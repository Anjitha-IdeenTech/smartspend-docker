"""Approve a request, optionally saying why.

Unlike the reason a cancellation demands, the note here is optional: an
approval that needs no explanation should not be held up for one. When it is
given, it reaches the requester through the same thread the portal renders.
"""
from odoo import fields, models, _
from odoo.exceptions import UserError


class SmartspendRequestApprove(models.TransientModel):
    _name = 'smartspend.request.approve'
    _description = 'Approve SmartSpend Purchase Request'

    request_ids = fields.Many2many(
        'smartspend.request', string='Requests', required=True,
        default=lambda self: self.env.context.get('active_ids', []))
    note = fields.Text(
        string='Approval Note',
        help="Shown to the requester in the portal and recorded on the request.")

    def action_confirm(self):
        self.ensure_one()
        if not self.request_ids:
            raise UserError(_("There is nothing to approve."))
        self.request_ids._apply_approve(self.note)
        return {'type': 'ir.actions.act_window_close'}
