"""Master data a purchase request is filed against.

The portal used to ship these as hard-coded dropdowns. Keeping them as real
records means an administrator maintains the list in Odoo, the portal renders
whatever is active, and every request carries a link rather than a loose string.
"""
from odoo import api, fields, models, _


class SmartspendBranch(models.Model):
    _name = 'smartspend.branch'
    _description = 'SmartSpend Branch / Site'
    _order = 'sequence, name, id'

    name = fields.Char(required=True, translate=True)
    code = fields.Char(help="Short code used on references, e.g. BLR.")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    city = fields.Char()
    partner_id = fields.Many2one(
        'res.partner', string='Delivery Address',
        help="Where goods ordered for this site are delivered.")
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    request_count = fields.Integer(compute='_compute_request_count')

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'A branch with this name already exists.',
    )

    def _compute_request_count(self):
        counts = dict(self.env['smartspend.request']._read_group(
            [('branch_id', 'in', self.ids)], ['branch_id'], ['__count']))
        for branch in self:
            branch.request_count = counts.get(branch, 0)

    def action_view_requests(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Requests'),
            'res_model': 'smartspend.request',
            'view_mode': 'list,form',
            'domain': [('branch_id', '=', self.id)],
            'context': {'default_branch_id': self.id},
        }


class SmartspendDepartment(models.Model):
    _name = 'smartspend.department'
    _description = 'SmartSpend Department'
    _order = 'sequence, name, id'
    _check_company_auto = True

    name = fields.Char(required=True, translate=True)
    code = fields.Char(help="Short code used on references, e.g. ITI.")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    manager_id = fields.Many2one(
        'res.users', string='Approver',
        help="Manager who approves the requests raised by this department.")
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    # The cost centre every request of this department is filed against. Nothing
    # is posted to it yet — it is the hook a later phase reserves budget on.
    analytic_account_id = fields.Many2one(
        'account.analytic.account', string='Cost Center', check_company=True,
        help="Analytic account the spend of this department belongs to.")
    request_count = fields.Integer(compute='_compute_request_count')

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'A department with this name already exists.',
    )

    def _compute_request_count(self):
        counts = dict(self.env['smartspend.request']._read_group(
            [('department_id', 'in', self.ids)], ['department_id'], ['__count']))
        for department in self:
            department.request_count = counts.get(department, 0)

    def action_view_requests(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Requests'),
            'res_model': 'smartspend.request',
            'view_mode': 'list,form',
            'domain': [('department_id', '=', self.id)],
            'context': {'default_department_id': self.id},
        }


class SmartspendExpenseCategory(models.Model):
    _name = 'smartspend.expense.category'
    _description = 'SmartSpend Expense Category'
    _order = 'sequence, name, id'

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    expense_type = fields.Selection(
        [('capex', 'Capital Expenditure (CapEx)'), ('opex', 'Operating Expenditure (OpEx)')],
        default='opex', required=True)
    product_category_id = fields.Many2one(
        'product.category', string='Product Category',
        help="Odoo product category the items of this spend category belong to.")
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)
    request_count = fields.Integer(compute='_compute_request_count')

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'An expense category with this name already exists.',
    )

    def _compute_request_count(self):
        counts = dict(self.env['smartspend.request']._read_group(
            [('category_id', 'in', self.ids)], ['category_id'], ['__count']))
        for category in self:
            category.request_count = counts.get(category, 0)

    def action_view_requests(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Purchase Requests'),
            'res_model': 'smartspend.request',
            'view_mode': 'list,form',
            'domain': [('category_id', '=', self.id)],
            'context': {'default_category_id': self.id},
        }


class SmartspendMasterMixin(models.AbstractModel):
    """Resolve the labels the portal speaks into the records Odoo files against."""
    _name = 'smartspend.master.mixin'
    _description = 'SmartSpend Master Data Resolution'

    @api.model
    def _resolve_master_record(self, model_name, label, company=None):
        """Return the active master record named ``label``, or an empty one.

        The portal posts names, not ids — an employee picked "Bangalore Office"
        from a list this very backend served. Matching is case-insensitive so a
        dictated request still lands on the right record.

        :param company: restrict the match to this company. A request may only
            point at master data of its own company, so resolving against every
            allowed company could hand back a record the request must refuse.
        """
        label = (label or '').strip()
        if not label:
            return self.env[model_name].browse()
        return self.env[model_name].search([
            ('name', '=ilike', label),
            ('company_id', 'in', (company or self.env.companies).ids),
        ], limit=1)
