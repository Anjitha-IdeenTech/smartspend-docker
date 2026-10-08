"""Subscriptions on the portal — recurring purchases ordered automatically.

The SCM buyer sets them up and runs them; a procurement manager (who is a
buyer too) the same. Everyone else is refused: the list carries vendor prices.
"""
from collections import OrderedDict

from dateutil.relativedelta import relativedelta

from odoo import _, fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from ..models.smartspend_subscription import FREQUENCIES, STATES
from .auction import _is_buyer
from .main import _authenticate, _error, _refused

ORDER_STATES = {'draft': 'RFQ', 'sent': 'RFQ Sent', 'to approve': 'To Approve',
                'purchase': 'Confirmed', 'done': 'Locked', 'cancel': 'Cancelled'}


def _date(value):
    return fields.Date.to_string(value) if value else ''


def _row(sub):
    orders = sub.order_ids.sorted(lambda o: (o.smartspend_cycle_date or o.date_order.date(), o.id), reverse=True)
    return {
        'id': sub.name,
        'dbId': sub.id,
        'title': sub.title,
        'state': sub.state,
        'stateLabel': dict(STATES)[sub.state],
        'vendor': sub.partner_id.name,
        'vendorId': sub.partner_id.id,
        'frequency': sub.frequency,
        'startDate': _date(sub.start_date),
        'endDate': _date(sub.end_date),
        'nextOrderDate': _date(sub.next_order_date),
        'autoConfirm': sub.auto_confirm,
        'department': sub.department_id.name or '',
        'branch': sub.branch_id.name or '',
        'category': sub.category_id.name or '',
        'owner': sub.owner_id.name or '',
        'note': sub.note or '',
        'lines': [{'productName': line.product_name, 'qty': line.product_qty,
                   'price': line.price_unit, 'subtotal': line.subtotal} for line in sub.line_ids],
        'perOrder': sub.amount_per_cycle,
        'monthlyCost': sub.monthly_cost,
        'annualCost': sub.annual_cost,
        'orderedTotal': sub.ordered_total,
        'orderCount': sub.order_count,
        'orders': [{
            'po': order.name,
            'cycle': _date(order.smartspend_cycle_date),
            'raisedAt': fields.Datetime.to_string(order.date_order) if order.date_order else '',
            'amount': order.amount_total,
            'state': order.state,
            'stateLabel': ORDER_STATES.get(order.state, order.state),
        } for order in orders[:24]],
    }


class SmartSpendSubscriptions(http.Controller):

    def _check(self):
        error = _authenticate()
        if error:
            return error
        if not _is_buyer(request.env.user):
            return _error(_("Subscriptions are run by the SCM buyer."), 403)
        return None

    @http.route('/api/smartspend/subscriptions', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def subscriptions(self, **kwargs):
        """Every subscription, a 12-month order forecast, and the form's choices."""
        error = self._check()
        if error:
            return error
        env = request.env
        subs = env['smartspend.subscription'].search([])
        today = fields.Date.context_today(subs)
        months = OrderedDict()
        for offset in range(12):
            first = (today + relativedelta(months=offset)).replace(day=1)
            months[first.strftime('%Y-%m')] = {'month': first.strftime('%Y-%m'), 'label': first.strftime('%b %Y'),
                                               'total': 0.0, 'items': []}
        for sub in subs:
            for day, amount in sub._upcoming(12):
                bucket = months.get(day.strftime('%Y-%m'))
                if bucket:
                    bucket['total'] += amount
                    bucket['items'].append({'id': sub.name, 'title': sub.title, 'amount': amount,
                                            'frequency': sub.frequency})
        su = env(su=True)
        return {
            'today': _date(today),
            'subscriptions': [_row(sub) for sub in subs],
            'forecast': list(months.values()),
            'vendors': [{'id': p.id, 'name': p.name}
                        for p in su['res.partner'].search([('supplier_rank', '>', 0)], order='name', limit=500)],
            'departments': su['smartspend.department'].search([]).mapped('name'),
            'branches': su['smartspend.branch'].search([]).mapped('name'),
            'categories': su['smartspend.expense.category'].search([]).mapped('name'),
            'frequencies': [{'value': key, 'label': label} for key, label in FREQUENCIES],
        }

    @http.route('/api/smartspend/subscriptions/save', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def save(self, id=None, title=None, vendorId=None, frequency=None, startDate=None, endDate=None,
             autoConfirm=True, department=None, branch=None, category=None, note=None, lines=None,
             activate=True, **kwargs):
        """Create a subscription, or change one when ``id`` (its reference) is given.

        A new one starts straight away unless ``activate`` is false; the items
        sent replace the ones it had.
        """
        error = self._check()
        if error:
            return error
        env = request.env
        Sub = env['smartspend.subscription']
        title = (title or '').strip()
        if not title:
            return _error(_("Give the subscription a name."), 400)
        if frequency not in dict(FREQUENCIES):
            return _error(_("Choose monthly or yearly."), 400)
        items = []
        try:
            vendor = env['res.partner'].browse(int(vendorId or 0)).exists()
            for line in lines or []:
                name = (line.get('productName') or '').strip()
                if not name:
                    continue
                qty, price = float(line.get('qty') or 0), float(line.get('price') or 0)
                if qty <= 0 or price <= 0:
                    return _error(_("“%s” needs a quantity and a price above zero.", name), 400)
                items.append({'product_name': name, 'product_qty': qty, 'price_unit': price})
            start = fields.Date.to_date(str(startDate or '')[:10] or None)
            end = fields.Date.to_date(str(endDate or '')[:10] or None) if endDate else False
        except (TypeError, ValueError):
            return _error(_("Check the vendor, dates, quantities and prices."), 400)
        if not vendor or not vendor.supplier_rank:
            return _error(_("Choose the vendor to order from."), 400)
        if not items:
            return _error(_("Add at least one item to order."), 400)
        if not start:
            return _error(_("Choose when the first order goes out."), 400)

        def find(model, name):
            return env[model].sudo().search([('name', '=', name)], limit=1).id if name else False

        values = {
            'title': title, 'partner_id': vendor.id, 'frequency': frequency,
            'start_date': start, 'end_date': end, 'auto_confirm': bool(autoConfirm),
            'department_id': find('smartspend.department', department),
            'branch_id': find('smartspend.branch', branch),
            'category_id': find('smartspend.expense.category', category),
            'note': (note or '').strip() or False,
            'line_ids': [fields.Command.clear()] + [fields.Command.create(item) for item in items],
        }
        try:
            if id:
                sub = Sub.search([('name', '=', id)], limit=1)
                if not sub:
                    return _error(_("No subscription named %s.", id), 404)
                if sub.state in ('ended', 'cancelled'):
                    return _error(_("%s has ended and can no longer be changed.", sub.name), 400)
                sub.write(values)
            else:
                sub = Sub.create(values)
                if activate:
                    sub.action_activate()
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _row(sub)

    @http.route('/api/smartspend/subscriptions/<string:reference>/action', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def action(self, reference=None, action=None, **kwargs):
        """``start``, ``pause``, ``resume``, ``end`` or ``generate`` (raise the next order now)."""
        error = self._check()
        if error:
            return error
        sub = request.env['smartspend.subscription'].search([('name', '=', (reference or '').strip())], limit=1)
        if not sub:
            return _error(_("No subscription named %s.", reference or '—'), 404)
        handlers = {
            'start': sub.action_activate, 'pause': sub.action_pause, 'resume': sub.action_resume,
            'end': sub.action_end, 'generate': sub.action_generate_now,
        }
        handler = handlers.get((action or '').strip().lower())
        if not handler:
            return _error(_("Action must be one of: %s.", ", ".join(handlers)), 400)
        try:
            handler()
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _row(sub)
