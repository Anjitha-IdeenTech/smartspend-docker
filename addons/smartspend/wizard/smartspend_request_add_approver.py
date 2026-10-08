"""Put an extra approver into a chain that is already running.

The chain comes from the workflow master, which is written for the general
case. A particular request sometimes needs one more signature — a higher
authority, or the head of a function the rule never anticipated — and this adds
it without editing the master and rewriting every other request in flight.
"""
from odoo import fields, models, _
from odoo.exceptions import UserError


class SmartspendRequestAddApprover(models.TransientModel):
    _name = 'smartspend.request.add.approver'
    _description = 'Add an Approver to a SmartSpend Request'

    request_ids = fields.Many2many(
        'smartspend.request', string='Requests', required=True,
        default=lambda self: self.env.context.get('active_ids', []))
    designation_id = fields.Many2one(
        'smartspend.designation', string='Designation', required=True,
        help="The added step names a designation, like every other step, so "
             "whoever holds it signs.")
    position = fields.Selection(
        [('next', 'Signs next, after the level now waiting'),
         ('last', 'Signs last, after everyone else')],
        default='next', required=True, string='Position')
    note = fields.Text(string='Reason')

    def action_confirm(self):
        self.ensure_one()
        if not self.request_ids:
            raise UserError(_("There is nothing to add an approver to."))
        self.request_ids._apply_add_approver(self.designation_id, self.position, self.note)
        return {'type': 'ir.actions.act_window_close'}
