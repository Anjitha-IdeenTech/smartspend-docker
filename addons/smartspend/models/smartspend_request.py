from datetime import datetime

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import formatLang

# The portal speaks in labels, Odoo stores keys. Keeping the labels identical to
# the ones the React app renders means the serialiser is a plain dict lookup and
# a request round-trips through the API unchanged.
STATE_SELECTION = [
    ('draft', 'Draft'),
    ('to_approve', 'Pending Approval'),
    ('clarification', 'Needs Clarification'),
    ('sourcing', 'Sourcing'),
    ('approved', 'Approved'),
    ('po_confirmed', 'PO Confirmed'),
    ('rejected', 'Rejected'),
    ('paid', 'Paid'),
    # A request withdrawn before it was ordered. Appended last so every key the
    # portal already knows keeps its meaning and its position in the list the
    # /master-data route serves.
    ('cancelled', 'Cancelled'),
]
URGENCY_SELECTION = [('high', 'High'), ('medium', 'Medium'), ('low', 'Low')]
# How an uncontracted request is taken to market. The keys predate the wording
# and are left alone — a stored 'rfq' means the same thing it always did.
SOURCING_SELECTION = [('direct', 'Negotiation'), ('rfq', 'Multi RFQ'), ('auction', 'Bidding')]

# States at or beyond the point where an order exists. Confirming an order
# must never pull a request back to "PO Confirmed" from one of these: a paid
# request has moved past the confirmation, and a closed one is not reopened by
# activity on an order it no longer owns.
SETTLED_STATES = ('po_confirmed', 'paid', 'rejected', 'cancelled')

STATE_BY_LABEL = {label: key for key, label in STATE_SELECTION}
URGENCY_BY_LABEL = {label: key for key, label in URGENCY_SELECTION}
SOURCING_BY_LABEL = {label: key for key, label in SOURCING_SELECTION}
SOURCING_BY_LABEL.update({'Direct': 'direct', 'RFQ': 'rfq', 'Auction': 'auction'})

# How the portal renders the two dates. We emit exactly these so the value the
# app sends back on the next save parses into the same record.
DISPLAY_DATETIME_FORMAT = '%B %d, %H:%M'
DISPLAY_DATE_FORMAT = '%b %d, %Y'

_DATETIME_INPUT_FORMATS = (
    DISPLAY_DATETIME_FORMAT, '%b %d, %H:%M',
    '%B %d, %Y %H:%M', '%b %d, %Y %H:%M',
    '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S',
)
_DATE_INPUT_FORMATS = (DISPLAY_DATE_FORMAT, '%B %d, %Y', '%Y-%m-%d', '%d/%m/%Y')


def parse_display_datetime(value):
    """Parse a portal date-time label back into a naive datetime, or ``False``."""
    if isinstance(value, datetime):
        return value
    if not value or not isinstance(value, str):
        return False
    for fmt in _DATETIME_INPUT_FORMATS:
        try:
            parsed = datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
        # "%B %d, %H:%M" carries no year, and strptime defaults it to 1900.
        return parsed.replace(year=fields.Date.today().year) if parsed.year == 1900 else parsed
    return False


def portal_quantity(value):
    """Read a quantity off the portal, never below one.

    The composer's quantity box is a free number input: emptying it posts a 0,
    and Odoo now refuses a line with no quantity. Clamping here keeps that
    typo from silently costing the employee the whole save, and one unit is
    what the field defaults to anyway. The parser already treats a staged
    quantity the same way.
    """
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        return 1.0
    return quantity if quantity > 0 else 1.0


def portal_price(value):
    """Read a unit price off the portal; a negative one is a typo, not a credit."""
    try:
        price = float(value)
    except (TypeError, ValueError):
        return 0.0
    return price if price >= 0 else 0.0


def parse_display_date(value):
    """Parse a portal date label back into a ``date``, or ``False``."""
    if not value or not isinstance(value, str):
        return False
    for fmt in _DATE_INPUT_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return False


class SmartspendRequest(models.Model):
    _name = 'smartspend.request'
    _description = 'SmartSpend Purchase Request'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'request_date desc, id desc'
    _check_company_auto = True

    name = fields.Char(
        string='Reference', required=True, copy=False, readonly=True,
        default=lambda self: _('New'), index=True)
    active = fields.Boolean(default=True)
    # Marks a request the demo seeder created. "Reset demo data" restores only
    # these: it used to wipe the table, which took real work with it every time
    # somebody reset — including on the sign-out button it used to share.
    demo_seed = fields.Boolean(
        string='Seeded Demo Record', default=False, copy=False, index=True,
        help="Created by the demo seeder. Only these are replaced when the demo "
             "data is reset; anything raised through the portal is left alone.")
    state = fields.Selection(
        STATE_SELECTION, string='Status', default='draft', required=True,
        tracking=True, copy=False)
    user_id = fields.Many2one(
        'res.users', string='Requested by', default=lambda self: self.env.user,
        required=True, tracking=True, index=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id', string='Currency')
    description = fields.Text(
        string='Description', tracking=True,
        help="What is being asked for, and why. Free text — the portal does not "
             "collect it today, so it is filled in from Odoo.")
    notes = fields.Text(
        string='Internal Notes',
        help="Working notes for the buyer and the approver. Never shown to the requester.")

    # -- Flat summary the portal shows on a request card. Lines are the source
    # -- of truth; these are derived so the two can never drift apart.
    product_name = fields.Char(
        string='Product', compute='_compute_summary', store=True,
        help="First requested product — the label the portal shows on the request card.")
    product_qty = fields.Float(
        string='Total Quantity', compute='_compute_summary', store=True, digits='Product Unit')
    target_price = fields.Monetary(
        string='Target Unit Price', compute='_compute_summary', store=True)
    total_cost = fields.Monetary(
        string='Estimated Cost', compute='_compute_summary', store=True, tracking=True)

    # The portal exchanges labels; Odoo files against records. Both are kept:
    # the Char is the API surface, the Many2one is what reporting and budgets use.
    location = fields.Char(string='Branch / Site', tracking=True)
    department = fields.Char(tracking=True)
    expense_category = fields.Char(string='Expense Category', tracking=True)
    branch_id = fields.Many2one('smartspend.branch', string='Branch', tracking=True,
                                check_company=True, index='btree_not_null')
    department_id = fields.Many2one('smartspend.department', string='Department Record',
                                    tracking=True, check_company=True, index='btree_not_null')
    category_id = fields.Many2one('smartspend.expense.category', string='Expense Category Record',
                                  tracking=True, check_company=True, index='btree_not_null')
    expense_type = fields.Selection(related='category_id.expense_type', string='Expense Type', store=True)
    urgency = fields.Selection(URGENCY_SELECTION, default='medium', required=True, tracking=True)
    sourcing_method = fields.Selection(
        SOURCING_SELECTION, string='Contract Method', default='direct', required=True,
        help="How this spend is taken to market when no rate contract covers it.")
    buyer_ref = fields.Char(string='Buyer Code', help="SCM buyer desk that owns the sourcing, e.g. SCM-IT-14.")

    partner_id = fields.Many2one('res.partner', string='Vendor', tracking=True)
    vendor_name = fields.Char(
        string='Vendor Name', help="Vendor as named by the portal, kept even when no Odoo contact matches yet.")
    savings = fields.Monetary(string='Negotiated Savings', tracking=True)

    request_date = fields.Datetime(
        string='Requested On', default=fields.Datetime.now, required=True, tracking=True)
    delivery_date = fields.Date(string='Needed By', tracking=True)

    # -- Who did what, and when. The timeline below reads well but is free text;
    # -- these are the fields reporting and future approval routing filter on.
    submitted_by_id = fields.Many2one(
        'res.users', string='Submitted by', readonly=True, copy=False,
        help="Who last sent this request for approval.")
    submitted_on = fields.Datetime(string='Submitted On', readonly=True, copy=False)
    cancelled_by_id = fields.Many2one(
        'res.users', string='Cancelled by', readonly=True, copy=False)
    cancelled_on = fields.Datetime(string='Cancelled On', readonly=True, copy=False)
    cancel_reason = fields.Text(string='Cancellation Reason', readonly=True, copy=False, tracking=True)
    delegated = fields.Boolean(
        string='Raised on Behalf', compute='_compute_delegated', store=True,
        help="The account that created this record is not the one the request is for.")

    line_ids = fields.One2many('smartspend.request.line', 'request_id', string='Requested Items', copy=True)
    bid_ids = fields.One2many('smartspend.request.bid', 'request_id', string='Vendor Bids', copy=False)
    history_ids = fields.One2many('smartspend.request.history', 'request_id', string='Timeline', copy=False)
    comment_ids = fields.One2many('smartspend.request.comment', 'request_id', string='Clarifications', copy=False)
    document_ids = fields.One2many('smartspend.request.document', 'request_id', string='Documents', copy=False)

    # -- Rate contract ------------------------------------------------------
    contract_id = fields.Many2one(
        'smartspend.contract', string='Rate Contract', tracking=True,
        help="Pre-negotiated agreement covering these items. Set by 'Check Rate Contract'.")
    contract_partner_id = fields.Many2one(related='contract_id.partner_id', string='Contracted Vendor')
    contract_reference = fields.Char(related='contract_id.name', string='Contract Reference')
    # What the matched agreement actually commits the vendor to. Held on the
    # contract, but this is where a buyer reads them — deciding whether to order
    # against it means knowing the lead time and the terms, not just the rate.
    contract_category = fields.Char(
        related='contract_id.category', string='Contract Category', readonly=True)
    contract_lead_time = fields.Char(
        related='contract_id.lead_time', string='Contracted Lead Time', readonly=True)
    contract_warranty = fields.Char(
        related='contract_id.warranty', string='Contracted Warranty', readonly=True)
    contract_payment_terms = fields.Char(
        related='contract_id.payment_terms', string='Contracted Payment Terms', readonly=True)
    contract_date_end = fields.Date(
        related='contract_id.date_end', string='Contract Valid Until', readonly=True)
    has_contract = fields.Boolean(compute='_compute_contract_figures', store=True)
    contract_count = fields.Integer(compute='_compute_contract_figures', store=True)
    contract_value = fields.Monetary(
        string='Value at Contract Rates', compute='_compute_contract_figures', store=True)
    contract_savings = fields.Monetary(
        string='Saving vs Target', compute='_compute_contract_figures', store=True)
    contract_coverage = fields.Float(
        string='Lines Covered (%)', compute='_compute_contract_figures', store=True,
        help="Share of the requested lines priced by the matched rate contract.")
    contract_match_label = fields.Char(
        string='Rates Applied', compute='_compute_contract_match_label',
        help="How much of the matched rate card this request uses. A rate contract "
             "prices a catalogue; a request draws on a slice of it.")

    # -- Budget -------------------------------------------------------------
    # -- The approval chain this request is running, copied from the workflow
    # -- master when it was submitted. See smartspend_workflow.py.
    workflow_id = fields.Many2one(
        'smartspend.workflow', string='Approval Workflow', readonly=True, copy=False,
        help="The workflow matched when this request was submitted. Its approvers "
             "were copied onto the request, so editing the master later does not "
             "rewrite an approval already given.")
    approval_ids = fields.One2many(
        'smartspend.request.approval', 'request_id', string='Approval Chain', copy=False)
    approval_level = fields.Integer(
        string='Current Level', compute='_compute_approval_progress', store=True,
        help="Order number of the step the request is waiting on. Zero when the "
             "chain is finished or there is none.")
    approval_next_id = fields.Many2one(
        'smartspend.request.approval', string='Waiting On',
        compute='_compute_approval_progress', store=True)
    approval_done = fields.Integer(compute='_compute_approval_progress', store=True)
    approval_total = fields.Integer(compute='_compute_approval_progress', store=True)

    budget_id = fields.Many2one(
        'smartspend.budget', string='Budget', compute='_compute_budget',
        help="Narrowest running budget covering this request's department, branch and category.")
    budget_available = fields.Monetary(
        string='Budget Available', compute='_compute_budget',
        help="What is left in that budget once this request's own claim is set aside.")
    budget_breach = fields.Boolean(
        string='Over Budget', compute='_compute_budget',
        help="This request costs more than its budget has left.")

    # -- Cost centre --------------------------------------------------------
    # The reference a later phase reserves budget against. Nothing is posted to
    # it yet: it is filled in from the department so the link already exists.
    analytic_account_id = fields.Many2one(
        'account.analytic.account', string='Cost Center', check_company=True,
        compute='_compute_analytic_account_id', store=True, readonly=False,
        help="Analytic account this spend belongs to. Defaults to the one held "
             "by the requesting department.")

    # -- Documents ----------------------------------------------------------
    # Standard Odoo storage, so a file dropped on the chatter and one attached
    # from the Documents tab are the same record.
    attachment_ids = fields.One2many(
        'ir.attachment', 'res_id', string='Attached Files',
        domain=[('res_model', '=', 'smartspend.request')])
    attachment_count = fields.Integer(string='Files', compute='_compute_attachment_count')

    # -- Purchase orders ----------------------------------------------------
    purchase_order_ids = fields.One2many(
        'purchase.order', 'smartspend_request_id', string='Purchase Orders')
    purchase_order_count = fields.Integer(compute='_compute_purchase_order_count')
    purchase_order_live_count = fields.Integer(
        string='Open Orders', compute='_compute_purchase_order_count',
        help="Orders raised for this request that have not been cancelled. The "
             "smart button counts every order ever raised, history included; "
             "this is what decides whether another one may be raised.")

    # The two steps the portal drives once the order exists. They lived in the
    # React app as component state, so a reload or a change of role forgot them
    # — and a single pair of booleans stood for every request at once. Stored
    # here they belong to the request they describe, and the timeline entries
    # below record who took each step.
    po_released = fields.Boolean(
        string='PO Released', copy=False, readonly=True,
        help="The purchase head has approved the financial release terms, so the "
             "order document may go to the vendor.")
    po_acknowledged = fields.Boolean(
        string='PO Acknowledged', copy=False, readonly=True,
        help="The vendor has confirmed receipt of the order, the delivery commit "
             "date and the pricing.")

    settlement_pending = fields.Boolean(
        string='Bill Outstanding', compute='_compute_settlement_pending',
        help="A confirmed order on this request has no posted, fully paid bill "
             "behind it. A request that reached Paid before the bill was raised "
             "automatically is the usual case.")

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'A purchase request with this reference already exists.',
    )

    # ------------------------------------------------------------------
    # Computes
    # ------------------------------------------------------------------
    @api.depends('line_ids.product_name', 'line_ids.product_qty', 'line_ids.price_unit', 'line_ids.subtotal')
    def _compute_summary(self):
        for request in self:
            lines = request.line_ids
            request.product_name = lines[:1].product_name or ''
            request.product_qty = sum(lines.mapped('product_qty'))
            request.target_price = lines[:1].price_unit
            request.total_cost = sum(lines.mapped('subtotal'))

    @api.depends('contract_id', 'contract_id.line_ids.price_unit',
                 'line_ids.product_name', 'line_ids.product_qty', 'line_ids.price_unit',
                 'line_ids.contract_line_id')
    def _compute_contract_figures(self):
        for request in self:
            contract, lines = request.contract_id, request.line_ids
            covered = lines.filtered('contract_line_id')
            # An agreement only counts as this request's when it actually prices
            # something on it — otherwise the smart button would advertise a
            # contract that has nothing to do with these items.
            request.has_contract = bool(contract and covered)
            request.contract_count = 1 if (contract and covered) else 0
            if not contract or not lines:
                request.contract_value = 0.0
                request.contract_savings = 0.0
                request.contract_coverage = 0.0
                continue
            # Uncovered lines still cost their target price, so count them in.
            request.contract_value = sum(
                line.product_qty * (line.contract_price if line.contract_line_id else line.price_unit)
                for line in lines
            )
            request.contract_savings = request.total_cost - request.contract_value
            request.contract_coverage = 100.0 * len(covered) / len(lines)

    @api.depends('contract_id', 'line_ids', 'line_ids.contract_line_id')
    def _compute_contract_match_label(self):
        """How much of *this request* the agreement prices.

        Counted against the request's own items, not the rate card's rates:
        a card holding three rates that price three of four requested items is
        not "3 of 3" — that reads as fully covered while an item is going
        unpriced. This says the same thing as Lines Covered (%) beside it.
        """
        for request in self:
            if not request.contract_id:
                request.contract_match_label = ''
                continue
            priced = len(request.line_ids.filtered('contract_line_id'))
            items = len(request.line_ids)
            request.contract_match_label = _(
                "%(priced)s of %(items)s items priced", priced=priced, items=items)

    @api.depends('department_id', 'branch_id', 'category_id', 'request_date', 'total_cost', 'company_id')
    def _compute_budget(self):
        Budget = self.env['smartspend.budget'].sudo()
        for request in self:
            budget = Budget._match_for_request(request)
            request.budget_id = budget
            if not budget:
                request.budget_available = 0.0
                request.budget_breach = False
                continue
            available = budget._available_excluding(request)
            request.budget_available = available
            request.budget_breach = request.total_cost > available

    @api.depends('create_uid', 'user_id')
    def _compute_delegated(self):
        for request in self:
            request.delegated = bool(
                request.create_uid and request.user_id and request.create_uid != request.user_id)

    @api.depends('department_id', 'department_id.analytic_account_id')
    def _compute_analytic_account_id(self):
        for request in self:
            # Never clear a cost centre somebody set by hand.
            request.analytic_account_id = (
                request.department_id.analytic_account_id or request.analytic_account_id)

    def _compute_attachment_count(self):
        # A requester may read their own attachments but not search them freely.
        counts = dict(self.env['ir.attachment'].sudo()._read_group(
            [('res_model', '=', self._name), ('res_id', 'in', self.ids)],
            ['res_id'], ['__count']))
        for request in self:
            request.attachment_count = counts.get(request.id, 0)

    @api.depends('purchase_order_ids', 'purchase_order_ids.state')
    def _compute_purchase_order_count(self):
        # Requesters may not read purchase.order; the count is theirs to see.
        for request in self.sudo():
            orders = request.purchase_order_ids
            request.purchase_order_count = len(orders)
            request.purchase_order_live_count = len(
                orders.filtered(lambda order: order.state != 'cancel'))

    # ------------------------------------------------------------------
    # Constraints
    # ------------------------------------------------------------------
    @api.constrains('request_date', 'delivery_date')
    def _check_request_dates(self):
        for request in self:
            if not request.request_date:
                raise ValidationError(_("%s needs a request date.", request.name))
            if request.delivery_date and request.delivery_date < request.request_date.date():
                raise ValidationError(_(
                    "%(request)s is needed by %(needed)s, which is before it was raised "
                    "on %(raised)s. Pick a date on or after the request date.",
                    request=request.name,
                    needed=fields.Date.to_string(request.delivery_date),
                    raised=fields.Date.to_string(request.request_date.date())))

    @api.constrains('user_id')
    def _check_requester(self):
        # OdooBot is archived by design. A request it raises is a cron, a data
        # load or a shell session — not one filed against somebody who has left.
        root = self.env.ref('base.user_root', raise_if_not_found=False)
        for request in self:
            # Read as superuser: a requester may not read other users' records,
            # and refusing the write for that reason would be misleading.
            requester = request.user_id.sudo()
            if requester == root or requester.active:
                continue
            raise ValidationError(_(
                "%(request)s is filed against %(user)s, whose account is archived.",
                request=request.name, user=requester.name))

    # ``currency_id`` is a non-stored related, so it cannot be watched here —
    # the company it hangs off can, and that is what actually decides it.
    @api.constrains('company_id')
    def _check_company_currency(self):
        for request in self:
            if not request.company_id:
                raise ValidationError(_("%s needs a company.", request.name))
            if not request.currency_id:
                raise ValidationError(_(
                    "%(company)s has no currency, so %(request)s cannot be valued.",
                    company=request.company_id.name, request=request.name))

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('smartspend.request') or _('New')
        requests = super().create(vals_list)
        for request in requests:
            if not request.history_ids:
                request._log_history(
                    _("Request Submitted"),
                    _("Raised by %(requester)s (created by %(author)s)",
                      requester=request.user_id.name, author=request.create_uid.name)
                    if request.delegated else _("Raised by %s", request.user_id.name),
                    state_to=request.state)
            if request.contract_id:
                request._log_contract_match()
            else:
                request._autofill_contract()
        return requests

    @api.depends('purchase_order_ids.state', 'purchase_order_ids.invoice_status',
                 'purchase_order_ids.invoice_ids.state',
                 'purchase_order_ids.invoice_ids.payment_state')
    def _compute_settlement_pending(self):
        for request in self:
            # sudo: a buyer may read the request without rights on the bills
            # hanging off it, and the button has to appear for them all the same.
            orders = request.sudo().purchase_order_ids.filtered(
                lambda order: order.state == 'purchase')
            request.settlement_pending = any(
                order.invoice_status != 'invoiced'
                or any(bill.state == 'draft'
                       or bill.payment_state in ('not_paid', 'partial')
                       for bill in order.invoice_ids)
                for order in orders)

    def write(self, vals):
        # Read before the write: settling belongs to the move *into* Paid, not
        # to every later save of a request that is already there.
        arriving_at_paid = (
            self.filtered(lambda request: request.state != 'paid')
            if vals.get('state') == 'paid' else self.browse()
        )
        res = super().write(vals)
        # Items added after the first save still deserve their agreement.
        if 'line_ids' in vals:
            self._autofill_contract()
        # A status changed on the Odoo form leaves the same documents behind as
        # one changed from the app.
        for request in arriving_at_paid:
            request._settle_purchase_orders()
        return res

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _log_history(self, title, description=False, when=None, state_from=None, state_to=None):
        """Append one entry to the request timeline the portal renders.

        ``state_from`` / ``state_to`` are the audit half of the entry: the
        portal only ever shows the title, the date and the note, but a reviewer
        in Odoo can see which transition the entry stands for and who made it.
        """
        self.ensure_one()
        return self.env['smartspend.request.history'].create({
            'request_id': self.id,
            'title': title,
            'description': description or False,
            'event_date': when or fields.Datetime.now(),
            'user_id': self.env.user.id,
            'state_from': state_from or False,
            'state_to': state_to or False,
        })

    def _history_commands_from_portal(self, entries):
        """Merge the portal's timeline into the stored one instead of replacing it.

        The portal posts the whole request back on every change, timeline
        included. Overwriting the stored timeline with that copy dropped every
        entry Odoo had written since the browser last read the request, so the
        audit trail was only ever as good as the last refresh. Entries are
        merged in now: what Odoo already holds stays, and only genuinely new
        ones are appended.
        """
        known = {(entry.title or '', entry.description or '') for entry in self.history_ids}
        commands = []
        for entry in entries:
            title = entry.get('title') or _('Update')
            description = entry.get('desc') or ''
            if (title, description) in known:
                continue
            known.add((title, description))
            commands.append(fields.Command.create({
                'title': title,
                'description': description or False,
                'event_date': parse_display_datetime(entry.get('date')) or fields.Datetime.now(),
            }))
        return commands

    _MASTER_FIELDS = (
        ('branch_id', 'smartspend.branch', 'location'),
        ('department_id', 'smartspend.department', 'department'),
        ('category_id', 'smartspend.expense.category', 'expense_category'),
    )

    def _sync_master_records(self):
        """Reconcile the portal's labels with the master records they name.

        A request arriving from the portal carries names; one typed in Odoo
        carries records. Whichever side is filled in populates the other, so a
        request is always both readable by the portal and reportable in Odoo.
        """
        resolver = self.env['smartspend.master.mixin']
        for request in self:
            for field_name, model_name, label_field in self._MASTER_FIELDS:
                record, label = request[field_name], request[label_field]
                if not record and label:
                    match = resolver._resolve_master_record(
                        model_name, label, company=request.company_id)
                    if match:
                        request[field_name] = match
                elif record and not label:
                    request[label_field] = record.name

    @api.onchange('branch_id', 'department_id', 'category_id')
    def _onchange_master_records(self):
        for request in self:
            for field_name, _model_name, label_field in request._MASTER_FIELDS:
                if request[field_name]:
                    request[label_field] = request[field_name].name

    def _autofill_contract(self):
        """Match a rate contract as soon as a request has items to match on.

        The portal has always done this on every save. A request typed into
        Odoo used to sit with an empty agreement until somebody thought to
        press "Check Rate Contract" — so the rates, the coverage and the
        contracted vendor were all missing from a perfectly ordinary request.
        """
        for request in self:
            if request.contract_id or not request.line_ids:
                continue
            request.action_check_contract()

    def _log_contract_match(self):
        self.ensure_one()
        return self._log_history(
            _("Rate Contract Mapped"),
            _("%(contract)s with %(vendor)s covers this request.",
              contract=self.contract_id.name, vendor=self.contract_id.partner_id.name))

    @api.onchange('line_ids', 'partner_id')
    def _onchange_lines_match_contract(self):
        """Fill the agreement in as the items are typed, before saving.

        Matching only — the timeline entry is written on save, since an
        onchange must not create records.
        """
        for request in self:
            if request.contract_id or not request.line_ids:
                continue
            contract, _covered = self.env['smartspend.contract']._match_for_products(
                request.line_ids.mapped('product_name'), partner=request.partner_id)
            if contract:
                request.contract_id = contract

    def _sync_partner_from_vendor_name(self):
        """Resolve ``vendor_name`` to a contact, so the PO has someone to go to."""
        Partner = self.env['res.partner']
        for request in self:
            name = (request.vendor_name or '').strip()
            if not name or request.partner_id or name.lower() in ('pending sourcing', 'n/a', 'na'):
                continue
            partner = Partner.search([('name', '=ilike', name)], limit=1)
            if not partner:
                partner = Partner.create({'name': name, 'is_company': True, 'supplier_rank': 1})
            request.partner_id = partner

    # ------------------------------------------------------------------
    # Workflow
    # ------------------------------------------------------------------
    def _validate_for_submission(self):
        """Everything that has to be true before a request may leave the requester.

        The portal fills all of this in from its own dropdowns, so this is what
        catches a request typed straight into Odoo — and what a future phase
        will lean on before it reserves budget or resolves an approver.
        """
        self.ensure_one()
        if self.state in ('po_confirmed', 'paid'):
            raise UserError(_("%s has already been ordered; it cannot be submitted again.", self.name))
        if not self.line_ids:
            raise UserError(_("Add at least one item before submitting %s.", self.name))

        missing = []
        if not (self.department_id or self.department):
            missing.append(_("Department"))
        if not (self.branch_id or self.location):
            missing.append(_("Branch / Site"))
        if not (self.category_id or self.expense_category):
            missing.append(_("Expense Category"))
        if not self.delivery_date:
            missing.append(_("Needed By date"))
        if missing:
            raise UserError(_(
                "%(request)s is missing: %(fields)s.",
                request=self.name, fields=", ".join(missing)))

        # The line and header constraints already hold for a saved record; run
        # them again so a request built in one transaction is checked here too,
        # where the message can name the item rather than the field.
        for line in self.line_ids:
            if line.product_qty <= 0:
                raise UserError(_("\"%s\" is requested with no quantity.", line.product_name))
            if line.price_unit < 0:
                raise UserError(_("\"%s\" carries a negative unit price.", line.product_name))
            if not line.product_uom_id:
                raise UserError(_("\"%s\" has no unit of measure.", line.product_name))
        return True

    @api.depends('approval_ids.state', 'approval_ids.sequence')
    def _compute_approval_progress(self):
        """Where the chain has got to: what it waits on, and how far it is through."""
        for request in self:
            steps = request.approval_ids.sorted('sequence')
            waiting = steps.filtered(lambda s: s.state == 'pending')[:1]
            request.approval_next_id = waiting
            request.approval_level = waiting.sequence if waiting else 0
            request.approval_done = len(steps.filtered(lambda s: s.state == 'approved'))
            request.approval_total = len(steps)

    def _build_approval_chain(self):
        """Match this request to a workflow and copy its approvers onto it.

        Run on submission rather than on creation: a draft's department, category
        and value all still move, and the chain has to be the one that fits what
        was actually submitted.
        """
        self.ensure_one()
        workflow = self.env['smartspend.workflow'].sudo()._match(
            document_type='purchase_request',
            company=self.company_id,
            branch=self.branch_id,
            department=self.department_id,
            expense_type=self.category_id.expense_type,
            category=self.category_id,
            amount=self.total_cost,
        )
        # Written as the system, not as the requester. The chain is derived from
        # the master — the person submitting never chooses it — and letting a
        # requester create approval rows directly would let them forge their own
        # sign-offs. Their group is read-only on the model for that reason.
        #
        # Replace whatever a previous submission left behind: a request reset to
        # draft and resubmitted at a different value gets the chain for the new
        # value, not the old one.
        record = self.sudo()
        record.approval_ids = [fields.Command.clear()]
        record.workflow_id = workflow
        if workflow:
            record.approval_ids = workflow._approval_commands()
            self._log_history(
                _("Approval Workflow Applied"),
                _("%(workflow)s · %(count)s approval step(s): %(chain)s",
                  workflow=workflow.name, count=len(workflow.approver_ids),
                  chain=" → ".join(workflow.approver_ids.sorted('sequence')
                                   .mapped('designation_id.name'))))
        else:
            # No rule covers it. Said out loud rather than silently letting the
            # request through on a single generic approval.
            self._log_history(
                _("No Approval Workflow Matched"),
                _("No configured workflow covers this company, department, category "
                  "and value. It follows the standard single approval."))
        return workflow

    def action_submit(self):
        """Send the request for approval, and stamp who did so and when."""
        for request in self:
            request._validate_for_submission()
            # The totals are stored computes: make sure the value being
            # submitted is the one the lines actually add up to, not a stale
            # cache from earlier in the transaction.
            request.line_ids.flush_recordset()
            request.invalidate_recordset(['total_cost', 'product_qty', 'target_price'])
            # Match the workflow now the totals are settled — the amount slab is
            # part of what decides who has to sign.
            request._build_approval_chain()
            previous = request.state
            request.write({
                'state': 'to_approve',
                'submitted_by_id': self.env.user.id,
                'submitted_on': fields.Datetime.now(),
                'cancelled_by_id': False,
                'cancelled_on': False,
            })
            note = _(
                "Submitted by %(user)s · %(count)s line(s) · %(total)s",
                user=self.env.user.name,
                count=len(request.line_ids),
                total=formatLang(self.env, request.total_cost, currency_obj=request.currency_id))
            request._log_history(
                _("Submitted for Approval"), note, state_from=previous, state_to='to_approve')
            request.message_post(body=note)
        return True

    def _apply_cancel(self, reason=None):
        """Withdraw a request without deleting it, and record who did it and why."""
        for request in self:
            if request.state == 'cancelled':
                raise UserError(_("%s is already cancelled.", request.name))
            if request.state in ('po_confirmed', 'paid'):
                raise UserError(_(
                    "%s has already been ordered — cancel its purchase order first.", request.name))
            live_orders = request.sudo().purchase_order_ids.filtered(lambda o: o.state != 'cancel')
            if live_orders:
                raise UserError(_(
                    "%(request)s still has %(orders)s open. Cancel the order first.",
                    request=request.name, orders=", ".join(live_orders.mapped('name'))))

            previous = request.state
            reason = (reason or request.cancel_reason or '').strip()
            request.write({
                'state': 'cancelled',
                'cancelled_by_id': self.env.user.id,
                'cancelled_on': fields.Datetime.now(),
                'cancel_reason': reason or False,
            })
            note = _(
                "Cancelled by %(user)s from %(previous)s%(reason)s",
                user=self.env.user.name,
                previous=dict(STATE_SELECTION).get(previous, previous),
                reason=_(" — %s", reason) if reason else '')
            request._log_history(
                _("Request Cancelled"), note, state_from=previous, state_to='cancelled')
            request.message_post(body=note)
        return True

    def action_cancel(self):
        """Ask for the reason, then cancel. Cancelling is an audit event, not a click."""
        return {
            'type': 'ir.actions.act_window',
            'name': _('Cancel Purchase Request'),
            'res_model': 'smartspend.request.cancel',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_request_ids': self.ids},
        }

    def action_request_clarification(self):
        for request in self:
            previous = request.state
            request.state = 'clarification'
            request._log_history(
                _("Info Requested"), _("Approver asked for clarification"),
                state_from=previous, state_to='clarification')
            request.message_post(body=_(
                "%s asked the requester for more information.", self.env.user.name))
        return True

    def action_approve(self):
        """Ask for the approver's note, then approve.

        Optional, unlike the reason a cancellation demands: an approval that
        needs no explanation must not be held up for one. When it is given it
        goes where the requester will actually read it — the clarification
        thread the portal renders — as well as the timeline and the chatter.
        """
        return {
            'type': 'ir.actions.act_window',
            'name': _('Approve Purchase Request'),
            'res_model': 'smartspend.request.approve',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_request_ids': self.ids},
        }

    def _apply_approve(self, note=None):
        """Approve, recording the approver's note when there is one.

        When the request is running a configured chain this signs one step. The
        request only reaches Approved once every step has been signed — with a
        three-level chain, the first two approvals leave it Pending Approval and
        waiting on the next designation.
        """
        note = (note or '').strip()
        for request in self:
            previous = request.state
            step = request.approval_next_id
            if step:
                if not step._may_be_signed_by(self.env.user):
                    raise UserError(_(
                        "%(request)s is waiting on the %(designation)s. Your account "
                        "does not hold that designation.",
                        request=request.name, designation=step.designation_id.name))
                step.write({
                    'state': 'approved',
                    'user_id': self.env.user.id,
                    'decided_on': fields.Datetime.now(),
                    'note': note or False,
                })
                # Recompute before asking what is left, or the next step is read
                # off a cache that still shows this one pending.
                request.invalidate_recordset(
                    ['approval_next_id', 'approval_level', 'approval_done'])
                remaining = request.approval_next_id
                request._log_history(
                    _("Approved · Level %(level)s of %(total)s",
                      level=step.sequence, total=request.approval_total),
                    _("%(designation)s signed by %(user)s%(note)s",
                      designation=step.designation_id.name, user=self.env.user.name,
                      note=_(" — %s", note) if note else ''))
                if remaining:
                    # More signatures owed: it stays where it is, now waiting on
                    # the next designation in the chain.
                    request.message_post(body=_(
                        "%(designation)s approved by %(user)s. Now waiting on %(next)s.",
                        designation=step.designation_id.name, user=self.env.user.name,
                        next=remaining.designation_id.name))
                    if note:
                        request.comment_ids = [fields.Command.create({
                            'role': 'manager', 'text': note,
                        })]
                    continue
            request.state = 'approved'
            request._log_history(
                _("Approved"),
                _("Approved by %(user)s — %(note)s", user=self.env.user.name, note=note)
                if note else _("Approved by %s", self.env.user.name),
                state_from=previous, state_to='approved')
            if note:
                request.comment_ids = [fields.Command.create({
                    'role': 'manager',
                    'text': note,
                })]
            request.message_post(body=_(
                "Approved by %(user)s.%(note)s", user=self.env.user.name,
                note=_(" Note: %s", note) if note else ''))
        return True

    def action_reject(self):
        for request in self:
            previous = request.state
            # Record the refusal on the step it stopped at, so the chain shows
            # where it died rather than a row still reading "waiting".
            if request.approval_next_id:
                request.approval_next_id.write({
                    'state': 'rejected',
                    'user_id': self.env.user.id,
                    'decided_on': fields.Datetime.now(),
                })
            request.state = 'rejected'
            request._log_history(
                _("Rejected"), _("Rejected by %s", self.env.user.name),
                state_from=previous, state_to='rejected')
            request.message_post(body=_("Rejected by %s.", self.env.user.name))
        return True

    def action_start_sourcing(self):
        for request in self:
            previous = request.state
            request.state = 'sourcing'
            request._log_history(
                _("Sourcing Triggered"),
                _("No active rate contract found. Routed to the SCM buyer.")
                if not request.contract_id else _("Routed to the SCM buyer."),
                state_from=previous, state_to='sourcing')
            request.message_post(body=_(
                "Sourcing started by %(user)s.%(contract)s", user=self.env.user.name,
                contract='' if request.contract_id
                else _(" No active rate contract covers it.")))
        return True

    def action_reset_draft(self):
        for request in self:
            previous = request.state
            if previous == 'draft':
                continue
            request.write({
                'state': 'draft',
                'cancelled_by_id': False,
                'cancelled_on': False,
                'cancel_reason': False,
                'submitted_by_id': False,
                'submitted_on': False,
            })
            request._log_history(
                _("Reset to Draft"),
                _("Reopened by %(user)s from %(previous)s",
                  user=self.env.user.name,
                  previous=dict(STATE_SELECTION).get(previous, previous)),
                state_from=previous, state_to='draft')
            request.message_post(body=_(
                "Reset to draft by %(user)s, from %(previous)s.",
                user=self.env.user.name,
                previous=dict(STATE_SELECTION).get(previous, previous)))
        return True

    def action_check_contract(self):
        """Match the request against the running rate contracts."""
        for request in self:
            contract, covered = self.env['smartspend.contract']._match_for_products(
                request.line_ids.mapped('product_name'), partner=request.partner_id)
            request.contract_id = contract
            if contract:
                request._log_history(
                    _("Rate Contract Mapped"),
                    _("%(contract)s with %(vendor)s covers %(covered)s of %(total)s lines.",
                      contract=contract.name, vendor=contract.partner_id.name,
                      covered=len(covered), total=len(request.line_ids)))
                request.message_post(body=_(
                    "Rate contract %(contract)s matched: %(covered)s of %(total)s lines priced.",
                    contract=contract.name, covered=len(covered), total=len(request.line_ids)))
            else:
                request._log_history(
                    _("No Active Contract Found"),
                    _("No running agreement covers these items — sourcing is required."))
                request.message_post(body=_(
                    "No running rate contract covers these items — sourcing is required."))
        return True

    def action_apply_contract_rates(self):
        """Reprice the covered lines at their contracted rate."""
        for request in self:
            if not request.contract_id:
                raise UserError(_("%s has no matched rate contract to apply.", request.name))
            repriced = 0
            for line in request.line_ids.filtered('contract_line_id'):
                if line.price_unit != line.contract_price:
                    line.price_unit = line.contract_price
                    repriced += 1
            if not request.partner_id:
                request.partner_id = request.contract_id.partner_id
                request.vendor_name = request.contract_id.partner_id.name
            request._log_history(
                _("Contract Rates Applied"),
                _("%(count)s line(s) repriced at the %(contract)s rate card.",
                  count=repriced, contract=request.contract_id.name))
            request.message_post(body=_(
                "%(count)s line(s) repriced at the %(contract)s rate card by %(user)s.",
                count=repriced, contract=request.contract_id.name, user=self.env.user.name))
        return True

    # ------------------------------------------------------------------
    # Purchase order
    # ------------------------------------------------------------------
    def _prepare_purchase_order_vals(self, partner):
        self.ensure_one()
        return {
            'partner_id': partner.id,
            'company_id': self.company_id.id,
            'origin': self.name,
            'date_order': fields.Datetime.now(),
            'smartspend_request_id': self.id,
            'smartspend_contract_id': self.contract_id.id or False,
        }

    def action_post_bill_payment(self):
        """Bill and pay an order by hand, for a request already sitting in Paid.

        The automatic settlement fires on the move *into* Paid. A request that
        was already there before that behaviour existed never crosses that
        line, so the only way it gets its documents is by asking.
        """
        for request in self:
            if not request.settlement_pending:
                raise UserError(
                    _("%s has no confirmed order waiting to be billed.", request.name))
            if request.state != 'paid':
                # The money is going out now, so the status has to say so — and
                # the write hook raises the documents on the way through.
                request.state = 'paid'
            else:
                request._settle_purchase_orders()
        return True

    def _settle_purchase_orders(self):
        """Post and pay the vendor bill for every order this request raised."""
        self.ensure_one()
        # The employee who marks a request paid in the portal is not an
        # accountant, and the documents still have to exist. Same reasoning as
        # the purchase order this request already creates on their behalf.
        settled = self.env['account.move']
        for order in self.sudo().purchase_order_ids:
            settled |= order._smartspend_settle()
        if settled:
            # Posted to the chatter rather than the timeline: the portal writes
            # its own "Vendor Bill Posted" line, and this one carries the real
            # Odoo references instead of a narrated placeholder.
            self.message_post(body=_(
                "Vendor bill %(bills)s posted and paid in full.",
                bills=", ".join(settled.mapped('name'))))

    def action_create_purchase_order(self):
        """Turn the request into a confirmed purchase order.

        Lines covered by the matched rate contract are priced at the contracted
        rate; the rest keep the requested target price.
        """
        self.ensure_one()
        if not self.line_ids:
            raise UserError(_("%s has no items to order.", self.name))

        # A purchase order commits the company's money, so it must not be raised
        # against a request that is still being approved. Enforced here rather
        # than in the portal because the buyer group is implied by the manager
        # group: without this a manager could order on a request that had
        # collected no signatures at all, and the order would sit next to an
        # approval chain still reading "0 of 1 signed".
        outstanding = self.approval_ids.filtered(lambda step: step.state == 'pending')
        if outstanding:
            raise UserError(_(
                "%(request)s is still waiting on the %(designation)s. A purchase order "
                "cannot be raised until every approval has been given.",
                request=self.name, designation=outstanding[0].designation_id.name))
        # Requests raised before the workflow master existed carry no chain, so
        # fall back to the state they are in.
        if not self.approval_ids and self.state in (
                'draft', 'to_approve', 'clarification', 'rejected', 'cancelled'):
            raise UserError(_(
                "%(request)s has not been approved yet — it is %(state)s.",
                request=self.name,
                state=dict(STATE_SELECTION).get(self.state, self.state)))
        # A cancelled order is spent history, not a commitment: it must not
        # stand in the way of raising a replacement. A live one still does.
        live = self.sudo().purchase_order_ids.filtered(lambda order: order.state != 'cancel')
        if live:
            raise UserError(_(
                "%(request)s already has %(orders)s open. Cancel it before raising another.",
                request=self.name, orders=", ".join(live.mapped('name'))))

        self._sync_partner_from_vendor_name()
        partner = self.partner_id or self.contract_id.partner_id
        if not partner:
            raise UserError(
                _("Set a vendor on %s (or match a rate contract) before creating a purchase order.", self.name))

        order = self.env['purchase.order'].create(self._prepare_purchase_order_vals(partner))
        for line in self.line_ids:
            order.order_line = [(0, 0, line._prepare_purchase_order_line_vals(order))]

        # Sourcing is over once the order exists: stop showing the request as
        # "Pending Sourcing" in the portal when the contract named the vendor.
        if not self.partner_id:
            self.partner_id = partner
        if (self.vendor_name or '').strip().lower() in ('', 'pending sourcing', 'n/a', 'na'):
            self.vendor_name = partner.name

        # Read the state before confirming: the confirmation moves the request
        # to "PO Confirmed" itself, and the timeline entry below has to record
        # where it came *from*, not where it has just arrived.
        previous = self.state
        # A replacement order is released on its own signature: the approval
        # that sent the cancelled one to the vendor does not carry over.
        self.po_released = False
        self.po_acknowledged = False
        # A draft order reads "RFQ" in Odoo. Leaving it draft means a request
        # the portal has taken all the way to paid still points at an order
        # that says nobody has committed to it. The flag suppresses the
        # override's own timeline line — "PO Created" below covers this action.
        order.with_context(smartspend_po_created=True).button_confirm()
        self.state = 'po_confirmed'
        self._log_history(
            _("PO Created: %s", order.name),
            _("Sent to %s", partner.name),
            state_from=previous, state_to='po_confirmed')
        self.message_post(body=_("Purchase order %s created from this request.", order.name))
        return self.action_view_purchase_orders()

    def action_release_purchase_order(self):
        """Record the purchase head's release of the order to the vendor.

        Idempotent: the portal shows the button to anyone holding the role, and
        a second click must not write a second timeline entry.
        """
        self.ensure_one()
        live = self.sudo().purchase_order_ids.filtered(lambda order: order.state != 'cancel')
        if not live:
            raise UserError(_(
                "%s has no open purchase order to release. Raise the order first.",
                self.name))
        if self.po_released:
            return True
        self.po_released = True
        self._log_history(
            _("Approved by Purchase Head"),
            _("%s approved and released to vendor.", ", ".join(live.mapped('name'))))
        self.message_post(body=_(
            "Purchase order released to the vendor by %s.", self.env.user.name))
        return True

    def action_acknowledge_purchase_order(self):
        """Record the vendor's acknowledgment of the released order.

        The steps run in order: there is nothing for a vendor to confirm until
        the purchase head has actually released the document to them.
        """
        self.ensure_one()
        if not self.po_released:
            raise UserError(_(
                "%s has not been released by the purchase head yet.", self.name))
        if self.po_acknowledged:
            return True
        self.po_acknowledged = True
        self._log_history(
            _("Vendor Acknowledged PO"),
            _("Vendor confirmed delivery commit date & pricing."))
        self.message_post(body=_(
            "Vendor acknowledgment recorded by %s.", self.env.user.name))
        return True

    # ------------------------------------------------------------------
    # Smart buttons
    # ------------------------------------------------------------------
    def action_view_purchase_orders(self):
        self.ensure_one()
        action = {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Orders for %s', self.name),
            'res_model': 'purchase.order',
            'domain': [('smartspend_request_id', '=', self.id)],
            'context': {
                'default_smartspend_request_id': self.id,
                'default_partner_id': self.partner_id.id or False,
                'default_origin': self.name,
            },
        }
        if len(self.purchase_order_ids) == 1:
            action.update(view_mode='form', res_id=self.purchase_order_ids.id)
        else:
            action.update(view_mode='list,form')
        return action

    def action_view_attachments(self):
        """The files filed against this request, wherever they were dropped."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Files on %s', self.name),
            'res_model': 'ir.attachment',
            'view_mode': 'kanban,list,form',
            'domain': [('res_model', '=', self._name), ('res_id', '=', self.id)],
            'context': {'default_res_model': self._name, 'default_res_id': self.id},
        }

    def action_view_contract(self):
        """Open the matched agreement, showing the rates that price this request.

        A rate contract prices a catalogue; a request draws on a slice of it.
        Landing on the whole card read as the request's own items being wrong,
        so the request travels in the context and the agreement opens on a tab
        holding just its rates — with the full card one tab away.
        """
        self.ensure_one()
        if not self.contract_id:
            raise UserError(_("No rate contract is mapped to %s yet.", self.name))
        return {
            'type': 'ir.actions.act_window',
            'name': _('%(contract)s rates for %(request)s',
                      contract=self.contract_id.name, request=self.name),
            'res_model': 'smartspend.contract',
            'view_mode': 'form',
            'res_id': self.contract_id.id,
            'context': dict(self.env.context, smartspend_request_id=self.id),
        }


    # ------------------------------------------------------------------
    # Portal (REST API) serialisation
    # ------------------------------------------------------------------
    # The React portal exchanges one flat JSON shape, ``RequestItem``. These two
    # methods are the only place that shape is spelled out.
    def _to_portal_dict(self):
        """Serialise the request into the portal's ``RequestItem`` shape."""
        self.ensure_one()
        qty = self.product_qty
        return {
            'id': self.name,
            'productName': self.product_name or '',
            'productQty': int(qty) if float(qty).is_integer() else qty,
            'targetPrice': self.target_price,
            'totalCost': self.total_cost,
            'location': self.location or '',
            'department': self.department or '',
            'expenseCategory': self.expense_category or '',
            'status': dict(STATE_SELECTION).get(self.state, 'Draft'),
            'urgency': dict(URGENCY_SELECTION).get(self.urgency, 'Medium'),
            'createdDate': self.request_date.strftime(DISPLAY_DATETIME_FORMAT) if self.request_date else '',
            # A sortable companion to createdDate. That one is a display label
            # ("September 03, 10:11") with no year, so the portal cannot order
            # by it; without this the approver's queue depends on the order the
            # API happened to return and a freshly submitted request can land
            # anywhere in the list.
            'submittedAt': (self.submitted_on or self.request_date or self.create_date or '')
                           and (self.submitted_on or self.request_date or self.create_date).isoformat(),
            # The configured approval chain this request is running, so the
            # portal can show who has signed and who it is waiting on.
            'workflow': self.workflow_id.name or '',
            'approvalLevel': self.approval_level,
            'approvalDone': self.approval_done,
            'approvalTotal': self.approval_total,
            'approvalChain': [{
                'order': step.sequence,
                'designation': step.designation_id.name,
                'state': step.state,
                'decidedBy': step.user_id.name or '',
                'decidedOn': step.decided_on.strftime(DISPLAY_DATETIME_FORMAT) if step.decided_on else '',
                'note': step.note or '',
                # Who actually holds this designation. Without it the portal can
                # name the role that has to sign but not the account to sign in
                # as, which leaves the chain unanswerable: "Finance CapEx Head"
                # is not something anyone can log in as.
                'holders': [{
                    'name': holder.name,
                    'login': holder.login,
                } for holder in step.designation_id.sudo().user_ids],
            } for step in self.approval_ids.sorted('sequence')],
            'deliveryDate': self.delivery_date.strftime(DISPLAY_DATE_FORMAT) if self.delivery_date else '',
            'buyer': self.buyer_ref or '',
            'vendor': self.vendor_name or self.partner_id.name or '',
            'savings': self.savings,
            'selectedSourcingMethod': dict(SOURCING_SELECTION).get(self.sourcing_method, 'Negotiation'),
            'attachments': self.document_ids.mapped('name'),
            'lineItems': [{
                'productName': line.product_name,
                'productQty': int(line.product_qty) if float(line.product_qty).is_integer() else line.product_qty,
                'targetPrice': line.price_unit,
            } for line in self.line_ids],
            'history': [{
                'title': entry.title,
                'date': entry.event_date.strftime(DISPLAY_DATETIME_FORMAT) if entry.event_date else '',
                'desc': entry.description or '',
            } for entry in self.history_ids],
            'clarificationComments': [{
                'role': comment.role,
                'text': comment.text,
                'date': comment.comment_date.strftime(DISPLAY_DATETIME_FORMAT) if comment.comment_date else '',
            } for comment in self.comment_ids],
            'vendorBids': [{
                'vendorName': bid.vendor_name,
                'price': bid.price,
                'leadTime': bid.lead_time or '',
                'warranty': bid.warranty or '',
                'status': bid.bid_status or '',
            } for bid in self.bid_ids],
            # Extras the portal ignores today but the backend can already answer.
            'contract': self.contract_id.name if self.has_contract else '',
            'contractVendor': self.contract_id.partner_id.name if self.has_contract else '',
            'contractCoverage': round(self.contract_coverage, 1),
            # A label, not a key: the portal renders it straight into the card.
            'contractCategory': self.contract_category or '',
            'purchaseOrders': self.sudo().purchase_order_ids.mapped('name'),
            'poReleased': self.po_released,
            'poAcknowledged': self.po_acknowledged,
            # A related Selection carries no labels of its own: read them off the
            # category, which is where the field is actually defined.
            'expenseType': dict(
                self.env['smartspend.expense.category']._fields['expense_type'].selection
            ).get(self.expense_type, ''),
            'budgetName': self.budget_id.name or '',
            'budgetAvailable': self.budget_available,
            'budgetBreach': self.budget_breach,
        }

    @api.model
    def _vals_from_portal(self, payload, record=None):
        """Translate one portal ``RequestItem`` into Odoo write values.

        Only the keys actually present in ``payload`` are mapped, so the portal
        can send a partial record without wiping the rest.

        :param record: the request being updated, when there is one. The
            timeline is merged against it rather than replaced — see
            :meth:`_history_commands_from_portal`.
        """
        record = record if record is not None else self.browse()
        vals = {}
        simple = {
            'location': 'location',
            'department': 'department',
            'expenseCategory': 'expense_category',
            'buyer': 'buyer_ref',
            'vendor': 'vendor_name',
            # Not sent by the portal today. Accepted so a later client can fill
            # them in without another change on this side.
            'description': 'description',
            'notes': 'notes',
        }
        for key, field_name in simple.items():
            if key in payload:
                vals[field_name] = payload.get(key) or False
        if 'savings' in payload:
            vals['savings'] = float(payload.get('savings') or 0.0)
        if 'status' in payload and payload['status'] in STATE_BY_LABEL:
            vals['state'] = STATE_BY_LABEL[payload['status']]
        if 'urgency' in payload and payload['urgency'] in URGENCY_BY_LABEL:
            vals['urgency'] = URGENCY_BY_LABEL[payload['urgency']]
        if 'selectedSourcingMethod' in payload and payload['selectedSourcingMethod'] in SOURCING_BY_LABEL:
            vals['sourcing_method'] = SOURCING_BY_LABEL[payload['selectedSourcingMethod']]
        if payload.get('createdDate'):
            requested_on = parse_display_datetime(payload['createdDate'])
            if requested_on:
                vals['request_date'] = requested_on
        if 'deliveryDate' in payload:
            vals['delivery_date'] = parse_display_date(payload.get('deliveryDate'))

        lines = payload.get('lineItems')
        if not lines and payload.get('productName'):
            lines = [{
                'productName': payload['productName'],
                'productQty': payload.get('productQty') or 1,
                'targetPrice': payload.get('targetPrice') or 0.0,
            }]
        if lines is not None:
            vals['line_ids'] = [fields.Command.clear()] + [
                fields.Command.create({
                    'sequence': index * 10,
                    'product_name': line.get('productName') or _('Unnamed item'),
                    'product_qty': portal_quantity(line.get('productQty')),
                    'price_unit': portal_price(line.get('targetPrice')),
                })
                for index, line in enumerate(lines)
            ]

        if payload.get('history') is not None:
            commands = record._history_commands_from_portal(payload['history'])
            if commands:
                vals['history_ids'] = commands
        if payload.get('clarificationComments') is not None:
            vals['comment_ids'] = [fields.Command.clear()] + [
                fields.Command.create({
                    'role': comment.get('role') if comment.get('role') in ('manager', 'employee') else 'manager',
                    'text': comment.get('text') or '',
                    'comment_date': parse_display_datetime(comment.get('date')) or fields.Datetime.now(),
                })
                for comment in payload['clarificationComments'] if comment.get('text')
            ]
        if payload.get('vendorBids') is not None:
            vals['bid_ids'] = [fields.Command.clear()] + [
                fields.Command.create({
                    'vendor_name': bid.get('vendorName') or _('Unknown vendor'),
                    'price': float(bid.get('price') or 0.0),
                    'lead_time': bid.get('leadTime') or False,
                    'warranty': bid.get('warranty') or False,
                    'bid_status': bid.get('status') or False,
                })
                for bid in payload['vendorBids'] if bid.get('vendorName')
            ]
        if payload.get('attachments') is not None:
            # A document holding a real uploaded file is not something the
            # portal can send back — it posts names only. Clearing the list on
            # every save therefore threw away the link to the file and left the
            # name behind, so a requisition showed a document nobody could
            # open. Keep those, and add whatever names are new.
            kept = record.document_ids.filtered('attachment_id') if record else record.browse()
            known = {(doc.name or '').casefold() for doc in kept}
            vals['document_ids'] = (
                [fields.Command.set(kept.ids)]
                + [fields.Command.create({'name': name})
                   for name in payload['attachments']
                   if name and name.casefold() not in known]
            )
        return vals

    @api.model
    def _upsert_from_portal(self, payload):
        """Create or update the request the portal just saved, and return it."""
        reference = (payload.get('id') or '').strip()
        request = self.search([('name', '=', reference)], limit=1) if reference else self.browse()
        vals = self._vals_from_portal(payload, record=request)
        if request:
            request.write(vals)
        else:
            # A brand-new request: let the sequence own the reference unless the
            # portal invented one that is still free. The search above runs
            # under the caller's record rules, so it can miss a reference that
            # belongs to somebody else's request — check without them, or the
            # create would die on the uniqueness constraint.
            if reference and reference.lower() != 'new' and not self.sudo().with_context(
                    active_test=False).search_count([('name', '=', reference)]):
                vals['name'] = reference
            request = self.create(vals)
        request._sync_master_records()
        request._sync_partner_from_vendor_name()
        if not request.contract_id:
            request.action_check_contract()
        # The portal writes the state directly instead of calling action_submit,
        # so a request that arrives already "Pending Approval" would otherwise
        # never be matched to a workflow. Build it here, once, when it lands in
        # an approving state without a chain.
        if request.state in ('to_approve', 'clarification') and not request.approval_ids:
            request._build_approval_chain()
        return request


    # ------------------------------------------------------------------
    # Demo data
    # ------------------------------------------------------------------
    # Mirrors the seed set the portal ships with, so a freshly reset backend
    # looks like the walkthrough everyone has already seen.
    _DEMO_REQUESTS = [
        {
            'lineItems': [
                {'productName': 'Dell Latitude 5440 Laptop', 'productQty': 20, 'targetPrice': 70000},
                {'productName': 'USB-C Docking Station', 'productQty': 20, 'targetPrice': 8500},
                {'productName': 'Laptop Backpack', 'productQty': 20, 'targetPrice': 1800},
            ],
            'location': 'Bangalore Office', 'department': 'IT & Infrastructure',
            'expenseCategory': 'IT Hardware & Laptops', 'status': 'Pending Approval',
            'urgency': 'High', 'buyer': 'SCM-IT-14', 'vendor': 'Primus Technologies',
            'savings': 60000, 'selectedSourcingMethod': 'Multi RFQ',
            'attachments': ['hardware_specifications.pdf'],
            'vendorBids': [
                {'vendorName': 'Primus Technologies', 'price': 68000, 'leadTime': '5 Days',
                 'warranty': '3 Years On-Site', 'status': 'Recommended'},
                {'vendorName': 'Apex Systems', 'price': 71000, 'leadTime': '10 Days',
                 'warranty': '1 Year Carry-In', 'status': 'Qualified'},
            ],
        },
        {
            'lineItems': [{'productName': 'Ergonomic Office Chair', 'productQty': 10, 'targetPrice': 8000}],
            'location': 'Kochi Head Office', 'department': 'Facilities',
            'expenseCategory': 'Office Furniture', 'status': 'Approved', 'urgency': 'Medium',
            'buyer': 'SCM-FUR-03', 'vendor': 'Apex Systems', 'savings': 5000,
            'selectedSourcingMethod': 'Negotiation',
            'vendorBids': [{'vendorName': 'Apex Systems', 'price': 8000, 'leadTime': '3 Days',
                            'warranty': '2 Years', 'status': 'Selected'}],
        },
        {
            'lineItems': [{'productName': '19-Inch Data Server Rack', 'productQty': 2, 'targetPrice': 120000}],
            'location': 'Mumbai Office', 'department': 'IT & Infrastructure',
            'expenseCategory': 'Datacenter Equipment', 'status': 'Sourcing', 'urgency': 'High',
            'buyer': 'SCM-IT-14', 'vendor': 'Pending Sourcing', 'savings': 0,
            'selectedSourcingMethod': 'Multi RFQ',
            'vendorBids': [{'vendorName': 'Primus Technologies', 'price': 125000, 'leadTime': '7 Days',
                            'warranty': '3 Years', 'status': 'Submitted'}],
        },
        {
            'lineItems': [{'productName': 'Industrial UPS Unit', 'productQty': 4, 'targetPrice': 85000}],
            'location': 'Mumbai Office', 'department': 'Operations',
            'expenseCategory': 'Datacenter Equipment', 'status': 'Pending Approval', 'urgency': 'High',
            'buyer': 'SCM-IT-14', 'vendor': 'PowerGrid Solutions', 'savings': 22000,
            'selectedSourcingMethod': 'Multi RFQ', 'attachments': ['ups_specs.pdf'],
            'vendorBids': [
                {'vendorName': 'PowerGrid Solutions', 'price': 83000, 'leadTime': '8 Days',
                 'warranty': '3 Years', 'status': 'Recommended'},
                {'vendorName': 'VoltEdge', 'price': 88000, 'leadTime': '6 Days',
                 'warranty': '2 Years', 'status': 'Qualified'},
            ],
        },
        {
            'lineItems': [{'productName': 'Next-Gen Firewall Appliance', 'productQty': 3, 'targetPrice': 145000}],
            'location': 'Bangalore Office', 'department': 'IT & Infrastructure',
            'expenseCategory': 'Datacenter Equipment', 'status': 'Needs Clarification',
            'urgency': 'High', 'buyer': 'SCM-IT-14', 'vendor': 'SecureNet', 'savings': 0,
            'selectedSourcingMethod': 'Multi RFQ', 'attachments': ['network_diagram.pdf'],
            'clarificationComments': [{
                'role': 'manager',
                'text': 'Do these replace the existing units or add capacity?',
            }],
            'vendorBids': [{'vendorName': 'SecureNet', 'price': 143000, 'leadTime': '10 Days',
                            'warranty': '3 Years', 'status': 'Submitted'}],
            # Owned by the demo requester so the Employee portal's "Questions"
            # tab has something waiting on it.
            'requestedBy': 'requester@smartspend.demo',
        },
        # -- Raised by the demo requester, so signing in as that account shows a
        # -- populated portal. The record rule scopes a requester to their own
        # -- requests, so without these the Employee portal reads as empty.
        {
            'lineItems': [
                {'productName': 'Wireless Keyboard & Mouse Combo', 'productQty': 8, 'targetPrice': 2200},
                {'productName': 'Noise-Cancelling Headset', 'productQty': 8, 'targetPrice': 3400},
            ],
            'location': 'Bangalore Office', 'department': 'IT & Infrastructure',
            'expenseCategory': 'IT Hardware & Laptops', 'status': 'Draft',
            'urgency': 'Low', 'buyer': '', 'vendor': '', 'savings': 0,
            'requestedBy': 'requester@smartspend.demo',
        },
        {
            'lineItems': [{'productName': 'MS Office 365 Business License', 'productQty': 25, 'targetPrice': 8200}],
            'location': 'Bangalore Office', 'department': 'IT & Infrastructure',
            'expenseCategory': 'Software Licenses', 'status': 'Pending Approval',
            'urgency': 'Medium', 'buyer': 'SCM-SW-07', 'vendor': 'Microsoft', 'savings': 0,
            'selectedSourcingMethod': 'Negotiation',
            'requestedBy': 'requester@smartspend.demo',
        },
        {
            'lineItems': [
                {'productName': 'Height-Adjustable Desk', 'productQty': 6, 'targetPrice': 12500},
                {'productName': 'Storage Pedestal Cabinet', 'productQty': 6, 'targetPrice': 9500},
            ],
            'location': 'Kochi Head Office', 'department': 'Facilities',
            'expenseCategory': 'Office Furniture', 'status': 'Approved',
            'urgency': 'Medium', 'buyer': 'SCM-FUR-03', 'vendor': 'Featherlite Office',
            'savings': 9000, 'selectedSourcingMethod': 'Negotiation',
            'vendorBids': [{'vendorName': 'Featherlite Office', 'price': 11800, 'leadTime': '6 Days',
                            'warranty': '5 Years', 'status': 'Selected'}],
            'requestedBy': 'requester@smartspend.demo',
        },
        {
            'lineItems': [{'productName': '24" Full-HD Monitor', 'productQty': 12, 'targetPrice': 11000}],
            'location': 'Bangalore Office', 'department': 'IT & Infrastructure',
            'expenseCategory': 'IT Hardware & Laptops', 'status': 'PO Confirmed',
            'urgency': 'High', 'buyer': 'SCM-IT-14', 'vendor': 'Primus Technologies',
            'savings': 7200, 'selectedSourcingMethod': 'Multi RFQ',
            'vendorBids': [
                {'vendorName': 'Primus Technologies', 'price': 10400, 'leadTime': '4 Days',
                 'warranty': '3 Years On-Site', 'status': 'Selected'},
                {'vendorName': 'Apex Systems', 'price': 10950, 'leadTime': '9 Days',
                 'warranty': '1 Year Carry-In', 'status': 'Qualified'},
            ],
            'requestedBy': 'requester@smartspend.demo',
        },
    ]

    @api.model
    def _create_demo_requests(self):
        """Seed the sample requests used by the portal's "reset demo" button.

        A payload may name the account that raised it with ``requestedBy`` (an
        Odoo login). It is read here rather than in :meth:`_vals_from_portal`
        deliberately: that mapper is fed by the public API, and letting a
        payload choose its own owner would let any signed-in user file a
        request in somebody else's name.

        The owner is applied through ``default_user_id`` rather than written
        afterwards, so the request is created as theirs and the timeline entry
        create() writes reads "Raised by <them>" instead of naming whoever
        happened to press reset.
        """
        Users = self.env['res.users'].sudo()
        seeded = self.browse()
        for payload in self._DEMO_REQUESTS:
            payload = dict(payload)
            owner_login = payload.pop('requestedBy', None)
            owner = Users.search([('login', '=', owner_login)], limit=1) if owner_login else Users.browse()
            context = {'default_demo_seed': True}
            if owner:
                context['default_user_id'] = owner.id
            seeded |= self.with_context(**context)._upsert_from_portal(payload)
        return seeded


class SmartspendRequestLine(models.Model):
    _name = 'smartspend.request.line'
    _description = 'SmartSpend Purchase Request Line'
    _order = 'request_id, sequence, id'

    request_id = fields.Many2one(
        'smartspend.request', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    product_name = fields.Char(string='Product', required=True)
    product_id = fields.Many2one('product.product', string='Odoo Product')
    description = fields.Char(
        string='Description',
        help="What is wanted, in the requester's words. Carried onto the purchase "
             "order line when set; otherwise the product name is.")
    product_category_id = fields.Many2one(
        'product.category', string='Product Category',
        compute='_compute_product_category_id', store=True, readonly=False,
        help="Odoo category this item belongs to. Taken from the product, or from "
             "the request's expense category when the product is still free text.")
    product_qty = fields.Float(string='Quantity', default=1.0, required=True, digits='Product Unit')
    product_uom_id = fields.Many2one(
        'uom.uom', string='Unit of Measure',
        compute='_compute_product_uom_id', store=True, readonly=False, precompute=True,
        default=lambda self: self.env.ref('uom.product_uom_unit', raise_if_not_found=False),
        help="Unit the quantity is expressed in. Follows the product once one is matched.")
    price_unit = fields.Monetary(string='Target Price')
    subtotal = fields.Monetary(compute='_compute_subtotal', store=True)
    currency_id = fields.Many2one(related='request_id.currency_id', string='Currency')
    company_id = fields.Many2one(related='request_id.company_id', store=True)
    notes = fields.Text(string='Notes')

    contract_line_id = fields.Many2one(
        'smartspend.contract.line', string='Contract Line',
        compute='_compute_contract_line', store=True,
        help="Line of the matched rate contract that prices this item.")
    contract_price = fields.Monetary(
        string='Contract Rate', related='contract_line_id.price_unit')
    on_contract = fields.Boolean(compute='_compute_contract_line', store=True)

    @api.depends('product_qty', 'price_unit')
    def _compute_subtotal(self):
        for line in self:
            line.subtotal = line.product_qty * line.price_unit

    @api.depends('product_id')
    def _compute_product_uom_id(self):
        default = self.env.ref('uom.product_uom_unit', raise_if_not_found=False)
        for line in self:
            line.product_uom_id = line.product_id.uom_id or line.product_uom_id or default

    @api.depends('product_id', 'request_id.category_id')
    def _compute_product_category_id(self):
        for line in self:
            line.product_category_id = (
                line.product_id.categ_id
                or line.request_id.category_id.product_category_id
                or line.product_category_id)

    # ------------------------------------------------------------------
    # Constraints — Odoo, not the portal, decides what a line may hold.
    # ------------------------------------------------------------------
    @api.constrains('product_qty')
    def _check_product_qty(self):
        for line in self:
            if line.product_qty <= 0:
                raise ValidationError(_(
                    "\"%s\" must be requested in a quantity greater than zero.", line.product_name))

    @api.constrains('price_unit')
    def _check_price_unit(self):
        for line in self:
            if line.price_unit < 0:
                raise ValidationError(_(
                    "\"%s\" cannot carry a negative unit price.", line.product_name))

    @api.constrains('product_uom_id')
    def _check_product_uom(self):
        for line in self:
            if not line.product_uom_id:
                raise ValidationError(_(
                    "\"%s\" needs a unit of measure.", line.product_name))

    @api.depends('product_name', 'request_id.contract_id', 'request_id.contract_id.line_ids.product_name')
    def _compute_contract_line(self):
        for line in self:
            contract = line.request_id.contract_id
            match = contract._line_for_product(line.product_name) if contract else False
            line.contract_line_id = match or False
            line.on_contract = bool(match)

    @api.onchange('product_id')
    def _onchange_product_id(self):
        for line in self:
            if line.product_id:
                line.product_name = line.product_id.display_name
                if not line.price_unit:
                    line.price_unit = line.product_id.standard_price

    def _find_or_create_product(self):
        """Resolve the free-text product label to a storable Odoo product.

        Sourcing a request may be the first time a product is heard of, and a
        buyer is not normally allowed to create one — so the catalogue entry is
        created as superuser rather than blocking the purchase order.
        """
        self.ensure_one()
        if self.product_id:
            return self.product_id
        Product = self.env['product.product'].sudo()
        product = Product.search([('name', '=ilike', self.product_name)], limit=1)
        if not product:
            product = Product.create({
                'name': self.product_name,
                'type': 'consu',
                'purchase_ok': True,
                'list_price': self.price_unit,
                'standard_price': self.price_unit,
            })
        self.product_id = product.id
        return product

    def _prepare_purchase_order_line_vals(self, order):
        self.ensure_one()
        product = self._find_or_create_product()
        price = self.contract_price if self.contract_line_id else self.price_unit
        # Order in the requested unit when the product actually accepts it;
        # a unit the product does not know would not price or receive correctly.
        uom = self.product_uom_id
        if not uom or uom not in (product.uom_id | product.uom_ids):
            uom = product.uom_id
        return {
            'product_id': product.id,
            'name': self.description or self.product_name,
            'product_qty': self.product_qty,
            'product_uom_id': uom.id,
            'price_unit': price,
            'date_planned': (
                fields.Datetime.to_datetime(self.request_id.delivery_date)
                or order.date_order or fields.Datetime.now()
            ),
        }


class SmartspendRequestBid(models.Model):
    _name = 'smartspend.request.bid'
    _description = 'SmartSpend Vendor Bid'
    _order = 'request_id, price, id'

    request_id = fields.Many2one(
        'smartspend.request', required=True, ondelete='cascade', index=True)
    vendor_name = fields.Char(string='Vendor', required=True)
    partner_id = fields.Many2one('res.partner', string='Contact')
    price = fields.Monetary(string='Quoted Unit Price')
    currency_id = fields.Many2one(related='request_id.currency_id', string='Currency')
    lead_time = fields.Char()
    warranty = fields.Char()
    bid_status = fields.Char(
        string='Status', help="Free-text bid state as shown in the portal: Recommended, Qualified, Selected…")


class SmartspendRequestHistory(models.Model):
    """One audited step in a request's life.

    The portal renders this as a courier-style timeline and reads only the
    title, the date and the note. The user and the two states are the audit
    half: they say who moved the request and where from, which the title alone
    never could.
    """
    _name = 'smartspend.request.history'
    _description = 'SmartSpend Request Timeline Entry'
    _order = 'event_date, id'

    request_id = fields.Many2one(
        'smartspend.request', required=True, ondelete='cascade', index=True)
    title = fields.Char(required=True)
    description = fields.Char()
    event_date = fields.Datetime(default=fields.Datetime.now, required=True)
    user_id = fields.Many2one(
        'res.users', string='Done by', default=lambda self: self.env.user, index='btree_not_null')
    state_from = fields.Selection(STATE_SELECTION, string='Previous Status')
    state_to = fields.Selection(STATE_SELECTION, string='New Status')
    company_id = fields.Many2one(related='request_id.company_id', store=True)


class SmartspendRequestComment(models.Model):
    _name = 'smartspend.request.comment'
    _description = 'SmartSpend Clarification Comment'
    _order = 'comment_date, id'

    request_id = fields.Many2one(
        'smartspend.request', required=True, ondelete='cascade', index=True)
    role = fields.Selection(
        [('manager', 'Manager'), ('employee', 'Employee')], required=True, default='manager')
    text = fields.Text(required=True)
    comment_date = fields.Datetime(default=fields.Datetime.now, required=True)


class SmartspendRequestDocument(models.Model):
    _name = 'smartspend.request.document'
    _description = 'SmartSpend Request Document'
    _order = 'request_id, id'

    request_id = fields.Many2one(
        'smartspend.request', required=True, ondelete='cascade', index=True)
    name = fields.Char(string='File Name', required=True)
    attachment_id = fields.Many2one('ir.attachment', string='Attachment')
