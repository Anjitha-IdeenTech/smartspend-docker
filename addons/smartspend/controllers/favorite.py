"""Favourite products — what each user orders again and again, one tap away.

The portal keeps every user's own list, and around each favourite what the
company knows about it: how often the user ordered it, what was last paid and
to whom, and whether a running rate contract already covers it. From a
selection of favourites the portal raises a request in one go.

Beside the list it offers products worth starring, read off real requests: the
ones the user keeps asking for, and the ones their department asks for most.

Suppliers have no favourites; this is the buying side's shortcut.
"""
from odoo import _, fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from ..models.smartspend_contract import normalize_product_name
from .auction import _is_vendor
from .main import _authenticate, _error, _refused
from .price_history import paid_history

# Requests in these states never asked for anything in earnest.
IGNORED_STATES = ('draft', 'cancelled', 'rejected')

# How many suggestions each panel offers.
MAX_SUGGESTIONS = 6


def _key(name):
    return ' '.join(normalize_product_name(name))


def _same(left, right):
    """Two labels name the same product: one contains the other, noise aside."""
    return bool(left and right) and (left in right or right in left)


def _history(lines):
    """Group request lines by product: ``{key: {name, count, qty, price, last, ref, category}}``.

    ``lines`` come newest first, so the first line seen for a product supplies
    its name, usual quantity and last price.
    """
    seen = {}
    for line in lines:
        key = _key(line.product_name)
        if not key:
            continue
        entry = seen.get(key)
        if entry is None:
            seen[key] = entry = {
                'name': line.product_name, 'requests': set(), 'users': set(),
                'qty': line.product_qty, 'price': line.price_unit,
                'last': line.request_id.create_date, 'ref': line.request_id.name,
                'category': line.request_id.category_id.name or '',
            }
        entry['requests'].add(line.request_id.id)
        entry['users'].add(line.request_id.user_id.id)
    return seen


class SmartSpendFavorites(http.Controller):

    def _check(self):
        error = _authenticate()
        if error:
            return error
        if _is_vendor(request.env.user):
            return _error(_("Favourites are for the buying side only."), 403)
        return None

    @http.route('/api/smartspend/favorites', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def favorites(self, **kwargs):
        """The signed-in user's favourites, and products worth starring.

        :return: ``{'favorites': [...], 'frequent': [...], 'popular': [...],
            'categories': [...], 'department': str}``
        """
        error = self._check()
        if error:
            return error
        user = request.env.user
        env = request.env
        favorites = env['smartspend.favorite.product'].search([('user_id', '=', user.id)])

        # Read as superuser: the department's requests are not the user's to
        # open, and only product names and counts leave this method.
        Line = env['smartspend.request.line'].sudo()
        mine = Line.search([
            ('request_id.user_id', '=', user.id),
            ('request_id.state', 'not in', IGNORED_STATES),
        ], order='id desc', limit=1000)
        own = _history(mine)

        # The department is the one the user last raised a request for; with
        # no request yet, the whole company stands in for it.
        department = mine[:1].request_id.department_id
        team = _history(Line.search([
            ('request_id.user_id', '!=', user.id),
            ('request_id.state', 'not in', IGNORED_STATES),
        ] + ([('request_id.department_id', '=', department.id)] if department else []),
            order='id desc', limit=1000))

        contracts = env['smartspend.contract'].sudo().search([('is_running', '=', True)])

        def contract_for(name):
            for contract in contracts:
                line = contract._line_for_product(name)
                if line:
                    return {'ref': contract.name, 'vendor': contract.partner_id.name or '',
                            'price': line.price_unit}
            return None

        def ordered(key, history):
            hits = [entry for other, entry in history.items() if _same(key, other)]
            if not hits:
                return 0, '', ''
            latest = max(hits, key=lambda entry: entry['last'] or fields.Datetime.now())
            return (len(set().union(*(entry['requests'] for entry in hits))),
                    fields.Date.to_string(latest['last']) if latest['last'] else '', latest['ref'])

        rows = []
        for favorite in favorites:
            key = _key(favorite.product_name)
            count, last, ref = ordered(key, own)
            paid = paid_history(user, favorite.product_name)
            latest = paid['rows'][0] if paid['rows'] else {}
            rows.append({
                'id': favorite.id,
                'productName': favorite.product_name,
                'category': favorite.category_id.name or '',
                'defaultQty': favorite.default_qty,
                'targetPrice': favorite.target_price,
                'note': favorite.note or '',
                'timesOrdered': count,
                'lastOrdered': last,
                'lastRequest': ref,
                'lastPaid': paid['last'],
                'lastVendor': latest.get('vendor', ''),
                'lastPaidOn': latest.get('date', ''),
                'contract': contract_for(favorite.product_name),
            })

        starred = [_key(favorite.product_name) for favorite in favorites]

        def unstarred(key):
            return not any(_same(key, other) for other in starred)

        frequent = sorted(
            ((key, entry) for key, entry in own.items() if unstarred(key)),
            key=lambda item: (-len(item[1]['requests']), item[1]['name'].casefold()))
        popular = sorted(
            ((key, entry) for key, entry in team.items()
             if unstarred(key) and not any(_same(key, other) for other in own)),
            key=lambda item: (-len(item[1]['users']), -len(item[1]['requests']), item[1]['name'].casefold()))

        return {
            'favorites': rows,
            'frequent': [{
                'productName': entry['name'],
                'timesOrdered': len(entry['requests']),
                'lastOrdered': fields.Date.to_string(entry['last']) if entry['last'] else '',
                'usualQty': entry['qty'],
                'lastPrice': entry['price'],
                'category': entry['category'],
            } for _key_, entry in frequent[:MAX_SUGGESTIONS]],
            'popular': [{
                'productName': entry['name'],
                'colleagues': len(entry['users']),
                'timesOrdered': len(entry['requests']),
                'usualQty': entry['qty'],
                'lastPrice': entry['price'],
                'category': entry['category'],
            } for _key_, entry in popular[:MAX_SUGGESTIONS]],
            'categories': env['smartspend.expense.category'].sudo().search([]).mapped('name'),
            'department': department.name or '',
        }

    @http.route('/api/smartspend/favorites/save', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def save_favorite(self, id=None, productName=None, category=None, defaultQty=None,
                      targetPrice=None, note=None, **kwargs):
        """Star a product, or change a favourite when ``id`` is given.

        Starring a product that is already a favourite keeps it as it is,
        changing only what was sent, so a double tap does no harm.
        """
        error = self._check()
        if error:
            return error
        name = ' '.join((productName or '').split())
        if not name:
            return _error(_("A favourite needs a product name."), 400)
        values = {}
        try:
            if defaultQty not in (None, ''):
                values['default_qty'] = float(defaultQty)
            if targetPrice not in (None, ''):
                values['target_price'] = float(targetPrice)
            favorite_id = int(id) if id else False
        except (TypeError, ValueError):
            return _error(_("Quantity and price have to be numbers."), 400)
        if values.get('default_qty', 1) <= 0 or values.get('target_price', 0) < 0:
            return _error(_("The quantity has to be above zero and the price not below it."), 400)
        if note is not None:
            values['note'] = note.strip()
        if favorite_id:
            values['product_name'] = name
        env = request.env
        Favorite = env['smartspend.favorite.product']
        if category is not None:
            values['category_id'] = env['smartspend.expense.category'].search(
                [('name', '=', category)], limit=1).id or False
        try:
            favorite = (Favorite.browse(favorite_id).exists() if favorite_id
                        else Favorite.search([('user_id', '=', env.user.id),
                                              ('product_name', '=ilike', name)], limit=1))
            if favorite:
                favorite.write(values)
            else:
                last = Favorite.search([('user_id', '=', env.user.id)], order='sequence desc', limit=1)
                favorite = Favorite.create(dict(values, product_name=name, sequence=last.sequence + 1))
        except (AccessError, UserError, ValidationError) as exc:
            return _refused(exc)
        return {'id': favorite.id, 'productName': favorite.product_name}

    @http.route('/api/smartspend/favorites/delete', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def delete_favorite(self, id=None, **kwargs):
        """Unstar a favourite."""
        error = self._check()
        if error:
            return error
        try:
            favorite = request.env['smartspend.favorite.product'].browse(int(id or 0)).exists()
        except (TypeError, ValueError):
            return _error(_("Which favourite? Its id has to be a number."), 400)
        if not favorite:
            return _error(_("That favourite no longer exists."), 404)
        try:
            favorite.unlink()
        except (AccessError, UserError) as exc:
            return _refused(exc)
        return {'deleted': True}

    @http.route('/api/smartspend/favorites/reorder', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def reorder_favorites(self, ids=None, **kwargs):
        """Keep the favourites in the order the user dragged them into."""
        error = self._check()
        if error:
            return error
        try:
            ordered = [int(value) for value in (ids or [])]
        except (TypeError, ValueError):
            return _error(_("The order has to be a list of favourite ids."), 400)
        favorites = request.env['smartspend.favorite.product'].browse(ordered).exists()
        try:
            for position, favorite_id in enumerate(ordered):
                if favorite_id in favorites.ids:
                    favorites.browse(favorite_id).sequence = position + 1
        except (AccessError, UserError) as exc:
            return _refused(exc)
        return {'ok': True}
