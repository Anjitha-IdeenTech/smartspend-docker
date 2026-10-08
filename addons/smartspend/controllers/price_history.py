"""What the company has actually paid for a product — the portal's price history.

The employee typing a product into their request sees, under the line, the
unit prices on earlier confirmed purchase orders: when, from whom, how many and
at what price. Every figure is read off a confirmed Odoo purchase order line;
nothing is estimated.

The portal's product is free text ("Dell Latitude 5440 Laptops"), so a line
matches when its product name and the typed text contain one another, ignoring
case — the plural or a missing word does not hide the history. Of the products
that match, only the closest one is reported.

Suppliers never see it: what one vendor charged is not another vendor's
business, and not their own to browse either.
"""
from odoo import _, http
from odoo.http import request

from .auction import _is_vendor
from .main import _authenticate, _error

# Purchase orders in these states were placed with the vendor, so their prices
# were really paid (or are owed); drafts and RFQs are only asks.
PLACED_STATES = ('purchase', 'done')

# Newest first, and only so many: the panel is a glance, not a report.
MAX_ROWS = 12


def _fold(text):
    return ' '.join((text or '').casefold().split())


class SmartSpendPriceHistory(http.Controller):

    @http.route('/api/smartspend/price-history', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def price_history(self, product=None, **kwargs):
        """Unit prices paid for ``product`` on confirmed purchase orders.

        :param product: the product as typed on the request line.
        :return: ``{'product', 'rows': [...], 'last', 'min', 'max', 'avg', 'count'}``
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if _is_vendor(user):
            return _error(_("Price history is for the buying side only."), 403)
        return paid_history(user, product or request.httprequest.args.get('product'))


def paid_history(user, product):
    """The price facts ``/price-history`` answers for ``product``.

    Shared with the favourites list, which shows the last price paid for each
    favourite the same way the request form does.
    """
    typed = _fold(product)
    empty = {'product': product or '', 'rows': [], 'count': 0,
             'last': 0, 'min': 0, 'max': 0, 'avg': 0}
    if len(typed) < 3:
        return empty
    # Read as superuser: an employee holds no rights on purchase orders, and
    # this hands back only the price facts below, never the order itself.
    Line = request.env['purchase.order.line'].sudo()
    lines = Line.search([
        ('order_id.state', 'in', PLACED_STATES),
        ('display_type', '=', False),
        ('company_id', 'in', user.company_ids.ids),
    ], order='date_order desc, id desc', limit=2000)

    def name_of(line):
        return _fold(line.product_id.name or line.name.split('\n')[0])

    candidates = {}
    for line in lines:
        name = name_of(line)
        if name and (name in typed or typed in name):
            candidates[name] = candidates.get(name, 0) + 1
    if not candidates:
        return empty
    # One product only, so the figures never mix a laptop with its bag: the
    # exact name, else the longest name the typed text contains (the most
    # specific), else the one bought most often.
    best = max(candidates, key=lambda name: (name == typed, name in typed and len(name),
                                             candidates[name]))
    lines = lines.filtered(lambda line: name_of(line) == best)
    prices = lines.mapped('price_unit')
    rows = [{
        'date': (line.order_id.date_approve or line.order_id.date_order).date().isoformat()
                if (line.order_id.date_approve or line.order_id.date_order) else '',
        'vendor': line.order_id.partner_id.commercial_partner_id.name or '',
        'po': line.order_id.name,
        'product': line.product_id.name or line.name.split('\n')[0],
        'qty': line.product_qty,
        'unitPrice': line.price_unit,
        'currency': line.currency_id.name or '',
    } for line in lines[:MAX_ROWS]]
    return {
        'product': rows[0]['product'],
        'rows': rows,
        'count': len(lines),
        'last': lines[0].price_unit,
        'min': min(prices),
        'max': max(prices),
        'avg': round(sum(prices) / len(prices), 2),
    }
