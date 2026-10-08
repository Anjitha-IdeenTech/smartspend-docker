"""Goods receipts (GRN) and backorders — Odoo's receipt concept, without stock.

A purchase order is received in one or more receipts. Each receipt says how
much of every line arrived. When less arrived than was expected, the person
validating chooses, as in Odoo:

* **Create Backorder** — the rest stays open as a new receipt waiting for the
  next delivery (``GRN-…`` with *Backorder of* pointing back), or
* **No Backorder** — the rest is not coming; the order is closed at what was
  received.

Received quantities are written onto the purchase order lines, so the vendor
bill — Odoo bills what was received — matches what really arrived.
"""
from odoo import api, fields, models, _
from odoo.exceptions import UserError

from .smartspend_request import SHIPPING_METHOD_SELECTION

RECEIPT_STATES = [
    ('waiting', 'Waiting'),      # expected: a first delivery, or a backorder
    ('done', 'Done'),
    ('cancel', 'Cancelled'),     # a backorder nobody will deliver
]


class BackorderDecisionNeeded(UserError):
    """Less arrived than expected and nobody said whether to keep the rest open."""

    def __init__(self, message, shortages):
        super().__init__(message)
        self.shortages = shortages


class SmartspendReceipt(models.Model):
    _name = 'smartspend.receipt'
    _description = 'SmartSpend Goods Receipt'
    _inherit = ['mail.thread']
    _order = 'id desc'

    name = fields.Char(string='Reference', required=True, copy=False, readonly=True,
                       default=lambda self: _('New'), index=True)
    state = fields.Selection(RECEIPT_STATES, default='waiting', required=True, tracking=True)
    purchase_order_id = fields.Many2one('purchase.order', string='Purchase Order', required=True,
                                        ondelete='cascade', index=True)
    request_id = fields.Many2one('smartspend.request', string='Purchase Request', index=True)
    partner_id = fields.Many2one(related='purchase_order_id.partner_id', string='Vendor', store=True)
    company_id = fields.Many2one(related='purchase_order_id.company_id', store=True)
    currency_id = fields.Many2one(related='purchase_order_id.currency_id')
    backorder_of_id = fields.Many2one('smartspend.receipt', string='Backorder of', readonly=True,
                                      help="The receipt this one holds the undelivered rest of.")
    backorder_ids = fields.One2many('smartspend.receipt', 'backorder_of_id', string='Backorders')
    is_backorder = fields.Boolean(compute='_compute_is_backorder', store=True)
    scheduled_date = fields.Date(string='Expected On',
                                 help="When the goods are expected: the vendor's committed date, if any.")
    date_done = fields.Datetime(string='Received On', readonly=True)
    received_by_id = fields.Many2one('res.users', string='Received By', readonly=True)
    shipping_method = fields.Selection(SHIPPING_METHOD_SELECTION, string='Shipping Method')
    quality_passed = fields.Boolean(string='Quality Inspection Passed', default=True)
    no_backorder = fields.Boolean(string='No Backorder', readonly=True,
                                  help="Received short, and the rest was closed instead of kept open.")
    line_ids = fields.One2many('smartspend.receipt.line', 'receipt_id', string='Products')
    amount_pending = fields.Monetary(compute='_compute_amounts', store=True,
                                     help="Value still to arrive on this receipt.")
    qty_pending = fields.Float(compute='_compute_amounts', store=True)

    @api.depends('backorder_of_id')
    def _compute_is_backorder(self):
        for receipt in self:
            receipt.is_backorder = bool(receipt.backorder_of_id)

    @api.depends('state', 'line_ids.qty_demand', 'line_ids.qty_done', 'line_ids.price_unit')
    def _compute_amounts(self):
        for receipt in self:
            open_lines = receipt.line_ids if receipt.state == 'waiting' else receipt.line_ids.browse()
            receipt.qty_pending = sum(open_lines.mapped('qty_demand'))
            receipt.amount_pending = sum(line.qty_demand * line.price_unit for line in open_lines)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('smartspend.receipt') or _('New')
        return super().create(vals_list)

    # ------------------------------------------------------------------
    # The receipt waiting on an order
    # ------------------------------------------------------------------
    @api.model
    def _waiting_for(self, order):
        """The receipt expected next on ``order`` — created for the first delivery
        with every line's full quantity; after that, the open backorder, if any."""
        order.ensure_one()
        Receipt = self.sudo()
        waiting = Receipt.search([('purchase_order_id', '=', order.id), ('state', '=', 'waiting')],
                                 order='id desc', limit=1)
        if waiting or Receipt.search_count([('purchase_order_id', '=', order.id)]):
            return waiting
        lines = order.order_line.filtered(lambda l: not l.display_type and l.product_qty > l.qty_received)
        if not lines:
            return Receipt
        request = order.smartspend_request_id
        return Receipt.create({
            'purchase_order_id': order.id,
            'request_id': request.id or False,
            'scheduled_date': request.vendor_delivery_date or (order.date_planned and order.date_planned.date()),
            'line_ids': [fields.Command.create({
                'po_line_id': line.id,
                'product_name': line.name.split('\n')[0] if line.name else line.product_id.name,
                'qty_demand': line.product_qty - line.qty_received,
                'price_unit': line.price_unit,
            }) for line in lines],
        })

    # ------------------------------------------------------------------
    # Validate — Odoo's "Validate" with its backorder question
    # ------------------------------------------------------------------
    def action_validate(self, quantities=None, backorder=None, shipping_method=None, quality_passed=True):
        """Record what arrived and close the receipt.

        :param quantities: ``{receipt line id: qty received}``; lines left out
            count as fully received.
        :param backorder: ``'create'`` or ``'none'`` — required when anything
            arrived short; without it :class:`BackorderDecisionNeeded` is raised
            listing the shortages, which is where Odoo asks "Create Backorder?".
        :return: the backorder created, or an empty recordset.
        """
        self.ensure_one()
        if self.state != 'waiting':
            raise UserError(_("%s has already been processed.", self.name))
        if not quality_passed:
            raise UserError(_("Pass the quality inspection before validating the receipt."))
        quantities = {int(k): float(v) for k, v in (quantities or {}).items()}
        for line in self.line_ids:
            qty = quantities.get(line.id, line.qty_demand)
            if qty < 0:
                raise UserError(_("A received quantity cannot be negative."))
            if qty > line.qty_demand:
                raise UserError(_("%(product)s: %(got)s received, but only %(want)s were expected on %(receipt)s.",
                                  product=line.product_name, got=qty, want=line.qty_demand, receipt=self.name))
            line.qty_done = qty
        if not any(self.line_ids.mapped('qty_done')):
            raise UserError(_("Nothing was received. Enter the quantities that arrived."))
        short = self.line_ids.filtered(lambda l: l.qty_done < l.qty_demand)
        if short and backorder not in ('create', 'none'):
            raise BackorderDecisionNeeded(
                _("You have processed less products than the initial demand. Create a backorder?"),
                [{'lineId': l.id, 'product': l.product_name, 'demand': l.qty_demand,
                  'done': l.qty_done, 'missing': l.qty_demand - l.qty_done} for l in short])

        for line in self.line_ids.filtered('qty_done'):
            line.po_line_id.sudo().qty_received += line.qty_done
        self.write({
            'state': 'done', 'date_done': fields.Datetime.now(), 'received_by_id': self.env.user.id,
            'shipping_method': shipping_method or self.shipping_method or False,
            'quality_passed': True, 'no_backorder': bool(short) and backorder == 'none',
        })
        new = self.browse()
        if short and backorder == 'create':
            new = self.sudo().create({
                'purchase_order_id': self.purchase_order_id.id,
                'request_id': self.request_id.id,
                'backorder_of_id': self.id,
                'scheduled_date': self.scheduled_date,
                'shipping_method': self.shipping_method,
                'line_ids': [fields.Command.create({
                    'po_line_id': l.po_line_id.id, 'product_name': l.product_name,
                    'qty_demand': l.qty_demand - l.qty_done, 'price_unit': l.price_unit,
                }) for l in short],
            })
        self._log_receipt(short, new, backorder)
        return new

    def action_no_backorder(self):
        """Close an open backorder: the rest will not be delivered."""
        for receipt in self:
            if receipt.state != 'waiting' or not receipt.backorder_of_id:
                raise UserError(_("Only an open backorder can be closed this way."))
            receipt.write({'state': 'cancel', 'no_backorder': True})
            text = _("Backorder %(name)s closed — %(qty)s unit(s) will not be delivered (%(items)s).",
                     name=receipt.name, qty=self._fmt(sum(receipt.line_ids.mapped('qty_demand'))),
                     items=', '.join(f"{self._fmt(l.qty_demand)} × {l.product_name}" for l in receipt.line_ids))
            receipt._post(_("Backorder Closed"), text)
        return True

    # ------------------------------------------------------------------
    @staticmethod
    def _fmt(qty):
        return int(qty) if float(qty).is_integer() else qty

    def _post(self, title, text):
        self.ensure_one()
        self.message_post(body=text)
        self.purchase_order_id.sudo().message_post(body=text)
        if self.request_id:
            self.request_id.sudo()._log_history(title, text)
            self.request_id.sudo().message_post(body=text)

    def _log_receipt(self, short, new, backorder):
        got = ', '.join(f"{self._fmt(l.qty_done)}/{self._fmt(l.qty_demand)} {l.product_name}" for l in self.line_ids)
        text = _("%(name)s received from %(vendor)s: %(got)s.", name=self.name,
                 vendor=self.partner_id.name, got=got)
        if new:
            text += ' ' + _("Backorder %(bo)s created for the rest (%(items)s).", bo=new.name,
                            items=', '.join(f"{self._fmt(l.qty_demand)} × {l.product_name}" for l in new.line_ids))
        elif short and backorder == 'none':
            text += ' ' + _("No backorder — the missing quantity will not be delivered.")
        title = _("Goods Received (%s)", self.name) if not self.is_backorder else _("Backorder Received (%s)", self.name)
        self._post(title, text)


class SmartspendReceiptLine(models.Model):
    _name = 'smartspend.receipt.line'
    _description = 'SmartSpend Goods Receipt Line'
    _order = 'id'

    receipt_id = fields.Many2one('smartspend.receipt', required=True, ondelete='cascade', index=True)
    po_line_id = fields.Many2one('purchase.order.line', string='Order Line', required=True, ondelete='cascade')
    product_name = fields.Char(string='Product', required=True)
    qty_demand = fields.Float(string='Expected', digits='Product Unit')
    qty_done = fields.Float(string='Received', digits='Product Unit')
    price_unit = fields.Float(string='Unit Price')
    currency_id = fields.Many2one(related='receipt_id.currency_id')
