from datetime import timedelta

from odoo import api, fields, models, _

from ..models.smartspend_auction import REBID_WINDOW_MINUTES, VISIBILITY


class SmartspendAuctionLaunch(models.TransientModel):
    """Put a request up for a live reverse auction — the original "Add to Bidding"."""
    _name = 'smartspend.auction.launch'
    _description = 'Launch a SmartSpend Reverse Auction'

    request_id = fields.Many2one('smartspend.request', required=True, readonly=True)
    currency_id = fields.Many2one(related='request_id.currency_id')
    ceiling_total = fields.Monetary(
        related='request_id.total_cost', string='Opening Price',
        help="The request at its target prices. Vendors bid down from here.")
    partner_ids = fields.Many2many(
        'res.partner', string='Invite Vendors', domain=[('supplier_rank', '>', 0)],
        help="At least two. A vendor without a portal login can still take part: "
             "you accept and bid for them.")
    start_date = fields.Datetime(
        string='Opens At', required=True,
        default=lambda self: fields.Datetime.now() + timedelta(minutes=5),
        help="Leave the vendors time to accept the terms. Bidding opens by itself the "
             "moment every invited vendor has answered and two have accepted — or at "
             "this time, whichever comes first.")
    duration_minutes = fields.Integer(string='Runs For (minutes)', default=10, required=True)
    extension_window = fields.Integer(
        string='Extension Applied in last (minutes)', default=2,
        help="A bid placed with less than this many minutes left extends the close by "
             "the Extension Duration. Zero switches extensions off.")
    extension_minutes = fields.Integer(
        string='Extension Duration (minutes)', default=2,
        help="How many minutes a last-moment bid adds to the close.")
    min_decrement = fields.Monetary(
        string='Minimum Decrement',
        help="How much lower each vendor's next bid has to be than their last.")
    visibility = fields.Selection(VISIBILITY, string='Vendors See', default='rank', required=True)
    rebid_minutes = fields.Integer(string='Bid Again Round (minutes)', default=REBID_WINDOW_MINUTES)
    terms = fields.Text(
        string='Terms & Conditions',
        default=lambda self: _(
            "Prices are for the full quantity, delivered to the requesting site, inclusive "
            "of freight and exclusive of GST. The lowest total at the close is L1. The buyer "
            "may award to L1 or cancel the event; placing a bid is a binding offer valid for "
            "30 days."))

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        request = self.env['smartspend.request'].browse(values.get('request_id'))
        if request and 'partner_ids' in fields_list and not values.get('partner_ids'):
            # The vendors already quoting on this request are the obvious field.
            names = request.bid_ids.mapped('vendor_name')
            partners = self.env['res.partner'].search(
                [('name', 'in', names), ('supplier_rank', '>', 0)]) if names else False
            if partners:
                values['partner_ids'] = [fields.Command.set(partners.ids)]
        if request and 'min_decrement' in fields_list and not values.get('min_decrement'):
            # Half a percent of the opening price, rounded to a tidy figure.
            step = request.total_cost * 0.005
            values['min_decrement'] = round(step, -2) if step >= 100 else round(step)
        return values

    def action_launch(self):
        self.ensure_one()
        auction = self.env['smartspend.auction']._launch_for_request(
            self.request_id, self.partner_ids,
            start_at=self.start_date,
            duration_minutes=self.duration_minutes,
            extension_window=self.extension_window,
            extension_minutes=self.extension_minutes,
            min_decrement=self.min_decrement,
            visibility=self.visibility,
            rebid_minutes=self.rebid_minutes,
            terms=self.terms,
        )
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'smartspend.auction',
            'view_mode': 'form',
            'res_id': auction.id,
        }
