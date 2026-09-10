"""Ask why a request is being withdrawn, then withdraw it.

Cancelling is an audit event: the reason is what a reviewer reads six months
later, so it is collected before the state moves rather than typed into the
record afterwards (or not at all).
"""
from odoo import fields, models, _
from odoo.exceptions import UserError


class SmartspendRequestCancel(models.TransientModel):
    _name = 'smartspend.request.cancel'
    _description = 'Cancel SmartSpend Purchase Request'

    request_ids = fields.Many2many(
        'smartspend.request', string='Requests', required=True,
        default=lambda self: self.env.context.get('active_ids', []))
    reason = fields.Text(string='Reason', required=True)

    def action_confirm(self):
        self.ensure_one()
        if not self.request_ids:
            raise UserError(_("There is nothing to cancel."))
        self.request_ids._apply_cancel(self.reason)
        return {'type': 'ir.actions.act_window_close'}
