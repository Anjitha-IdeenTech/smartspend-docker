from odoo import api, fields, models, _

from .smartspend_request import SETTLED_STATES


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    smartspend_request_id = fields.Many2one(
        'smartspend.request', string='Purchase Request', copy=False, index='btree_not_null',
        help="SmartSpend request this order was raised from.")
    smartspend_contract_id = fields.Many2one(
        'smartspend.contract', string='Rate Contract', copy=False, index='btree_not_null',
        help="Pre-negotiated agreement the prices on this order come from.")
    smartspend_request_ref = fields.Char(
        related='smartspend_request_id.name', string='Request Reference')
    smartspend_contract_ref = fields.Char(
        related='smartspend_contract_id.name', string='Contract Reference')
    smartspend_request_count = fields.Integer(compute='_compute_smartspend_request_count')

    @api.depends('smartspend_request_id')
    def _compute_smartspend_request_count(self):
        for order in self:
            order.smartspend_request_count = 1 if order.smartspend_request_id else 0

    def action_view_smartspend_request(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Request'),
            'res_model': 'smartspend.request',
            'view_mode': 'form',
            'res_id': self.smartspend_request_id.id,
        }

    def action_view_smartspend_contract(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Rate Contract'),
            'res_model': 'smartspend.contract',
            'view_mode': 'form',
            'res_id': self.smartspend_contract_id.id,
        }

    def _smartspend_settle(self):
        """Post the vendor bill for this order and pay it in full.

        The portal's "Paid" is the end of the story it tells the employee. In
        Odoo that story has to leave documents behind, or the spend never
        reaches the ledger and the vendor shows no balance against an order
        everybody believes is settled.

        :return: the bills now posted against this order.
        """
        self.ensure_one()
        if self.state != 'purchase':
            return self.env['account.move']

        # An order can only be billed for what it says arrived, and with stock
        # uninstalled nothing ever marks itself received. The portal timeline
        # already tells the employee the goods landed, so record that here
        # rather than leave the order permanently unbillable.
        for line in self.order_line:
            if line.qty_received < line.product_qty:
                line.qty_received = line.product_qty
        self.invalidate_recordset(['invoice_status'])
        if self.invoice_status == 'to invoice':
            self.action_create_invoice()

        for draft in self.invoice_ids.filtered(lambda move: move.state == 'draft'):
            # A vendor bill cannot post without one, and the vendor's own date
            # is not something the portal ever collected.
            if not draft.invoice_date:
                draft.invoice_date = fields.Date.context_today(draft)
            draft.action_post()

        unpaid = self.invoice_ids.filtered(
            lambda move: move.state == 'posted' and move.payment_state in ('not_paid', 'partial'))
        if unpaid:
            self.env['account.payment.register'].with_context(
                active_model='account.move', active_ids=unpaid.ids,
            ).create({}).action_create_payments()
        return self.invoice_ids.filtered(lambda move: move.state == 'posted')

    def button_cancel(self):
        """Take the request back out of *PO Confirmed* when nothing is left standing.

        Confirming an order moves its request to *PO Confirmed*; cancelling the
        last one has to undo that, or the request claims an order it no longer
        has — and the buyer is offered "Create Purchase Order" on a record whose
        status says one already exists. The state it returns to is the one the
        timeline recorded when the order was raised.
        """
        res = super().button_cancel()
        for request in self.smartspend_request_id:
            request = request.sudo()
            if request.purchase_order_ids.filtered(lambda order: order.state != 'cancel'):
                continue
            dropped = self.filtered(lambda order: order.smartspend_request_id == request)
            note = _("%(orders)s cancelled — this request has no order standing.",
                     orders=", ".join(dropped.mapped('name')))
            previous = request.state
            if previous == 'po_confirmed':
                # Whatever it was before the order was raised; the timeline knows.
                raised = request.history_ids.filtered(lambda h: h.state_to == 'po_confirmed')
                request.state = (raised[-1:].state_from or 'approved')
            request._log_history(
                _("Purchase Order Cancelled"), note,
                state_from=previous, state_to=request.state)
            request.message_post(body=note)
        return res

    def button_confirm(self):
        res = super().button_confirm()
        skip_log = self.env.context.get('smartspend_po_created')
        for order in self.filtered('smartspend_request_id'):
            # Confirmed as part of raising it from a request: that call writes
            # its own "PO Created" entry, and two lines for one action read as
            # two separate events on the timeline.
            if not skip_log:
                order.smartspend_request_id._log_history(
                    _("PO Confirmed: %s", order.name),
                    _("Confirmed with %s", order.partner_id.name))
            if order.smartspend_request_id.state not in SETTLED_STATES:
                order.smartspend_request_id.state = 'po_confirmed'
        return res
