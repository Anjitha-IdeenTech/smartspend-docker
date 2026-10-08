"""Analytic distribution on the portal — which accounts each item's cost lands on.

The analytic accounts come from Odoo, grouped by plan. A request's lines are
read and written by item name: the portal re-creates line records on every save,
so a name is the only thing that stays put.
"""
from odoo import _, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from ..models.smartspend_product_request import same_product
from .auction import _is_vendor
from .main import _authenticate, _error, _refused


class SmartSpendAnalytics(http.Controller):

    def _check(self):
        error = _authenticate()
        if error:
            return error
        if _is_vendor(request.env.user):
            return _error(_("Analytic accounts are for the buying side."), 403)
        return None

    @http.route('/api/smartspend/analytic-accounts', type='json2', auth='none', methods=['GET'], cors='*', readonly=True)
    def accounts(self, **kwargs):
        """Every analytic account a cost can be booked on, grouped by plan."""
        error = self._check()
        if error:
            return error
        env = request.env(su=True)
        company = request.env.company
        accounts = env['account.analytic.account'].search(
            ['|', ('company_id', '=', False), ('company_id', '=', company.id)], order='plan_id, name')
        plans = {}
        for account in accounts:
            plan = account.root_plan_id
            plans.setdefault(plan.id, {'id': plan.id, 'name': plan.name, 'accounts': []})['accounts'].append(
                {'id': account.id, 'name': account.name, 'code': account.code or ''})
        return {'plans': list(plans.values())}

    def _request(self, reference):
        reference = (reference or '').strip()
        return request.env['smartspend.request'].search([('name', '=', reference)], limit=1) if reference else None

    @http.route('/api/smartspend/analytics', type='json2', auth='none', methods=['GET'], cors='*', readonly=True)
    def read(self, id=None, **kwargs):
        """Each item of a request, with its analytic split ``{account id: percent}``."""
        error = self._check()
        if error:
            return error
        record = self._request(id or request.httprequest.args.get('id'))
        if not record:
            return _error(_("No purchase request named %s.", id or '—'), 404)
        return {'id': record.name, 'lines': [
            {'productName': line.product_name, 'distribution': line.analytic_distribution or {}}
            for line in record.line_ids]}

    @http.route('/api/smartspend/analytics', type='json2', auth='none', methods=['POST'], cors='*', readonly=False)
    def write(self, id=None, lines=None, **kwargs):
        """Set the split of the named items; each plan has to add up to 100%."""
        error = self._check()
        if error:
            return error
        record = self._request(id)
        if not record:
            return _error(_("No purchase request named %s.", id or '—'), 404)
        try:
            for sent in lines or []:
                dist = {str(int(k)): float(v) for k, v in (sent.get('distribution') or {}).items() if float(v or 0)}
                for line in record.line_ids.filtered(lambda l: same_product(l.product_name, sent.get('productName') or '')):
                    line.analytic_distribution = dist or False
            record.line_ids.flush_recordset()
        except (TypeError, ValueError):
            return _error(_("Analytic shares have to be numbers."), 400)
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return self.read(id=record.name)
