"""Subscriptions — products bought on a fixed cycle, ordered automatically.

A subscription names a vendor, the items and how often they are needed:
monthly (a purchase order on the 1st of every month) or yearly (on the 1st of
the chosen month, once a year). A daily job raises each order when it falls
due, confirms it with the vendor, and moves the subscription on to the next
date. The buyer may pause it, resume it, end it, or raise the next order early.
"""
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import format_amount

FREQUENCIES = [('monthly', 'Monthly'), ('yearly', 'Yearly')]

STATES = [
    ('draft', 'Draft'),
    ('active', 'Active'),
    ('paused', 'Paused'),
    ('ended', 'Ended'),
    ('cancelled', 'Cancelled'),
]

# A subscription missed for longer than this (the server was down, say) raises
# one order for the current cycle, not one for every cycle it slept through.
STEP = {'monthly': relativedelta(months=1), 'yearly': relativedelta(years=1)}


def first_of_month(day):
    """The 1st of ``day``'s month, or of the next month when ``day`` is past the 1st."""
    if not day:
        return day
    return day if day.day == 1 else (day + relativedelta(months=1)).replace(day=1)


class SmartspendSubscription(models.Model):
    _name = 'smartspend.subscription'
    _description = 'SmartSpend Subscription'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'state, next_order_date, id desc'

    name = fields.Char(
        string='Reference', required=True, copy=False, readonly=True, index=True,
        default=lambda self: _('New'))
    title = fields.Char(
        string='Subscription', required=True, tracking=True,
        help="What is being subscribed to, e.g. Microsoft 365 Business licences.")
    state = fields.Selection(STATES, default='draft', required=True, tracking=True, copy=False)
    partner_id = fields.Many2one(
        'res.partner', string='Vendor', required=True, tracking=True,
        domain=[('supplier_rank', '>', 0)])
    frequency = fields.Selection(
        FREQUENCIES, default='monthly', required=True, tracking=True,
        help="Monthly: an order on the 1st of every month. Yearly: an order on the 1st "
             "of the start month, once a year.")
    start_date = fields.Date(
        string='First Order On', required=True, tracking=True,
        default=lambda self: first_of_month(fields.Date.context_today(self)),
        help="Orders are raised on the 1st of a month; a date past the 1st moves to the next month.")
    end_date = fields.Date(
        string='Ends On', tracking=True,
        help="No orders after this date. Empty: runs until it is ended or cancelled.")
    next_order_date = fields.Date(
        string='Next Order On', readonly=True, copy=False, tracking=True,
        help="When the next purchase order is raised automatically.")
    auto_confirm = fields.Boolean(
        string='Confirm Orders Automatically', default=True,
        help="Confirm each order with the vendor as it is raised. Off: it is left as an "
             "RFQ for the buyer to check and confirm.")
    department_id = fields.Many2one('smartspend.department', string='Department')
    branch_id = fields.Many2one('smartspend.branch', string='Branch / Site')
    category_id = fields.Many2one('smartspend.expense.category', string='Expense Category')
    owner_id = fields.Many2one(
        'res.users', string='Owner', default=lambda self: self.env.user, tracking=True,
        help="Who looks after this subscription.")
    note = fields.Text(string='Notes')
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id')

    line_ids = fields.One2many('smartspend.subscription.line', 'subscription_id', string='Items', copy=True)
    order_ids = fields.One2many('purchase.order', 'smartspend_subscription_id', string='Purchase Orders')

    amount_per_cycle = fields.Monetary(
        string='Per Order', compute='_compute_amounts', store=True,
        help="What one order costs.")
    monthly_cost = fields.Monetary(
        string='Monthly Run-Rate', compute='_compute_amounts', store=True,
        help="Cost per month: a yearly order spread over twelve months.")
    annual_cost = fields.Monetary(string='Annual Cost', compute='_compute_amounts', store=True)
    order_count = fields.Integer(compute='_compute_orders')
    ordered_total = fields.Monetary(
        string='Ordered So Far', compute='_compute_orders',
        help="Total of the orders raised so far, cancelled ones left out.")
    last_order_id = fields.Many2one('purchase.order', string='Last Order', compute='_compute_orders')

    @api.depends('line_ids.subtotal', 'frequency')
    def _compute_amounts(self):
        for subscription in self:
            per = sum(subscription.line_ids.mapped('subtotal'))
            subscription.amount_per_cycle = per
            subscription.monthly_cost = per if subscription.frequency == 'monthly' else per / 12.0
            subscription.annual_cost = per * 12 if subscription.frequency == 'monthly' else per

    @api.depends('order_ids.state', 'order_ids.amount_total')
    def _compute_orders(self):
        for subscription in self:
            orders = subscription.order_ids.filtered(lambda order: order.state != 'cancel')
            subscription.order_count = len(subscription.order_ids)
            subscription.ordered_total = sum(orders.mapped('amount_total'))
            subscription.last_order_id = subscription.order_ids.sorted(lambda o: (o.date_order, o.id))[-1:]

    @api.constrains('start_date', 'end_date')
    def _check_dates(self):
        for subscription in self:
            if subscription.end_date and subscription.start_date and subscription.end_date < subscription.start_date:
                raise ValidationError(_("A subscription cannot end before its first order."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('smartspend.subscription') or _('New')
            if vals.get('start_date'):
                vals['start_date'] = first_of_month(fields.Date.to_date(vals['start_date']))
        return super().create(vals_list)

    def write(self, vals):
        if vals.get('start_date'):
            vals['start_date'] = first_of_month(fields.Date.to_date(vals['start_date']))
        res = super().write(vals)
        if 'start_date' in vals or 'frequency' in vals:
            # A changed schedule moves the next order with it, but never into
            # a cycle that has already been ordered.
            for subscription in self.filtered(lambda s: s.state in ('active', 'paused')):
                subscription.next_order_date = subscription._first_open_cycle()
        return res

    # ------------------------------------------------------------------
    # Schedule
    # ------------------------------------------------------------------
    def _first_open_cycle(self, after=None):
        """The first order date not yet ordered — on or after ``after`` (today)."""
        self.ensure_one()
        today = after or fields.Date.context_today(self)
        step = STEP[self.frequency]
        day = self.start_date
        ordered = set(self.order_ids.filtered(lambda o: o.state != 'cancel').mapped('smartspend_cycle_date'))
        while day < today or day in ordered:
            day += step
        return day

    def _upcoming(self, months=12):
        """The order dates due in the next ``months`` months: ``[(date, amount)]``."""
        self.ensure_one()
        if self.state != 'active' or not self.next_order_date:
            return []
        horizon = fields.Date.context_today(self) + relativedelta(months=months)
        out, day = [], self.next_order_date
        while day <= horizon and (not self.end_date or day <= self.end_date):
            out.append((day, self.amount_per_cycle))
            day += STEP[self.frequency]
        return out

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------
    def action_activate(self):
        for subscription in self:
            if subscription.state not in ('draft', 'paused'):
                raise UserError(_("%s is already running or has finished.", subscription.name))
            if not subscription.line_ids:
                raise UserError(_("Add the items %s orders before starting it.", subscription.name))
            if subscription.line_ids.filtered(lambda line: line.price_unit <= 0 or line.product_qty <= 0):
                raise UserError(_("Every item needs a quantity and a price."))
            was = subscription.state
            subscription.write({'state': 'active', 'next_order_date': subscription._first_open_cycle()})
            subscription.message_post(body=_(
                "%(verb)s — next order on %(date)s.",
                verb=_("Resumed") if was == 'paused' else _("Started"),
                date=subscription.next_order_date.strftime('%d %b %Y')))
        return True

    def action_pause(self):
        for subscription in self:
            if subscription.state != 'active':
                raise UserError(_("Only an active subscription can be paused."))
            subscription.state = 'paused'
            subscription.message_post(body=_("Paused — no orders until it is resumed."))
        return True

    action_resume = action_activate

    def action_end(self):
        for subscription in self:
            if subscription.state in ('ended', 'cancelled'):
                continue
            subscription.write({'state': 'ended', 'next_order_date': False})
            subscription.message_post(body=_("Ended — no further orders."))
        return True

    def action_generate_now(self):
        """Raise the next order now instead of waiting for its date."""
        for subscription in self:
            if subscription.state != 'active':
                raise UserError(_("Start or resume %s before ordering from it.", subscription.name))
            subscription._raise_order(subscription.next_order_date, manual=True)
        return True

    def action_view_orders(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Orders from %s', self.name),
            'res_model': 'purchase.order',
            'view_mode': 'list,form',
            'domain': [('smartspend_subscription_id', '=', self.id)],
        }

    # ------------------------------------------------------------------
    # Ordering
    # ------------------------------------------------------------------
    def _raise_order(self, cycle_date, manual=False):
        """Raise (and normally confirm) the purchase order for ``cycle_date``,
        then move the subscription on to its next date."""
        self.ensure_one()
        if not self.line_ids:
            raise UserError(_("%s has no items to order.", self.name))
        Order = self.env['purchase.order'].sudo()
        planned = fields.Datetime.to_datetime(cycle_date).replace(hour=12)
        order = Order.create({
            'partner_id': self.partner_id.id,
            'company_id': self.company_id.id,
            'origin': self.name,
            'date_order': fields.Datetime.now(),
            'smartspend_subscription_id': self.id,
            'smartspend_cycle_date': cycle_date,
            'order_line': [fields.Command.create(line._prepare_order_line(planned)) for line in self.line_ids],
        })
        if self.auto_confirm:
            order.button_confirm()
        period = (cycle_date.strftime('%B %Y') if self.frequency == 'monthly'
                  else _("%(start)s – %(end)s", start=cycle_date.strftime('%b %Y'),
                         end=(cycle_date + relativedelta(years=1, days=-1)).strftime('%b %Y')))
        nxt = cycle_date + STEP[self.frequency]
        values = {'next_order_date': nxt}
        if self.end_date and nxt > self.end_date:
            values.update(state='ended', next_order_date=False)
        self.write(values)
        self.message_post(body=_(
            "%(order)s %(how)s for %(period)s — %(amount)s.%(after)s",
            order=order.name,
            how=(_("raised early by %s", self.env.user.name) if manual else _("raised automatically"))
                + ('' if self.auto_confirm else _(" (left as an RFQ to confirm)")),
            period=period, amount=format_amount(self.env, order.amount_total, order.currency_id),
            after=(' ' + _("That was the last one — the subscription has ended.")) if values.get('state') == 'ended'
                  else ' ' + _("Next order on %s.", nxt.strftime('%d %b %Y'))))
        return order

    @api.model
    def _cron_raise_orders(self):
        """Raise every order that has fallen due — run daily."""
        today = fields.Date.context_today(self)
        for subscription in self.search([('state', '=', 'active'), ('next_order_date', '<=', today)]):
            if subscription.end_date and subscription.next_order_date > subscription.end_date:
                subscription.action_end()
                continue
            due = subscription.next_order_date
            step = STEP[subscription.frequency]
            missed = []
            # Down for a while: order the current cycle only, and say which were skipped.
            while due + step <= today:
                missed.append(due)
                due += step
            try:
                with self.env.cr.savepoint():
                    subscription._raise_order(due)
            except Exception as exc:  # one failure must not stop the others
                subscription.message_post(body=_("The order due on %(date)s could not be raised: %(error)s",
                                                 date=due.strftime('%d %b %Y'), error=exc))
                continue
            if missed:
                subscription.message_post(body=_(
                    "Skipped while the scheduler was not running: %s. Raise them by hand if they are needed.",
                    ', '.join(day.strftime('%b %Y') for day in missed)))
        return True


class SmartspendSubscriptionLine(models.Model):
    _name = 'smartspend.subscription.line'
    _description = 'SmartSpend Subscription Item'
    _order = 'sequence, id'

    subscription_id = fields.Many2one('smartspend.subscription', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    product_name = fields.Char(string='Product', required=True)
    product_id = fields.Many2one('product.product', string='Odoo Product')
    product_qty = fields.Float(string='Quantity', default=1.0, required=True, digits='Product Unit')
    price_unit = fields.Monetary(string='Unit Price', required=True)
    subtotal = fields.Monetary(compute='_compute_subtotal', store=True)
    currency_id = fields.Many2one(related='subscription_id.currency_id')

    @api.depends('product_qty', 'price_unit')
    def _compute_subtotal(self):
        for line in self:
            line.subtotal = line.product_qty * line.price_unit

    def _product(self):
        """The Odoo product to order — matched by name, created when new."""
        self.ensure_one()
        if self.product_id:
            return self.product_id
        Product = self.env['product.product'].sudo()
        product = Product.search([('name', '=ilike', self.product_name)], limit=1) or Product.create({
            'name': self.product_name, 'type': 'consu', 'purchase_ok': True,
            'list_price': self.price_unit, 'standard_price': self.price_unit,
        })
        self.sudo().product_id = product.id
        return product

    def _prepare_order_line(self, planned):
        product = self._product()
        return {
            'product_id': product.id,
            'name': self.product_name,
            'product_qty': self.product_qty,
            'product_uom_id': product.uom_id.id,
            'price_unit': self.price_unit,
            'date_planned': planned,
        }
