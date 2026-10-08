"""Goods receipts and backorders on the portal.

The Receive Items screen validates a receipt; when it arrives short, Odoo's
question comes back — create a backorder for the rest, or not. The Backorders
board lists every delivery still owed. Only the purchase manager receives goods
or closes a backorder; buyers read everything, a supplier reads its own.
"""
from odoo import _, fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from ..models.smartspend_receipt import BackorderDecisionNeeded
from .auction import _is_buyer, _is_vendor
from .main import _authenticate, _error, _refused


def _num(qty):
    return int(qty) if float(qty).is_integer() else qty


def _receipt_row(receipt):
    return {
        'id': receipt.id,
        'name': receipt.name,
        'state': receipt.state,
        'isBackorder': receipt.is_backorder,
        'backorderOf': receipt.backorder_of_id.name or '',
        'noBackorder': receipt.no_backorder,
        'scheduledDate': fields.Date.to_string(receipt.scheduled_date) if receipt.scheduled_date else '',
        'doneAt': fields.Datetime.to_string(receipt.date_done) if receipt.date_done else '',
        'createdAt': fields.Datetime.to_string(receipt.create_date) if receipt.create_date else '',
        'shippingMethod': receipt.shipping_method or '',
        'lines': [{'id': line.id, 'poLineId': line.po_line_id.id, 'product': line.product_name,
                   'demand': _num(line.qty_demand), 'done': _num(line.qty_done), 'price': line.price_unit}
                  for line in receipt.line_ids],
        'qtyPending': _num(receipt.qty_pending),
        'amountPending': receipt.amount_pending,
    }


def _order_lines(order):
    return [{'poLineId': line.id, 'product': (line.name or '').split('\n')[0],
             'ordered': _num(line.product_qty), 'received': _num(line.qty_received),
             'price': line.price_unit}
            for line in order.order_line.filtered(lambda l: not l.display_type)]


class SmartSpendReceipts(http.Controller):

    def _request_for(self, reference):
        """The request, if this user may see it — then read as superuser."""
        user = request.env.user
        record = request.env['smartspend.request'].sudo().search([('name', '=', (reference or '').strip())], limit=1)
        if not record:
            return None
        if _is_vendor(user):
            return record if record._placed_with(user) else None
        if _is_buyer(user) or request.env['smartspend.request'].search_count([('id', '=', record.id)]):
            return record
        return None

    @http.route('/api/smartspend/receipts', type='json2', auth='none', methods=['GET'], cors='*', readonly=True)
    def receipts(self, requestId=None, **kwargs):
        """The order's lines, the receipt expected next, and every receipt so far."""
        error = _authenticate()
        if error:
            return error
        reference = requestId or request.httprequest.args.get('requestId')
        record = self._request_for(reference)
        if not record:
            return _error(_("No purchase request named %s.", reference or '—'), 404)
        order = record.purchase_order_ids.filtered(lambda o: o.state in ('purchase', 'done'))[:1]
        if not order:
            return {'requestId': record.name, 'order': '', 'lines': [], 'open': None, 'receipts': []}
        Receipt = request.env['smartspend.receipt'].sudo()
        receipts = Receipt.search([('purchase_order_id', '=', order.id)], order='id')
        waiting = receipts.filtered(lambda r: r.state == 'waiting')[-1:]
        if waiting:
            open_row = _receipt_row(waiting)
        elif not receipts:
            # Nothing recorded yet: the first delivery expects every line in
            # full. The receipt itself is only created when it is validated.
            remaining = [l for l in order.order_line if not l.display_type and l.product_qty > l.qty_received]
            open_row = {'id': None, 'name': '', 'state': 'waiting', 'isBackorder': False, 'backorderOf': '',
                        'scheduledDate': fields.Date.to_string(record.vendor_delivery_date) if record.vendor_delivery_date else '',
                        'lines': [{'id': None, 'poLineId': l.id, 'product': (l.name or '').split('\n')[0],
                                   'demand': _num(l.product_qty - l.qty_received), 'done': 0, 'price': l.price_unit}
                                  for l in remaining]} if remaining else None
        else:
            open_row = None
        return {
            'requestId': record.name,
            'order': order.name,
            'vendor': order.partner_id.name,
            'lines': _order_lines(order),
            'open': open_row,
            'receipts': [_receipt_row(receipt) for receipt in receipts],
            'canReceive': request.env.user.has_group('smartspend.group_smartspend_manager'),
        }

    @http.route('/api/smartspend/receipts/validate', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def validate(self, requestId=None, quantities=None, backorder=None, shippingMethod=None,
                 qualityPassed=True, **kwargs):
        """Validate the delivery expected on a request's order.

        :param quantities: ``{purchase order line id: qty received}``.
        :param backorder: ``'create'`` or ``'none'`` when it arrived short;
            left out, a short delivery answers 409 with the shortages — the
            portal then asks "Create Backorder?".
        """
        error = _authenticate()
        if error:
            return error
        if not request.env.user.has_group('smartspend.group_smartspend_manager'):
            return _error(_("Only the purchase manager records goods receipt."), 403)
        record = self._request_for(requestId)
        if not record:
            return _error(_("No purchase request named %s.", requestId or '—'), 404)
        order = record.purchase_order_ids.filtered(lambda o: o.state in ('purchase', 'done'))[:1]
        if not order:
            return _error(_("%s has no confirmed purchase order to receive against.", record.name), 400)
        receipt = request.env['smartspend.receipt'].sudo()._waiting_for(order)
        if not receipt:
            return _error(_("Everything on %s has been received or closed.", order.name), 400)
        try:
            by_po_line = {int(k): float(v) for k, v in (quantities or {}).items()}
        except (TypeError, ValueError):
            return _error(_("Received quantities have to be numbers."), 400)
        mapped = {line.id: by_po_line[line.po_line_id.id] for line in receipt.line_ids if line.po_line_id.id in by_po_line}
        try:
            new = receipt.with_user(request.env.user).sudo().action_validate(
                quantities=mapped, backorder=backorder,
                shipping_method=shippingMethod or None, quality_passed=bool(qualityPassed))
            if shippingMethod and receipt.request_id:
                receipt.request_id.sudo().shipping_method = shippingMethod
        except BackorderDecisionNeeded as exc:
            request.env.cr.rollback()
            return request.make_json_response(
                {'error': str(exc), 'needsBackorderDecision': True, 'shortages': exc.shortages}, status=409)
        except (UserError, ValidationError, AccessError, ValueError) as exc:
            return _refused(exc)
        return {'receipt': _receipt_row(receipt), 'backorder': _receipt_row(new) if new else None,
                'lines': _order_lines(receipt.purchase_order_id)}

    @http.route('/api/smartspend/receipts/<int:receipt_id>/no-backorder', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def no_backorder(self, receipt_id=None, **kwargs):
        """Close an open backorder: the rest will not be delivered."""
        error = _authenticate()
        if error:
            return error
        if not request.env.user.has_group('smartspend.group_smartspend_manager'):
            return _error(_("Only the purchase manager closes a backorder."), 403)
        receipt = request.env['smartspend.receipt'].sudo().browse(receipt_id).exists()
        if not receipt:
            return _error(_("That goods receipt no longer exists."), 404)
        try:
            receipt.action_no_backorder()
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _receipt_row(receipt)

    @http.route('/api/smartspend/backorders', type='json2', auth='none', methods=['GET'], cors='*', readonly=True)
    def backorders(self, **kwargs):
        """Every backorder: open ones first, then those settled in the last 60 days."""
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        vendor = _is_vendor(user)
        if not vendor and not _is_buyer(user):
            return _error(_("Backorders are followed up by the purchasing desk."), 403)
        Receipt = request.env['smartspend.receipt'].sudo()
        today = fields.Date.context_today(Receipt)
        since = fields.Datetime.subtract(fields.Datetime.now(), days=60)
        found = Receipt.search(['&', ('is_backorder', '=', True), '|', ('state', '=', 'waiting'),
                                ('write_date', '>=', since)], order='id desc', limit=300)
        if vendor:
            supplier = user.sudo().partner_id.commercial_partner_id
            found = found.filtered(lambda r: r.partner_id.commercial_partner_id == supplier)
        rows = []
        for receipt in found:
            order = receipt.purchase_order_id
            chain = Receipt.search([('purchase_order_id', '=', order.id)], order='id')
            opened = (receipt.create_date or fields.Datetime.now()).date()
            row = _receipt_row(receipt)
            row.update({
                'requestId': receipt.request_id.name or '',
                'order': order.name,
                'vendor': receipt.partner_id.name,
                'daysOpen': (today - opened).days if receipt.state == 'waiting' else 0,
                'overdue': bool(receipt.state == 'waiting' and receipt.scheduled_date and receipt.scheduled_date < today),
                'orderLines': _order_lines(order),
                'chain': [{'name': r.name, 'state': r.state, 'isBackorder': r.is_backorder,
                           'noBackorder': r.no_backorder,
                           'qty': _num(sum(r.line_ids.mapped('qty_done' if r.state == 'done' else 'qty_demand'))),
                           'at': fields.Datetime.to_string(r.date_done or r.create_date) if (r.date_done or r.create_date) else ''}
                          for r in chain],
            })
            rows.append(row)
        return {
            'today': fields.Date.to_string(today),
            'canReceive': user.has_group('smartspend.group_smartspend_manager') and not vendor,
            'backorders': rows,
        }
