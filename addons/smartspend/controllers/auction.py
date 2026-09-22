"""Reverse-auction API for the SmartSpend portal.

Two audiences, one set of records:

* the SCM buyer runs the event — launches it from a request, opens it, awards
  it — and sees every vendor, every bid and every price;
* a supplier sees only their own invitation: their bids, their rank and, when
  the buyer allows it, the leading price. Never a rival's name or price.

A supplier holds no rights on the auction models at all. Every vendor call
below reads with elevated rights, scoped to the participant rows that belong to
the signed-in account, and returns the vendor-shaped payload — so what a
vendor can learn is decided here, in one place, and not by record rules that a
related field could walk around.
"""
from datetime import timedelta

from odoo import _, fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from .main import _authenticate, _error, _refused


def _is_buyer(user):
    return user.has_group('smartspend.group_smartspend_buyer')


def _is_vendor(user):
    return (user.has_group('smartspend.group_smartspend_vendor')
            and not _is_buyer(user)
            and not user.has_group('smartspend.group_smartspend_manager'))


def _my_participants(user):
    """The invitations the signed-in supplier answers for."""
    return request.env['smartspend.auction.participant'].sudo().search([
        '|', ('user_id', '=', user.id),
        ('partner_id', '=', user.partner_id.commercial_partner_id.id),
    ])


def _find_auction(reference):
    reference = (reference or '').strip()
    if not reference:
        return request.env['smartspend.auction']
    return request.env['smartspend.auction'].sudo().search([('name', '=', reference)], limit=1)


def _envelope(auction, user):
    """The auction as this user may see it, plus the request the buyer changed."""
    if _is_buyer(user):
        return {
            'auction': auction._to_buyer_dict(),
            # Launching, awarding and cancelling all move the request; the
            # portal swaps in this copy the way it does after any other action.
            'request': auction.request_id.with_user(user)._to_portal_dict(),
        }
    participant = _my_participants(user).filtered(lambda p: p.auction_id == auction)[:1]
    return {'auction': auction._to_vendor_dict(participant)}


class SmartSpendAuctionApi(http.Controller):

    @http.route('/api/smartspend/auctions', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=False)
    def list_auctions(self, **kwargs):
        """Buyer: every auction, newest first. Vendor: the ones they were invited to."""
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if _is_buyer(user):
            # Searched as the buyer, so the company rule applies; read with
            # elevated rights, since the payload names the vendors' logins.
            auctions = request.env['smartspend.auction'].search([]).sudo()
            auctions.filtered(lambda a: a.state in ('scheduled', 'live'))._sync_state()
            return [auction._to_buyer_dict() for auction in auctions]
        if _is_vendor(user):
            mine = _my_participants(user)
            mine.auction_id.filtered(lambda a: a.state in ('scheduled', 'live'))._sync_state()
            return [participant.auction_id._to_vendor_dict(participant)
                    for participant in mine.sorted(lambda p: p.auction_id.start_date, reverse=True)]
        return _error(_("Reverse auctions are run by the sourcing desk and its invited vendors."), 403)

    @http.route('/api/smartspend/auctions/<string:reference>', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=False)
    def get_auction(self, reference=None, **kwargs):
        """One auction, as the caller may see it. Polled by the live screens."""
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        auction = _find_auction(reference)
        if not auction:
            return _error(_("No reverse auction named %s.", reference or '—'), 404)
        if not _is_buyer(user) and not (
                _is_vendor(user) and _my_participants(user).filtered(lambda p: p.auction_id == auction)):
            return _error(_("You were not invited to %s.", auction.name), 403)
        auction._sync_state()
        return _envelope(auction, user)

    @http.route('/api/smartspend/auctions/launch', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def launch_auction(self, requestId=None, vendorIds=None, startInMinutes=None,
                       durationMinutes=None, extensionWindow=2, extensionMinutes=2,
                       minDecrement=0, visibility='rank', rebidMinutes=15, terms=None, **kwargs):
        """Put a request up for auction and send the invitations."""
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if not _is_buyer(user):
            return _error(_("Only an SCM buyer can launch a reverse auction."), 403)
        reference = (requestId or '').strip()
        record = request.env['smartspend.request'].search([('name', '=', reference)], limit=1)
        if not record:
            return _error(_("No purchase request named %s.", reference or '—'), 404)
        try:
            ids = [int(vendor_id) for vendor_id in (vendorIds or [])]
            start_in = max(float(startInMinutes if startInMinutes is not None else 5), 0.0)
            duration = int(durationMinutes or 10)
        except (TypeError, ValueError):
            return _error(_("Vendors, start and duration have to be numbers."), 400)
        partners = request.env['res.partner'].browse(ids).exists()
        try:
            auction = request.env['smartspend.auction']._launch_for_request(
                record, partners,
                start_at=fields.Datetime.now() + timedelta(minutes=start_in),
                duration_minutes=duration,
                extension_window=extensionWindow,
                extension_minutes=extensionMinutes,
                min_decrement=minDecrement,
                visibility=visibility,
                rebid_minutes=rebidMinutes,
                terms=(terms or '').strip() or False,
            )
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _envelope(auction, user)

    @http.route('/api/smartspend/auctions/<string:reference>/action', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def auction_action(self, reference=None, action=None, **kwargs):
        """The buyer's controls: start, award, bid_again, cancel."""
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if not _is_buyer(user):
            return _error(_("Only the SCM buyer runs the auction."), 403)
        auction = request.env['smartspend.auction'].search([('name', '=', (reference or '').strip())], limit=1)
        if not auction:
            return _error(_("No reverse auction named %s.", reference or '—'), 404)
        handlers = {
            'start': auction.action_start,
            'award': auction.action_award,
            'bid_again': auction.action_bid_again,
            'cancel': auction.action_cancel,
        }
        handler = handlers.get((action or '').strip().lower())
        if not handler:
            return _error(_("Action must be one of: %s.", ", ".join(handlers)), 400)
        try:
            handler()
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _envelope(auction.sudo(), user)

    @http.route('/api/smartspend/auctions/<string:reference>/respond', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def respond(self, reference=None, accept=None, note=None, participantId=None, **kwargs):
        """Accept or decline the invitation.

        A vendor answers for themselves. The buyer may answer for a vendor
        (``participantId``) who replied by phone or email — logged as such.
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        auction = _find_auction(reference)
        if not auction:
            return _error(_("No reverse auction named %s.", reference or '—'), 404)
        participant = self._participant_for(user, auction, participantId)
        if isinstance(participant, http.Response):
            return participant
        try:
            participant.with_user(user).sudo()._respond(bool(accept), (note or '').strip() or False)
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _envelope(auction, user)

    @http.route('/api/smartspend/auctions/<string:reference>/bid', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def place_bid(self, reference=None, prices=None, participantId=None, note=None, **kwargs):
        """Place one bid: a unit price for every item.

        :param prices: ``{"<line id>": unit price, …}``
        :param participantId: buyer only — a surrogate bid for that vendor.
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        auction = _find_auction(reference)
        if not auction:
            return _error(_("No reverse auction named %s.", reference or '—'), 404)
        if not isinstance(prices, dict) or not prices:
            return _error(_("Send a price for every item."), 400)
        participant = self._participant_for(user, auction, participantId)
        if isinstance(participant, http.Response):
            return participant
        try:
            auction.with_user(user)._place_bid(
                participant, prices, on_behalf=_is_buyer(user),
                note=(note or '').strip() or False)
        except (UserError, ValidationError, AccessError) as exc:
            return _refused(exc)
        return _envelope(auction, user)

    # ------------------------------------------------------------------
    def _participant_for(self, user, auction, participant_id):
        """Whose invitation this call acts on — or the error response to send."""
        if _is_buyer(user):
            try:
                wanted = int(participant_id or 0)
            except (TypeError, ValueError):
                wanted = 0
            participant = auction.participant_ids.filtered(lambda p: p.id == wanted)
            if not participant:
                return _error(_("Say which vendor you are acting for."), 400)
            return participant
        if _is_vendor(user):
            participant = _my_participants(user).filtered(lambda p: p.auction_id == auction)[:1]
            if not participant:
                return _error(_("You were not invited to %s.", auction.name), 403)
            return participant
        return _error(_("Only an invited vendor or the SCM buyer can do that."), 403)
