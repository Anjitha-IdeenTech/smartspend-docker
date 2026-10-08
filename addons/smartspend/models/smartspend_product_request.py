"""Product creation requests — what happens when someone asks for something
the product master does not have.

The requester is never blocked: a requisition naming a product the master does
not know is raised as usual, and a product creation request goes to the
procurement manager alongside it (one can also be raised on its own). The
manager approves it into the master (choosing its category), points it at a
product the master already has, or rejects it. The requester is told either
way. Until every new product on a requisition is settled, no purchase order is
raised from it — the master stays clean without making anyone wait to ask.
"""
import re

from odoo import api, fields, models, _
from odoo.exceptions import UserError

from .smartspend_contract import normalize_product_name, product_names_match

STATES = [
    ('pending', 'Waiting for Approval'),
    ('approved', 'Added to Catalogue'),
    ('mapped', 'Use Existing Product'),
    ('rejected', 'Rejected'),
]


def _singular(token):
    # "laptops" and "laptop" name the same product.
    return token[:-1] if len(token) > 3 and token.endswith('s') and not token.endswith('ss') else token


def product_key(name):
    return ' '.join(_singular(t) for t in normalize_product_name(name))


def same_product(left, right):
    """Two labels name the same product: equal, or one contains the other,
    noise words aside — strict enough that "Latitude 5440" is not "Latitude 7440"."""
    a, b = product_key(left), product_key(right)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    return len(shorter.split()) >= 2 and re.search(r'(^| )' + re.escape(shorter) + r'( |$)', longer) is not None


class SmartspendProductRequest(models.Model):
    _name = 'smartspend.product.request'
    _description = 'SmartSpend Product Creation Request'
    _inherit = ['mail.thread']
    _order = 'state, id desc'

    name = fields.Char(string='Reference', required=True, copy=False, readonly=True, index=True,
                       default=lambda self: _('New'))
    product_name = fields.Char(string='Product', required=True, tracking=True)
    description = fields.Text(string='Specification', help="What exactly is needed: model, size, make…")
    reason = fields.Char(string='Why it is needed')
    estimated_price = fields.Float(string='Estimated Unit Price')
    category_id = fields.Many2one('smartspend.expense.category', string='Expense Category')
    product_category_id = fields.Many2one('product.category', string='Product Category', tracking=True)
    requested_by_id = fields.Many2one('res.users', string='Requested By', required=True, index=True,
                                      default=lambda self: self.env.user)
    request_ids = fields.Many2many('smartspend.request', 'smartspend_product_request_rel',
                                   'product_request_id', 'request_id', string='Purchase Requests',
                                   help="Requisitions waiting on this product.")
    state = fields.Selection(STATES, default='pending', required=True, tracking=True, index=True)
    product_id = fields.Many2one('product.product', string='Catalogue Product', readonly=True, tracking=True,
                                 help="The product created on approval, or the existing one chosen instead.")
    decision_note = fields.Char(string='Manager Note')
    decided_by_id = fields.Many2one('res.users', string='Decided By', readonly=True)
    decided_on = fields.Datetime(string='Decided On', readonly=True)
    requester_seen = fields.Boolean(
        string='Seen by Requester', default=True, copy=False,
        help="Cleared when the manager decides; set once the requester has seen the decision.")
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('smartspend.product.request') or _('New')
        return super().create(vals_list)

    # ------------------------------------------------------------------
    # The master, and what it already holds
    # ------------------------------------------------------------------
    @api.model
    def _master_names(self):
        """Every product name the master knows: purchasable products and contract lines."""
        su = self.env(su=True)
        names = su['product.product'].search([('purchase_ok', '=', True)]).mapped('name')
        names += su['smartspend.contract.line'].search([]).mapped('product_name')
        return [n for n in dict.fromkeys(names) if n]

    @api.model
    def _check_product(self, name):
        """Whether ``name`` is in the master, and the closest names it does have.

        :return: ``{'known', 'match', 'suggestions', 'pending'}`` — ``pending``
            is an open (or decided) request for the same product, if any.
        """
        name = (name or '').strip()
        names = self._master_names()
        exact = next((n for n in names if same_product(name, n)), None)
        approved = self.sudo().search([('state', 'in', ('approved', 'mapped'))]).filtered(
            lambda r: same_product(name, r.product_name))[:1]
        if not exact and approved:
            exact = approved.product_id.name
        words = set(normalize_product_name(name))

        def score(other):
            common = words & set(normalize_product_name(other))
            return (product_names_match(name, other), len(common))

        suggestions = sorted((n for n in names if n != exact and (words & set(normalize_product_name(n)))),
                             key=score, reverse=True)[:3]
        open_request = self.sudo().search([('state', 'in', ('pending', 'rejected'))]).filtered(
            lambda r: same_product(name, r.product_name))[:1]
        return {
            'known': bool(exact),
            'match': exact or '',
            'suggestions': suggestions,
            'pending': open_request and {'name': open_request.name, 'state': open_request.state,
                                         'stateLabel': dict(STATES)[open_request.state],
                                         'note': open_request.decision_note or ''} or None,
        }

    # ------------------------------------------------------------------
    # Decisions — the procurement manager's
    # ------------------------------------------------------------------
    def _check_manager(self):
        if not (self.env.su or self.env.user.has_group('smartspend.group_smartspend_manager')):
            raise UserError(_("Only a procurement manager decides what goes into the product master."))

    def _decide(self, state, note, product=None):
        self.write({
            'state': state, 'decision_note': (note or '').strip() or False,
            'product_id': product.id if product else False,
            'decided_by_id': self.env.user.id, 'decided_on': fields.Datetime.now(),
            'requester_seen': False,
        })

    def action_approve(self, product_category=None, final_name=None, note=None):
        """Add the product to the master — named as requested unless renamed."""
        self._check_manager()
        for req in self:
            if req.state != 'pending':
                raise UserError(_("%s has already been decided.", req.name))
            name = (final_name or req.product_name).strip()
            Product = self.env['product.product'].sudo()
            category = product_category or req.product_category_id
            values = {
                'name': name, 'type': 'consu', 'purchase_ok': True,
                'list_price': req.estimated_price, 'standard_price': req.estimated_price,
                'description_purchase': req.description or False,
            }
            if category:
                values['categ_id'] = category.id
            product = Product.search([('name', '=ilike', name)], limit=1) or Product.create(values)
            if product_category:
                req.product_category_id = product_category
            req._decide('approved', note, product)
            req._announce(_("“%(product)s” was approved and added to the product catalogue by %(manager)s.",
                            product=product.name, manager=self.env.user.name))
        return True

    def action_map(self, product, note=None):
        """The master already has it: use ``product`` wherever this was asked for."""
        self._check_manager()
        product = self.env['product.product'].browse(product.id if hasattr(product, 'id') else int(product)).exists()
        if not product:
            raise UserError(_("Choose the existing product to use instead."))
        for req in self:
            if req.state != 'pending':
                raise UserError(_("%s has already been decided.", req.name))
            req._decide('mapped', note, product)
            req._announce(_("“%(asked)s” is already in the catalogue as “%(product)s” — %(manager)s linked it, "
                            "so orders use that product.", asked=req.product_name, product=product.name,
                            manager=self.env.user.name))
        return True

    def action_reject(self, note=None):
        self._check_manager()
        if not (note or '').strip():
            raise UserError(_("Say why the product is not being added, so the requester knows what to do."))
        for req in self:
            if req.state != 'pending':
                raise UserError(_("%s has already been decided.", req.name))
            req._decide('rejected', note)
            req._announce(_("“%(product)s” was not added to the catalogue by %(manager)s: %(note)s",
                            product=req.product_name, manager=self.env.user.name, note=note.strip()))
        return True

    def action_mark_seen(self):
        self.write({'requester_seen': True})
        return True

    def _announce(self, text):
        """Tell the requester, and every requisition waiting on it."""
        self.ensure_one()
        self.message_post(body=text, partner_ids=self.requested_by_id.partner_id.ids,
                          subtype_xmlid='mail.mt_comment')
        for request in self.request_ids.sudo():
            follow = {
                'approved': _("Its purchase order can be raised once the request is approved."),
                'mapped': _("Its purchase order will use the existing product."),
                'rejected': _("Change or remove this item before a purchase order can be raised."),
            }[self.state]
            request._log_history(_("New Product %s", dict(STATES)[self.state]), f"{text} {follow}")
            request.message_post(body=f"{text} {follow}")

    # Odoo form buttons -------------------------------------------------
    def action_approve_button(self):
        return self.action_approve()

    def action_reject_button(self):
        return self.action_reject(note=self.decision_note or _("Not added to the catalogue."))


class SmartspendRequest(models.Model):
    _inherit = 'smartspend.request'

    product_request_ids = fields.Many2many(
        'smartspend.product.request', 'smartspend_product_request_rel', 'request_id', 'product_request_id',
        string='New Product Requests', readonly=True, copy=False)

    def _raise_product_requests(self):
        """For every item the master does not know, raise (or join) a product
        creation request — once the requisition is submitted."""
        ProductRequest = self.env['smartspend.product.request'].sudo()
        known = ProductRequest._master_names()
        for request in self:
            for line in request.line_ids.filtered(lambda l: not l.product_id and l.product_name):
                if any(same_product(line.product_name, n) for n in known):
                    continue
                existing = ProductRequest.search([]).filtered(lambda r: same_product(line.product_name, r.product_name))[:1]
                if existing:
                    if request not in existing.request_ids:
                        existing.request_ids = [fields.Command.link(request.id)]
                    continue
                pr = ProductRequest.create({
                    'product_name': line.product_name.strip(),
                    'description': line.description or False,
                    'estimated_price': line.price_unit,
                    'category_id': request.category_id.id or False,
                    'product_category_id': request.category_id.product_category_id.id or False,
                    'requested_by_id': request.user_id.id,
                    'request_ids': [fields.Command.link(request.id)],
                })
                text = _("“%(product)s” is not in the product catalogue — %(ref)s sent to the procurement manager "
                         "to add it. The request goes on for approval meanwhile.", product=pr.product_name, ref=pr.name)
                request._log_history(_("New Product Requested"), text)
                request.message_post(body=text)

    def _blocking_product_requests(self):
        self.ensure_one()
        names = self.line_ids.mapped('product_name')
        return self.product_request_ids.filtered(
            lambda r: r.state in ('pending', 'rejected') and any(same_product(n, r.product_name) for n in names))

    def action_submit(self):
        # Before the submission itself, so "Submitted for Approval" stays the
        # latest timeline entry; a refused submission rolls this back with it.
        self._raise_product_requests()
        return super().action_submit()

    def _upsert_from_portal(self, payload):
        request = super()._upsert_from_portal(payload)
        if request.state in ('to_approve', 'clarification', 'approved', 'sourcing'):
            request._raise_product_requests()
        return request

    def action_create_purchase_order(self):
        for request in self:
            blocking = request._blocking_product_requests()
            if blocking:
                pending = blocking.filtered(lambda r: r.state == 'pending')
                if pending:
                    raise UserError(_(
                        "%(request)s includes a product that is not in the catalogue yet (%(items)s). "
                        "The procurement manager has to approve it before a purchase order is raised.",
                        request=request.name,
                        items=', '.join(f"{r.product_name} — {r.name}" for r in pending)))
                raise UserError(_(
                    "%(request)s includes a product the procurement manager did not add to the catalogue "
                    "(%(items)s). Change or remove that item first.",
                    request=request.name,
                    items=', '.join(f"{r.product_name}: {r.decision_note or _('rejected')}" for r in blocking)))
        return super().action_create_purchase_order()


class SmartspendRequestLine(models.Model):
    _inherit = 'smartspend.request.line'

    def _find_or_create_product(self):
        """An approved product request decides which product a typed name means."""
        self.ensure_one()
        if not self.product_id and self.product_name:
            decided = self.env['smartspend.product.request'].sudo().search(
                [('state', 'in', ('approved', 'mapped')), ('product_id', '!=', False)]).filtered(
                lambda r: same_product(self.product_name, r.product_name))[:1]
            if decided:
                self.product_id = decided.product_id.id
        return super()._find_or_create_product()
