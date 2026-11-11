"""Purchase orders for the manager's Open PO report.

Every confirmed purchase order with what was ordered, received and billed on
each line, so the portal can list the ones still open: goods not all received,
or not all billed. Read-only; cancelled and draft orders are left out.
"""
from odoo import _, fields, http
from odoo.http import request

from .auction import _is_buyer, _is_vendor
from .main import _authenticate, _error

BILLING = {'no': 'Nothing to bill', 'to invoice': 'Waiting for bills', 'invoiced': 'Fully billed'}


def _num(qty):
    return int(qty) if float(qty).is_integer() else qty


def _order_row(order, today, pr):
    lines = order.order_line.filtered(lambda line: not line.display_type)
    ordered_value = sum(lines.mapped('price_subtotal'))
    received_value = sum(line.price_unit * min(line.qty_received, line.product_qty) for line in lines)
    billed_value = sum(line.price_unit * min(line.qty_invoiced, line.product_qty) for line in lines)
    fully_received = all(line.qty_received >= line.product_qty for line in lines)
    fully_billed = all(line.qty_invoiced >= line.product_qty for line in lines)
    subscription = order.smartspend_subscription_id
    expected = order.smartspend_delivery_date or (order.date_planned and order.date_planned.date())
    return {
        'name': order.name,
        'state': order.state,
        'orderDate': fields.Datetime.to_string(order.date_order) if order.date_order else '',
        'expectedDate': fields.Date.to_string(expected) if expected else '',
        'overdue': bool(expected and expected < today and not fully_received),
        'daysOpen': (today - order.date_order.date()).days if order.date_order else 0,
        'vendor': order.partner_id.name or '',
        'company': order.company_id.name or '',
        'currency': order.currency_id.name or '',
        'acknowledged': order.smartspend_acknowledged,
        'requestId': pr.name or order.smartspend_request_ref or '',
        'subscription': subscription.name or '',
        # The source document as the order records it, e.g. a request since removed.
        'origin': order.origin or '',
        # Raised from a request, or by a subscription on its owner's behalf.
        'requester': pr.user_id.name or subscription.owner_id.name or '',
        'branch': pr.location or subscription.branch_id.name or '',
        'department': pr.department or subscription.department_id.name or '',
        'amountUntaxed': order.amount_untaxed,
        'amountTotal': order.amount_total,
        'orderedValue': ordered_value,
        'receivedValue': received_value,
        'billedValue': billed_value,
        'fullyReceived': fully_received,
        'fullyBilled': fully_billed,
        'billing': BILLING.get(order.invoice_status, order.invoice_status or ''),
        'open': not (fully_received and fully_billed),
        'lines': [{
            'product': (line.name or '').split('\n')[0],
            'ordered': _num(line.product_qty),
            'received': _num(line.qty_received),
            'billed': _num(line.qty_invoiced),
            'price': line.price_unit,
            'subtotal': line.price_subtotal,
        } for line in lines],
    }


class SmartSpendOpenPo(http.Controller):

    @http.route('/api/smartspend/reports/open-po', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def open_po(self, **kwargs):
        """Every confirmed purchase order of the user's companies.

        :return: ``{'today', 'orders': [...]}`` — each order with its lines and
            whether it is still open (not all received, or not all billed).
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if _is_vendor(user) or not (_is_buyer(user) or user.has_group('smartspend.group_smartspend_manager')):
            return _error(_("The Open PO report is for the purchasing desk."), 403)
        # Read as superuser: the report hands back figures, and a SmartSpend
        # manager holds no purchase rights of their own.
        Order = request.env(su=True)['purchase.order']
        today = fields.Date.context_today(Order)
        orders = Order.search([('state', 'in', ('purchase', 'done')),
                               ('company_id', 'in', user.company_ids.ids)], order='date_order desc')
        # The request behind each order: linked directly, through the request's
        # own orders, or named as the order's source document.
        Request = request.env(su=True)['smartspend.request']
        requests = Request.search(['|', ('purchase_order_ids', 'in', orders.ids),
                                   ('name', 'in', [o for o in orders.mapped('origin') if o])])
        by_order = {order.id: req for req in requests for order in req.purchase_order_ids}
        by_name = {req.name: req for req in requests}

        def request_of(order):
            return (order.smartspend_request_id or by_order.get(order.id)
                    or by_name.get(order.origin or '') or Request)
        return {
            'today': fields.Date.to_string(today),
            'orders': [_order_row(order, today, request_of(order)) for order in orders],
        }
