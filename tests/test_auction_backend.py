"""Reverse auctions, end to end in the ORM — rolled back at the end.

Launch → accept / decline → open → bid down → time extension → close → award →
purchase order, plus every refusal on the way and the access rules that keep a
supplier from reading a rival's price. Time is moved by writing the auction's
clock directly, so nothing here waits.
"""
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError

ok = []
def check(n, v, d=''):
    ok.append(bool(v)); print(('PASS  ' if v else 'FAIL  ') + n + (' :: %s' % (d,) if d else ''))
def raises(n, exc, fn):
    try:
        with env.cr.savepoint():
            fn()
    except exc as e:
        check(n, True, str(e).replace('\n', ' ')[:110]); return
    except Exception as e:
        check(n, False, 'wrong exception %r' % e); return
    check(n, False, 'no exception')

admin = env.ref('base.user_admin')
buyer = env.ref('smartspend.user_demo_buyer')
requester = env.ref('smartspend.user_demo_requester')
v_primus = env.ref('smartspend.user_demo_vendor')
v_apex = env.ref('smartspend.user_demo_vendor_apex')
v_secure = env.ref('smartspend.user_demo_vendor_securenet')
Partner = env['res.partner'].sudo()
primus = Partner.search([('name', '=', 'Primus Technologies'), ('is_company', '=', True)], limit=1)
apex = Partner.search([('name', '=', 'Apex Systems'), ('is_company', '=', True)], limit=1)
secure = Partner.search([('name', '=', 'SecureNet'), ('is_company', '=', True)], limit=1)
Auction = env['smartspend.auction'].with_user(buyer)
now = fields.Datetime.now


def approved_request(lines):
    req = env['smartspend.request'].with_user(admin).create({
        'department_id': env.ref('smartspend.department_it').id,
        'branch_id': env.ref('smartspend.branch_bangalore').id,
        'category_id': env.ref('smartspend.category_it_hardware').id,
        'delivery_date': fields.Date.add(fields.Date.today(), days=20),
        'line_ids': [(0, 0, line) for line in lines],
    })
    req.sudo().write({'state': 'approved'})
    return req.with_user(buyer)


LINES = [
    {'product_name': 'Dell Latitude 5440 Laptop', 'product_qty': 2, 'price_unit': 70000},
    {'product_name': 'USB-C Docking Station', 'product_qty': 2, 'price_unit': 8500},
]
r = approved_request(LINES)
print('fixture: %s state=%s total=%s' % (r.name, r.state, r.total_cost))
from odoo.addons.smartspend.models.smartspend_auction import inr
check('amounts read the way the portal writes them',
      (inr(157000), inr(1234567.5), inr(999), inr(0)) == ('₹1,57,000', '₹12,34,567.50', '₹999', '₹0'),
      (inr(157000), inr(1234567.5), inr(999), inr(0)))
print('=' * 72)

check('each supplier signs in under its company\'s name',
      (v_primus.login, v_apex.login, v_secure.login)
      == ('primus@smartspend.demo', 'apex@smartspend.demo', 'securenet@smartspend.demo'),
      (v_primus.login, v_apex.login, v_secure.login))
check('the demo suppliers are real-looking sales contacts',
      (v_primus.name, v_apex.name, v_secure.name) == ('Arjun Nair', 'Meera Krishnan', 'Vikram Desai')
      and all(u.partner_id.function for u in (v_primus, v_apex, v_secure)),
      [(u.name, u.partner_id.function) for u in (v_primus, v_apex, v_secure)])
F = env['smartspend.auction']._fields
check('the time extension carries the original module\'s two field names',
      (F['extension_window'].string, F['extension_minutes'].string)
      == ('Extension Applied in last (minutes)', 'Extension Duration (minutes)'))
check('the three demo supplier logins sit under their companies',
      v_primus.partner_id.commercial_partner_id == primus
      and v_apex.partner_id.commercial_partner_id == apex
      and v_secure.partner_id.commercial_partner_id == secure,
      (v_primus.partner_id.commercial_partner_id.name, v_apex.partner_id.commercial_partner_id.name,
       v_secure.partner_id.commercial_partner_id.name))

soon = lambda minutes=5: now() + timedelta(minutes=minutes)
vendors3 = primus | apex | secure

print('\n--- launching ---')
draft = env['smartspend.request'].with_user(admin).create({
    'line_ids': [(0, 0, {'product_name': 'Thing', 'product_qty': 1, 'price_unit': 10})]}).with_user(buyer)
raises('a request that is not approved cannot be auctioned', UserError,
       lambda: Auction._launch_for_request(draft, vendors3, soon(), 10))
raises('one vendor is not an auction', UserError,
       lambda: Auction._launch_for_request(r, primus, soon(), 10))
raises('the opening needs a minute for vendors to accept', UserError,
       lambda: Auction._launch_for_request(r, vendors3, now(), 10))
unpriced = approved_request([{'product_name': 'Mystery item', 'product_qty': 1, 'price_unit': 0}])
raises('an item with no target price has no opening price', UserError,
       lambda: Auction._launch_for_request(unpriced, vendors3, soon(), 10))

a = Auction._launch_for_request(r, vendors3, soon(), 10, extension_window=2,
                                extension_minutes=2, min_decrement=1000, visibility='rank')
check('launch schedules the auction', a.state == 'scheduled', a.state)
check('reference comes from the sequence', a.name.startswith('AUC-'), a.name)
check('opening price is the request at its target prices', a.ceiling_total == 157000, a.ceiling_total)
check('every item carried across', len(a.line_ids) == 2 and a.line_ids[0].ceiling_price == 70000)
check('three vendors invited', len(a.participant_ids) == 3
      and set(a.participant_ids.mapped('state')) == {'invited'})
p_primus = a.participant_ids.filtered(lambda p: p.partner_id == primus)
p_apex = a.participant_ids.filtered(lambda p: p.partner_id == apex)
p_secure = a.participant_ids.filtered(lambda p: p.partner_id == secure)
check('each invitation found its supplier login',
      (p_primus.user_id, p_apex.user_id, p_secure.user_id) == (v_primus, v_apex, v_secure),
      (p_primus.user_id.login, p_apex.user_id.login, p_secure.user_id.login))
check('the request moves to Sourcing, by auction',
      r.state == 'sourcing' and r.sourcing_method == 'auction', (r.state, r.sourcing_method))
check('the timeline says so', r.history_ids[-1].title == 'Reverse Auction Scheduled',
      r.history_ids[-1].title)
raises('a second auction while one is open is refused', UserError,
       lambda: Auction._launch_for_request(r, vendors3, soon(), 10))
raises('opening with nobody accepted is refused', UserError, a.action_start)

print('\n--- invitations, and opening once everyone is ready ---')
p_primus.with_user(v_primus).sudo()._respond(True)
p_apex.with_user(v_apex).sudo()._respond(True)
check('two accepted, one still to answer: it waits', a.state == 'scheduled', a.state)
raises('accepting twice is refused', UserError, lambda: p_primus.sudo()._respond(True))
p_secure.with_user(v_secure).sudo()._respond(False, 'Stock not available')
check('two accept, one declines',
      (p_primus.state, p_apex.state, p_secure.state) == ('live', 'live', 'declined'))
check('the decline keeps its reason', p_secure.response_note == 'Stock not available')
check('the last answer opens bidding by itself', a.state == 'live' and a.start_mode == 'ready',
      (a.state, a.start_mode))
check('and keeps the ten-minute duration',
      abs((a.end_date - now()).total_seconds() - 600) < 5, a.end_date)
check('the request timeline says it opened because everyone was ready',
      'every invited vendor is ready' in (r.history_ids[-1].description or ''),
      r.history_ids[-1].description)
check('accepted vendors are now bidding', (p_primus.state, p_apex.state) == ('live', 'live'))
check('the decliner stays out', p_secure.state == 'declined')
raises('an invitation cannot be answered once bidding is open', UserError,
       lambda: p_secure.sudo()._respond(True))

L1, L2 = a.line_ids.sorted('sequence')
bid = lambda who, user, laptop, dock: a.with_user(user)._place_bid(who, {L1.id: laptop, L2.id: dock})

print('\n--- bidding ---')
raises('a bid above the opening price is refused', UserError, lambda: bid(p_primus, v_primus, 71000, 8500))
raises('every item needs a price', UserError,
       lambda: a.with_user(v_primus)._place_bid(p_primus, {L1.id: 65000}))
raises('a zero price is refused', UserError, lambda: bid(p_primus, v_primus, 0, 8500))
bid(p_primus, v_primus, 66500, 8500)                      # 150000
check('first bid ranks L1', p_primus.rank == 1 and p_primus.current_total == 150000,
      (p_primus.rank, p_primus.current_total))
bid(p_apex, v_apex, 65500, 8500)                          # 148000
check('a lower bid takes L1', (p_apex.rank, p_primus.rank) == (1, 2), (p_apex.rank, p_primus.rank))
check('the auction knows its leader and saving',
      a.leader_id == apex and a.best_total == 148000 and a.savings_amount == 9000
      and round(a.savings_percent, 1) == 5.7, (a.leader_id.name, a.best_total, a.savings_percent))
raises('a rebid less than the minimum decrement below your last is refused', UserError,
       lambda: bid(p_primus, v_primus, 66250, 8500))      # 149500 > 150000-1000
bid(p_primus, v_primus, 65000, 8000)                      # 146000
check('undercutting takes L1 back', (p_primus.rank, p_apex.rank) == (1, 2))
bid(p_apex, v_apex, 65000, 8000)                          # 146000 — a tie
check('a tie goes to whoever got there first', (p_primus.rank, p_apex.rank) == (1, 2),
      (p_primus.rank, p_apex.rank))
raises('a vendor who declined cannot bid', UserError, lambda: bid(p_secure, v_secure, 60000, 8000))
check('every bid is logged', len(a.bid_ids) == 4 and p_primus.bid_count == 2, len(a.bid_ids))

print('\n--- time extension (a bid in the last minutes) ---')
a.sudo().end_date = now() + timedelta(seconds=60)
end_before = a.end_date
bid(p_apex, v_apex, 64000, 8000)                          # 144000, inside the 2-minute window
check('a bid inside the window extends the close by two minutes',
      a.end_date == end_before + timedelta(minutes=2) and a.extension_count == 1,
      (a.end_date - end_before, a.extension_count))
last = a.bid_ids.sorted('id')[-1]
check('the bid that did it is marked', last.extended_by == 2 and 0 < last.seconds_left <= 60,
      (last.extended_by, last.seconds_left))

# The original module's rule applies to every bid, not just the first: each
# time a vendor bids again in the last minutes, the clock is pushed out again.
r8 = approved_request(LINES)
a8 = Auction._launch_for_request(r8, primus | apex, soon(2), 5, extension_window=1, extension_minutes=2)
for p in a8.participant_ids:
    p.sudo()._respond(True)
q_primus = a8.participant_ids.filtered(lambda p: p.partner_id == primus)
q_apex = a8.participant_ids.filtered(lambda p: p.partner_id == apex)
n1, n2 = a8.line_ids.sorted('sequence')
bid8 = lambda who, user, laptop, dock: a8.with_user(user)._place_bid(who, {n1.id: laptop, n2.id: dock})
bid8(q_primus, v_primus, 66000, 8000)
check('a bid with time to spare adds nothing', a8.extension_count == 0, a8.extension_count)
extended = []
for who, user, laptop in ((q_apex, v_apex, 65500), (q_primus, v_primus, 65000), (q_apex, v_apex, 64500)):
    a8.sudo().end_date = now() + timedelta(seconds=40)   # the clock has run down again
    before = a8.end_date
    bid8(who, user, laptop, 8000)
    extended.append(round((a8.end_date - before).total_seconds() / 60))
check('every last-moment bid extends it again, by the Extension Duration each time',
      extended == [2, 2, 2] and a8.extension_count == 3, (extended, a8.extension_count))

print('\n--- what each side can see ---')
vendor_view = a.sudo()._to_vendor_dict(p_primus)
blob = str(vendor_view)
check('a vendor never sees a rival\'s name', 'Apex' not in blob and 'SecureNet' not in blob)
check('rank-only: no leading price for the vendor', vendor_view['leaderTotal'] is None)
check('the vendor sees their own rank and prices',
      vendor_view['me']['rank'] == 2 and vendor_view['me']['prices'] == {str(L1.id): 65000.0, str(L2.id): 8000.0},
      vendor_view['me'])
check('and how many they are up against', vendor_view['competitors'] == 1, vendor_view['competitors'])
check('the next bid ceiling is last minus the decrement', vendor_view['nextMaxBid'] == 145000,
      vendor_view['nextMaxBid'])
a.sudo().visibility = 'leader'
check('with the leading price shown, the vendor gets the figure but not the name',
      a.sudo()._to_vendor_dict(p_primus)['leaderTotal'] == 144000)
a.sudo().visibility = 'rank'
buyer_view = a._to_buyer_dict()
check('the buyer sees every vendor, ranked', [p['vendor'] for p in buyer_view['participants']][:2]
      == ['Apex Systems', 'Primus Technologies'], [p['vendor'] for p in buyer_view['participants']])
check('and the whole bid log', len(buyer_view['bids']) == 5)

print('\n--- access ---')
raises('a supplier login has no rights on auctions', AccessError,
       lambda: env['smartspend.auction'].with_user(v_primus).search([]).mapped('best_total'))
raises('nor on the bid log', AccessError,
       lambda: env['smartspend.auction.bid'].with_user(v_primus).search([]).mapped('total'))
raises('a requester has none either', AccessError,
       lambda: env['smartspend.auction'].with_user(requester).search([]).mapped('name'))
raises('the bid log cannot be edited, even by the buyer', AccessError,
       lambda: a.bid_ids[:1].with_user(buyer).write({'total': 1}))
raises('nor deleted', AccessError, lambda: a.bid_ids[:1].with_user(buyer).unlink())
own = approved_request(LINES)
own.sudo().user_id = requester
try:
    own.with_user(requester).read(['name', 'state', 'total_cost'])
    own.with_user(requester)._to_portal_dict()
    check('a requester still reads their own request, and the portal payload', True)
except Exception as e:
    check('a requester still reads their own request, and the portal payload', False, repr(e)[:120])

print('\n--- closing and awarding ---')
raises('awarding a live auction is refused', UserError, a.action_award)
a.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a._sync_state()
check('the clock closes it', a.state == 'closed' and a.closed_on, a.state)
check('bidders are now closed', (p_primus.state, p_apex.state) == ('closed', 'closed'))
raises('no bids after the close', UserError, lambda: bid(p_primus, v_primus, 60000, 8000))
check('the request timeline records the close',
      r.history_ids[-1].title == 'Reverse Auction Closed', r.history_ids[-1].title)

raises('awarding before the manager approves is refused', UserError, a.action_award)
raises('a buyer cannot approve the award', UserError, lambda: a.action_approve_award(note='x'))
raises('approving without a reason is refused', UserError, lambda: a.with_user(admin).action_approve_award())
a.with_user(admin).action_approve_award(participant=a.participant_ids.filtered(lambda p: p.rank == 2), note='second look')
check('the manager can approve another level', a.approved_rank == 2 and a.approval_note == 'second look',
      (a.approved_rank, a.approval_note))
a.with_user(admin).action_approve_award(note='lowest price')
check('and change it to L1 before the award', a.approved_rank == 1 and a.approved_participant_id.rank == 1,
      a.approved_rank)
raises('the buyer cannot award a level the manager did not approve', UserError,
       lambda: a.action_award(participant=a.participant_ids.filtered(lambda p: p.rank == 2)))
a.action_award()
check('award goes to L1', a.state == 'awarded' and a.winner_id == apex and a.awarded_total == 144000,
      (a.state, a.winner_id.name, a.awarded_total))
check('winner won, runner-up lost, decliner untouched',
      (p_apex.state, p_primus.state, p_secure.state) == ('won', 'lost', 'declined'))
r.invalidate_recordset()
check('the request now names the winner',
      r.partner_id == apex and r.vendor_name == 'Apex Systems', (r.partner_id.name, r.vendor_name))
check('its items are repriced at the winning bid',
      r.line_ids.sorted('sequence').mapped('price_unit') == [64000, 8000],
      r.line_ids.mapped('price_unit'))
check('its value is the awarded total', r.total_cost == 144000, r.total_cost)
check('the saving is recorded', r.savings == 13000, r.savings)
check('and it remembers the auction', r.awarded_auction_id == a)
check('the timeline says who won', r.history_ids[-1].title == 'Reverse Auction Awarded')

print('\n--- the purchase order ---')
r.with_user(admin).action_create_purchase_order()
po = r.sudo().purchase_order_ids[:1]
check('the order goes to the winner', po.partner_id == apex, po.partner_id.name)
check('at the winning prices — even where a rate card covers the item',
      sorted(po.order_line.mapped('price_unit')) == [8000, 64000],
      (po.order_line.mapped('price_unit'), bool(r.contract_id)))

print('\n--- a portal save during the auction ---')
r5 = approved_request(LINES)
a5 = Auction._launch_for_request(r5, primus | apex, soon(2), 5)
for p in a5.participant_ids:
    p.sudo()._respond(True)
# The portal posts the whole request back, items included, on any edit.
payload = r5.with_user(admin)._to_portal_dict()
env['smartspend.request'].with_user(admin)._upsert_from_portal(payload)
check('a portal save replaces the request lines', not a5.line_ids[0].request_line_id.exists())
pa = a5.participant_ids.filtered(lambda p: p.partner_id == primus)
m1, m2 = a5.line_ids.sorted('sequence')
a5.with_user(v_primus)._place_bid(pa, {m1.id: 60000, m2.id: 7000})
a5.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a5._sync_state()
a5.with_user(admin).action_approve_award(note='lowest price')
a5.action_award()
r5.invalidate_recordset()
check('award still reprices the items, matched by name',
      r5.line_ids.sorted('sequence').mapped('price_unit') == [60000, 7000] and r5.total_cost == 134000,
      (r5.line_ids.mapped('price_unit'), r5.total_cost))

print('\n--- the start-time rule, Bid Again, cancel ---')
r2 = approved_request(LINES)
a2 = Auction._launch_for_request(r2, primus | apex, soon(2), 5)
a2.participant_ids[:1].sudo()._respond(True)
a2.sudo().start_date = now() - timedelta(seconds=1)
a2._sync_state()
check('only one accepted by the opening time: cancelled', a2.state == 'cancelled', a2.state)
check('and says why', 'only 1' in (a2.cancel_reason or ''), a2.cancel_reason)
check('the silent vendor is cancelled too', set(a2.participant_ids.mapped('state')) == {'cancelled'})
a3 = Auction._launch_for_request(r2, primus | apex, soon(2), 5)
check('a cancelled auction does not block a new one', a3.state == 'scheduled')
for p in a3.participant_ids:
    p.sudo()._respond(True)
check('both invited vendors accepted: it opened by itself', a3.state == 'live' and a3.start_mode == 'ready',
      (a3.state, a3.start_mode))
a3.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a3._sync_state()
raises('nobody bid: nothing to award', UserError, a3.action_award)
a3.action_bid_again()
check('Bid Again reopens it for another round', a3.state == 'live'
      and abs((a3.end_date - now()).total_seconds() - 15 * 60) < 5, (a3.state, a3.end_date))
check('its bidders are back in', set(a3.participant_ids.mapped('state')) == {'live'})

# A second round starts from the opening price: nobody carries their bid over,
# but every bid of the first round stays in the log.
r9 = approved_request(LINES)
a9 = Auction._launch_for_request(r9, primus | apex, soon(2), 5, min_decrement=1000)
for p in a9.participant_ids:
    p.sudo()._respond(True)
w_primus = a9.participant_ids.filtered(lambda p: p.partner_id == primus)
w_apex = a9.participant_ids.filtered(lambda p: p.partner_id == apex)
k1, k2 = a9.line_ids.sorted('sequence')
bid9 = lambda who, user, laptop, dock: a9.with_user(user)._place_bid(who, {k1.id: laptop, k2.id: dock})
bid9(w_primus, v_primus, 66000, 8000)     # 148000
bid9(w_apex, v_apex, 65000, 8000)         # 146000
check('round one stands at the lower bid', (a9.round_no, a9.best_total, a9.leader_id) == (1, 146000, apex),
      (a9.round_no, a9.best_total, a9.leader_id.name))
a9.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a9._sync_state()
bids_before = len(a9.bid_ids)
a9.action_bid_again()
check('the new round is numbered', a9.round_no == 2 and a9.state == 'live', (a9.round_no, a9.state))
check('everyone starts from the opening price again',
      set(a9.participant_ids.mapped('current_total')) == {0.0} and set(a9.participant_ids.mapped('rank')) == {0}
      and not a9.leader_id and a9.best_total == 0,
      (a9.participant_ids.mapped('current_total'), a9.best_total))
check('and the earlier round is still in the log', len(a9.bid_ids) == bids_before == 2)
# 151000: above both round-one bids, which round one would have refused.
bid9(w_apex, v_apex, 67000, 8500)
check('a bid the first round would have refused is fine in the second',
      a9.best_total == 151000 and a9.leader_id == apex, (a9.best_total, a9.leader_id.name))
check('the new bid is stamped with its round', a9.bid_ids.sorted('id')[-1].round_no == 2)
check('the log now holds both rounds', sorted(a9.bid_ids.mapped('round_no')) == [1, 1, 2])
view = a9.sudo()._to_vendor_dict(w_primus)
check('a vendor may bid up to the opening price again', view['nextMaxBid'] == a9.ceiling_total and view['me']['total'] == 0,
      (view['nextMaxBid'], view['me']['total']))
a3.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a3._sync_state()
a3.sudo().closed_on = now() - timedelta(minutes=16)
raises('Bid Again is only offered for fifteen minutes after the close', UserError, a3.action_bid_again)
a3.action_cancel()
check('cancel withdraws every invitation', a3.state == 'cancelled'
      and set(a3.participant_ids.mapped('state')) == {'cancelled'})
raises('a cancelled auction cannot be cancelled again', UserError, a3.action_cancel)

print('\n--- opening early, and the cron ---')
r6 = approved_request(LINES)
a6 = Auction._launch_for_request(r6, primus | apex | secure, soon(10), 5)
a6.participant_ids.filtered(lambda p: p.partner_id != secure).sudo()._respond(True)
check('two in, one silent: still waiting', a6.state == 'scheduled')
a6.action_start()
check('the buyer can open early once two have accepted', a6.state == 'live' and a6.start_mode == 'buyer',
      (a6.state, a6.start_mode))
check('the silent vendor is dropped', a6.participant_ids.filtered(lambda p: p.partner_id == secure).state == 'cancelled')
r7 = approved_request(LINES)
a7 = Auction._launch_for_request(r7, primus | apex | secure, soon(10), 5)
a7.participant_ids.filtered(lambda p: p.partner_id == primus).sudo()._respond(True)
a7.participant_ids.filtered(lambda p: p.partner_id != primus).sudo()._respond(False)
check('everyone answered but only one accepted: it does not open', a7.state == 'scheduled', a7.state)

r3 = approved_request(LINES)
a4 = Auction._launch_for_request(r3, primus | apex | secure, soon(20), 5)
env['smartspend.auction']._cron_tick()
check('the cron sends the half-hour reminder once', a4.reminder_sent)
a4.participant_ids.filtered(lambda p: p.partner_id != secure).sudo()._respond(True)
a4.sudo().start_date = now() - timedelta(seconds=1)
env['smartspend.auction']._cron_tick()
check('and opens it on time', a4.state == 'live' and a4.start_mode == 'schedule', (a4.state, a4.start_mode))

print('\n--- the Odoo screens ---')
for model, kinds in (('smartspend.auction', ('form', 'list', 'kanban', 'search')),
                     ('smartspend.auction.bid', ('list', 'graph', 'pivot', 'search')),
                     ('smartspend.auction.launch', ('form',)),
                     ('smartspend.request', ('form',))):
    for kind in kinds:
        try:
            env[model].with_user(buyer).get_view(view_type=kind)
            check('%s %s view compiles for a buyer' % (model, kind), True)
        except Exception as e:
            check('%s %s view compiles for a buyer' % (model, kind), False, repr(e)[:120])
try:
    env['smartspend.request'].with_user(requester).get_view(view_type='form')
    check('the request form still compiles for a requester', True)
except Exception as e:
    check('the request form still compiles for a requester', False, repr(e)[:120])

print('\n--- repeat reminders every N minutes ---')
r7 = approved_request(LINES)
a7 = Auction._launch_for_request(r7, vendors3, soon(60), 10, repeat_reminder_minutes=5)
check('launch keeps the repeat interval', a7.repeat_reminder_minutes == 5, a7.repeat_reminder_minutes)
t0 = fields.Datetime.now()
a7.sudo().write({'repeat_reminded_on': t0 - timedelta(minutes=4)})
a7._send_repeat_reminders(now=t0)
check('nothing goes out before the interval is up', sum(a7.participant_ids.mapped('reminder_count')) == 0)
a7.sudo().write({'repeat_reminded_on': t0 - timedelta(minutes=6)})
a7._send_repeat_reminders(now=t0)
check('once it is up, every vendor who has not answered is reminded',
      a7.participant_ids.mapped('reminder_count') == [1, 1, 1] and all(a7.participant_ids.mapped('last_reminder_auto')),
      a7.participant_ids.mapped('reminder_count'))
check('the reminder says how often and when bidding opens',
      'every 5 minutes' in (a7.participant_ids[0].last_reminder_note or '') and 'bidding opens' in a7.participant_ids[0].last_reminder_note,
      a7.participant_ids[0].last_reminder_note)
a7._send_repeat_reminders(now=t0 + timedelta(minutes=1))
check('and not again until the next interval', a7.participant_ids.mapped('reminder_count') == [1, 1, 1])
q_primus = a7.participant_ids.filtered(lambda p: p.partner_id == primus)
q_apex = a7.participant_ids.filtered(lambda p: p.partner_id == apex)
q_primus.with_user(v_primus).sudo()._respond(True)
a7.sudo().write({'repeat_reminded_on': t0 - timedelta(minutes=6)})
a7._send_repeat_reminders(now=t0)
check('a vendor who answered is left alone', q_primus.reminder_count == 1 and q_apex.reminder_count == 2,
      (q_primus.reminder_count, q_apex.reminder_count))
q_apex.with_user(v_apex).sudo()._respond(True)
a7.participant_ids.filtered(lambda p: p.partner_id == secure).with_user(v_secure).sudo()._respond(False)
check('everyone answered: bidding opened', a7.state == 'live', a7.state)
k1, k2 = a7.line_ids.sorted('sequence')
a7.with_user(v_primus)._place_bid(q_primus, {k1.id: 69000, k2.id: 8400})
# Opened seven minutes ago, last reminded six: the next one is due.
a7.sudo().write({'start_date': fields.Datetime.now() - timedelta(minutes=7),
                 'repeat_reminded_on': fields.Datetime.now() - timedelta(minutes=6)})
a7._send_repeat_reminders()
check('live: only the vendor who has not bid is reminded', (q_primus.reminder_count, q_apex.reminder_count) == (1, 3)
      and 'bidding closes' in (q_apex.last_reminder_note or ''), (q_primus.reminder_count, q_apex.reminder_count, q_apex.last_reminder_note))
a7.with_user(v_apex)._place_bid(q_apex, {k1.id: 68000, k2.id: 8400})
a7.sudo().write({'repeat_reminded_on': fields.Datetime.now() - timedelta(minutes=6)})
a7._send_repeat_reminders()
check('everyone has bid: no more reminders', (q_primus.reminder_count, q_apex.reminder_count) == (1, 3))
raises('the interval cannot be negative', UserError, lambda: a7.action_set_repeat_reminders(-5))
a7.action_set_repeat_reminders(10)
check('the buyer can change the interval while it runs', a7.repeat_reminder_minutes == 10
      and a7._to_buyer_dict()['repeatReminderMinutes'] == 10 and a7._to_buyer_dict()['repeatReminderNextAt'])
a7.action_set_repeat_reminders(0)
check('and turn it off', a7.repeat_reminder_minutes == 0 and not a7._repeat_reminder_due_at())

print('\n--- removing a vendor from the invitation list ---')
r8r = approved_request(LINES)
a8r = Auction._launch_for_request(r8r, vendors3, soon(60), 10)
x_primus = a8r.participant_ids.filtered(lambda p: p.partner_id == primus)
x_apex = a8r.participant_ids.filtered(lambda p: p.partner_id == apex)
x_secure = a8r.participant_ids.filtered(lambda p: p.partner_id == secure)
x_primus.with_user(v_primus).sudo()._respond(True)
x_apex.with_user(v_apex).sudo()._respond(True)
x_secure.with_user(buyer)._remove('Not approved for this category')
check('the buyer removes a vendor who had not answered', x_secure.state == 'removed'
      and 'Not approved' in (x_secure.response_note or ''), (x_secure.state, x_secure.response_note))
check('the two who accepted are now everyone: bidding opens by itself', a8r.state == 'live', a8r.state)
check('the request timeline says who was removed', any(
    h.title == 'Vendor Removed from Auction' for h in r8r.history_ids), r8r.history_ids.mapped('title')[-3:])
raises('a removed vendor cannot accept', UserError, lambda: x_secure.with_user(v_secure).sudo()._respond(True))
raises('nor bid', UserError, lambda: a8r.with_user(v_secure)._place_bid(
    x_secure, {l.id: 1000 for l in a8r.line_ids}))
raises('nobody can be removed once bidding is open', UserError, lambda: x_apex.with_user(buyer)._remove())
vd = a8r.sudo()._to_vendor_dict(x_secure)
check('the vendor is told why', vd['me']['state'] == 'removed' and 'Not approved' in vd['me']['removedNote'], vd['me'])
r8t = approved_request(LINES)
a8t = Auction._launch_for_request(r8t, vendors3, soon(60), 10)
y_secure = a8t.participant_ids.filtered(lambda p: p.partner_id == secure)
y_secure.with_user(buyer)._remove()
check('removing one of three leaves the auction waiting on the others', a8t.state == 'scheduled', a8t.state)
raises('a removed vendor cannot accept while it is still waiting', UserError,
       lambda: y_secure.with_user(v_secure).sudo()._respond(True))
raises('nor decline', UserError, lambda: y_secure.with_user(v_secure).sudo()._respond(False))
raises('nor be removed twice', UserError, lambda: y_secure.with_user(buyer)._remove())
check('and is not reminded', not y_secure._reminder_kind())
r8s = approved_request(LINES)
a8s = Auction._launch_for_request(r8s, primus | apex, soon(60), 10)
raises('an auction keeps at least two vendors', UserError,
       lambda: a8s.participant_ids[0].with_user(buyer)._remove())
raises('a requester cannot remove vendors through the API path', Exception,
       lambda: a8s.with_user(requester)._participant_to_remove(a8s.participant_ids[0].id).with_user(requester).write({'state': 'removed'}))

print('\n--- an award split between levels ---')
LINES10 = [{'product_name': 'Dell Latitude 5440 Laptop', 'product_qty': 10, 'price_unit': 70000},
           {'product_name': 'USB-C Docking Station', 'product_qty': 5, 'price_unit': 8500}]
r6 = approved_request(LINES10)
a6 = Auction._launch_for_request(r6, primus | apex, soon(2), 5)
for p in a6.participant_ids:
    p.sudo()._respond(True)
q1, q2 = a6.line_ids.sorted('sequence')
s_primus = a6.participant_ids.filtered(lambda p: p.partner_id == primus)
s_apex = a6.participant_ids.filtered(lambda p: p.partner_id == apex)
a6.with_user(v_primus)._place_bid(s_primus, {q1.id: 50000, q2.id: 8000})
a6.with_user(v_apex)._place_bid(s_apex, {q1.id: 55000, q2.id: 7000})
a6.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a6._sync_state()
split = [{'participantId': s_primus.id, 'percent': 60}, {'participantId': s_apex.id, 'percent': 40}]
raises('a split still needs a reason', UserError, lambda: a6.with_user(admin).action_approve_award(shares=split))
raises('shares that do not make 100% are refused', UserError, lambda: a6.with_user(admin).action_approve_award(
    note='x', shares=[{'participantId': s_primus.id, 'percent': 60}, {'participantId': s_apex.id, 'percent': 30}]))
raises('a split too small to give everyone something is refused', UserError,
       lambda: a6.with_user(admin).action_approve_award(note='x', shares=[
           {'participantId': s_primus.id, 'percent': 99.5}, {'participantId': s_apex.id, 'percent': 0.5}]))
raises('a buyer cannot approve a split', UserError, lambda: a6.action_approve_award(note='x', shares=split))
preview = a6.sudo()._split_preview(split)
check('the preview divides every item and adds up', [sum(i['qty'] for r_ in preview for i in r_['items']
      if i['productName'] == n) for n in ('Dell Latitude 5440 Laptop', 'USB-C Docking Station')] == [10, 5],
      preview)
check('and keeps the value shares close to 60/40',
      all(abs(r_['actualPercent'] - r_['percent']) < 6 for r_ in preview), [r_['actualPercent'] for r_ in preview])
a6.with_user(admin).action_approve_award(note='Spread the supply', shares=split)
check('the split is approved, L1 first', a6.is_split and a6.approved_participant_id == s_primus
      and a6.approval_note == 'Spread the supply', (a6.is_split, a6.approved_participant_id.partner_id.name))
check('the approval total is the sum of the parts',
      abs(a6.approved_total - sum(a6.award_share_ids.mapped('amount'))) < 0.01, a6.approved_total)
a6.action_award()
r6.invalidate_recordset()
check('awarding a split reprices the request at the blended total',
      abs(r6.total_cost - a6.awarded_total) < 0.01 and a6.state == 'awarded', (r6.total_cost, a6.awarded_total))
check('both vendors won', (s_primus.state, s_apex.state) == ('won', 'won'))
r6.with_user(buyer).action_create_purchase_order()
orders = r6.sudo().purchase_order_ids
check('one purchase order per vendor', len(orders) == 2 and set(orders.partner_id.mapped('name'))
      == {'Primus Technologies', 'Apex Systems'} and set(orders.mapped('state')) == {'purchase'},
      orders.mapped('partner_id.name'))
check('each at its own quantities and prices', sorted(
    (o.partner_id.name, l.product_id.name, l.product_qty, l.price_unit) for o in orders for l in o.order_line) == sorted(
    (sh.partner_id.name, ln.product_name, ln.quantity, ln.unit_price) for sh in a6.award_share_ids for ln in sh.line_ids))
check('the second vendor can read the request', bool(env['smartspend.request'].with_user(v_apex).search(
    [('id', '=', r6.id)])) and r6.sudo()._placed_with(v_apex))
mine = r6.sudo()._to_vendor_portal_dict(v_apex)
check('and sees only their own part', mine['purchaseOrders'] == orders.filtered(
    lambda o: o.partner_id == apex).mapped('name') and abs(mine['totalCost'] - a6.award_share_ids.filtered(
    lambda sh: sh.partner_id == apex).amount) < 0.01, (mine['purchaseOrders'], mine['totalCost']))
r6.with_user(admin).action_release_purchase_order()
day = fields.Date.add(fields.Date.today(), days=7)
r6.sudo().with_context(smartspend_ack_partner=apex.id).action_acknowledge_purchase_order(delivery_date=day)
check('one vendor confirming is not enough', not r6.po_acknowledged
      and orders.filtered(lambda o: o.partner_id == apex).smartspend_acknowledged)
r6.sudo().with_context(smartspend_ack_partner=primus.id).action_acknowledge_purchase_order(delivery_date=day)
check('both confirmed: acknowledged', r6.po_acknowledged and r6.vendor_delivery_date == day)

r4 = approved_request(LINES)
r4.sudo().bid_ids = [(0, 0, {'vendor_name': 'Primus Technologies', 'price': 1}),
                     (0, 0, {'vendor_name': 'Apex Systems', 'price': 1})]
wizard = env['smartspend.auction.launch'].with_user(buyer).with_context(
    default_request_id=r4.id).create({})
check('the launcher suggests the vendors already quoting', set(wizard.partner_ids.mapped('name'))
      == {'Primus Technologies', 'Apex Systems'}, wizard.partner_ids.mapped('name'))
check('and a half-percent decrement', wizard.min_decrement == 800, wizard.min_decrement)
action = wizard.action_launch()
check('launching from Odoo opens the auction',
      action['res_model'] == 'smartspend.auction' and r4.auction_count == 1)

env.cr.rollback()
print()
print('%s checks, %s failed' % (len(ok), len([x for x in ok if not x])))
