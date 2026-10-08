"""Shipping and payment method of a request — set on the portal's GRN and invoice.

Both are required choices on the portal: the goods receipt cannot be generated
without saying how the goods came, nor the vendor invoice posted without saying
how it will be paid. They are kept on the request (not on the request payload,
whose keys are pinned) and printed on the GRN and invoice documents.
"""
from odoo import _, fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from ..models.smartspend_request import PAYMENT_METHOD_SELECTION, SHIPPING_METHOD_SELECTION
from .auction import _is_vendor
from .main import _authenticate, _error, _refused

OPTIONS = {
    'shippingMethod': ('shipping_method', SHIPPING_METHOD_SELECTION),
    'paymentMethod': ('payment_method', PAYMENT_METHOD_SELECTION),
}


def _payload(record):
    return {
        'id': record.name,
        'shippingMethod': record.shipping_method or '',
        'paymentMethod': record.payment_method or '',
        'options': {
            key: [{'value': value, 'label': label} for value, label in selection]
            for key, (_field, selection) in OPTIONS.items()
        },
    }


class SmartSpendFulfilment(http.Controller):

    def _record(self, reference):
        reference = (reference or '').strip()
        record = request.env['smartspend.request'].search([('name', '=', reference)], limit=1)
        return record

    @http.route('/api/smartspend/fulfilment', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def fulfilment(self, id=None, **kwargs):
        """The request's shipping and payment method, and the choices for each."""
        error = _authenticate()
        if error:
            return error
        if _is_vendor(request.env.user):
            return _error(_("Shipping and payment are recorded by the buying side."), 403)
        record = self._record(id or request.httprequest.args.get('id'))
        if not record:
            return _error(_("No purchase request named %s.", id or '—'), 404)
        return _payload(record)

    @http.route('/api/smartspend/fulfilment', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def set_fulfilment(self, id=None, shippingMethod=None, paymentMethod=None, **kwargs):
        """Record the shipping method (GRN) and/or the payment method (invoice).

        A key that is sent must hold one of the offered values: an empty one is
        refused, since on the portal both are required choices.
        """
        error = _authenticate()
        if error:
            return error
        if _is_vendor(request.env.user):
            return _error(_("Shipping and payment are recorded by the buying side."), 403)
        record = self._record(id)
        if not record:
            return _error(_("No purchase request named %s.", id or '—'), 404)
        values = {}
        for key, sent in (('shippingMethod', shippingMethod), ('paymentMethod', paymentMethod)):
            if sent is None:
                continue
            field, selection = OPTIONS[key]
            if sent not in dict(selection):
                label = record._fields[field].string
                return _error(_("Choose a %s — it is required.", label.lower()), 400)
            values[field] = sent
        if not values:
            return _error(_("Send a shipping method, a payment method, or both."), 400)
        try:
            record.write(values)
        except (AccessError, UserError, ValidationError) as exc:
            return _refused(exc)
        return _payload(record)


class SmartSpendDeliveryCommitments(http.Controller):

    @http.route('/api/smartspend/delivery-commitments', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def delivery_commitments(self, **kwargs):
        """The delivery date each vendor committed to, by request reference.

        Kept off the request payload, whose keys are pinned. A supplier sees
        the dates of the orders placed with them and no others.

        :return: ``{'PR-2026-487': '2026-10-20', ...}``
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        records = request.env['smartspend.request'].sudo().search(
            [('vendor_delivery_date', '!=', False)], limit=2000)
        if _is_vendor(user):
            records = records.filtered(lambda record: record._placed_with(user))
        else:
            # What this user may open, and nothing beyond it.
            records = request.env['smartspend.request'].search([('id', 'in', records.ids)])
        return {record.name: fields.Date.to_string(record.vendor_delivery_date) for record in records}
