"""Live reverse auctions: vendors bid a request's price down against the clock.

A port of the Odoo 15 ``bidding`` module onto SmartSpend requests. The ideas
carried across, and the model each one lived in there:

* the auction event itself, its schedule and its current leader  (``bidding``)
* the items being bid on, opening at the request's target prices (``bidding.products``)
* one invitation per vendor: accept the terms, then bid           (``bid.request``)
* an append-only log of every price a vendor put in               (``bid.price.history``)
* anti-sniping: a bid in the last *N* minutes pushes the close
  out by *M* minutes                                   (``extension`` / ``extension_period``)
* the start-time rule: fewer than two vendors who accepted means
  there is no competition, and the event is cancelled   (``_cron_update_bidding_status``)
* "Bid Again": a closed auction may be reopened for one more round
  within fifteen minutes of closing                     (``bid_again``)
* a reminder to the vendors half an hour before it opens (``_notify_vendor_before_bidding``)

What is different: the lowest total is ranked L1 by the server and nowhere
else; a vendor is only ever told their own rank (and, when the buyer allows
it, the leading price) — never a competitor's name; bids are a read-only audit
log; and awarding writes the winner and the winning prices back onto the
purchase request, so the purchase order goes to the right vendor at the price
they committed to.
"""
from datetime import datetime, timedelta, timezone

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import format_datetime

AUCTION_STATES = [
    ('draft', 'Draft'),
    ('scheduled', 'Scheduled'),
    ('live', 'Live'),
    ('closed', 'Closed'),
    ('awarded', 'Awarded'),
    ('cancelled', 'Cancelled'),
]
OPEN_STATES = ('draft', 'scheduled', 'live', 'closed')

PARTICIPANT_STATES = [
    ('invited', 'Invited'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('live', 'Bidding'),
    ('closed', 'Bidding Closed'),
    ('won', 'Won'),
    ('lost', 'Lost'),
    ('cancelled', 'Cancelled'),
]

VISIBILITY = [
    ('rank', 'Rank only'),
    ('leader', 'Rank and leading price'),
]

# Requests an auction may be launched for: the buyer's queue.
LAUNCHABLE_REQUEST_STATES = ('approved', 'sourcing')
# The original module's rule, kept: an event cannot open with one bidder.
MIN_BIDDERS = 2
# How long after closing "Bid Again" is still offered, as in the original.
REBID_WINDOW_MINUTES = 15
# How far ahead of the start the vendors are reminded, as in the original.
REMINDER_MINUTES = 30

# Demo supplier logins, and the supplier company each one bids for.
# Demo supplier logins: the supplier company each one bids for, the person
# behind it, and a sign-in named after the company. A client sees three
# real-looking sales contacts competing, not three "demo vendor" accounts.
# `seeded` holds the name and login each account was first created with; only
# those are ever replaced, so an account somebody has since edited is left alone.
DEMO_VENDOR_ACCOUNTS = {
    'smartspend.user_demo_vendor': {
        'supplier': 'Primus Technologies', 'person': 'Arjun Nair', 'job': 'Key Account Manager',
        'login': 'primus@smartspend.demo', 'password': 'primus',
        'seeded': {'names': ('Demo Vendor',), 'logins': ('vendor@smartspend.demo',)}},
    'smartspend.user_demo_vendor_apex': {
        'supplier': 'Apex Systems', 'person': 'Meera Krishnan', 'job': 'Enterprise Sales Lead',
        'login': 'apex@smartspend.demo', 'password': 'apex',
        'seeded': {'names': ('Apex Systems Sales Desk',), 'logins': ('vendor2@smartspend.demo',)}},
    'smartspend.user_demo_vendor_securenet': {
        'supplier': 'SecureNet', 'person': 'Vikram Desai', 'job': 'Regional Sales Manager',
        'login': 'securenet@smartspend.demo', 'password': 'securenet',
        'seeded': {'names': ('SecureNet Sales Desk',), 'logins': ('vendor3@smartspend.demo',)}},
}


def inr(amount):
    """₹1,57,000 — the portal's own format (en-IN grouping, paise only when present)."""
    amount = round(float(amount or 0.0), 2)
    rupees, paise = divmod(round(abs(amount) * 100), 100)
    digits = str(int(rupees))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ','.join(([head] if head else []) + groups + [tail])
    return '%s₹%s%s' % ('-' if amount < 0 else '', digits, '.%02d' % paise if paise else '')


def iso_utc(value):
    """A stored (naive, UTC) datetime as an ISO string the browser reads as UTC."""
    if not value:
        return ''
    return value.replace(tzinfo=timezone.utc).isoformat()


class SmartspendAuction(models.Model):
    _name = 'smartspend.auction'
    _description = 'SmartSpend Reverse Auction'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'start_date desc, id desc'
    _check_company_auto = True

    name = fields.Char(
        string='Reference', required=True, copy=False, readonly=True,
        default=lambda self: _('New'), index=True)
    request_id = fields.Many2one(
        'smartspend.request', string='Purchase Request', required=True,
        ondelete='cascade', index=True, tracking=True, check_company=True)
    company_id = fields.Many2one(
        related='request_id.company_id', store=True, index=True)
    currency_id = fields.Many2one(related='request_id.currency_id', string='Currency')
    buyer_id = fields.Many2one(
        'res.users', string='Buyer', default=lambda self: self.env.user,
        required=True, tracking=True)
    state = fields.Selection(
        AUCTION_STATES, string='Status', default='draft', required=True,
        tracking=True, copy=False, index=True)

    # -- Schedule -----------------------------------------------------------
    start_date = fields.Datetime(string='Opens At', required=True, tracking=True)
    end_date = fields.Datetime(
        string='Closes At', required=True, tracking=True,
        help="Moves later every time a last-moment bid triggers a time extension.")
    duration_minutes = fields.Integer(
        string='Duration (minutes)', default=10, required=True,
        help="How long bidding runs once it opens. Starting early keeps the duration.")
    original_end_date = fields.Datetime(
        string='Scheduled Close', readonly=True, copy=False,
        help="When the auction was due to close before any time extension.")
    closed_on = fields.Datetime(string='Closed On', readonly=True, copy=False)

    # -- Rules ---------------------------------------------------------------
    # The two fields of the original module, under its own labels: a bid placed
    # in the last `extension_window` minutes adds `extension_minutes` to the
    # clock — and a bid in the new last minutes extends it again.
    extension_window = fields.Integer(
        string='Extension Applied in last (minutes)', default=2,
        help="A bid placed with less than this many minutes left on the clock extends "
             "the auction by the Extension Duration. Zero switches extensions off.")
    extension_minutes = fields.Integer(
        string='Extension Duration (minutes)', default=2,
        help="How many minutes a last-moment bid adds to the close.")
    extension_count = fields.Integer(string='Time Extensions', readonly=True, copy=False)
    start_mode = fields.Selection([
        ('schedule', 'At the scheduled time'),
        ('buyer', 'Opened early by the buyer'),
        ('ready', 'Every vendor ready'),
    ], string='Opened', readonly=True, copy=False,
        help="How bidding opened. It opens by itself the moment every invited vendor "
             "has answered and at least two have accepted.")
    min_decrement = fields.Monetary(
        string='Minimum Decrement',
        help="Each new bid must undercut the vendor's own previous bid by at least this much.")
    visibility = fields.Selection(
        VISIBILITY, string='Vendors See', default='rank', required=True,
        help="Rank only: a vendor sees where they stand (L1, L2…). With the leading "
             "price they also see the lowest bid, but never who placed it.")
    rebid_minutes = fields.Integer(
        string='Bid Again Round (minutes)', default=15,
        help="How long an extra round runs when a closed auction is reopened.")
    terms = fields.Text(
        string='Terms & Conditions',
        help="What a vendor agrees to when they accept the invitation.")
    reminder_sent = fields.Boolean(copy=False, readonly=True)

    line_ids = fields.One2many('smartspend.auction.line', 'auction_id', string='Items', copy=True)
    participant_ids = fields.One2many(
        'smartspend.auction.participant', 'auction_id', string='Vendors', copy=False)
    bid_ids = fields.One2many('smartspend.auction.bid', 'auction_id', string='Bid Log', copy=False)

    # -- Standing ------------------------------------------------------------
    ceiling_total = fields.Monetary(
        string='Opening Price', compute='_compute_ceiling', store=True,
        help="The request's value at its target prices. No bid may be above it.")
    best_total = fields.Monetary(
        string='Best Bid', compute='_compute_standing', store=True)
    leader_id = fields.Many2one(
        'res.partner', string='Leading Vendor (L1)', compute='_compute_standing', store=True)
    savings_amount = fields.Monetary(
        string='Savings', compute='_compute_standing', store=True,
        help="Opening price less the best bid.")
    savings_percent = fields.Float(
        string='Savings (%)', compute='_compute_standing', store=True, digits=(16, 1))
    bid_count = fields.Integer(string='Bids', compute='_compute_counts', store=True)
    participant_count = fields.Integer(string='Invited', compute='_compute_counts', store=True)
    accepted_count = fields.Integer(string='Accepted', compute='_compute_counts', store=True)

    # -- Outcome -------------------------------------------------------------
    winner_id = fields.Many2one('res.partner', string='Awarded To', readonly=True, copy=False, tracking=True)
    awarded_total = fields.Monetary(string='Awarded Value', readonly=True, copy=False)
    awarded_on = fields.Datetime(string='Awarded On', readonly=True, copy=False)
    awarded_by_id = fields.Many2one('res.users', string='Awarded By', readonly=True, copy=False)
    cancel_reason = fields.Char(string='Cancellation Reason', readonly=True, copy=False)

    _name_uniq = models.Constraint(
        'UNIQUE(name, company_id)',
        'A reverse auction with this reference already exists.',
    )

    # ------------------------------------------------------------------
    # Computes
    # ------------------------------------------------------------------
    @api.depends('line_ids.ceiling_subtotal')
    def _compute_ceiling(self):
        for auction in self:
            auction.ceiling_total = sum(auction.line_ids.mapped('ceiling_subtotal'))

    @api.depends('participant_ids.rank', 'participant_ids.current_total', 'ceiling_total')
    def _compute_standing(self):
        for auction in self:
            leader = auction.participant_ids.filtered(lambda p: p.rank == 1)[:1]
            best = leader.current_total if leader else 0.0
            auction.best_total = best
            auction.leader_id = leader.partner_id
            saved = auction.ceiling_total - best if best else 0.0
            auction.savings_amount = saved
            auction.savings_percent = (
                100.0 * saved / auction.ceiling_total if best and auction.ceiling_total else 0.0)

    @api.depends('bid_ids', 'participant_ids.state')
    def _compute_counts(self):
        for auction in self:
            auction.bid_count = len(auction.bid_ids)
            auction.participant_count = len(auction.participant_ids)
            auction.accepted_count = len(auction.participant_ids.filtered(
                lambda p: p.state in ('accepted', 'live', 'closed', 'won', 'lost')))

    # ------------------------------------------------------------------
    # Constraints
    # ------------------------------------------------------------------
    @api.constrains('start_date', 'end_date')
    def _check_dates(self):
        for auction in self:
            if auction.start_date and auction.end_date and auction.end_date <= auction.start_date:
                raise ValidationError(_("%s must close after it opens.", auction.name))

    @api.constrains('duration_minutes', 'extension_window', 'extension_minutes', 'rebid_minutes', 'min_decrement')
    def _check_rules(self):
        for auction in self:
            if auction.duration_minutes <= 0:
                raise ValidationError(_("An auction has to run for at least a minute."))
            if auction.extension_window < 0 or auction.extension_minutes < 0 or auction.rebid_minutes < 0:
                raise ValidationError(_("Extension and round lengths cannot be negative."))
            if auction.extension_window and not auction.extension_minutes:
                raise ValidationError(_(
                    "Extension Applied in last is %s minutes but the Extension Duration is "
                    "zero. Set how many minutes a last-moment bid adds.", auction.extension_window))
            if auction.min_decrement < 0:
                raise ValidationError(_("The minimum decrement cannot be negative."))

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code('smartspend.auction') or _('New')
        return super().create(vals_list)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _money(self, amount):
        """An amount the way the portal writes it: rupees, Indian digit grouping.

        These messages are read in the portal — a vendor's refused bid, a line
        on the request timeline — and the portal prices everything in rupees.
        Formatting them in the company currency put "$ 1,57,000.00" beside a
        screen that says ₹1,57,000.
        """
        return inr(amount)

    def _when(self, value):
        """A stored datetime in the reader's timezone, short."""
        tz = self.env.user.tz or self.buyer_id.tz or 'Asia/Kolkata'
        return format_datetime(self.env, value, tz=tz, dt_format='d MMM, HH:mm')

    @api.model
    def _portal_user_for(self, partner):
        """The supplier login that bids for ``partner``, if it has one.

        A vendor account belongs to a supplier through its contact: the contact
        sits under the supplier's company record. Without a login the vendor
        can still take part — the buyer accepts and bids on their behalf.
        """
        vendor_group = self.env.ref('smartspend.group_smartspend_vendor', raise_if_not_found=False)
        if not vendor_group or not partner:
            return self.env['res.users']
        users = self.env['res.users'].sudo().search([
            ('partner_id.commercial_partner_id', '=', partner.commercial_partner_id.id),
            ('share', '=', False),
        ])
        return users.filtered(lambda u: vendor_group in u.all_group_ids)[:1]

    def _post_to_request(self, title, note):
        """Mirror an auction milestone onto the request's timeline."""
        self.ensure_one()
        self.request_id.sudo()._log_history(title, note)

    def _vendor_mail_partners(self, participants):
        """The suppliers to email. Only those with an address: a message to a
        contact with none just leaves a delivery failure on the chatter."""
        return participants.partner_id.filtered('email').ids

    def _rerank(self):
        """Order the bidders by price — lowest first, earliest to get there on a tie."""
        for auction in self:
            bidders = auction.participant_ids.filtered(
                lambda p: p.current_total > 0 and p.state in ('live', 'closed', 'won', 'lost'))
            ordered = bidders.sorted(
                lambda p: (p.current_total, p.improved_on or datetime.max, p.id))
            for position, participant in enumerate(ordered, start=1):
                if participant.rank != position:
                    participant.rank = position
            (auction.participant_ids - bidders).filtered('rank').write({'rank': 0})

    # ------------------------------------------------------------------
    # Launch
    # ------------------------------------------------------------------
    @api.model
    def _launch_for_request(self, request, partners, start_at, duration_minutes,
                            extension_window=2, extension_minutes=2, min_decrement=0.0,
                            visibility='rank', rebid_minutes=REBID_WINDOW_MINUTES, terms=False):
        """Create the auction for ``request``, invite ``partners`` and schedule it."""
        request.ensure_one()
        if request.state not in LAUNCHABLE_REQUEST_STATES:
            raise UserError(_(
                "%(request)s is %(state)s. A reverse auction is run once a request is "
                "approved and with the buyer for sourcing.",
                request=request.name,
                state=dict(request._fields['state'].selection).get(request.state, request.state)))
        running = request.auction_ids.filtered(lambda a: a.state in OPEN_STATES)
        if running:
            raise UserError(_(
                "%(request)s already has %(auction)s open. Finish or cancel it first.",
                request=request.name, auction=running[0].name))
        partners = partners.exists()
        if len(partners) < MIN_BIDDERS:
            raise UserError(_(
                "Invite at least %s vendors — with one bidder there is nobody to compete with.",
                MIN_BIDDERS))
        if not request.line_ids:
            raise UserError(_("%s has no items to put up for bidding.", request.name))
        unpriced = request.line_ids.filtered(lambda line: line.price_unit <= 0)
        if unpriced:
            raise UserError(_(
                "\"%s\" has no target price. The target is the opening price vendors bid "
                "down from, so every item needs one.", unpriced[0].product_name))
        now = fields.Datetime.now()
        start_at = fields.Datetime.to_datetime(start_at)
        if not start_at or start_at < now - timedelta(minutes=1):
            raise UserError(_("The auction cannot open in the past."))
        if start_at < now + timedelta(seconds=50):
            # At the opening time an auction with fewer than two accepted
            # vendors is cancelled, and nobody can have accepted yet.
            raise UserError(_(
                "Give the vendors at least a minute to accept the terms. Once two have "
                "accepted you can open bidding straight away."))
        duration_minutes = int(duration_minutes or 0)
        if duration_minutes <= 0:
            raise UserError(_("An auction has to run for at least a minute."))
        end_at = start_at + timedelta(minutes=duration_minutes)

        auction = self.create({
            'request_id': request.id,
            'start_date': start_at,
            'end_date': end_at,
            'original_end_date': end_at,
            'duration_minutes': duration_minutes,
            'extension_window': max(int(extension_window or 0), 0),
            'extension_minutes': max(int(extension_minutes or 0), 0),
            'min_decrement': max(float(min_decrement or 0.0), 0.0),
            'visibility': visibility if visibility in dict(VISIBILITY) else 'rank',
            'rebid_minutes': max(int(rebid_minutes or 0), 0) or REBID_WINDOW_MINUTES,
            'terms': terms or False,
            'line_ids': [fields.Command.create({
                'request_line_id': line.id,
                'sequence': line.sequence,
                'product_name': line.product_name,
                'product_qty': line.product_qty,
                'product_uom_id': line.product_uom_id.id,
                'ceiling_price': line.price_unit,
            }) for line in request.line_ids],
            'participant_ids': [fields.Command.create({
                'partner_id': partner.id,
                'user_id': self._portal_user_for(partner).id or False,
            }) for partner in partners],
        })
        auction.action_schedule()
        return auction

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def action_schedule(self):
        """Send the invitations out. Vendors accept the terms before it opens."""
        for auction in self:
            if auction.state != 'draft':
                raise UserError(_("%s has already been scheduled.", auction.name))
            if len(auction.participant_ids) < MIN_BIDDERS:
                raise UserError(_("Invite at least %s vendors before scheduling.", MIN_BIDDERS))
            if not auction.line_ids or auction.ceiling_total <= 0:
                raise UserError(_("%s has nothing priced to bid on.", auction.name))
            auction.state = 'scheduled'

            request = auction.request_id.sudo()
            previous = request.state
            request.write({
                'sourcing_method': 'auction',
                'state': 'sourcing' if request.state == 'approved' else request.state,
            })
            vendors = ", ".join(auction.participant_ids.mapped('partner_id.name'))
            request._log_history(
                _("Reverse Auction Scheduled"),
                _("%(auction)s opens %(start)s for %(minutes)s min · opening price %(ceiling)s · invited: %(vendors)s",
                  auction=auction.name, start=auction._when(auction.start_date),
                  minutes=auction.duration_minutes, ceiling=auction._money(auction.ceiling_total),
                  vendors=vendors),
                state_from=previous if previous != request.state else None,
                state_to=request.state if previous != request.state else None)
            auction.message_post(
                body=_("Invitation to bid on %(request)s: %(items)s. Bidding opens %(start)s and runs "
                       "%(minutes)s minutes from an opening price of %(ceiling)s. Accept the terms "
                       "in the supplier portal to take part.",
                       request=request.name, items=request.product_name,
                       start=auction._when(auction.start_date), minutes=auction.duration_minutes,
                       ceiling=auction._money(auction.ceiling_total)),
                partner_ids=auction._vendor_mail_partners(auction.participant_ids),
                subtype_xmlid='mail.mt_comment')
        return True

    def _go_live(self, mode='schedule'):
        self.ensure_one()
        now = fields.Datetime.now()
        accepted = self.participant_ids.filtered(lambda p: p.state == 'accepted')
        silent = self.participant_ids.filtered(lambda p: p.state == 'invited')
        accepted.write({'state': 'live'})
        silent.write({'state': 'cancelled', 'response_note': _("Did not accept before bidding opened.")})
        self.write({'state': 'live', 'start_date': min(self.start_date, now), 'start_mode': mode})
        how = {
            'ready': _(" — opened automatically, every invited vendor is ready"),
            'buyer': _(" — opened early by %s", self.env.user.name),
        }.get(mode, '')
        self._post_to_request(
            _("Reverse Auction Live"),
            _("%(auction)s is open to %(count)s vendors until %(end)s%(how)s.",
              auction=self.name, count=len(accepted), end=self._when(self.end_date), how=how))
        self.message_post(body=_(
            "Bidding is open%(how)s. %(count)s vendors competing: %(vendors)s.",
            how=how, count=len(accepted), vendors=", ".join(accepted.mapped('partner_id.name'))))

    def _open_now(self, mode):
        """Open bidding this minute, keeping the length the buyer asked for."""
        self.ensure_one()
        now = fields.Datetime.now()
        end = now + timedelta(minutes=self.duration_minutes)
        self.write({'start_date': now, 'end_date': end, 'original_end_date': end})
        self._go_live(mode)

    def _start_if_everyone_ready(self):
        """Open bidding the moment there is nobody left to wait for.

        Every invited vendor has answered, and at least two of them accepted.
        Holding the event until the scheduled time from here on would only keep
        ready bidders waiting; a vendor who declined is not coming.
        """
        for auction in self.filtered(lambda a: a.state == 'scheduled'):
            answers = auction.participant_ids.mapped('state')
            if 'invited' in answers or answers.count('accepted') < MIN_BIDDERS:
                continue
            auction._open_now('ready')
        return True

    def action_start(self):
        """Open bidding now instead of waiting for the scheduled time."""
        for auction in self:
            auction._sync_state()
            if auction.state != 'scheduled':
                raise UserError(_("%s is not waiting to open.", auction.name))
            accepted = auction.participant_ids.filtered(lambda p: p.state == 'accepted')
            if len(accepted) < MIN_BIDDERS:
                raise UserError(_(
                    "Only %(count)s vendor(s) have accepted %(auction)s. It needs at least "
                    "%(minimum)s competing bidders to open.",
                    count=len(accepted), auction=auction.name, minimum=MIN_BIDDERS))
            auction._open_now('buyer')
        return True

    def _close(self):
        self.ensure_one()
        self.write({'state': 'closed', 'closed_on': fields.Datetime.now()})
        self.participant_ids.filtered(lambda p: p.state == 'live').write({'state': 'closed'})
        self._rerank()
        leader = self.participant_ids.filtered(lambda p: p.rank == 1)[:1]
        if leader:
            note = _("%(auction)s closed after %(bids)s bids. L1: %(vendor)s at %(price)s "
                     "(%(pct)s%% below the opening price).",
                     auction=self.name, bids=self.bid_count, vendor=leader.partner_id.name,
                     price=self._money(leader.current_total), pct=round(self.savings_percent, 1))
        else:
            note = _("%s closed without a single bid. Run another round with Bid Again, or cancel it.",
                     self.name)
        self._post_to_request(_("Reverse Auction Closed"), note)
        self.message_post(body=note)

    def _cancel(self, reason):
        self.ensure_one()
        self.participant_ids.filtered(
            lambda p: p.state not in ('declined', 'cancelled')).write({'state': 'cancelled'})
        self.write({'state': 'cancelled', 'cancel_reason': reason or False})
        note = _("%(auction)s cancelled%(reason)s", auction=self.name,
                 reason=_(" — %s", reason) if reason else '')
        self._post_to_request(_("Reverse Auction Cancelled"), note)
        self.message_post(body=note)

    def action_cancel(self):
        for auction in self:
            if auction.state in ('awarded', 'cancelled'):
                raise UserError(_("%s is already %s.", auction.name,
                                  dict(AUCTION_STATES)[auction.state].lower()))
            auction._cancel(_("Cancelled by %s", self.env.user.name))
        return True

    def action_bid_again(self):
        """Reopen a closed auction for one more round — the original "Bid Again"."""
        now = fields.Datetime.now()
        for auction in self:
            auction._sync_state()
            if auction.state != 'closed':
                raise UserError(_("Only a closed auction can be reopened for another round."))
            if auction.closed_on and now > auction.closed_on + timedelta(minutes=REBID_WINDOW_MINUTES):
                raise UserError(_(
                    "%(auction)s closed more than %(minutes)s minutes ago. Another round has to "
                    "be offered within %(minutes)s minutes of closing — launch a new auction instead.",
                    auction=auction.name, minutes=REBID_WINDOW_MINUTES))
            end = now + timedelta(minutes=auction.rebid_minutes or REBID_WINDOW_MINUTES)
            auction.write({'state': 'live', 'end_date': end, 'closed_on': False})
            auction.participant_ids.filtered(lambda p: p.state == 'closed').write({'state': 'live'})
            note = _("%(auction)s reopened by %(user)s for another round, closing %(end)s.",
                     auction=auction.name, user=self.env.user.name, end=auction._when(end))
            auction._post_to_request(_("Reverse Auction Reopened"), note)
            auction.message_post(body=note)
        return True

    def action_award(self):
        """Give the business to L1 and carry the winning prices onto the request."""
        for auction in self:
            auction._sync_state()
            if auction.state != 'closed':
                raise UserError(_("%s has to close before it can be awarded.", auction.name))
            winner = auction.participant_ids.filtered(lambda p: p.rank == 1)[:1]
            if not winner:
                raise UserError(_(
                    "Nobody bid in %s, so there is no one to award it to. Run another round "
                    "with Bid Again, or cancel it.", auction.name))
            bid = winner.latest_bid_id
            request = auction.request_id.sudo()
            for bid_line in bid.line_ids:
                request_line = bid_line.auction_line_id.request_line_id
                if not request_line.exists():
                    # The portal re-posts a request's items on every save, which
                    # replaces the line records the auction was launched from.
                    # The item itself is still there: find it by name.
                    wanted = (bid_line.auction_line_id.product_name or '').casefold()
                    request_line = request.line_ids.filtered(
                        lambda line: (line.product_name or '').casefold() == wanted)[:1]
                if request_line:
                    request_line.price_unit = bid_line.unit_price
            partner = winner.partner_id
            saved = auction.ceiling_total - winner.current_total
            request.write({
                'partner_id': partner.id,
                'vendor_name': partner.name,
                'sourcing_method': 'auction',
                'savings': saved,
                'awarded_auction_id': auction.id,
            })
            winner.state = 'won'
            (auction.participant_ids - winner).filtered(
                lambda p: p.state in ('live', 'closed')).write({'state': 'lost'})
            auction.write({
                'state': 'awarded',
                'winner_id': partner.id,
                'awarded_total': winner.current_total,
                'awarded_on': fields.Datetime.now(),
                'awarded_by_id': self.env.user.id,
            })
            note = _("%(auction)s awarded to %(vendor)s at %(price)s — %(saved)s (%(pct)s%%) below "
                     "the opening price of %(ceiling)s. Items repriced at the winning bid.",
                     auction=auction.name, vendor=partner.name,
                     price=auction._money(winner.current_total), saved=auction._money(saved),
                     pct=round(100.0 * saved / auction.ceiling_total, 1) if auction.ceiling_total else 0,
                     ceiling=auction._money(auction.ceiling_total))
            auction._post_to_request(_("Reverse Auction Awarded"), note)
            request.message_post(body=note)
            auction.message_post(body=note, partner_ids=auction._vendor_mail_partners(winner),
                                  subtype_xmlid='mail.mt_comment')
        return True

    # ------------------------------------------------------------------
    # The clock
    # ------------------------------------------------------------------
    def _sync_state(self):
        """Move each auction to where the clock says it should be.

        Run by the cron every minute and by every API read, so a screen never
        shows an auction as open after it has closed just because the cron has
        not come round yet.
        """
        now = fields.Datetime.now()
        for auction in self:
            if auction.state == 'scheduled' and auction.start_date <= now:
                accepted = auction.participant_ids.filtered(lambda p: p.state == 'accepted')
                if len(accepted) < MIN_BIDDERS:
                    auction._cancel(_(
                        "only %(count)s vendor(s) had accepted by the opening time; "
                        "it needs %(minimum)s", count=len(accepted), minimum=MIN_BIDDERS))
                    continue
                auction._go_live('schedule')
            if auction.state == 'live' and auction.end_date <= now:
                auction._close()
        return True

    @api.model
    def _cron_tick(self):
        """Open and close auctions on time, and remind vendors before they open."""
        self.search([('state', 'in', ('scheduled', 'live'))])._sync_state()
        now = fields.Datetime.now()
        due = self.search([
            ('state', '=', 'scheduled'),
            ('reminder_sent', '=', False),
            ('start_date', '>', now),
            ('start_date', '<=', now + timedelta(minutes=REMINDER_MINUTES)),
        ])
        for auction in due:
            waiting = auction.participant_ids.filtered(lambda p: p.state in ('invited', 'accepted'))
            auction.message_post(
                body=_("%(auction)s opens at %(start)s. Accept the terms before then to take part.",
                       auction=auction.name, start=auction._when(auction.start_date)),
                partner_ids=auction._vendor_mail_partners(waiting), subtype_xmlid='mail.mt_comment')
            auction.reminder_sent = True

    # ------------------------------------------------------------------
    # Bidding
    # ------------------------------------------------------------------
    def _place_bid(self, participant, prices, on_behalf=False, note=False):
        """Record one bid and re-rank everybody.

        :param prices: ``{auction line id: unit price}`` — every item priced.
        :param on_behalf: the buyer is keying in a bid the vendor gave by phone
            or email (a surrogate bid). It is logged under the buyer's name.
        """
        self.ensure_one()
        auction = self.sudo()
        # One bid at a time per auction: two bids landing together must not
        # both read the old ranking, or both extend the close.
        self.env.cr.execute('SELECT id FROM smartspend_auction WHERE id = %s FOR UPDATE', (auction.id,))
        self.env.invalidate_all()
        auction._sync_state()
        if auction.state != 'live':
            raise UserError(_("%(auction)s is %(state)s — it is not taking bids.",
                              auction=auction.name,
                              state=dict(AUCTION_STATES)[auction.state].lower()))
        now = fields.Datetime.now()
        if now >= auction.end_date:
            raise UserError(_("Bidding on %s has closed.", auction.name))
        participant = participant.sudo()
        if participant.auction_id != auction or participant.state != 'live':
            raise UserError(_("%(vendor)s is not bidding in %(auction)s.",
                              vendor=participant.partner_id.name, auction=auction.name))

        currency = auction.currency_id
        line_prices = {}
        for line in auction.line_ids:
            raw = prices.get(line.id, prices.get(str(line.id)))
            try:
                price = float(raw)
            except (TypeError, ValueError):
                raise UserError(_("Put a price on \"%s\".", line.product_name))
            if price <= 0:
                raise UserError(_("\"%s\" needs a price above zero.", line.product_name))
            line_prices[line] = currency.round(price)
        total = currency.round(sum(line.product_qty * price for line, price in line_prices.items()))

        if currency.compare_amounts(total, auction.ceiling_total) > 0:
            raise UserError(_(
                "A bid of %(bid)s is above the opening price of %(ceiling)s.",
                bid=auction._money(total), ceiling=auction._money(auction.ceiling_total)))
        previous = participant.current_total
        if previous:
            ceiling = previous - (auction.min_decrement or 0.0)
            too_high = (currency.compare_amounts(total, ceiling) > 0 if auction.min_decrement
                        else currency.compare_amounts(total, previous) >= 0)
            if too_high:
                if auction.min_decrement:
                    raise UserError(_(
                        "Your last bid was %(previous)s. The next one has to be at least "
                        "%(step)s lower — %(max)s or less.",
                        previous=auction._money(previous), step=auction._money(auction.min_decrement),
                        max=auction._money(ceiling)))
                raise UserError(_("Your last bid was %s. A new bid has to be lower.",
                                  auction._money(previous)))

        # Anti-sniping, as the original: a bid inside the window pushes the close out.
        extended_by = 0
        remaining = auction.end_date - now
        if auction.extension_window and remaining < timedelta(minutes=auction.extension_window):
            extended_by = auction.extension_minutes
        leader_before = auction.leader_id

        bid = self.env['smartspend.auction.bid'].sudo().create({
            'auction_id': auction.id,
            'participant_id': participant.id,
            'total': total,
            'placed_on': now,
            'placed_by_id': self.env.user.id,
            'on_behalf': bool(on_behalf),
            'extended_by': extended_by,
            'seconds_left': int(remaining.total_seconds()),
            'note': note or False,
            'line_ids': [fields.Command.create({
                'auction_line_id': line.id,
                'unit_price': price,
            }) for line, price in line_prices.items()],
        })
        participant.write({
            'current_total': total,
            'improved_on': now,
            'first_bid_on': participant.first_bid_on or now,
        })
        auction._rerank()
        bid.rank_after = participant.rank
        if extended_by:
            new_end = auction.end_date + timedelta(minutes=extended_by)
            auction.write({'end_date': new_end, 'extension_count': auction.extension_count + 1})
            auction.message_post(body=_(
                "Time extended: a bid with %(left)s left added %(minutes)s min to the clock, "
                "to %(end)s.",
                left=_("%(m)s:%(s)02d", m=int(remaining.total_seconds()) // 60,
                       s=int(remaining.total_seconds()) % 60),
                minutes=extended_by, end=auction._when(new_end)))
        if auction.leader_id != leader_before:
            auction.message_post(body=_(
                "New leader: %(vendor)s at %(price)s%(proxy)s.",
                vendor=auction.leader_id.name, price=auction._money(auction.best_total),
                proxy=_(" (entered by %s on the vendor's behalf)", self.env.user.name) if on_behalf else ''))
        return bid

    # ------------------------------------------------------------------
    # Portal (REST API) serialisation
    # ------------------------------------------------------------------
    def _portal_common(self):
        self.ensure_one()
        request = self.request_id.sudo()
        return {
            'id': self.name,
            'requestId': request.name,
            'title': request.product_name or '',
            'itemCount': len(self.line_ids),
            'location': request.location or '',
            'neededBy': request.delivery_date.strftime('%b %d, %Y') if request.delivery_date else '',
            'state': self.state,
            'stateLabel': dict(AUCTION_STATES)[self.state],
            'startAt': iso_utc(self.start_date),
            'endAt': iso_utc(self.end_date),
            'originalEndAt': iso_utc(self.original_end_date),
            'closedAt': iso_utc(self.closed_on),
            'serverNow': iso_utc(fields.Datetime.now()),
            'durationMinutes': self.duration_minutes,
            'openedBy': self.start_mode or '',
            'extensionWindow': self.extension_window,
            'extensionMinutes': self.extension_minutes,
            'extensionCount': self.extension_count,
            'minDecrement': self.min_decrement,
            'visibility': self.visibility,
            'rebidMinutes': self.rebid_minutes,
            'terms': self.terms or '',
            'ceiling': self.ceiling_total,
            'lines': [{
                'id': line.id,
                'productName': line.product_name,
                'qty': line.product_qty,
                'uom': line.product_uom_id.name or '',
                'ceilingPrice': line.ceiling_price,
                'ceilingSubtotal': line.ceiling_subtotal,
            } for line in self.line_ids],
        }

    def _to_buyer_dict(self):
        """Everything, for the buyer running the event."""
        self.ensure_one()
        rebid_until = (self.closed_on + timedelta(minutes=REBID_WINDOW_MINUTES)
                       if self.state == 'closed' and self.closed_on else False)
        data = self._portal_common()
        data.update({
            'buyer': self.buyer_id.name,
            'bestTotal': self.best_total,
            'leader': self.leader_id.name or '',
            'savings': self.savings_amount,
            'savingsPct': round(self.savings_percent, 2),
            'bidCount': self.bid_count,
            'acceptedCount': self.accepted_count,
            'winner': self.winner_id.name or '',
            'awardedTotal': self.awarded_total,
            'awardedAt': iso_utc(self.awarded_on),
            'awardedBy': self.awarded_by_id.name or '',
            'cancelReason': self.cancel_reason or '',
            'rebidUntil': iso_utc(rebid_until),
            'participants': [{
                'id': participant.id,
                'vendorId': participant.partner_id.id,
                'vendor': participant.partner_id.name,
                'hasLogin': bool(participant.user_id),
                'login': participant.user_id.login or '',
                'state': participant.state,
                'stateLabel': dict(PARTICIPANT_STATES)[participant.state],
                'total': participant.current_total,
                'rank': participant.rank,
                'bidCount': participant.bid_count,
                'lastBidAt': iso_utc(participant.improved_on),
                'respondedAt': iso_utc(participant.responded_on),
                'note': participant.response_note or '',
            } for participant in self.participant_ids.sorted(
                lambda p: (p.rank or 999, p.partner_id.name or ''))],
            'bids': [{
                'id': bid.id,
                'vendorId': bid.partner_id.id,
                'vendor': bid.partner_id.name,
                'total': bid.total,
                'at': iso_utc(bid.placed_on),
                'rankAfter': bid.rank_after,
                'onBehalf': bid.on_behalf,
                'placedBy': bid.placed_by_id.name or '',
                'extendedBy': bid.extended_by,
                'secondsLeft': bid.seconds_left,
            } for bid in self.bid_ids.sorted(lambda b: (b.placed_on, b.id))],
        })
        return data

    def _to_vendor_dict(self, participant):
        """What one supplier may know: their own standing, never a rival's name."""
        self.ensure_one()
        data = self._portal_common()
        # Internal reference of the requisition means nothing to a supplier.
        data.pop('requestId', None)
        live_or_done = self.state in ('live', 'closed', 'awarded')
        latest = participant.latest_bid_id
        competing = self.participant_ids.filtered(
            lambda p: p.state in ('accepted', 'live', 'closed', 'won', 'lost'))
        next_max = False
        if participant.current_total:
            next_max = participant.current_total - (self.min_decrement or 0.0)
        data.update({
            'buyer': self.buyer_id.name,
            'competitors': max(len(competing) - (1 if participant in competing else 0), 0),
            'leaderTotal': self.best_total if (self.visibility == 'leader' and live_or_done) else None,
            'nextMaxBid': next_max if next_max is not False else self.ceiling_total,
            'me': {
                'participantId': participant.id,
                'vendor': participant.partner_id.name,
                'state': participant.state,
                'stateLabel': dict(PARTICIPANT_STATES)[participant.state],
                'total': participant.current_total,
                'rank': participant.rank if live_or_done else 0,
                'bidCount': participant.bid_count,
                'lastBidAt': iso_utc(participant.improved_on),
                'prices': {str(line.auction_line_id.id): line.unit_price for line in latest.line_ids},
            },
            'myBids': [{
                'total': bid.total,
                'at': iso_utc(bid.placed_on),
                'rankAfter': bid.rank_after,
                'extendedBy': bid.extended_by,
            } for bid in participant.bid_ids.sorted(lambda b: (b.placed_on, b.id))],
            'outcome': participant.state if participant.state in ('won', 'lost') else '',
        })
        return data

    # ------------------------------------------------------------------
    # Smart buttons
    # ------------------------------------------------------------------
    def action_view_request(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'smartspend.request',
            'view_mode': 'form',
            'res_id': self.request_id.id,
        }

    def action_view_bids(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Bids in %s', self.name),
            'res_model': 'smartspend.auction.bid',
            'view_mode': 'list,graph,pivot',
            'domain': [('auction_id', '=', self.id)],
            'context': {'search_default_group_vendor': 0},
        }

    # ------------------------------------------------------------------
    # Demo data
    # ------------------------------------------------------------------
    @api.model
    def _link_demo_vendor_accounts(self):
        """Put each demo supplier login under the supplier company it bids for.

        Idempotent, and run from the data file on every install and upgrade, so
        the seeded accounts line up with suppliers that may have been created
        by the demo seeder rather than by a data file.
        """
        Partner = self.env['res.partner'].sudo()
        Users = self.env['res.users'].sudo().with_context(active_test=False)
        for xmlid, spec in DEMO_VENDOR_ACCOUNTS.items():
            supplier, person, job = spec['supplier'], spec['person'], spec['job']
            user = self.env.ref(xmlid, raise_if_not_found=False)
            if not user:
                continue
            user = user.sudo()
            if user.name in spec['seeded']['names']:
                user.name = person
            # Sign in under the company's name. The password moves with the
            # login, and only from the login the account was seeded with.
            if (user.login in spec['seeded']['logins']
                    and not Users.search_count([('login', '=', spec['login'])])):
                user.write({'login': spec['login'], 'password': spec['password']})
            company = Partner.search([('name', '=ilike', supplier), ('is_company', '=', True)], limit=1)
            if not company:
                company = Partner.create({'name': supplier, 'is_company': True, 'supplier_rank': 1})
            elif not company.supplier_rank:
                company.supplier_rank = 1
            contact = user.partner_id
            if contact.parent_id != company:
                contact.parent_id = company
            if not contact.function:
                contact.function = job
        return True


class SmartspendAuctionLine(models.Model):
    _name = 'smartspend.auction.line'
    _description = 'SmartSpend Reverse Auction Item'
    _order = 'auction_id, sequence, id'

    auction_id = fields.Many2one('smartspend.auction', required=True, ondelete='cascade', index=True)
    request_line_id = fields.Many2one(
        'smartspend.request.line', string='Request Line', ondelete='set null')
    sequence = fields.Integer(default=10)
    product_name = fields.Char(string='Product', required=True)
    product_qty = fields.Float(string='Quantity', required=True, digits='Product Unit')
    product_uom_id = fields.Many2one('uom.uom', string='Unit')
    ceiling_price = fields.Monetary(
        string='Opening Unit Price', help="The request's target price for this item.")
    ceiling_subtotal = fields.Monetary(compute='_compute_ceiling_subtotal', store=True)
    currency_id = fields.Many2one(related='auction_id.currency_id')

    @api.depends('product_qty', 'ceiling_price')
    def _compute_ceiling_subtotal(self):
        for line in self:
            line.ceiling_subtotal = line.product_qty * line.ceiling_price


class SmartspendAuctionParticipant(models.Model):
    """One invited vendor — the original module's ``bid.request``."""
    _name = 'smartspend.auction.participant'
    _description = 'SmartSpend Reverse Auction Vendor'
    _order = 'auction_id, rank, id'
    _rec_name = 'partner_id'

    auction_id = fields.Many2one('smartspend.auction', required=True, ondelete='cascade', index=True)
    partner_id = fields.Many2one('res.partner', string='Vendor', required=True, index=True)
    user_id = fields.Many2one(
        'res.users', string='Portal Login',
        help="The supplier account that bids. Empty when the vendor has no login: "
             "the buyer then accepts and bids on their behalf.")
    state = fields.Selection(PARTICIPANT_STATES, default='invited', required=True, index=True)
    responded_on = fields.Datetime(readonly=True)
    response_note = fields.Char(string='Note')
    current_total = fields.Monetary(string='Current Bid', readonly=True)
    rank = fields.Integer(readonly=True, help="1 is the lowest bid (L1).")
    improved_on = fields.Datetime(
        string='Last Bid At', readonly=True,
        help="When the current bid was placed. Settles a tie: whoever got there first ranks higher.")
    first_bid_on = fields.Datetime(readonly=True)
    bid_ids = fields.One2many('smartspend.auction.bid', 'participant_id', string='Bids')
    bid_count = fields.Integer(compute='_compute_bid_stats')
    latest_bid_id = fields.Many2one('smartspend.auction.bid', compute='_compute_bid_stats')
    savings_percent = fields.Float(
        string='Below Opening (%)', compute='_compute_bid_stats', digits=(16, 1))
    currency_id = fields.Many2one(related='auction_id.currency_id')

    _vendor_once = models.Constraint(
        'UNIQUE(auction_id, partner_id)',
        'A vendor can only be invited to an auction once.',
    )

    @api.depends('bid_ids', 'current_total', 'auction_id.ceiling_total')
    def _compute_bid_stats(self):
        for participant in self:
            bids = participant.bid_ids.sorted(lambda b: (b.placed_on, b.id))
            participant.bid_count = len(bids)
            participant.latest_bid_id = bids[-1:] if bids else False
            ceiling = participant.auction_id.ceiling_total
            participant.savings_percent = (
                100.0 * (ceiling - participant.current_total) / ceiling
                if participant.current_total and ceiling else 0.0)

    def _respond(self, accept, note=False):
        """Accept or decline the invitation — the original Accept / Reject."""
        for participant in self:
            auction = participant.auction_id
            auction._sync_state()
            if auction.state != 'scheduled':
                raise UserError(_(
                    "%s has already opened, closed or been cancelled — the invitation can no "
                    "longer be answered.", auction.name))
            if accept and participant.state not in ('invited', 'declined'):
                raise UserError(_("%s has already accepted.", participant.partner_id.name))
            if not accept and participant.state not in ('invited', 'accepted'):
                raise UserError(_("%s has already declined.", participant.partner_id.name))
            participant.write({
                'state': 'accepted' if accept else 'declined',
                'responded_on': fields.Datetime.now(),
                'response_note': note or False,
            })
            proxy = ''
            if participant.user_id != self.env.user:
                proxy = _(" (recorded by %s)", self.env.user.name)
            auction.message_post(body=_(
                "%(vendor)s %(verb)s the invitation%(proxy)s%(note)s",
                vendor=participant.partner_id.name,
                verb=_("accepted") if accept else _("declined"),
                proxy=proxy, note=_(": %s", note) if note else '.'))
        self.auction_id._start_if_everyone_ready()
        return True

    def action_accept(self):
        return self._respond(True)

    def action_decline(self):
        return self._respond(False)


class SmartspendAuctionBid(models.Model):
    """Every price a vendor put in — the original ``bid.price.history``.

    Read-only to everybody: a bid is only ever created by the bidding call,
    which validates it, and nothing edits or deletes one afterwards.
    """
    _name = 'smartspend.auction.bid'
    _description = 'SmartSpend Reverse Auction Bid'
    _order = 'placed_on desc, id desc'
    _rec_name = 'partner_id'

    auction_id = fields.Many2one('smartspend.auction', required=True, ondelete='cascade', index=True)
    participant_id = fields.Many2one(
        'smartspend.auction.participant', required=True, ondelete='cascade', index=True)
    partner_id = fields.Many2one(
        related='participant_id.partner_id', store=True, string='Vendor', index=True)
    total = fields.Monetary(string='Bid Total', aggregator='min', required=True)
    placed_on = fields.Datetime(string='Placed At', required=True, default=fields.Datetime.now, index=True)
    placed_by_id = fields.Many2one('res.users', string='Entered By', required=True,
                                   default=lambda self: self.env.user)
    on_behalf = fields.Boolean(
        string='Surrogate Bid',
        help="Keyed in by the buyer for a vendor who quoted by phone or email.")
    rank_after = fields.Integer(string='Rank After', aggregator=None)
    extended_by = fields.Integer(
        string='Time Extension Added (min)', aggregator='sum',
        help="Minutes this bid added to the close under the time-extension rule.")
    seconds_left = fields.Integer(string='Seconds Left', aggregator=None)
    note = fields.Char()
    line_ids = fields.One2many('smartspend.auction.bid.line', 'bid_id', string='Prices')
    currency_id = fields.Many2one(related='auction_id.currency_id')
    company_id = fields.Many2one(related='auction_id.company_id', store=True)


class SmartspendAuctionBidLine(models.Model):
    _name = 'smartspend.auction.bid.line'
    _description = 'SmartSpend Reverse Auction Bid Price'
    _order = 'bid_id, id'

    bid_id = fields.Many2one('smartspend.auction.bid', required=True, ondelete='cascade', index=True)
    auction_line_id = fields.Many2one('smartspend.auction.line', required=True, ondelete='cascade')
    product_name = fields.Char(related='auction_line_id.product_name')
    product_qty = fields.Float(related='auction_line_id.product_qty')
    unit_price = fields.Monetary(required=True)
    subtotal = fields.Monetary(compute='_compute_subtotal', store=True)
    currency_id = fields.Many2one(related='bid_id.currency_id')

    @api.depends('unit_price', 'auction_line_id.product_qty')
    def _compute_subtotal(self):
        for line in self:
            line.subtotal = line.unit_price * line.auction_line_id.product_qty
