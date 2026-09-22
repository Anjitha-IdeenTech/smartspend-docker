"""A supplier reads the orders placed with them, and nobody else's — rolled back.

Each demo supplier login sits under its company. An order is theirs when the
request's vendor is that company: the record rules decide what /requests
returns, and _placed_with() guards the calls that look an order up with
elevated rights (the vendor's acknowledgment of a PO).
"""
from odoo import fields
from odoo.exceptions import AccessError

ok = []
def check(n, v, d=''):
    ok.append(bool(v)); print(('PASS  ' if v else 'FAIL  ') + n + (' :: %s' % (d,) if d else ''))

admin = env.ref('base.user_admin')
buyer = env.ref('smartspend.user_demo_buyer')
v_primus = env.ref('smartspend.user_demo_vendor')
v_apex = env.ref('smartspend.user_demo_vendor_apex')
v_secure = env.ref('smartspend.user_demo_vendor_securenet')
Partner = env['res.partner'].sudo()
primus = Partner.search([('name', '=', 'Primus Technologies'), ('is_company', '=', True)], limit=1)
apex = Partner.search([('name', '=', 'Apex Systems'), ('is_company', '=', True)], limit=1)


def order_with(partner, state='po_confirmed'):
    req = env['smartspend.request'].with_user(admin).create({
        'department_id': env.ref('smartspend.department_it').id,
        'branch_id': env.ref('smartspend.branch_bangalore').id,
        'category_id': env.ref('smartspend.category_it_hardware').id,
        'delivery_date': fields.Date.add(fields.Date.today(), days=20),
        'line_ids': [(0, 0, {'product_name': 'Dell Latitude 5440 Laptop', 'product_qty': 2, 'price_unit': 70000})],
    })
    req.sudo().write({'state': state, 'partner_id': partner.id, 'vendor_name': partner.name})
    req.sudo()._log_history('Test entry', 'for the vendor-scope suite')
    return req


o_primus = order_with(primus)
o_primus_paid = order_with(primus, 'paid')
o_apex = order_with(apex)
mine = o_primus | o_primus_paid | o_apex
print('fixture: %s (Primus), %s (Primus, paid), %s (Apex)' % tuple(mine.mapped('name')))
print('=' * 72)


def visible(user, model='smartspend.request', field='id'):
    records = env[model].with_user(user).search([] if model == 'smartspend.request' else [('request_id', 'in', mine.ids)])
    ids = set(records.mapped(field) if field != 'id' else records.ids)
    return ids & set(mine.ids)


check('Primus sees its own orders, confirmed and paid', visible(v_primus) == {o_primus.id, o_primus_paid.id},
      sorted(visible(v_primus)))
check('Apex sees only its own', visible(v_apex) == {o_apex.id}, sorted(visible(v_apex)))
check('SecureNet, with no orders, sees none of them', visible(v_secure) == set(), sorted(visible(v_secure)))
check('the buyer still sees every order', visible(buyer) == set(mine.ids))
check("items follow the order: Apex reads no Primus line",
      visible(v_apex, 'smartspend.request.line', 'request_id.id') == {o_apex.id},
      visible(v_apex, 'smartspend.request.line', 'request_id.id'))
check("and no Primus timeline",
      visible(v_apex, 'smartspend.request.history', 'request_id.id') == {o_apex.id},
      visible(v_apex, 'smartspend.request.history', 'request_id.id'))
try:
    o_primus.with_user(v_apex).read(['name', 'total_cost'])
    check("opening a rival's order directly is refused", False, 'read succeeded')
except AccessError:
    check("opening a rival's order directly is refused", True)
try:
    o_primus.with_user(v_primus)._to_portal_dict()
    check('a supplier still reads its own order in full', True)
except Exception as e:
    check('a supplier still reads its own order in full', False, repr(e)[:120])

check('the ownership check agrees, for every pair',
      (o_primus._placed_with(v_primus), o_primus._placed_with(v_apex), o_apex._placed_with(v_apex),
       o_apex._placed_with(v_secure), o_apex._placed_with(buyer)) == (True, False, True, False, False))
draft = env['smartspend.request'].with_user(admin).create(
    {'line_ids': [(0, 0, {'product_name': 'Thing', 'product_qty': 1, 'price_unit': 1})]})
check('an order with no vendor belongs to nobody', not draft._placed_with(v_primus))

# The seeded demo orders, as each supplier now sees them.
for user in (v_primus, v_apex, v_secure):
    names = sorted(set(env['smartspend.request'].with_user(user).search(
        [('state', 'in', ['po_confirmed', 'paid'])]).mapped('partner_id.name')))
    check('%s sees orders placed with %s only' % (user.login, user.partner_id.commercial_partner_id.name),
          names in ([], [user.partner_id.commercial_partner_id.name]), names)

env.cr.rollback()
print()
print('%s checks, %s failed' % (len(ok), len([x for x in ok if not x])))
