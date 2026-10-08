"""What this product has cost us before, from the line you are looking at.

A buyer pricing a line asks the same three questions every time: what rate is
contracted for it, what have we actually paid on past orders, and who gave us
the best price. Answering them today means leaving the request, searching
contracts, then searching orders. This is that search, done from the line and
shown in one window.

Everything here is read out of the records: rate contract lines, confirmed
purchase order lines, and earlier requests for the same product. Nothing is
estimated. A product is matched by its Odoo product when the line carries one —
free-typed names vary — and by name otherwise, which is what the portal's own
lines are matched on.
"""
from odoo import api, fields, models, _

# A history is a reference, not an archive: enough rows to see the pattern.
HISTORY_LIMIT = 40


class SmartspendProductHistory(models.TransientModel):
    _name = 'smartspend.product.history'
    _description = 'Product Purchase History'

    product_name = fields.Char(string='Product', readonly=True)
    product_id = fields.Many2one('product.product', string='Odoo Product', readonly=True)
    branch = fields.Char(string='Branch / Site', readonly=True)
    currency_id = fields.Many2one(
        'res.currency', readonly=True,
        default=lambda self: self.env.company.currency_id)

    # What the buyer reads first.
    contracted_rate = fields.Monetary(
        string='Best Contracted Rate', readonly=True,
        help="Lowest rate on a running rate contract for this product.")
    contracted_partner_id = fields.Many2one(
        'res.partner', string='Contracted With', readonly=True)
    last_paid = fields.Monetary(
        string='Last Paid', readonly=True, help="Unit price on the most recent order.")
    last_paid_on = fields.Date(string='Last Ordered', readonly=True)
    last_partner_id = fields.Many2one('res.partner', string='Last Supplier', readonly=True)
    average_paid = fields.Monetary(
        string='Average Paid', readonly=True,
        help="Average unit price across the orders below.")
    best_paid = fields.Monetary(
        string='Best Price Paid', readonly=True,
        help="Lowest unit price actually paid on an order.")
    best_partner_id = fields.Many2one('res.partner', string='Best Price From', readonly=True)
    order_qty = fields.Float(string='Quantity Ordered', readonly=True,
                             help="Total quantity ordered across the orders below.")

    contract_line_ids = fields.One2many(
        'smartspend.product.history.contract', 'history_id', string='Rate Contracts', readonly=True)
    order_line_ids = fields.One2many(
        'smartspend.product.history.order', 'history_id', string='Purchase Orders', readonly=True)
    request_line_ids = fields.One2many(
        'smartspend.product.history.request', 'history_id', string='Requests', readonly=True)

    # ------------------------------------------------------------------
    # Gathering
    # ------------------------------------------------------------------
    @api.model
    def _open_for(self, product_name, product=None, branch=None):
        """Build the history for one product and return the window that shows it.

        :param product_name: the line's product as written on it.
        :param product: the Odoo product, when the line is linked to one.
        :param branch: the branch the line is for, shown for context.
        :return: an ``ir.actions.act_window`` opening the filled-in wizard.
        """
        wizard = self.create(self._gather(product_name, product, branch))
        return {
            'type': 'ir.actions.act_window',
            'name': _('Product History'),
            'res_model': self._name,
            'res_id': wizard.id,
            'view_mode': 'form',
            'target': 'new',
        }

    @api.model
    def _gather(self, product_name, product=None, branch=None):
        """Every value the window shows, as one dict of create values."""
        product = product or self.env['product.product'].browse()
        name = (product_name or product.display_name or '').strip()
        values = {
            'product_name': name or _('This product'),
            'product_id': product.id or False,
            'branch': branch or '',
        }
        values.update(self._contract_values(name, product))
        values.update(self._order_values(name, product))
        values.update(self._request_values(name, product))
        return values

    def _contract_values(self, name, product):
        domain = [('contract_id.state', '=', 'active')]
        domain += ([('product_id', '=', product.id)] if product
                   else [('product_name', '=ilike', name)])
        lines = self.env['smartspend.contract.line'].sudo().search(
            domain, order='price_unit asc', limit=HISTORY_LIMIT)
        best = lines[:1]
        return {
            'contracted_rate': best.price_unit if best else 0.0,
            'contracted_partner_id': best.partner_id.id if best else False,
            'contract_line_ids': [(0, 0, {
                'contract_id': line.contract_id.id,
                'partner_id': line.partner_id.id,
                'price_unit': line.price_unit,
                'min_qty': line.min_qty,
                'date_end': line.contract_id.date_end,
                'lead_time': line.contract_id.lead_time or '',
                'payment_terms': line.contract_id.payment_terms or '',
            }) for line in lines],
        }

    def _order_values(self, name, product):
        domain = [('order_id.state', 'in', ('purchase', 'done'))]
        domain += ([('product_id', '=', product.id)] if product
                   else [('name', 'ilike', name)])
        lines = self.env['purchase.order.line'].sudo().search(
            domain, order='date_order desc, id desc', limit=HISTORY_LIMIT)
        if not lines:
            return {'order_line_ids': []}
        priced = lines.filtered(lambda line: line.price_unit)
        cheapest = min(priced, key=lambda line: line.price_unit) if priced else lines[:1]
        latest = lines[0]
        return {
            'last_paid': latest.price_unit,
            'last_paid_on': latest.date_order.date() if latest.date_order else False,
            'last_partner_id': latest.order_id.partner_id.id,
            'average_paid': (sum(priced.mapped('price_unit')) / len(priced)) if priced else 0.0,
            'best_paid': cheapest.price_unit,
            'best_partner_id': cheapest.order_id.partner_id.id,
            'order_qty': sum(lines.mapped('product_qty')),
            'order_line_ids': [(0, 0, {
                'order_id': line.order_id.id,
                'partner_id': line.order_id.partner_id.id,
                'date_order': line.date_order.date() if line.date_order else False,
                'product_qty': line.product_qty,
                'price_unit': line.price_unit,
                'price_subtotal': line.price_subtotal,
                'state': line.order_id.state,
                'request_ref': line.order_id.smartspend_request_ref or '',
            }) for line in lines],
        }

    def _request_values(self, name, product):
        domain = ([('product_id', '=', product.id)] if product
                  else [('product_name', '=ilike', name)])
        lines = self.env['smartspend.request.line'].sudo().search(
            domain, order='id desc', limit=HISTORY_LIMIT)
        return {
            'request_line_ids': [(0, 0, {
                'request_id': line.request_id.id,
                'user_id': line.request_id.user_id.id,
                'branch': line.request_id.location or '',
                'request_date': (line.request_id.request_date.date()
                                 if line.request_id.request_date else False),
                'product_qty': line.product_qty,
                'price_unit': line.price_unit,
                'state': line.request_id.state,
            }) for line in lines],
        }


class SmartspendProductHistoryContract(models.TransientModel):
    _name = 'smartspend.product.history.contract'
    _description = 'Product History — Rate Contracts'
    _order = 'price_unit asc'

    history_id = fields.Many2one('smartspend.product.history', required=True, ondelete='cascade')
    currency_id = fields.Many2one(related='history_id.currency_id')
    contract_id = fields.Many2one('smartspend.contract', string='Contract', readonly=True)
    partner_id = fields.Many2one('res.partner', string='Supplier', readonly=True)
    price_unit = fields.Monetary(string='Contracted Rate', readonly=True)
    min_qty = fields.Float(string='Min. Qty', readonly=True)
    date_end = fields.Date(string='Valid Until', readonly=True)
    lead_time = fields.Char(string='Lead Time', readonly=True)
    payment_terms = fields.Char(string='Payment Terms', readonly=True)


class SmartspendProductHistoryOrder(models.TransientModel):
    _name = 'smartspend.product.history.order'
    _description = 'Product History — Purchase Orders'
    _order = 'date_order desc, id desc'

    history_id = fields.Many2one('smartspend.product.history', required=True, ondelete='cascade')
    currency_id = fields.Many2one(related='history_id.currency_id')
    order_id = fields.Many2one('purchase.order', string='Order', readonly=True)
    partner_id = fields.Many2one('res.partner', string='Supplier', readonly=True)
    date_order = fields.Date(string='Ordered On', readonly=True)
    product_qty = fields.Float(string='Qty', readonly=True)
    price_unit = fields.Monetary(string='Unit Price', readonly=True)
    price_subtotal = fields.Monetary(string='Subtotal', readonly=True)
    state = fields.Char(string='Status', readonly=True)
    request_ref = fields.Char(string='Request', readonly=True)


class SmartspendProductHistoryRequest(models.TransientModel):
    _name = 'smartspend.product.history.request'
    _description = 'Product History — Requests'
    _order = 'request_date desc, id desc'

    history_id = fields.Many2one('smartspend.product.history', required=True, ondelete='cascade')
    currency_id = fields.Many2one(related='history_id.currency_id')
    request_id = fields.Many2one('smartspend.request', string='Request', readonly=True)
    user_id = fields.Many2one('res.users', string='Raised By', readonly=True)
    branch = fields.Char(string='Branch / Site', readonly=True)
    request_date = fields.Date(string='Raised On', readonly=True)
    product_qty = fields.Float(string='Qty', readonly=True)
    price_unit = fields.Monetary(string='Target Price', readonly=True)
    state = fields.Char(string='Status', readonly=True)
