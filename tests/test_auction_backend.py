"""Reverse auctions, end to end in the ORM — rolled back at the end.

Launch → accept / decline → open → bid down → soft close → close → award →
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

print('\n--- invitations ---')
p_primus.with_user(v_primus).sudo()._respond(True)
p_apex.with_user(v_apex).sudo()._respond(True)
p_secure.with_user(v_secure).sudo()._respond(False, 'Stock not available')
check('two accept, one declines',
      (p_primus.state, p_apex.state, p_secure.state) == ('accepted', 'accepted', 'declined'))
check('the decline keeps its reason', p_secure.response_note == 'Stock not available')
raises('accepting twice is refused', UserError, lambda: p_primus.sudo()._respond(True))

a.action_start()
check('opening early goes live', a.state == 'live', a.state)
check('and keeps the ten-minute duration',
      abs((a.end_date - now()).total_seconds() - 600) < 5, a.end_date)
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

print('\n--- soft close ---')
a.sudo().end_date = now() + timedelta(seconds=60)
end_before = a.end_date
bid(p_apex, v_apex, 64000, 8000)                          # 144000, inside the 2-minute window
check('a bid inside the window extends the close by two minutes',
      a.end_date == end_before + timedelta(minutes=2) and a.extension_count == 1,
      (a.end_date - end_before, a.extension_count))
last = a.bid_ids.sorted('id')[-1]
check('the bid that did it is marked', last.extended_by == 2 and 0 < last.seconds_left <= 60,
      (last.extended_by, last.seconds_left))

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
a5.action_start()
# The portal posts the whole request back, items included, on any edit.
payload = r5.with_user(admin)._to_portal_dict()
env['smartspend.request'].with_user(admin)._upsert_from_portal(payload)
check('a portal save replaces the request lines', not a5.line_ids[0].request_line_id.exists())
pa = a5.participant_ids.filtered(lambda p: p.partner_id == primus)
m1, m2 = a5.line_ids.sorted('sequence')
a5.with_user(v_primus)._place_bid(pa, {m1.id: 60000, m2.id: 7000})
a5.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a5._sync_state()
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
a3.action_start()
a3.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a3._sync_state()
raises('nobody bid: nothing to award', UserError, a3.action_award)
a3.action_bid_again()
check('Bid Again reopens it for another round', a3.state == 'live'
      and abs((a3.end_date - now()).total_seconds() - 15 * 60) < 5, (a3.state, a3.end_date))
check('its bidders are back in', set(a3.participant_ids.mapped('state')) == {'live'})
a3.sudo().write({'start_date': now() - timedelta(minutes=30), 'end_date': now() - timedelta(seconds=1)})
a3._sync_state()
a3.sudo().closed_on = now() - timedelta(minutes=16)
raises('Bid Again is only offered for fifteen minutes after the close', UserError, a3.action_bid_again)
a3.action_cancel()
check('cancel withdraws every invitation', a3.state == 'cancelled'
      and set(a3.participant_ids.mapped('state')) == {'cancelled'})
raises('a cancelled auction cannot be cancelled again', UserError, a3.action_cancel)

print('\n--- the cron ---')
r3 = approved_request(LINES)
a4 = Auction._launch_for_request(r3, primus | apex, soon(20), 5)
env['smartspend.auction']._cron_tick()
check('the cron sends the half-hour reminder once', a4.reminder_sent)
for p in a4.participant_ids:
    p.sudo()._respond(True)
a4.sudo().start_date = now() - timedelta(seconds=1)
env['smartspend.auction']._cron_tick()
check('and opens it on time', a4.state == 'live', a4.state)

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
