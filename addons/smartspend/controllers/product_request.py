"""Products the master does not have — checking, requesting, deciding.

Anyone on the buying side checks a product name against the master (the
request form does, line by line) and can ask for a new product. The procurement
manager decides. A requester sees their own requests and is told of each
decision until they have seen it; suppliers have no part in it.
"""
from odoo import _, fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from ..models.smartspend_product_request import STATES, same_product
from .auction import _is_vendor
from .main import _authenticate, _error, _refused


def _row(pr, with_matches=False):
    row = {
        'id': pr.id,
        'name': pr.name,
        'productName': pr.product_name,
        'description': pr.description or '',
        'reason': pr.reason or '',
        'estimatedPrice': pr.estimated_price,
        'category': pr.category_id.name or '',
        'productCategoryId': pr.product_category_id.id or False,
        'productCategory': pr.product_category_id.complete_name or '',
        'requestedBy': pr.requested_by_id.name,
        'requests': [{'id': r.name, 'status': dict(r._fields['state'].selection).get(r.state, r.state)}
                     for r in pr.request_ids.sudo()],
        'state': pr.state,
        'stateLabel': dict(STATES)[pr.state],
        'product': pr.product_id.name or '',
        'decisionNote': pr.decision_note or '',
        'decidedBy': pr.decided_by_id.name or '',
        'decidedAt': fields.Datetime.to_string(pr.decided_on) if pr.decided_on else '',
        'createdAt': fields.Datetime.to_string(pr.create_date) if pr.create_date else '',
        'seen': pr.requester_seen,
    }
    if with_matches and pr.state == 'pending':
        check = request.env['smartspend.product.request']._check_product(pr.product_name)
        Product = request.env['product.product'].sudo()
        row['matches'] = [{'id': p.id, 'name': p.name} for p in
                          (Product.search([('name', '=', n), ('purchase_ok', '=', True)], limit=1)
                           for n in check['suggestions']) if p]
    return row


class SmartSpendProductRequests(http.Controller):

    def _check(self):
        error = _authenticate()
        if error:
            return error
        if _is_vendor(request.env.user):
            return _error(_("The product master is kept by the buying side."), 403)
        return None

    @http.route('/api/smartspend/product-check', type='json2', auth='none', methods=['GET'], cors='*', readonly=True)
    def product_check(self, name=None, **kwargs):
        """Is ``name`` in the product master? With the closest names it does have."""
        error = self._check()
        if error:
            return error
        name = (name or request.httprequest.args.get('name') or '').strip()
        if len(name) < 3:
            return {'known': True, 'match': '', 'suggestions': [], 'pending': None}
        return request.env['smartspend.product.request']._check_product(name)

    @http.route('/api/smartspend/product-requests', type='json2', auth='none', methods=['GET'], cors='*', readonly=True)
    def product_requests(self, **kwargs):
        """A requester's own requests; a buyer's or manager's, everyone's."""
        error = self._check()
        if error:
            return error
        user = request.env.user
        can_decide = user.has_group('smartspend.group_smartspend_manager')
        found = request.env['smartspend.product.request'].search([], limit=300)
        categories = request.env['product.category'].sudo().search([], order='complete_name')
        return {
            'canDecide': can_decide,
            'requests': [_row(pr, with_matches=can_decide) for pr in found],
            'productCategories': [{'id': c.id, 'name': c.complete_name} for c in categories],
            'expenseCategories': request.env['smartspend.expense.category'].sudo().search([]).mapped('name'),
        }

    @http.route('/api/smartspend/product-requests/create', type='json2', auth='none', methods=['POST'], cors='*', readonly=False)
    def create_request(self, productName=None, description=None, reason=None, estimatedPrice=None,
                       category=None, **kwargs):
        """Ask for a product on its own, without a requisition.

        Asking for one that is already in the master, or already asked for,
        returns that instead of a duplicate.
        """
        error = self._check()
        if error:
            return error
        name = ' '.join((productName or '').split())
        if len(name) < 3:
            return _error(_("Name the product you need."), 400)
        env = request.env
        PR = env['smartspend.product.request']
        check = PR._check_product(name)
        if check['known']:
            return _error(_("“%(name)s” is already in the catalogue as “%(match)s” — you can request it straight away.",
                            name=name, match=check['match']), 409)
        existing = PR.sudo().search([('state', '=', 'pending')]).filtered(lambda r: same_product(name, r.product_name))[:1]
        if existing:
            return dict(_row(existing), alreadyRequested=True)
        try:
            price = float(estimatedPrice or 0)
        except (TypeError, ValueError):
            return _error(_("The estimated price has to be a number."), 400)
        try:
            pr = PR.create({
                'product_name': name,
                'description': (description or '').strip() or False,
                'reason': (reason or '').strip() or False,
                'estimated_price': max(price, 0.0),
                'category_id': env['smartspend.expense.category'].sudo().search([('name', '=', category)], limit=1).id or False,
                'requested_by_id': env.user.id,
            })
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        pr.sudo().message_post(body=_("%s asked for this product to be added to the catalogue.", env.user.name))
        return _row(pr)

    @http.route('/api/smartspend/product-requests/<int:pr_id>/decide', type='json2', auth='none', methods=['POST'], cors='*', readonly=False)
    def decide(self, pr_id=None, decision=None, productCategoryId=None, finalName=None, productId=None, note=None, **kwargs):
        """``approve`` (into the master), ``map`` (to an existing product) or ``reject``."""
        error = self._check()
        if error:
            return error
        if not request.env.user.has_group('smartspend.group_smartspend_manager'):
            return _error(_("Only a procurement manager decides what goes into the product master."), 403)
        pr = request.env['smartspend.product.request'].browse(pr_id).exists()
        if not pr:
            return _error(_("That product request no longer exists."), 404)
        try:
            if decision == 'approve':
                category = request.env['product.category'].sudo().browse(int(productCategoryId or 0)).exists()
                pr.action_approve(product_category=category or None, final_name=finalName, note=note)
            elif decision == 'map':
                pr.action_map(int(productId or 0), note=note)
            elif decision == 'reject':
                pr.action_reject(note=note)
            else:
                return _error(_("Decision must be approve, map or reject."), 400)
        except (UserError, ValidationError, AccessError, ValueError, TypeError) as exc:
            return _refused(exc)
        return _row(pr, with_matches=True)

    @http.route('/api/smartspend/product-requests/seen', type='json2', auth='none', methods=['POST'], cors='*', readonly=False)
    def seen(self, ids=None, **kwargs):
        """The requester has seen these decisions — stop announcing them."""
        error = self._check()
        if error:
            return error
        try:
            wanted = [int(i) for i in (ids or [])]
        except (TypeError, ValueError):
            return _error(_("Ids have to be numbers."), 400)
        mine = request.env['smartspend.product.request'].sudo().browse(wanted).exists().filtered(
            lambda r: r.requested_by_id == request.env.user)
        mine.action_mark_seen()
        return {'ok': True, 'count': len(mine)}
