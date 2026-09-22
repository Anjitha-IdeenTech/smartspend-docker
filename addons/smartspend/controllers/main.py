"""REST API consumed by the SmartSpend portal (the React "AI Procurement Copilot").

Every route is JSON in / JSON out (``type='json2'``: a plain body, no JSON-RPC
envelope) and, except for ``/login``, is authenticated with an Odoo API key sent
as ``Authorization: Bearer <token>``.

The bearer check is done in the handler rather than through ``auth='bearer'``
on purpose: Odoo authenticates *before* it sets the CORS headers, so a rejection
raised there reaches the browser without ``Access-Control-Allow-Origin`` and the
portal sees an opaque network error instead of the 401 it knows how to act on.
"""
import base64
import binascii
import logging
import re

from odoo import _, fields, http
from odoo.exceptions import AccessDenied, AccessError, UserError
from odoo.http import request

from ..models.smartspend_request import (
    SOURCING_SELECTION as SOURCING_LABELS,
    STATE_SELECTION as STATE_LABELS,
    URGENCY_SELECTION as URGENCY_LABELS,
)
from .parser import parse_requisition

_logger = logging.getLogger(__name__)

# Odoo stores only the first 8 hex digits of a key in clear, as a lookup index.
API_KEY_INDEX_SIZE = 8
API_KEY_SCOPE = 'rpc'
API_KEY_NAME = 'SmartSpend Portal'
# Portal tokens outlive a demo session but not forever.
API_KEY_VALIDITY_DAYS = 30
# Big enough for a spec sheet or a quotation, small enough that the portal
# cannot be used to push a video into the database.
ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024


def _user_payload(user):
    """The signed-in user as the portal needs them: identity plus real roles.

    The portal used to let anyone switch to any role from a dropdown. These
    flags come from the Odoo groups the account actually holds, so the switcher
    can offer only what the person is allowed to be.
    """
    is_manager = user.has_group('smartspend.group_smartspend_manager')
    is_buyer = user.has_group('smartspend.group_smartspend_buyer')
    # An external supplier is not a staff role: it replaces the list rather than
    # adding to it, so a vendor account can never switch itself into Employee.
    # Checked against the vendor group alone — buyers and managers imply the
    # requester group, but never this one.
    is_vendor = (
        user.has_group('smartspend.group_smartspend_vendor')
        and not is_buyer and not is_manager
    )
    if is_vendor:
        roles = ['Vendor']
    else:
        roles = ['Employee']
        if is_buyer:
            roles.append('SCM Buyer')
        if is_manager:
            roles += ['Manager', 'CEO']
    return {
        'id': user.id,
        'name': user.name,
        'login': user.login,
        'email': user.email or '',
        'is_manager': is_manager,
        'is_buyer': is_buyer,
        'is_vendor': is_vendor,
        'roles': roles,
        'defaultRole': (
            'Vendor' if is_vendor
            else 'Manager' if is_manager
            else 'SCM Buyer' if is_buyer
            else 'Employee'
        ),
        'company': user.company_id.name,
    }


def _error(message, status):
    """A JSON error body the portal can display, with a real HTTP status."""
    return request.make_json_response({'error': message}, status=status)


def _refused(exc):
    """Answer a refused write with 400 — and undo whatever it already did.

    Odoo rolls a request back when an exception leaves the handler. These routes
    catch it instead, to answer the portal in JSON, so without this the partial
    write from the failed call is committed anyway: the portal is told the save
    was refused while Odoo quietly keeps the half of it that passed. A rejected
    call must leave the record exactly as it found it.
    """
    request.env.cr.rollback()
    request.env.invalidate_all()
    return _error(str(exc), 400)


def _bearer_token():
    header = request.httprequest.headers.get('Authorization') or ''
    match = re.match(r'^bearer\s+(.+)$', header, re.IGNORECASE)
    return match.group(1).strip() if match else None


def _authenticate():
    """Resolve the bearer token and switch the environment to that user.

    :return: ``None`` when authenticated, or a 401 response to return as-is.
    """
    token = _bearer_token()
    if not token:
        return _error(_("Missing Authorization header."), 401)
    uid = request.env['res.users.apikeys'].sudo()._check_credentials(scope=API_KEY_SCOPE, key=token)
    if not uid:
        return _error(_("Invalid or expired API token."), 401)
    request.update_env(user=uid)
    return None


class SmartSpendApi(http.Controller):

    # ------------------------------------------------------------------
    # Session
    # ------------------------------------------------------------------
    @http.route('/api/smartspend/login', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def login(self, login=None, password=None, **kwargs):
        """Exchange Odoo credentials for the API key the portal keeps as its token."""
        if not login or not password:
            return _error(_("Both login and password are required."), 400)

        credential = {'login': login, 'password': password, 'type': 'password'}
        try:
            request.session.authenticate(request.env, credential)
        except AccessDenied:
            return _error(_("Wrong login or password."), 401)

        uid = request.session.uid
        if not uid:
            # authenticate() leaves uid unset when it wants a second factor.
            return _error(_("Two-factor authentication is not supported by the portal."), 401)

        # The bearer token is the credential from here on: don't also hand out
        # (and persist) a browser session.
        request.session.can_save = False

        env = request.env(user=uid)
        user = env.user
        expiration = fields.Datetime.add(fields.Datetime.now(), days=API_KEY_VALIDITY_DAYS)
        token = env['res.users.apikeys'].sudo()._generate(API_KEY_SCOPE, API_KEY_NAME, expiration)
        return {'token': token, 'user': _user_payload(user)}

    @http.route('/api/smartspend/me', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def whoami(self, **kwargs):
        """Who the held token belongs to, and what they may do.

        The portal keeps the signed-in user in local storage; this is how it
        checks on reload that the token still works and the roles still hold.
        """
        error = _authenticate()
        if error:
            return error
        return _user_payload(request.env.user)

    @http.route('/api/smartspend/logout', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def logout(self, **kwargs):
        """Revoke the presented API key so a copied token stops working."""
        token = _bearer_token()
        if not token:
            return {'ok': True}
        apikeys = request.env['res.users.apikeys'].sudo()
        uid = apikeys._check_credentials(scope=API_KEY_SCOPE, key=token)
        if not uid:
            return {'ok': True}
        request.env.cr.execute(
            f'SELECT id FROM {apikeys._table} WHERE user_id = %s AND index = %s',
            (uid, token[:API_KEY_INDEX_SIZE]),
        )
        key_ids = [row[0] for row in request.env.cr.fetchall()]
        if key_ids:
            apikeys.browse(key_ids)._remove()
        return {'ok': True}

    # ------------------------------------------------------------------
    # Requests
    # ------------------------------------------------------------------
    @http.route('/api/smartspend/requests', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def list_requests(self, **kwargs):
        """Every request the signed-in user may see, newest first."""
        error = _authenticate()
        if error:
            return error
        records = request.env['smartspend.request'].search([])
        return [record._to_portal_dict() for record in records]

    @http.route('/api/smartspend/submit', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def submit_request(self, **payload):
        """Create or update one request from the portal, and echo it back.

        The portal replaces its local copy with whatever comes back, so the
        response is re-serialised from the saved record — reference, computed
        totals and matched rate contract included.
        """
        error = _authenticate()
        if error:
            return error
        if not payload:
            return _error(_("Empty request payload."), 400)
        try:
            record = request.env['smartspend.request']._upsert_from_portal(payload)
        except (UserError, AccessError) as exc:
            return _refused(exc)
        return record._to_portal_dict()

    @http.route('/api/smartspend/purchase-order', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def create_purchase_order(self, id=None, **kwargs):
        """Raise the Odoo purchase order for one request, and echo the request back.

        The portal's "generate purchase order" step used to be a local status
        flip, which left the request marked *PO Confirmed* with no order behind
        it. This turns that step into the real thing: lines covered by the
        matched rate contract are priced at the contracted rate, and the order
        reference comes back in ``purchaseOrders`` for the portal to show.
        """
        error = _authenticate()
        if error:
            return error

        # Ask about the role first: a requester cannot even see somebody else's
        # request, and "not found" would be a misleading way to say "not yours".
        if not request.env.user.has_group('smartspend.group_smartspend_buyer'):
            return _error(_("Only an SCM buyer can raise a purchase order."), 403)

        reference = (id or '').strip()
        if not reference:
            return _error(_("Which request should the purchase order be raised for?"), 400)
        record = request.env['smartspend.request'].search([('name', '=', reference)], limit=1)
        if not record:
            return _error(_("No purchase request named %s.", reference), 404)

        # Clicking twice must not raise a second order for the same request —
        # but a cancelled one is history, not a commitment, so it must not block
        # a replacement either.
        if not record.sudo().purchase_order_ids.filtered(lambda order: order.state != 'cancel'):
            try:
                record.action_create_purchase_order()
            except (UserError, AccessError) as exc:
                return _refused(exc)
        return record._to_portal_dict()

    @http.route('/api/smartspend/purchase-order/step', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def purchase_order_step(self, id=None, step=None, **kwargs):
        """Record one of the two steps that follow the order, and echo the request back.

        The portal used to hold both in component state, which forgot them on
        reload and applied one answer to every request at once.

        :param step: ``release`` — the purchase head approves the financial
            release terms; ``acknowledge`` — the vendor confirms the order.
        """
        error = _authenticate()
        if error:
            return error

        step = (step or '').strip().lower()
        if step not in ('release', 'acknowledge'):
            return _error(_("Step must be one of: release, acknowledge."), 400)

        user = request.env.user
        if step == 'release':
            # Releasing an order is an approver's signature, so it is gated the
            # way /decide is — never the buyer who raised it, never the
            # requester who asked for it.
            if not user.has_group('smartspend.group_smartspend_manager'):
                return _error(_("Only the purchase head can release a purchase order."), 403)
        elif not (user.has_group('smartspend.group_smartspend_buyer')
                  or user.has_group('smartspend.group_smartspend_vendor')):
            return _error(_("Only the SCM buyer or the vendor records an acknowledgment."), 403)

        reference = (id or '').strip()
        if not reference:
            return _error(_("Which request is this step for?"), 400)
        # sudo for the lookup and the write: a vendor account holds the
        # requester group alone, so the "own requests" rule hides the very
        # order it is being asked to acknowledge. The group check above is what
        # authorises the step; the timeline entry still names the real user.
        record = request.env['smartspend.request'].sudo().search(
            [('name', '=', reference)], limit=1)
        if not record:
            return _error(_("No purchase request named %s.", reference), 404)
        # A supplier answers for the orders placed with them, and no others.
        # Said the same way as an unknown reference, so the refusal does not
        # tell one supplier which orders another one holds.
        is_staff = (user.has_group('smartspend.group_smartspend_buyer')
                    or user.has_group('smartspend.group_smartspend_manager'))
        if not is_staff and not record._placed_with(user):
            return _error(_("No purchase request named %s.", reference), 404)

        try:
            if step == 'release':
                record.action_release_purchase_order()
            else:
                record.action_acknowledge_purchase_order()
        except (UserError, AccessError) as exc:
            return _refused(exc)
        return record._to_portal_dict()

    @http.route('/api/smartspend/attachment', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def add_attachment(self, id=None, filename=None, data=None, **kwargs):
        """Store a file the requester uploaded against one request.

        The portal used to name a file it had invented and send nothing, so a
        requisition arrived with a document listed and no document behind it.
        This writes a real ir.attachment on the request, which is what the form
        and the chatter read, and lists it under Documents.

        :param data: the file, base64 encoded, with or without a data: prefix.
        """
        error = _authenticate()
        if error:
            return error

        reference = (id or '').strip()
        name = (filename or '').strip() or 'attachment'
        if not reference:
            return _error(_("Which request is this file for?"), 400)
        if not data:
            return _error(_("No file content was sent."), 400)

        # A data: URL carries its type before the comma; keep only the payload.
        payload = data.split(',', 1)[1] if data.startswith('data:') else data
        try:
            raw = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError):
            return _error(_("That file could not be read — it is not valid base64."), 400)
        if len(raw) > ATTACHMENT_MAX_BYTES:
            return _error(_(
                "That file is %(size)s MB. The limit is %(limit)s MB.",
                size=round(len(raw) / 1024 / 1024, 1),
                limit=ATTACHMENT_MAX_BYTES // (1024 * 1024)), 413)

        # No sudo: a requester may attach to their own request and the record
        # rules already say which ones those are.
        record = request.env['smartspend.request'].search([('name', '=', reference)], limit=1)
        if not record:
            return _error(_("No purchase request named %s.", reference), 404)

        try:
            attachment = request.env['ir.attachment'].create({
                'name': name,
                'datas': payload,
                'res_model': 'smartspend.request',
                'res_id': record.id,
            })
            # The request was saved with this filename a moment ago, listing it
            # with no file behind it. Give that row the file rather than adding
            # a second row with the same name.
            placeholder = record.document_ids.filtered(
                lambda doc: not doc.attachment_id and (doc.name or '').casefold() == name.casefold())
            if placeholder:
                placeholder[0].attachment_id = attachment.id
            else:
                record.document_ids = [fields.Command.create({
                    'name': name,
                    'attachment_id': attachment.id,
                })]
            record._log_history(_("Document attached"), name)
        except (UserError, AccessError) as exc:
            return _refused(exc)
        return record._to_portal_dict()

    @http.route('/api/smartspend/parse', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def parse_request(self, text=None, items=None, **kwargs):
        """Turn a dictated or typed sentence into a saved draft requisition.

        ``items`` carries the products staged in the composer next to the
        sentence. They are part of the same requisition, so a request that
        mixes both reaches Odoo with every line rather than only the ones the
        sentence named.
        """
        error = _authenticate()
        if error:
            return error
        items = [
            item for item in (items or [])
            if isinstance(item, dict) and (item.get('productName') or '').strip()
        ]
        text = (text or '').strip()
        if not text and not items:
            return _error(_("Nothing to parse."), 400)

        parsed = parse_requisition(text, items)
        parsed['status'] = 'Draft'
        record = request.env['smartspend.request']._upsert_from_portal(parsed)
        record._log_history(
            _("Parsed from Request"),
            text[:250] or _("%s product(s) staged in the composer", len(items)))
        return record._to_portal_dict()

    # ------------------------------------------------------------------
    # Master data
    # ------------------------------------------------------------------
    @http.route('/api/smartspend/master-data', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def master_data(self, **kwargs):
        """Everything the portal needs to build its dropdowns.

        The lists used to be hard-coded in the app; they are Odoo records now,
        so what the employee picks always resolves to something the backend can
        file the request against.
        """
        error = _authenticate()
        if error:
            return error
        env = request.env
        return {
            'branches': [
                {'id': branch.id, 'name': branch.name, 'code': branch.code or '', 'city': branch.city or ''}
                for branch in env['smartspend.branch'].search([])
            ],
            'departments': [
                {'id': department.id, 'name': department.name, 'code': department.code or '',
                 'approver': department.manager_id.name or ''}
                for department in env['smartspend.department'].search([])
            ],
            'categories': [
                {'id': category.id, 'name': category.name,
                 'expenseType': dict(category._fields['expense_type'].selection)[category.expense_type]}
                for category in env['smartspend.expense.category'].search([])
            ],
            'urgencies': [label for _key, label in URGENCY_LABELS],
            'sourcingMethods': [label for _key, label in SOURCING_LABELS],
            'statuses': [label for _key, label in STATE_LABELS],
            # The approval matrix, so the portal's workflow master shows what is
            # actually configured rather than a picture of a fixed process.
            'workflows': [{
                'id': workflow.id,
                'name': workflow.name,
                'document': dict(workflow._fields['document_type'].selection).get(
                    workflow.document_type, workflow.document_type),
                'workflowType': dict(workflow._fields['workflow_type'].selection).get(
                    workflow.workflow_type, workflow.workflow_type),
                'branch': workflow.branch_id.name or 'All branches',
                'department': workflow.department_id.name or 'All departments',
                'category': workflow.category_id.name or 'All categories',
                'expenseType': dict(workflow._fields['expense_type'].selection).get(
                    workflow.expense_type, 'CapEx and OpEx'),
                'amountFrom': workflow.amount_from,
                'amountTo': workflow.amount_to,
                'approvers': [{
                    'order': approver.sequence,
                    'designation': approver.designation_id.name,
                    'branch': approver.branch_id.name or '',
                    'department': approver.department_id.name or '',
                } for approver in workflow.approver_ids.sorted('sequence')],
            } for workflow in request.env['smartspend.workflow'].search(
                [('document_type', '=', 'purchase_request')])],
        }

    # ------------------------------------------------------------------
    # Approvals
    # ------------------------------------------------------------------
    @http.route('/api/smartspend/approvals', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def pending_approvals(self, **kwargs):
        """The approval queue of the signed-in user, newest first."""
        error = _authenticate()
        if error:
            return error
        if not request.env.user.has_group('smartspend.group_smartspend_manager'):
            return _error(_("Only a procurement manager has an approval queue."), 403)
        records = request.env['smartspend.request'].search(
            [('state', 'in', ('to_approve', 'clarification'))])
        return [record._to_portal_dict() for record in records]

    @http.route('/api/smartspend/decide', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def decide_request(self, id=None, decision=None, comment=None, **kwargs):
        """Approve, reject or query one request, and echo it back.

        :param decision: ``approve``, ``reject`` or ``clarify``.
        :param comment: the approver's note — required to ask for clarification,
            recorded on the request's thread either way.
        """
        error = _authenticate()
        if error:
            return error
        if not request.env.user.has_group('smartspend.group_smartspend_manager'):
            return _error(_("Only a procurement manager can approve or reject."), 403)

        reference = (id or '').strip()
        record = request.env['smartspend.request'].search([('name', '=', reference)], limit=1)
        if not record:
            return _error(_("No purchase request named %s.", reference or '—'), 404)

        decision = (decision or '').strip().lower()
        comment = (comment or '').strip()
        if decision not in ('approve', 'reject', 'clarify'):
            return _error(_("Decision must be one of: approve, reject, clarify."), 400)
        if decision == 'clarify' and not comment:
            return _error(_("Say what needs clarifying."), 400)

        try:
            if decision == 'approve':
                # Approving records the note itself, on the thread and the
                # timeline entry both; the branch below would only repeat it.
                record._apply_approve(comment)
            elif decision == 'reject':
                record.action_reject()
            else:
                record.action_request_clarification()
            if comment and decision != 'approve':
                record.comment_ids = [fields.Command.create({
                    'role': 'manager',
                    'text': comment,
                })]
                record.message_post(body=comment)
        except (UserError, AccessError) as exc:
            return _refused(exc)
        return record._to_portal_dict()

    # ------------------------------------------------------------------
    # Reference data behind a request
    # ------------------------------------------------------------------
    @http.route('/api/smartspend/contracts', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def list_contracts(self, **kwargs):
        """Running rate contracts and the rates they hold."""
        error = _authenticate()
        if error:
            return error
        contracts = request.env['smartspend.contract'].search([('is_running', '=', True)])
        return [{
            'id': contract.name,
            'vendor': contract.partner_id.name,
            'category': contract.category or '',
            'validFrom': contract.date_start.isoformat() if contract.date_start else '',
            'validUntil': contract.date_end.isoformat() if contract.date_end else '',
            'leadTime': contract.lead_time or '',
            'warranty': contract.warranty or '',
            'paymentTerms': contract.payment_terms or '',
            'lines': [{
                'productName': line.product_name,
                'minQty': line.min_qty,
                'price': line.price_unit,
            } for line in contract.line_ids],
        } for contract in contracts]

    @http.route('/api/smartspend/vendors', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def list_vendors(self, **kwargs):
        """Suppliers the buyer can source from."""
        error = _authenticate()
        if error:
            return error
        Contract = request.env['smartspend.contract']
        vendors = request.env['res.partner'].search(
            [('supplier_rank', '>', 0)], limit=200)
        contracted = Contract.search([('is_running', '=', True)]).partner_id
        return [{
            'id': vendor.id,
            'name': vendor.name,
            'city': vendor.city or '',
            'email': vendor.email or '',
            'phone': vendor.phone or '',
            'onContract': vendor in contracted,
        } for vendor in vendors]

    @http.route('/api/smartspend/products', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def list_products(self, search=None, limit=100, **kwargs):
        """Purchasable products, with the contracted rate when one exists."""
        error = _authenticate()
        if error:
            return error
        domain = [('purchase_ok', '=', True)]
        if (search or '').strip():
            domain.append(('name', 'ilike', search.strip()))
        try:
            limit = max(1, min(int(limit), 500))
        except (TypeError, ValueError):
            limit = 100
        products = request.env['product.product'].search(domain, limit=limit)
        contract_lines = request.env['smartspend.contract.line'].search(
            [('is_running', '=', True)])
        rate_by_name = {line.product_name.casefold(): line for line in contract_lines}
        results = []
        for product in products:
            line = rate_by_name.get(product.name.casefold())
            results.append({
                'id': product.id,
                'name': product.display_name,
                'category': product.categ_id.name or '',
                'uom': product.uom_id.name or '',
                'listPrice': product.list_price,
                'contractPrice': line.price_unit if line else 0.0,
                'contract': line.contract_id.name if line else '',
            })
        return results

    @http.route('/api/smartspend/budgets', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def list_budgets(self, **kwargs):
        """Running budgets with what is allocated, committed and left."""
        error = _authenticate()
        if error:
            return error
        budgets = request.env['smartspend.budget'].search([('is_running', '=', True)])
        return [budget._to_portal_dict() for budget in budgets]

    @http.route('/api/smartspend/reset', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def reset_demo(self, **kwargs):
        """Wipe the requests and re-seed the demo set. Managers only."""
        error = _authenticate()
        if error:
            return error
        if not request.env.user.has_group('smartspend.group_smartspend_manager'):
            return _error(_("Only a SmartSpend manager can reset the demo data."), 403)

        Request = request.env['smartspend.request']
        # Only the seeded walkthrough records. Requests raised through the
        # portal are somebody's actual work and survive a reset.
        existing = Request.search([('demo_seed', '=', True)])
        cancellable = existing.purchase_order_ids.filtered(lambda o: o.state in ('draft', 'sent'))
        cancellable.button_cancel()
        existing.unlink()
        seeded = Request._create_demo_requests()
        _logger.info("SmartSpend demo data reset by %s: %s seeded records replaced, %s kept",
                     request.env.user.login, len(seeded),
                     Request.search_count([('demo_seed', '=', False)]))
        return [record._to_portal_dict() for record in seeded]
