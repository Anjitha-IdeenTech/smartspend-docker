"""Fiscal positions on the portal's Master Data console.

These are Odoo's own fiscal positions (``account.fiscal.position``): the rules
that swap a vendor's taxes and accounts depending on where the supply comes
from — e.g. intra-state (CGST + SGST) against inter-state (IGST) or imports.

Everyone on the buying side can read the list; only a procurement manager
creates or changes one. Suppliers do not see it. The tax and account mappings
are shown read-only here: they are kept in Odoo (Accounting → Configuration →
Fiscal Positions), where the taxes themselves live.
"""
from odoo import _, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request
from odoo.tools import html2plaintext

from .auction import _is_vendor
from .main import _authenticate, _error, _refused


def _is_manager(user):
    return user.has_group('smartspend.group_smartspend_manager')


def _row(position):
    taxes = position.tax_ids
    return {
        'id': position.id,
        'name': position.name,
        'active': position.active,
        'sequence': position.sequence,
        'companyId': position.company_id.id or False,
        'companyName': position.company_id.name or '',
        'countryId': position.country_id.id or False,
        'countryName': position.country_id.name or '',
        'countryGroupId': position.country_group_id.id or False,
        'countryGroupName': position.country_group_id.name or '',
        'stateIds': position.state_ids.ids,
        'states': position.state_ids.mapped('name'),
        'zipFrom': position.zip_from or '',
        'zipTo': position.zip_to or '',
        'autoApply': position.auto_apply,
        'vatRequired': position.vat_required,
        'foreignVat': position.foreign_vat or '',
        'note': html2plaintext(position.note) if position.note else '',
        # Each tax of this position names the taxes it replaces.
        'taxMap': [{
            'tax': tax.name,
            'replaces': tax.original_tax_ids.mapped('name'),
        } for tax in taxes],
        'accountMap': [{
            'fromId': line.account_src_id.id,
            'from': line.account_src_id.display_name,
            'toId': line.account_dest_id.id,
            'to': line.account_dest_id.display_name,
        } for line in position.account_ids],
        'vendorCount': request.env['res.partner'].sudo().search_count(
            [('property_account_position_id', '=', position.id)]),
    }


class SmartSpendFiscalPosition(http.Controller):

    @http.route('/api/smartspend/fiscal-positions', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def fiscal_positions(self, **kwargs):
        """Every fiscal position (archived ones too), and what the form offers.

        :return: ``{'canEdit', 'positions': [...], 'countries': [...],
            'states': [...]}``
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if _is_vendor(user):
            return _error(_("Fiscal positions are for the buying side only."), 403)
        # Read as superuser: a requester holds no accounting rights, and this
        # hands back names only.
        env = request.env(su=True)
        positions = env['account.fiscal.position'].with_context(active_test=False).search(
            [('company_id', 'in', user.company_ids.ids + [False])], order='sequence, name')
        countries = env['res.country'].search([], order='name')
        states = env['res.country.state'].search([], order='country_id, name')
        groups = env['res.country.group'].search([], order='name')
        companies = user.company_ids
        accounts = env['account.account'].search([
            ('company_ids', 'in', companies.ids), ('account_type', '!=', 'off_balance')], order='code')
        return {
            'canEdit': _is_manager(user),
            'positions': [_row(position) for position in positions],
            'countries': [{'id': c.id, 'name': c.name, 'code': c.code} for c in countries],
            'states': [{'id': s.id, 'name': s.name, 'countryId': s.country_id.id} for s in states],
            # The rest of what Odoo's own fiscal position form offers.
            'countryGroups': [{'id': g.id, 'name': g.name} for g in groups],
            'companies': [{'id': c.id, 'name': c.name} for c in companies],
            'accounts': [{'id': a.id, 'name': a.display_name} for a in accounts],
        }

    @http.route('/api/smartspend/fiscal-positions/save', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def save_fiscal_position(self, id=None, name=None, countryId=None, stateIds=None,
                             zipFrom=None, zipTo=None, autoApply=None, vatRequired=None,
                             active=None, note=None, companyId=None, foreignVat=None,
                             countryGroupId=None, accountMap=None, **kwargs):
        """Create a fiscal position, or change one when ``id`` is given.

        The same fields as Odoo's own fiscal position form. ``accountMap``
        (``[{fromId, toId}]``), when given, replaces the account mapping; the
        tax mapping is kept on the taxes, as in Odoo.

        :return: the saved fiscal position, as listed.
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if not _is_manager(user):
            return _error(_("Only a procurement manager maintains fiscal positions."), 403)
        name = (name or '').strip()
        if not name:
            return _error(_("A fiscal position needs a name."), 400)
        try:
            position_id = int(id) if id else False
            country_id = int(countryId) if countryId else False
            state_ids = [int(value) for value in (stateIds or [])]
            company_id = int(companyId) if companyId else False
            group_id = int(countryGroupId) if countryGroupId else False
            account_pairs = None if accountMap is None else [
                (int(line['fromId']), int(line['toId'])) for line in accountMap
                if line.get('fromId') and line.get('toId')]
        except (TypeError, ValueError, KeyError, AttributeError):
            return _error(_("Fiscal position, country and states have to be ids."), 400)
        # The manager was checked above; fiscal positions are accounting
        # configuration a SmartSpend manager holds no write right on.
        env = request.env(su=True)
        states = env['res.country.state'].browse(state_ids).exists()
        if country_id:
            states = states.filtered(lambda s: s.country_id.id == country_id)
        else:
            states = states.browse()
        values = {
            'name': name,
            'country_id': country_id,
            'state_ids': [(6, 0, states.ids)],
            'zip_from': (zipFrom or '').strip() or False,
            'zip_to': (zipTo or '').strip() or False,
            'auto_apply': bool(autoApply),
            'vat_required': bool(vatRequired),
            'note': (note or '').strip() or False,
        }
        auto_apply = bool(autoApply)
        foreign_vat = (foreignVat or '').strip()
        # As Odoo's form: VAT required, the country group and the zip range
        # only mean something when the position is detected automatically.
        values.update({
            'foreign_vat': foreign_vat or False,
            'country_group_id': group_id if auto_apply else False,
        })
        if not auto_apply:
            values.update({'vat_required': False, 'zip_from': False, 'zip_to': False})
        if company_id:
            if company_id not in user.company_ids.ids:
                return _error(_("That company is not one of yours."), 400)
            values['company_id'] = company_id
        if account_pairs is not None:
            values['account_ids'] = [(5, 0, 0)] + [
                (0, 0, {'account_src_id': src, 'account_dest_id': dest}) for src, dest in account_pairs]
        if active is not None:
            values['active'] = bool(active)
        Position = env['account.fiscal.position'].with_context(active_test=False)
        try:
            if position_id:
                position = Position.browse(position_id).exists()
                if not position:
                    return _error(_("That fiscal position no longer exists."), 404)
                position.write(values)
            else:
                values.setdefault('company_id', user.company_id.id)
                position = Position.create(values)
        except (AccessError, UserError, ValidationError) as exc:
            return _refused(exc)
        return _row(position)
