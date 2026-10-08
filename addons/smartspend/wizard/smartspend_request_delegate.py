"""Hand one approval step to another user.

An approver who cannot sign — away, or simply not the right person for this
one — gives their step to somebody else. Who it went to and why is asked here,
because a hand-off nobody can account for later is indistinguishable from a
step that was quietly skipped.
"""
from odoo import api, fields, models, _
from odoo.exceptions import UserError


class SmartspendRequestDelegate(models.TransientModel):
    _name = 'smartspend.request.delegate'
    _description = 'Delegate SmartSpend Approval Step'

    request_ids = fields.Many2many(
        'smartspend.request', string='Requests', required=True,
        default=lambda self: self.env.context.get('active_ids', []))
    user_id = fields.Many2one(
        'res.users', string='Delegate To', required=True,
        domain="[('share', '=', False), ('id', '!=', uid)]",
        help="Only this user may sign the step once it is delegated.")
    note = fields.Text(
        string='Reason', help="Recorded on the request, and shown beside the step.")
    waiting_on = fields.Char(string='Step', compute='_compute_waiting_on')

    @api.depends('request_ids')
    def _compute_waiting_on(self):
        for wizard in self:
            steps = wizard.request_ids.mapped('approval_next_id')
            wizard.waiting_on = ", ".join(
                _("Level %(order)s · %(designation)s", order=step.sequence,
                  designation=step.designation_id.name) for step in steps) or _("No step is waiting.")

    def action_confirm(self):
        self.ensure_one()
        if not self.request_ids:
            raise UserError(_("There is nothing to delegate."))
        self.request_ids._apply_delegate(self.user_id, self.note)
        return {'type': 'ir.actions.act_window_close'}
