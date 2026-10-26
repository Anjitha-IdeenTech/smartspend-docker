"""Splitting a reverse auction's award between bid levels.

Once bidding closes the procurement manager may approve more than one level —
"L1 60%, L2 40%" — to spread the supply. The share is a share of the order's
value: each vendor gets the quantities whose value, at their own bid prices,
makes up their share of the total. For each item the quantity is divided in
proportion to share ÷ price, rounded to whole units with the remainder going
to the largest fractions, so the shares hold item by item and overall.

The manager's reason is required on every approval, split or not.

Awarding a split approval reprices the request at the blended price, and
raising the purchase order raises one order per vendor with their own
quantities and prices. Each vendor then sees only their part of the order and
confirms it themselves; the request counts as acknowledged once every vendor
has confirmed. A single-vendor award keeps working exactly as before.
"""
import math
from datetime import datetime

from odoo import _, api, fields, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare


class SmartspendAuctionAwardShare(models.Model):
    _name = 'smartspend.auction.award.share'
    _description = 'Reverse Auction Award Share'
    _order = 'share_percent desc, rank, id'

    auction_id = fields.Many2one('smartspend.auction', required=True, ondelete='cascade', index=True)
    participant_id = fields.Many2one('smartspend.auction.participant', string='Bidder', required=True, ondelete='cascade')
    partner_id = fields.Many2one(related='participant_id.partner_id', string='Vendor', store=True)
    rank = fields.Integer(string='Level')
    share_percent = fields.Float(string='Share (%)', digits=(16, 2))
    amount = fields.Monetary(string='Value')
    currency_id = fields.Many2one(related='auction_id.currency_id')
    line_ids = fields.One2many('smartspend.auction.award.share.line', 'share_id', string='Quantities')


class SmartspendAuctionAwardShareLine(models.Model):
    _name = 'smartspend.auction.award.share.line'
    _description = 'Reverse Auction Award Share Quantity'
    _order = 'id'
    _rec_name = 'display_label'

    display_label = fields.Char(compute='_compute_display_label')

    @api.depends('product_name', 'quantity')
    def _compute_display_label(self):
        for line in self:
            line.display_label = f"{line.quantity:g} × {line.product_name}"

    share_id = fields.Many2one('smartspend.auction.award.share', required=True, ondelete='cascade', index=True)
    auction_line_id = fields.Many2one('smartspend.auction.line', ondelete='cascade')
    product_name = fields.Char(string='Product', required=True)
    quantity = fields.Float(string='Quantity', digits='Product Unit')
    unit_price = fields.Monetary(string='Unit Price')
    subtotal = fields.Monetary(compute='_compute_subtotal', store=True)
    currency_id = fields.Many2one(related='share_id.currency_id')

    @api.depends('quantity', 'unit_price')
    def _compute_subtotal(self):
        for line in self:
            line.subtotal = line.quantity * line.unit_price


class SmartspendAuction(models.Model):
    _inherit = 'smartspend.auction'

    award_share_ids = fields.One2many(
        'smartspend.auction.award.share', 'auction_id', string='Award Split', readonly=True, copy=False)
    is_split = fields.Boolean(string='Split Award', compute='_compute_is_split')

    @api.depends('award_share_ids')
    def _compute_is_split(self):
        for auction in self:
            auction.is_split = len(auction.award_share_ids) > 1

    # ------------------------------------------------------------------
    # Working out the split
    # ------------------------------------------------------------------
    def _read_shares(self, shares):
        """``[{'participantId', 'percent'}]`` → ``[(participant, percent)]``, checked."""
        self.ensure_one()
        chosen, seen = [], set()
        for share in shares or []:
            try:
                percent = float((share or {}).get('percent') or 0)
            except (TypeError, ValueError):
                raise UserError(_("Shares have to be percentages."))
            if percent <= 0:
                continue
            if not share.get('participantId'):
                raise UserError(_("Each share needs the bidder it is for."))
            participant = self._bidder(share.get('participantId'))
            if participant.id in seen:
                raise UserError(_("%s is listed twice.", participant.partner_id.name))
            seen.add(participant.id)
            chosen.append((participant, percent))
        if not chosen:
            raise UserError(_("Choose at least one level to award."))
        total = sum(percent for _p, percent in chosen)
        if float_compare(total, 100.0, precision_digits=2):
            raise UserError(_("The shares add up to %s%% — they have to make 100%%.", f"{total:g}"))
        return chosen

    def _allocate_shares(self, chosen):
        """Divide every item between the chosen bidders by value share.

        :param chosen: ``[(participant, percent)]``
        :return: ``{participant: [(auction line, quantity, unit price)]}``
        """
        self.ensure_one()
        prices = {}
        for participant, _percent in chosen:
            bid = participant.latest_bid_id
            prices[participant] = {line.auction_line_id.id: line.unit_price for line in bid.line_ids}
        allocation = {participant: [] for participant, _percent in chosen}
        for line in self.line_ids:
            weights = []
            for participant, percent in chosen:
                price = prices[participant].get(line.id) or 0.0
                if price <= 0:
                    raise UserError(_("%(vendor)s has no price for %(item)s.",
                                      vendor=participant.partner_id.name, item=line.product_name))
                weights.append(percent / price)
            quantity = line.product_qty
            raw = [quantity * w / sum(weights) for w in weights]
            if float(quantity).is_integer():
                # Whole units: round down, then hand the units left over to
                # the largest fractions.
                parts = [math.floor(r) for r in raw]
                left = int(round(quantity - sum(parts)))
                for index in sorted(range(len(raw)), key=lambda i: (parts[i] - raw[i], -chosen[i][1]))[:left]:
                    parts[index] += 1
            else:
                parts = [round(r, 2) for r in raw]
                parts[0] = round(quantity - sum(parts[1:]), 2)
            for (participant, _percent), part in zip(chosen, parts):
                if part > 0:
                    allocation[participant].append((line, part, prices[participant][line.id]))
        empty = [participant.partner_id.name for participant, lines in allocation.items() if not lines]
        if empty:
            raise UserError(_(
                "The order is too small to split this way: %s would get nothing. "
                "Give them a bigger share, or award fewer levels.", ', '.join(empty)))
        return allocation

    def _split_preview(self, shares):
        """What a split would hand each vendor — nothing is saved.

        :return: ``[{'participantId', 'vendor', 'rank', 'percent', 'amount',
            'actualPercent', 'items': [{'productName', 'qty', 'price'}]}]``
        """
        self.ensure_one()
        chosen = self._read_shares(shares)
        allocation = self._allocate_shares(chosen)
        total = sum(qty * price for lines in allocation.values() for _l, qty, price in lines) or 1.0
        rows = []
        for participant, percent in chosen:
            amount = sum(qty * price for _l, qty, price in allocation[participant])
            rows.append({
                'participantId': participant.id,
                'vendor': participant.partner_id.name,
                'rank': participant.rank,
                'percent': percent,
                'amount': amount,
                'actualPercent': round(100.0 * amount / total, 1),
                'items': [{'productName': line.product_name, 'qty': qty, 'price': price}
                          for line, qty, price in allocation[participant]],
            })
        return rows

    # ------------------------------------------------------------------
    # Approval, award, another round
    # ------------------------------------------------------------------
    def action_approve_award(self, participant=None, note=None, shares=None):
        """Approve one level — or several, each with its share of the value.

        :param shares: ``[{'participantId', 'percent'}]``; more than one entry
            splits the award. The reason (``note``) is required either way.
        """
        if not (note or '').strip():
            raise UserError(_("Give the reason for this approval — it is required."))
        chosen_shares = [s for s in (shares or []) if float((s or {}).get('percent') or 0) > 0]
        if len(chosen_shares) <= 1:
            if chosen_shares:
                participant = chosen_shares[0].get('participantId') or participant
            self.award_share_ids.unlink()
            return super().action_approve_award(participant=participant, note=note)
        if not (self.env.su or self.env.user.has_group('smartspend.group_smartspend_manager')):
            raise UserError(_("Only a procurement manager approves which vendor is awarded."))
        note = note.strip()
        for auction in self:
            auction._sync_state()
            if auction.state != 'closed':
                raise UserError(_("%s has to close before its award can be approved.", auction.name))
            chosen = auction._read_shares(chosen_shares)
            allocation = auction._allocate_shares(chosen)
            leader = auction._bidder(None)
            primary = max(chosen, key=lambda pair: (pair[1], -pair[0].rank))[0]
            auction.award_share_ids.unlink()
            total = 0.0
            for participant, percent in chosen:
                lines = allocation[participant]
                amount = sum(qty * price for _l, qty, price in lines)
                total += amount
                self.env['smartspend.auction.award.share'].create({
                    'auction_id': auction.id,
                    'participant_id': participant.id,
                    'rank': participant.rank,
                    'share_percent': percent,
                    'amount': amount,
                    'line_ids': [fields.Command.create({
                        'auction_line_id': line.id, 'product_name': line.product_name,
                        'quantity': qty, 'unit_price': price,
                    }) for line, qty, price in lines],
                })
            previous = auction.approved_participant_id
            auction.write({
                'approved_participant_id': primary.id,
                'approved_rank': primary.rank,
                'approved_total': total,
                'approval_note': note,
                'approved_by_id': self.env.user.id,
                'approved_on': fields.Datetime.now(),
            })
            split = '; '.join(
                self.env._("%(vendor)s (L%(rank)s) %(pct)s%% — %(amount)s",
                  vendor=share.partner_id.name, rank=share.rank, pct=f"{share.share_percent:g}",
                  amount=auction._money(share.amount))
                for share in auction.award_share_ids)
            text = _("%(manager)s approved splitting %(auction)s between %(count)s vendors: %(split)s. "
                     "Total %(total)s", manager=self.env.user.name, auction=auction.name,
                     count=len(chosen), split=split, total=auction._money(total))
            if float_compare(total, leader.current_total, precision_digits=2) > 0:
                text += ' ' + _("(%(gap)s more than all to L1 %(leader)s).",
                                gap=auction._money(total - leader.current_total), leader=leader.partner_id.name)
            else:
                text += '.'
            if previous:
                text += ' ' + _("Replaces the earlier approval.")
            text += ' ' + _("Reason: %s", note)
            auction._post_to_request(_("Award Approved"), text)
            auction.message_post(body=text, partner_ids=auction.buyer_id.partner_id.ids,
                                 subtype_xmlid='mail.mt_comment')
        return True

    def action_bid_again(self):
        # A new round makes the approved split meaningless, as the level.
        self.award_share_ids.unlink()
        return super().action_bid_again()

    def action_award(self, participant=None, reason=None):
        split = self.filtered('is_split')
        if self - split:
            super(SmartspendAuction, self - split).action_award(participant=participant, reason=reason)
        for auction in split:
            auction._sync_state()
            if auction.state != 'closed':
                raise UserError(_("%s has to close before it can be awarded.", auction.name))
            leader = auction._bidder(None)
            shares = auction.award_share_ids
            winners = shares.participant_id
            if participant and auction._bidder(participant) not in winners:
                raise UserError(_("The manager approved a split between %(vendors)s — award it to them.",
                                  vendors=', '.join(winners.partner_id.mapped('name'))))
            request = auction.request_id.sudo()
            # The request carries the blended price of each item.
            for auction_line in auction.line_ids:
                parts = shares.line_ids.filtered(lambda l: l.auction_line_id == auction_line)
                quantity = sum(parts.mapped('quantity'))
                if not quantity:
                    continue
                request_line = auction_line.request_line_id
                if not request_line.exists():
                    wanted = (auction_line.product_name or '').casefold()
                    request_line = request.line_ids.filtered(
                        lambda line: (line.product_name or '').casefold() == wanted)[:1]
                if request_line:
                    request_line.price_unit = sum(parts.mapped('subtotal')) / quantity
            primary = auction.approved_participant_id
            total = sum(shares.mapped('amount'))
            saved = auction.ceiling_total - total
            request.write({
                'partner_id': primary.partner_id.id,
                'vendor_name': primary.partner_id.name,
                'sourcing_method': 'auction',
                'savings': saved,
                'awarded_auction_id': auction.id,
            })
            winners.write({'state': 'won'})
            (auction.participant_ids - winners).filtered(
                lambda p: p.state in ('live', 'closed')).write({'state': 'lost'})
            reason = (reason or auction.approval_note or '').strip()
            auction.write({
                'state': 'awarded',
                'winner_id': primary.partner_id.id,
                'awarded_total': total,
                'awarded_on': fields.Datetime.now(),
                'awarded_by_id': self.env.user.id,
                'awarded_rank': primary.rank,
                'award_reason': reason or False,
            })
            split = '; '.join(
                self.env._("%(vendor)s (L%(rank)s) %(pct)s%% — %(amount)s",
                  vendor=share.partner_id.name, rank=share.rank, pct=f"{share.share_percent:g}",
                  amount=auction._money(share.amount))
                for share in shares)
            note = _("%(auction)s awarded, split between %(count)s vendors: %(split)s. Total %(total)s — "
                     "%(saved)s below the opening price of %(ceiling)s. One purchase order per vendor is raised.",
                     auction=auction.name, count=len(shares), split=split, total=auction._money(total),
                     saved=auction._money(saved), ceiling=auction._money(auction.ceiling_total))
            if float_compare(total, leader.current_total, precision_digits=2) > 0:
                note += ' ' + _("%(gap)s more than all to L1 %(leader)s.",
                                gap=auction._money(total - leader.current_total), leader=leader.partner_id.name)
            if reason:
                note += ' ' + _("Reason: %s", reason)
            auction._post_to_request(_("Reverse Auction Awarded"), note)
            request.message_post(body=note)
            auction.message_post(body=note, partner_ids=auction._vendor_mail_partners(winners),
                                 subtype_xmlid='mail.mt_comment')
        return True

    # ------------------------------------------------------------------
    # The portal
    # ------------------------------------------------------------------
    def _share_rows(self):
        return [{
            'participantId': share.participant_id.id,
            'vendor': share.partner_id.name,
            'rank': share.rank,
            'percent': share.share_percent,
            'amount': share.amount,
            'items': [{'productName': line.product_name, 'qty': line.quantity, 'price': line.unit_price}
                      for line in share.line_ids],
        } for share in self.award_share_ids]

    def _to_buyer_dict(self):
        data = super()._to_buyer_dict()
        if self.award_share_ids:
            data['split'] = self._share_rows()
            if data.get('approval'):
                data['approval']['split'] = data['split']
        return data


class SmartspendAuctionParticipant(models.Model):
    _inherit = 'smartspend.auction.participant'

    def action_approve_this(self):
        """Approving takes a reason (and, optionally, a split): open the form for it."""
        self.ensure_one()
        return self.auction_id.action_open_approve_wizard(participant=self)


class SmartspendAuctionApproveWizard(models.TransientModel):
    _name = 'smartspend.auction.approve.wizard'
    _description = 'Approve Reverse Auction Award'

    auction_id = fields.Many2one('smartspend.auction', required=True)
    note = fields.Char(string='Reason', help="Required — why this level, or this split.")
    line_ids = fields.One2many('smartspend.auction.approve.wizard.line', 'wizard_id', string='Levels')

    def action_confirm(self):
        self.ensure_one()
        self.auction_id.action_approve_award(note=self.note, shares=[
            {'participantId': line.participant_id.id, 'percent': line.share_percent}
            for line in self.line_ids if line.share_percent > 0])
        return {'type': 'ir.actions.act_window_close'}


class SmartspendAuctionApproveWizardLine(models.TransientModel):
    _name = 'smartspend.auction.approve.wizard.line'
    _description = 'Approve Reverse Auction Award — Level'

    wizard_id = fields.Many2one('smartspend.auction.approve.wizard', required=True, ondelete='cascade')
    participant_id = fields.Many2one('smartspend.auction.participant', string='Vendor', required=True, readonly=True)
    rank = fields.Integer(related='participant_id.rank', string='Level')
    total = fields.Monetary(related='participant_id.current_total', string='Bid')
    currency_id = fields.Many2one(related='participant_id.auction_id.currency_id')
    share_percent = fields.Float(string='Share (%)', digits=(16, 2))


class SmartspendAuctionWizardOpen(models.Model):
    _inherit = 'smartspend.auction'

    def action_open_approve_wizard(self, participant=None):
        """The approval form: every bidder by level, the chosen one at 100%."""
        self.ensure_one()
        bidders = self.participant_ids.filtered(lambda p: p.rank and p.current_total).sorted('rank')
        if not bidders:
            self._bidder(None)  # says why there is nothing to approve
        pick = participant or self.approved_participant_id or bidders[:1]
        current = {share.participant_id.id: share.share_percent for share in self.award_share_ids}
        wizard = self.env['smartspend.auction.approve.wizard'].create({
            'auction_id': self.id,
            'note': self.approval_note or False,
            'line_ids': [fields.Command.create({
                'participant_id': bidder.id,
                'share_percent': (current.get(bidder.id, 0.0) if current and not participant
                                  else 100.0 if bidder == pick else 0.0),
            }) for bidder in bidders],
        })
        return {
            'type': 'ir.actions.act_window',
            'name': _("Approve the award"),
            'res_model': 'smartspend.auction.approve.wizard',
            'res_id': wizard.id,
            'view_mode': 'form',
            'target': 'new',
        }


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    smartspend_acknowledged = fields.Boolean(
        string='Vendor Confirmed', copy=False, readonly=True,
        help="On a split award: this vendor has confirmed their order.")
    smartspend_delivery_date = fields.Date(
        string='Vendor Committed Delivery', copy=False, readonly=True)


class SmartspendRequest(models.Model):
    _inherit = 'smartspend.request'

    supplier_partner_ids = fields.Many2many(
        'res.partner', 'smartspend_request_supplier_rel', 'request_id', 'partner_id',
        string='Suppliers', compute='_compute_supplier_partner_ids', store=True,
        help="Every company an order on this request was placed with — more than one on a split award.")

    @api.depends('partner_id', 'purchase_order_ids.partner_id', 'purchase_order_ids.state')
    def _compute_supplier_partner_ids(self):
        for request in self:
            partners = request.partner_id.commercial_partner_id | request.sudo().purchase_order_ids.filtered(
                lambda o: o.state != 'cancel').partner_id.commercial_partner_id
            request.supplier_partner_ids = partners

    def _live_orders(self):
        return self.sudo().purchase_order_ids.filtered(lambda o: o.state != 'cancel')

    def _split_shares(self):
        """The award split this request was ordered from, if any."""
        self.ensure_one()
        auction = self.sudo().awarded_auction_id
        return auction.award_share_ids if auction and auction.state == 'awarded' and auction.is_split else \
            self.env['smartspend.auction.award.share']

    def _is_split_order(self):
        return len(self._live_orders()) > 1 and bool(self._split_shares())

    def _placed_with(self, user):
        if super()._placed_with(user):
            return True
        supplier = user.sudo().partner_id.commercial_partner_id
        return supplier in self.sudo().supplier_partner_ids

    # -- One order per vendor -------------------------------------------
    def action_create_purchase_order(self):
        if len(self) != 1 or not self._split_shares():
            return super().action_create_purchase_order()
        # Every check the single order goes through, without raising it.
        super(SmartspendRequest, self.with_context(smartspend_check_only=True)).action_create_purchase_order()
        shares = self._split_shares()
        orders = self.env['purchase.order']
        for share in shares.sorted('rank'):
            order = self.env['purchase.order'].create(self._prepare_purchase_order_vals(share.partner_id))
            for request_line in self.line_ids:
                key = (request_line.product_name or '').strip().casefold()
                part = share.line_ids.filtered(lambda l: (l.product_name or '').strip().casefold() == key)
                quantity = sum(part.mapped('quantity'))
                if not quantity:
                    continue
                values = request_line._prepare_purchase_order_line_vals(order)
                values.update(product_qty=quantity, price_unit=part[:1].unit_price)
                order.order_line = [(0, 0, values)]
            orders |= order
        previous = self.state
        self.po_released = False
        self.po_acknowledged = False
        self.vendor_delivery_date = False
        for order in orders:
            order.with_context(smartspend_po_created=True).button_confirm()
        self.state = 'po_confirmed'
        sent = ', '.join(
            self.env._("%(order)s to %(vendor)s (%(pct)s%%)", order=order.name, vendor=order.partner_id.name,
              pct=f"{shares.filtered(lambda s: s.partner_id == order.partner_id)[:1].share_percent:g}")
            for order in orders)
        self._log_history(
            _("PO Created: %s", ', '.join(orders.mapped('name'))),
            _("Split award — %s", sent),
            state_from=previous, state_to='po_confirmed')
        self.message_post(body=_("Purchase orders %s created from this request.", ', '.join(orders.mapped('name'))))
        # Every vendor's access hangs off the stored supplier list: write it now.
        self.env.flush_all()
        return self.action_view_purchase_orders()

    # -- Each vendor confirms their own order ----------------------------
    def action_acknowledge_purchase_order(self, delivery_date=None, schedule=None):
        if len(self) != 1 or not self._is_split_order():
            return super().action_acknowledge_purchase_order(delivery_date=delivery_date, schedule=schedule)
        if not self.po_released:
            raise UserError(_("%s has not been released by the purchase head yet.", self.name))
        partner_id = self.env.context.get('smartspend_ack_partner')
        orders = self._live_orders().filtered(lambda o: not o.smartspend_acknowledged)
        if partner_id:
            orders = orders.filtered(lambda o: o.partner_id.commercial_partner_id.id == partner_id)
        if not orders:
            return True
        today = fields.Date.context_today(self)
        slots = []
        if schedule and len(schedule) > 1:
            if not partner_id:
                raise UserError(_(
                    "This order is split between vendors — each vendor sends their own delivery schedule. "
                    "Record one date for all of them here."))
            share = self._split_shares().filtered(
                lambda s: s.partner_id.commercial_partner_id.id == partner_id)
            ordered = {}
            for line in share.line_ids:
                ordered[line.product_name] = ordered.get(line.product_name, 0.0) + line.quantity
            commit, slots = self._read_delivery_schedule(schedule, ordered=ordered)
        else:
            if schedule:
                delivery_date = (schedule[0] or {}).get('date') or delivery_date
            commit = fields.Date.to_date(delivery_date) if delivery_date else False
            if not commit:
                raise UserError(_("Confirm the expected delivery date to acknowledge %s.", self.name))
            if commit < today:
                raise UserError(_("The expected delivery date cannot be in the past."))
        partner = orders[:1].partner_id
        if slots:
            self.delivery_slot_ids.filtered(lambda s: s.partner_id == partner).unlink()
            self.write({'delivery_slot_ids': [fields.Command.create(dict(values, partner_id=partner.id))
                                              for values in slots]})
        orders.write({'smartspend_acknowledged': True, 'smartspend_delivery_date': commit})
        by_product = {}
        for slot in self.delivery_slot_ids.filtered(lambda s: s.partner_id == partner):
            key = slot.product_name.strip().casefold()
            by_product[key] = max(by_product.get(key, slot.date), slot.date)
        for po_line in orders.order_line.filtered(lambda l: not l.display_type):
            day = by_product.get((po_line.product_id.name or '').strip().casefold()) or commit
            po_line.date_planned = datetime.combine(day, datetime.min.time()).replace(hour=12)
        live = self._live_orders()
        done = live.filtered('smartspend_acknowledged')
        values = {'vendor_delivery_date': max(done.mapped('smartspend_delivery_date'))}
        if done == live:
            values['po_acknowledged'] = True
        self.write(values)
        when = commit.strftime('%b %d, %Y')
        vendors = ', '.join(orders.partner_id.mapped('name'))
        waiting = live - done
        detail = _("%(vendors)s confirmed %(orders)s and committed to deliver by %(date)s.",
                   vendors=vendors, orders=', '.join(orders.mapped('name')), date=when)
        if slots:
            detail += ' ' + _("In %s deliveries.", len({s['date'] for s in slots}))
        detail += ' ' + (_("Still waiting on %s.", ', '.join(waiting.partner_id.mapped('name'))) if waiting
                         else _("Every vendor has confirmed."))
        self._log_history(_("Vendor Acknowledged PO"), detail)
        self.message_post(body=_("Vendor acknowledgment recorded by %(user)s: %(detail)s",
                                 user=self.env.user.name, detail=detail))
        return True

    def _to_vendor_portal_dict(self, user):
        """The request as the supplier ``user`` sees it: on a split order, only
        their part — their items, quantities, value, order and confirmation."""
        self.ensure_one()
        data = self._to_portal_dict()
        if not self._is_split_order():
            return data
        supplier = user.sudo().partner_id.commercial_partner_id
        share = self._split_shares().filtered(lambda s: s.partner_id.commercial_partner_id == supplier)[:1]
        orders = self._live_orders().filtered(lambda o: o.partner_id.commercial_partner_id == supplier)
        if not share:
            return data
        items = [{'productName': line.product_name,
                  'productQty': int(line.quantity) if float(line.quantity).is_integer() else line.quantity,
                  'targetPrice': line.unit_price} for line in share.line_ids]
        qty = sum(line.quantity for line in share.line_ids)
        data.update({
            'lineItems': items,
            'productName': items[0]['productName'] if items else data.get('productName'),
            'productQty': int(qty) if float(qty).is_integer() else qty,
            'targetPrice': items[0]['targetPrice'] if items else data.get('targetPrice'),
            'totalCost': share.amount,
            'purchaseOrders': orders.mapped('name'),
            'poAcknowledged': bool(orders) and all(orders.mapped('smartspend_acknowledged')),
        })
        return data
