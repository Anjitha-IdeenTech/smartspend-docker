"""Departmental spend budgets, and the check a request is held against.

A budget covers a period and, optionally, a department / branch / expense
category. The narrowest budget covering a request is the one that applies, so a
company-wide envelope can sit behind a departmental one without either being
double-counted.
"""
import operator as py_operator

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError

# ``available_amount`` is computed live, so searching it is done in python.
_COMPARATORS = {
    '<': py_operator.lt, '<=': py_operator.le, '>': py_operator.gt,
    '>=': py_operator.ge, '=': py_operator.eq, '!=': py_operator.ne,
}

# Requests that have consumed budget, split by how firm the commitment is.
COMMITTED_STATES = ('to_approve', 'clarification', 'sourcing', 'approved')
ORDERED_STATES = ('po_confirmed', 'paid')


class SmartspendBudget(models.Model):
    _name = 'smartspend.budget'
    _description = 'SmartSpend Spend Budget'
    _inherit = ['mail.thread']
    _order = 'date_start desc, id desc'
    _check_company_auto = True

    name = fields.Char(required=True, tracking=True)
    active = fields.Boolean(default=True)
    state = fields.Selection(
        [('draft', 'Draft'), ('confirmed', 'Confirmed'), ('closed', 'Closed')],
        default='draft', required=True, tracking=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id', string='Currency')

    # An unset dimension means "any": leave all three empty for a company-wide
    # envelope, set one for a departmental budget, set all three to ring-fence.
    department_id = fields.Many2one(
        'smartspend.department', string='Department', check_company=True, tracking=True)
    branch_id = fields.Many2one(
        'smartspend.branch', string='Branch', check_company=True, tracking=True)
    category_id = fields.Many2one(
        'smartspend.expense.category', string='Expense Category', check_company=True, tracking=True)

    date_start = fields.Date(required=True, default=lambda self: fields.Date.today().replace(month=1, day=1))
    date_end = fields.Date(required=True, default=lambda self: fields.Date.today().replace(month=12, day=31))
    is_running = fields.Boolean(
        string='Currently Applicable', compute='_compute_is_running', store=True,
        help="Confirmed budget whose period covers today. Only these are checked "
             "against incoming purchase requests.")

    allocated_amount = fields.Monetary(string='Allocated', required=True, tracking=True)
    committed_amount = fields.Monetary(
        string='Committed', compute='_compute_amounts',
        help="Requests in flight: submitted, being sourced or approved.")
    ordered_amount = fields.Monetary(
        string='Ordered', compute='_compute_amounts',
        help="Requests that reached a purchase order.")
    consumed_amount = fields.Monetary(string='Consumed', compute='_compute_amounts')
    available_amount = fields.Monetary(
        string='Available', compute='_compute_amounts', search='_search_available_amount')
    consumed_percent = fields.Float(string='Used (%)', compute='_compute_amounts')

    request_count = fields.Integer(compute='_compute_amounts')

    _check_dates = models.Constraint(
        'CHECK(date_end >= date_start)',
        'A budget cannot end before it starts.',
    )
    _check_allocated = models.Constraint(
        'CHECK(allocated_amount >= 0)',
        'An allocated budget cannot be negative.',
    )

    # ------------------------------------------------------------------
    # Computes
    # ------------------------------------------------------------------
    @api.depends('state', 'date_start', 'date_end')
    def _compute_is_running(self):
        today = fields.Date.context_today(self)
        for budget in self:
            budget.is_running = bool(
                budget.state == 'confirmed'
                and budget.date_start <= today <= budget.date_end
            )

    def _compute_amounts(self):
        Request = self.env['smartspend.request'].sudo()
        for budget in self:
            requests = Request.search(budget._request_domain())
            committed = sum(requests.filtered(lambda r: r.state in COMMITTED_STATES).mapped('total_cost'))
            ordered = sum(requests.filtered(lambda r: r.state in ORDERED_STATES).mapped('total_cost'))
            budget.committed_amount = committed
            budget.ordered_amount = ordered
            budget.consumed_amount = committed + ordered
            budget.available_amount = budget.allocated_amount - budget.consumed_amount
            budget.consumed_percent = (
                100.0 * budget.consumed_amount / budget.allocated_amount
                if budget.allocated_amount else 0.0
            )
            budget.request_count = len(requests)

    def _search_available_amount(self, operator, value):
        """Let "over budget" be a filter, though the figure is computed live."""
        compare = _COMPARATORS.get(operator)
        if not compare:
            raise UserError(_("Budgets cannot be searched with the operator %s.", operator))
        budgets = self.search([]).filtered(lambda b: compare(b.available_amount, value))
        return [('id', 'in', budgets.ids)]

    @api.constrains('department_id', 'branch_id', 'category_id', 'date_start', 'date_end', 'state')
    def _check_no_overlap(self):
        """Two confirmed budgets must not cover the same spend twice."""
        for budget in self.filtered(lambda b: b.state == 'confirmed'):
            twin = self.search([
                ('id', '!=', budget.id),
                ('state', '=', 'confirmed'),
                ('company_id', '=', budget.company_id.id),
                ('department_id', '=', budget.department_id.id),
                ('branch_id', '=', budget.branch_id.id),
                ('category_id', '=', budget.category_id.id),
                ('date_start', '<=', budget.date_end),
                ('date_end', '>=', budget.date_start),
            ], limit=1)
            if twin:
                raise ValidationError(_(
                    "%(budget)s overlaps %(twin)s: the same scope is already budgeted "
                    "for that period.", budget=budget.name, twin=twin.name))

    # ------------------------------------------------------------------
    # Matching
    # ------------------------------------------------------------------
    def _request_domain(self):
        """Domain selecting the requests this budget answers for."""
        self.ensure_one()
        domain = [
            ('company_id', '=', self.company_id.id),
            ('state', 'in', COMMITTED_STATES + ORDERED_STATES),
            ('request_date', '>=', fields.Datetime.to_datetime(self.date_start)),
            ('request_date', '<=', fields.Datetime.to_datetime(self.date_end).replace(
                hour=23, minute=59, second=59)),
        ]
        for field_name, record in (('department_id', self.department_id),
                                   ('branch_id', self.branch_id),
                                   ('category_id', self.category_id)):
            if record:
                domain.append((field_name, '=', record.id))
        return domain

    @api.model
    def _match_for_request(self, request):
        """The narrowest running budget covering ``request``.

        :return: a single budget, or an empty recordset when nothing covers it.
        """
        if not request.request_date:
            return self.browse()
        request_date = request.request_date.date()
        candidates = self.search([
            ('is_running', '=', True),
            ('company_id', '=', request.company_id.id),
            ('date_start', '<=', request_date),
            ('date_end', '>=', request_date),
        ])
        matching = candidates.filtered(lambda b: all(
            not scope or scope == value
            for scope, value in ((b.department_id, request.department_id),
                                 (b.branch_id, request.branch_id),
                                 (b.category_id, request.category_id))
        ))
        # More dimensions set = the more specific envelope; it wins.
        return matching.sorted(
            key=lambda b: len(list(filter(None, (b.department_id, b.branch_id, b.category_id)))),
            reverse=True,
        )[:1]

    def _available_excluding(self, request):
        """What is left in this budget once ``request``'s own claim is set aside."""
        self.ensure_one()
        Request = self.env['smartspend.request'].sudo()
        domain = self._request_domain()
        if request.id:
            domain += [('id', '!=', request.id)]
        consumed = sum(Request.search(domain).mapped('total_cost'))
        return self.allocated_amount - consumed

    # ------------------------------------------------------------------
    # Workflow
    # ------------------------------------------------------------------
    def action_confirm(self):
        self.write({'state': 'confirmed'})

    def action_close(self):
        self.write({'state': 'closed'})

    def action_reset_draft(self):
        self.write({'state': 'draft'})

    def action_view_requests(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Requests'),
            'res_model': 'smartspend.request',
            'view_mode': 'list,form',
            'domain': self._request_domain(),
        }

    # ------------------------------------------------------------------
    # Portal
    # ------------------------------------------------------------------
    def _to_portal_dict(self):
        self.ensure_one()
        return {
            'id': self.id,
            'name': self.name,
            'department': self.department_id.name or '',
            'branch': self.branch_id.name or '',
            'category': self.category_id.name or '',
            'periodStart': self.date_start.isoformat(),
            'periodEnd': self.date_end.isoformat(),
            'allocated': self.allocated_amount,
            'committed': self.committed_amount,
            'ordered': self.ordered_amount,
            'consumed': self.consumed_amount,
            'available': self.available_amount,
            'usedPercent': round(self.consumed_percent, 1),
            'currency': self.currency_id.name or '',
        }
