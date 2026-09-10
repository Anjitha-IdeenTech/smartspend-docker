import re

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

# Words that carry no signal when matching a requested product against a
# contracted one ("2 Dell Latitude 5440 Laptops" vs "Dell Latitude Laptop").
_NOISE_TOKENS = {
    'the', 'and', 'for', 'with', 'unit', 'units', 'pcs', 'pieces', 'nos',
    'set', 'sets', 'new', 'inch', 'kit', 'pack',
}


def normalize_product_name(name):
    """Lower-case a product label and split it into significant tokens."""
    tokens = re.split(r'[^a-z0-9]+', (name or '').lower())
    return [t for t in tokens if t and t not in _NOISE_TOKENS]


def product_names_match(left, right):
    """Fuzzy match two free-text product labels.

    The portal sends product names typed (or dictated) by an employee, while
    contract lines are worded by the buyer who negotiated them. An exact match
    would almost never fire, so accept a containment or a two-token overlap.
    """
    left_tokens, right_tokens = normalize_product_name(left), normalize_product_name(right)
    if not left_tokens or not right_tokens:
        return False
    left_key, right_key = ' '.join(left_tokens), ' '.join(right_tokens)
    if left_key in right_key or right_key in left_key:
        return True
    common = set(left_tokens) & set(right_tokens)
    return len(common) >= 2 or (len(common) == 1 and min(len(left_tokens), len(right_tokens)) == 1)


class SmartspendContract(models.Model):
    _name = 'smartspend.contract'
    _description = 'SmartSpend Rate Contract'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'date_start desc, id desc'

    name = fields.Char(
        string='Reference', required=True, copy=False, readonly=True,
        default=lambda self: _('New'), index=True)
    active = fields.Boolean(default=True)
    partner_id = fields.Many2one(
        'res.partner', string='Vendor', required=True, tracking=True,
        domain="[('is_company', '=', True)]")
    category = fields.Char(
        string='Spend Category', tracking=True,
        help="Expense category this agreement covers, e.g. IT Hardware.")
    state = fields.Selection(
        [('draft', 'Draft'), ('active', 'Active'), ('expired', 'Expired'), ('cancel', 'Cancelled')],
        default='draft', required=True, tracking=True)
    date_start = fields.Date(string='Valid From', default=fields.Date.context_today, tracking=True)
    date_end = fields.Date(string='Valid Until', tracking=True)
    is_running = fields.Boolean(
        string='Currently Applicable', compute='_compute_is_running', store=True,
        help="Active agreement whose validity window covers today. Only running "
             "contracts are matched against new purchase requests.")

    lead_time = fields.Char(string='Lead Time', help="Committed delivery lead time, e.g. 5 Days.")
    warranty = fields.Char(help="Warranty committed by the vendor, e.g. 3 Years On-Site.")
    payment_terms = fields.Char(help="Negotiated payment terms, e.g. Net-30.")
    notes = fields.Html(string='Terms & Notes')

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id', string='Currency')

    line_ids = fields.One2many('smartspend.contract.line', 'contract_id', string='Contracted Rates', copy=True)
    line_count = fields.Integer(compute='_compute_line_count')
    total_value = fields.Monetary(
        string='Committed Value', compute='_compute_total_value', store=True,
        help="Minimum committed value: contracted rate times the minimum quantity of every line.")

    # -- The slice of this rate card that prices the request you arrived from.
    # -- A contract prices a catalogue; a request draws on part of it, and
    # -- landing on the whole card read as the request's own items being wrong.
    matched_request_id = fields.Many2one(
        'smartspend.request', string='Opened From', compute='_compute_matched_lines',
        help="The purchase request whose rate-contract button opened this agreement.")
    matched_line_ids = fields.Many2many(
        'smartspend.contract.line', string='Rates for This Request',
        compute='_compute_matched_lines')
    matched_unpriced = fields.Char(
        string='Not Priced Here', compute='_compute_matched_lines',
        help="Items on the request this agreement holds no rate for.")

    request_ids = fields.One2many('smartspend.request', 'contract_id', string='Purchase Requests')
    request_count = fields.Integer(compute='_compute_request_count')
    purchase_order_ids = fields.One2many('purchase.order', 'smartspend_contract_id', string='Purchase Orders')
    purchase_order_count = fields.Integer(compute='_compute_purchase_order_count')

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'A rate contract with this reference already exists.',
    )

    # Keyed on the reader as well as the request: the guard below turns on who
    # is asking, and a cache keyed only on the request would hand one user the
    # answer computed for another — defeating it inside a single transaction.
    @api.depends_context('smartspend_request_id', 'uid')
    def _compute_matched_lines(self):
        """Which of these rates price the request the user came from.

        The request id travels in the context rather than on the record: the
        same agreement is opened from many requests, and each wants its own
        slice. With no request in context — the agreement opened from the menu —
        both fields are empty and the form simply shows the whole card.
        """
        request = self.env['smartspend.request'].browse(
            self.env.context.get('smartspend_request_id') or []).exists()
        # A context can be crafted; never let it read a request the user may not.
        if request and not request.has_access('read'):
            request = self.env['smartspend.request']
        for contract in self:
            contract.matched_request_id = request
            contract.matched_line_ids = request.line_ids.contract_line_id.filtered(
                lambda line: line.contract_id == contract)
            # An item with no rate here is the whole reason to read this tab:
            # it is the part of the request still to be sourced.
            unpriced = request.line_ids.filtered(lambda line: not line.contract_line_id)
            contract.matched_unpriced = ', '.join(unpriced.mapped('product_name'))

    @api.depends('state', 'date_start', 'date_end')
    def _compute_is_running(self):
        today = fields.Date.context_today(self)
        for contract in self:
            contract.is_running = bool(
                contract.state == 'active'
                and (not contract.date_start or contract.date_start <= today)
                and (not contract.date_end or contract.date_end >= today)
            )

    @api.depends('line_ids')
    def _compute_line_count(self):
        for contract in self:
            contract.line_count = len(contract.line_ids)

    @api.depends('line_ids.price_unit', 'line_ids.min_qty')
    def _compute_total_value(self):
        for contract in self:
            contract.total_value = sum(contract.line_ids.mapped(lambda l: l.price_unit * (l.min_qty or 1)))

    @api.depends('request_ids')
    def _compute_request_count(self):
        for contract in self:
            contract.request_count = len(contract.request_ids)

    @api.depends('purchase_order_ids', 'purchase_order_ids.state')
    def _compute_purchase_order_count(self):
        # Requesters may read a rate contract but not the orders raised on it.
        # A cancelled order is not spend under this agreement: counting it left
        # a card with nothing live on it advertising twelve orders, all of them
        # cancelled leftovers. The button and its list agree on this.
        for contract in self.sudo():
            contract.purchase_order_count = len(
                contract.purchase_order_ids.filtered(lambda order: order.state != 'cancel'))

    @api.constrains('date_start', 'date_end')
    def _check_dates(self):
        for contract in self:
            if contract.date_start and contract.date_end and contract.date_end < contract.date_start:
                raise ValidationError(_("The contract end date cannot precede its start date."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('smartspend.contract') or _('New')
        return super().create(vals_list)

    def action_activate(self):
        self.write({'state': 'active'})

    def action_expire(self):
        self.write({'state': 'expired'})

    def action_cancel(self):
        self.write({'state': 'cancel'})

    def action_reset_draft(self):
        self.write({'state': 'draft'})

    # These two are agreement-wide: every request filed against this contract,
    # and every order raised on it — not the ones of whichever request you
    # happened to arrive from. Both name the contract in the breadcrumb, and
    # both open a list even for a single record, so an order belonging to
    # another request can never read as "this request's order".
    def action_view_requests(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Requests on %s', self.name),
            'res_model': 'smartspend.request',
            'view_mode': 'list,form',
            'domain': [('contract_id', '=', self.id)],
            'context': {'default_contract_id': self.id},
        }

    def action_view_purchase_orders(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Orders on %s', self.name),
            'res_model': 'purchase.order',
            'view_mode': 'list,form',
            # Same rule as the count above them: a button reading "1" that opens
            # two rows is the defect this pair was fixed for.
            'domain': [('smartspend_contract_id', '=', self.id), ('state', '!=', 'cancel')],
            'context': {'default_smartspend_contract_id': self.id},
        }

    # ------------------------------------------------------------------
    # Matching
    # ------------------------------------------------------------------
    def _line_for_product(self, product_name):
        """Return this contract's line covering ``product_name``, if any."""
        self.ensure_one()
        for line in self.line_ids:
            if product_names_match(product_name, line.product_name):
                return line
        return self.env['smartspend.contract.line']

    @api.model
    def _match_for_products(self, product_names, partner=None):
        """Pick the running contract covering most of ``product_names``.

        :param list product_names: the requested product labels.
        :param partner: optional :class:`res.partner` to prefer.
        :return: ``(contract, covered_names)`` — an empty recordset when nothing matches.
        """
        product_names = [n for n in (product_names or []) if n]
        empty = self.browse()
        if not product_names:
            return empty, []

        domain = [('is_running', '=', True), ('company_id', 'in', self.env.companies.ids)]
        best, best_covered = empty, []
        for contract in self.search(domain):
            covered = [name for name in product_names if contract._line_for_product(name)]
            if not covered:
                continue
            # More lines covered wins; the requested vendor breaks a tie.
            better = len(covered) > len(best_covered)
            same_but_preferred = (
                len(covered) == len(best_covered)
                and partner and contract.partner_id == partner and best.partner_id != partner
            )
            if better or same_but_preferred:
                best, best_covered = contract, covered
        return best, best_covered


class SmartspendContractLine(models.Model):
    _name = 'smartspend.contract.line'
    _description = 'SmartSpend Rate Contract Line'
    _order = 'contract_id, sequence, id'

    contract_id = fields.Many2one(
        'smartspend.contract', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    product_name = fields.Char(string='Product', required=True)
    product_id = fields.Many2one('product.product', string='Odoo Product')
    product_uom_id = fields.Many2one('uom.uom', string='Unit')
    min_qty = fields.Float(string='Min. Qty', default=1.0, digits='Product Unit')
    price_unit = fields.Monetary(string='Contracted Rate', required=True)
    currency_id = fields.Many2one(related='contract_id.currency_id', string='Currency')
    partner_id = fields.Many2one(related='contract_id.partner_id', string='Vendor', store=True)
    is_running = fields.Boolean(related='contract_id.is_running', store=True)

    @api.onchange('product_id')
    def _onchange_product_id(self):
        for line in self:
            if line.product_id:
                line.product_name = line.product_id.display_name
                line.product_uom_id = line.product_id.uom_id
                if not line.price_unit:
                    line.price_unit = line.product_id.standard_price
