"""Configurable approval workflows.

An approval chain is not a constant. Which people sign a request depends on the
company and branch it belongs to, the department that raised it, whether the
spend is capital or operating, which expense category it falls in, and how much
it is worth. Hard-coding "the manager approves, then the buyer sources" cannot
express that, so the chain lives in a master an administrator maintains.

A workflow is therefore two things at once:

* a **matching rule** — the company, branch, department, expense type, expense
  category and amount slab it applies to; and
* an **ordered list of approvers** — the designations that must sign, in order.

A request is matched against the rules once, when it is submitted, and the
winning workflow is copied onto it as a chain of approval steps. Copying rather
than referencing matters: editing a workflow must not silently rewrite the
approvals of requests already in flight.
"""
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

# What a workflow governs. The portal only drives purchase requests today; the
# rest are here because the same matrix is what an administrator maintains for
# the other documents, and a workflow master that can only describe one of them
# would have to be replaced the moment the second is wired up.
DOCUMENT_TYPES = [
    ('purchase_request', 'Purchase Request'),
    ('purchase_order', 'Purchase Order'),
    ('payment', 'Payment'),
    ('need_for_contract', 'Need for Contract'),
    ('legal', 'Legal Workflow'),
]

# The functional stream the chain belongs to — the same document can be routed
# through a different set of signatories depending on which function owns it.
WORKFLOW_TYPES = [
    ('procurement', 'Procurement'),
    ('accounting', 'Accounting'),
    ('legal', 'Legal'),
    ('management', 'Management'),
]

EXPENSE_TYPES = [
    ('capex', 'Capital Expenditure (CapEx)'),
    ('opex', 'Operating Expenditure (OpEx)'),
]


class SmartspendDesignation(models.Model):
    """A role that signs, as an organisation names it.

    Approvers are configured by designation rather than by person so the chain
    survives someone leaving: point the designation at a different user and
    every workflow that names it follows.
    """
    _name = 'smartspend.designation'
    _description = 'SmartSpend Approver Designation'
    _order = 'sequence, name, id'

    name = fields.Char(required=True, translate=True)
    code = fields.Char(help="Short code, e.g. FIN-CAPEX-HEAD.")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    user_ids = fields.Many2many(
        'res.users', string='Held by',
        help="Who currently holds this designation. Any one of them may sign a "
             "step that names it.")
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'A designation with this name already exists.',
    )


class SmartspendWorkflow(models.Model):
    _name = 'smartspend.workflow'
    _description = 'SmartSpend Approval Workflow'
    _order = 'document_type, sequence, amount_from, id'
    _inherit = ['mail.thread']

    name = fields.Char(
        required=True, copy=False, readonly=True, index=True,
        default=lambda self: _('New'), tracking=True)
    active = fields.Boolean(default=True)
    sequence = fields.Integer(default=10)

    document_type = fields.Selection(
        DOCUMENT_TYPES, string='Document', required=True,
        default='purchase_request', tracking=True,
        help="Which document this chain approves.")
    workflow_type = fields.Selection(
        WORKFLOW_TYPES, string='Workflow Type', required=True,
        default='procurement', tracking=True)

    # -- What the rule matches on. An empty criterion means "any": a workflow
    # -- with no department set applies to every department, which is how the
    # -- "All" rows in the master read.
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company, tracking=True)
    branch_id = fields.Many2one(
        'smartspend.branch', string='Branch', tracking=True,
        help="Leave empty to apply to every branch of the company.")
    department_id = fields.Many2one(
        'smartspend.department', string='Department', tracking=True,
        help="Leave empty to apply to every department.")
    expense_type = fields.Selection(
        EXPENSE_TYPES, string='Expense Type', tracking=True,
        help="Leave empty to apply to both CapEx and OpEx.")
    category_id = fields.Many2one(
        'smartspend.expense.category', string='Expense Category', tracking=True,
        help="Leave empty to apply to every expense category.")

    amount_from = fields.Monetary(string='From Amount', default=0.0, tracking=True)
    amount_to = fields.Monetary(string='To Amount', default=999999999.0, tracking=True)
    currency_id = fields.Many2one(
        related='company_id.currency_id', string='Currency', store=True)

    approver_ids = fields.One2many(
        'smartspend.workflow.approver', 'workflow_id', string='Approve Users', copy=True)
    approver_count = fields.Integer(compute='_compute_approver_count', store=True)

    # How narrowly this rule is drawn. Two workflows can both match a request —
    # one for "All departments", one for Sales — and the more specific one has
    # to win, or a general fallback would shadow every precise rule.
    #
    # Weighted, not counted. Expense type is a binary: setting it to CapEx keeps
    # roughly half of all spend, while naming a department or a category picks
    # one of many. Counting them equally let a plain "CapEx" rule tie with a
    # department-specific one, and the tie then fell to whichever had the
    # narrower amount slab — which meant a department rule spanning all values
    # could never win, and simply never fired.
    specificity = fields.Integer(compute='_compute_specificity', store=True, index=True)
    # How much each criterion narrows the rule.
    _CRITERION_WEIGHTS = {'branch': 4, 'department': 4, 'category': 4, 'expense_type': 1}

    _amount_range = models.Constraint(
        'CHECK(amount_to >= amount_from)',
        'The "To Amount" cannot be lower than the "From Amount".',
    )

    @api.depends('approver_ids')
    def _compute_approver_count(self):
        for workflow in self:
            workflow.approver_count = len(workflow.approver_ids)

    @api.depends('branch_id', 'department_id', 'expense_type', 'category_id')
    def _compute_specificity(self):
        weights = self._CRITERION_WEIGHTS
        for workflow in self:
            workflow.specificity = (
                (weights['branch'] if workflow.branch_id else 0)
                + (weights['department'] if workflow.department_id else 0)
                + (weights['category'] if workflow.category_id else 0)
                + (weights['expense_type'] if workflow.expense_type else 0)
            )

    @api.constrains('approver_ids')
    def _check_has_approver(self):
        for workflow in self:
            if workflow.active and not workflow.approver_ids:
                raise ValidationError(_(
                    "%s has no approvers. A workflow that names nobody would let a "
                    "request through unapproved.", workflow.display_name))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'smartspend.workflow') or _('New')
        return super().create(vals_list)

    # ------------------------------------------------------------------
    # Matching
    # ------------------------------------------------------------------
    @api.model
    def _match(self, *, document_type='purchase_request', company=None, branch=None,
               department=None, expense_type=None, category=None, amount=0.0):
        """The workflow that governs one document, or an empty recordset.

        A criterion left empty on the workflow matches anything, so the domain
        asks for "equal to what we have, or not set". Of the workflows that
        match, the most specific wins; ties are broken by the configured
        sequence and then the narrowest amount slab, so an administrator can
        still order two equally specific rules by hand.
        """
        company = company or self.env.company

        def either(field, value):
            return ['|', (field, '=', False), (field, '=', value)] if value \
                else [(field, '=', False)]

        domain = [
            ('document_type', '=', document_type),
            ('company_id', '=', company.id),
            ('amount_from', '<=', amount),
            ('amount_to', '>=', amount),
        ]
        domain += either('branch_id', branch.id if branch else None)
        domain += either('department_id', department.id if department else None)
        domain += either('category_id', category.id if category else None)
        domain += ['|', ('expense_type', '=', False), ('expense_type', '=', expense_type)] \
            if expense_type else [('expense_type', '=', False)]

        candidates = self.search(domain)
        if not candidates:
            return self.browse()
        return candidates.sorted(
            key=lambda w: (-w.specificity, w.sequence, w.amount_to - w.amount_from))[0]

    def _approval_commands(self):
        """Command list that copies this chain onto a request, in order."""
        self.ensure_one()
        return [
            fields.Command.create({
                'sequence': approver.sequence,
                'designation_id': approver.designation_id.id,
                'branch_id': approver.branch_id.id or False,
                'department_id': approver.department_id.id or False,
            })
            for approver in self.approver_ids.sorted('sequence')
        ]

    def action_view_requests(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Requests on %s', self.name),
            'res_model': 'smartspend.request',
            'view_mode': 'list,form',
            'domain': [('workflow_id', '=', self.id)],
        }


class SmartspendWorkflowApprover(models.Model):
    """One signatory line of a workflow, in the order they sign."""
    _name = 'smartspend.workflow.approver'
    _description = 'SmartSpend Workflow Approver'
    _order = 'workflow_id, sequence, id'

    workflow_id = fields.Many2one(
        'smartspend.workflow', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(string='Order', default=1, required=True)
    designation_id = fields.Many2one(
        'smartspend.designation', string='Designation', required=True)
    company_id = fields.Many2one(
        related='workflow_id.company_id', string='Company', store=True)
    branch_id = fields.Many2one('smartspend.branch', string='Branch')
    department_id = fields.Many2one('smartspend.department', string='Department')

    _order_positive = models.Constraint(
        'CHECK(sequence > 0)',
        'The approval order starts at 1.',
    )


class SmartspendRequestApproval(models.Model):
    """One step of the approval chain a request is actually running.

    Copied from the matched workflow when the request is submitted, so a later
    edit to the master cannot rewrite the approvals of a request already in
    flight — what was signed stays signed, against the rule that applied then.
    """
    _name = 'smartspend.request.approval'
    _description = 'SmartSpend Request Approval Step'
    _order = 'request_id, sequence, id'

    request_id = fields.Many2one(
        'smartspend.request', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(string='Order', default=1, required=True)
    designation_id = fields.Many2one(
        'smartspend.designation', string='Designation', required=True)
    branch_id = fields.Many2one('smartspend.branch', string='Branch')
    department_id = fields.Many2one('smartspend.department', string='Department')

    state = fields.Selection(
        [('pending', 'Waiting'), ('approved', 'Approved'), ('rejected', 'Rejected')],
        default='pending', required=True, index=True)
    user_id = fields.Many2one('res.users', string='Decided by', readonly=True)
    decided_on = fields.Datetime(readonly=True)
    note = fields.Text(string='Note')

    def _may_be_signed_by(self, user):
        """Whether this user may sign the step the request is waiting on.

        Where the designation names its holders, only they sign: a chain that
        any manager could clear end-to-end is not really a chain, and the whole
        point of routing by designation is that different people sign different
        levels.

        Where nobody holds it, any SmartSpend manager may — otherwise a
        designation left unassigned would deadlock the request with nobody on
        earth able to clear it.
        """
        self.ensure_one()
        holders = self.designation_id.sudo().user_ids
        if holders:
            return user in holders
        return user.has_group('smartspend.group_smartspend_manager')
