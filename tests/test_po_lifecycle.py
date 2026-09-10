from odoo import fields
from odoo.exceptions import UserError
ok = []
def check(n, v, d=''):
    ok.append(v); print(('PASS  ' if v else 'FAIL  ') + n + (' :: %s' % (d,) if d else ''))
def raises(n, exc, fn):
    try:
        with env.cr.savepoint():
            fn()
    except exc as e:
        check(n, True, str(e).replace('\n', ' ')[:100]); return
    except Exception as e:
        check(n, False, 'wrong exception %r' % e); return
    check(n, False, 'no exception')

admin = env.ref('base.user_admin')
Req = env['smartspend.request'].with_user(admin)

# a fresh approved request with a vendor, ready to order
r = Req.create({
    'department_id': env.ref('smartspend.department_it').id,
    'branch_id': env.ref('smartspend.branch_bangalore').id,
    'category_id': env.ref('smartspend.category_it_hardware').id,
    'delivery_date': fields.Date.add(fields.Date.today(), days=20),
    'vendor_name': 'Primus Technologies',
    'line_ids': [(0, 0, {'product_name': 'Dell Latitude 5440 Laptop',
                         'product_qty': 2, 'price_unit': 70000})]})
r.action_submit(); r.action_approve()
print('fixture: %s state=%s' % (r.name, r.state))
print('=' * 72)

check('before any order, Create Purchase Order is offered',
      r.purchase_order_live_count == 0 and r.state not in ('draft', 'rejected'))

r.action_create_purchase_order()
po = r.sudo().purchase_order_ids
check('raising one moves the request to PO Confirmed', r.state == 'po_confirmed', r.state)
check('and the button is withdrawn', r.purchase_order_live_count == 1, r.purchase_order_live_count)
raises('raising a second while one stands is refused', UserError, r.action_create_purchase_order)

print('\n--- cancel the order ---')
po.button_cancel()
r.invalidate_recordset()
check('the request leaves PO Confirmed', r.state != 'po_confirmed', r.state)
check('and returns to what the timeline says it was', r.state == 'approved', r.state)
check('Create Purchase Order is offered again', r.purchase_order_live_count == 0,
      r.purchase_order_live_count)
check('the smart button still shows the cancelled order as history',
      r.purchase_order_count == 1, r.purchase_order_count)
last = r.history_ids[-1]
check('the cancellation is on the timeline',
      last.title == 'Purchase Order Cancelled' and last.state_to == 'approved',
      (last.title, last.state_from, last.state_to, last.description))
check('and on the chatter',
      any('no order standing' in (m.body or '') for m in r.message_ids))

print('\n--- raise a replacement ---')
r.action_create_purchase_order()
r.invalidate_recordset()
live = r.sudo().purchase_order_ids.filtered(lambda o: o.state != 'cancel')
check('a replacement order can now be raised', len(live) == 1, live.mapped('name'))
check('the request is PO Confirmed again', r.state == 'po_confirmed', r.state)
check('both orders are on the record, one cancelled', r.purchase_order_count == 2,
      r.sudo().purchase_order_ids.mapped(lambda o: '%s:%s' % (o.name, o.state)))
check('but only one counts as standing', r.purchase_order_live_count == 1)

print('\n--- a request with several orders, only some cancelled ---')
extra = r.sudo().purchase_order_ids.filtered(lambda o: o.state != 'cancel')
second = env['purchase.order'].sudo().create(r._prepare_purchase_order_vals(r.partner_id))
r.invalidate_recordset()
check('two standing orders', r.purchase_order_live_count == 2, r.purchase_order_live_count)
second.button_cancel()
r.invalidate_recordset()
check('cancelling one of two leaves the request PO Confirmed',
      r.state == 'po_confirmed' and r.purchase_order_live_count == 1,
      (r.state, r.purchase_order_live_count))

try:
    Req.get_view(view_type='form'); check('request form compiles', True)
except Exception as e:
    check('request form compiles', False, repr(e)[:120])

env.cr.rollback()
print()
print('%s checks, %s failed' % (len(ok), len([x for x in ok if not x])))
