from odoo.exceptions import UserError, ValidationError, AccessError
from odoo import fields
from datetime import timedelta

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS  ' if ok else 'FAIL  ') + name + (' :: %s' % (detail,) if detail else ''))

def raises(name, exc, fn):
    """Run fn inside a savepoint so a refused write leaves the fixture intact."""
    try:
        with env.cr.savepoint():
            fn()
    except exc as e:
        check(name, True, str(e).replace('\n', ' ')[:110])
        return
    except Exception as e:
        check(name, False, 'wrong exception: %r' % e)
        return
    check(name, False, 'no exception raised')

Req = env['smartspend.request']
Cat = env.ref('smartspend.category_it_hardware')
Dep = env.ref('smartspend.department_it')
Bra = env.ref('smartspend.branch_bangalore')
uom_unit = env.ref('uom.product_uom_unit')
uom_dozen = env.ref('uom.product_uom_dozen')

print('=' * 70); print('PHASE 1 BACKEND BEHAVIOUR'); print('=' * 70)

# ---------------------------------------------------------------- 1. create
r = Req.create({
    'department_id': Dep.id, 'branch_id': Bra.id, 'category_id': Cat.id,
    'delivery_date': fields.Date.add(fields.Date.today(), days=14),
    'description': 'Two laptops and a dozen mice for the new joiners.',
    'notes': 'Buyer: check the Q4 rate card first.',
    'line_ids': [
        (0, 0, {'product_name': 'Dell Latitude 5440 Laptop', 'product_qty': 2, 'price_unit': 70000}),
        (0, 0, {'product_name': 'Wireless Mouse', 'product_qty': 12, 'price_unit': 900,
                'product_uom_id': uom_dozen.id, 'description': 'Bluetooth, black'}),
    ],
})
check('reference comes from the Odoo sequence', r.name.startswith('PR-'), r.name)
check('requester defaults to the current user', r.user_id == env.user, r.user_id.login)
check('company defaults and currency follows it',
      r.company_id == env.company and r.currency_id == env.company.currency_id, r.currency_id.name)
check('state starts at draft', r.state == 'draft', r.state)
check('description and internal notes are stored', bool(r.description and r.notes))
check('cost centre reference exists on the request', 'analytic_account_id' in r._fields)

# ------------------------------------------------------- 2. calculations
check('line total = qty x unit price (2 x 70000)', r.line_ids[0].subtotal == 140000.0, r.line_ids[0].subtotal)
check('line total = qty x unit price (12 x 900)', r.line_ids[1].subtotal == 10800.0, r.line_ids[1].subtotal)
check('request total = sum of line totals', r.total_cost == 150800.0, r.total_cost)
r.line_ids[0].product_qty = 3
check('request total recomputes when a line changes', r.total_cost == 220800.0, r.total_cost)
r.line_ids[0].product_qty = 2

# ------------------------------------------------------- 3. UOM / category
check('UOM defaults to Units', r.line_ids[0].product_uom_id == uom_unit, r.line_ids[0].product_uom_id.name)
check('an explicit UOM is kept', r.line_ids[1].product_uom_id == uom_dozen, r.line_ids[1].product_uom_id.name)
check('line description is stored', r.line_ids[1].description == 'Bluetooth, black')

# --------------------------------------------------------- 4. validations
raises('line quantity must be > 0', ValidationError,
       lambda: r.line_ids[0].write({'product_qty': 0}))
raises('line unit price may not be negative', ValidationError,
       lambda: r.line_ids[0].write({'price_unit': -1}))
raises('needed-by date may not precede the request date', ValidationError,
       lambda: r.write({'delivery_date': fields.Date.subtract(r.request_date.date(), days=1)}))
leaver = env['res.users'].sudo().create({
    'name': 'Phase 1 Leaver', 'login': 'phase1.leaver.test', 'active': False})
raises('a request may not be filed against an archived requester', ValidationError,
       lambda: r.write({'user_id': leaver.id}))
check('a request raised by OdooBot (cron / data load) is still allowed',
      bool(Req.with_user(env.ref('base.user_root')).create({
          'line_ids': [(0, 0, {'product_name': 'Cron item', 'product_qty': 1, 'price_unit': 1})]}).id))
raises('master data of another company is refused', UserError,
       lambda: r.write({'branch_id': env['smartspend.branch'].sudo().create({
           'name': 'Other Co Branch %s' % fields.Datetime.now(),
           'company_id': env['res.company'].sudo().create({'name': 'Phase1 Other Co'}).id}).id}))
# ------------------------------------------------------------- 5. submit
empty = Req.create({'department_id': Dep.id, 'branch_id': Bra.id, 'category_id': Cat.id,
                    'delivery_date': fields.Date.add(fields.Date.today(), days=5)})
raises('submit refuses a request with no lines', UserError, empty.action_submit)
bare = Req.create({'line_ids': [(0, 0, {'product_name': 'Thing', 'product_qty': 1, 'price_unit': 10})]})
raises('submit refuses a request with no department / branch / category / date',
       UserError, bare.action_submit)

before = len(r.history_ids)
r.action_submit()
check('submit moves the state to Pending Approval', r.state == 'to_approve', r.state)
check('submit records who submitted', r.submitted_by_id == env.user, r.submitted_by_id.login)
check('submit records when', bool(r.submitted_on), r.submitted_on)
check('submit appends a timeline entry', len(r.history_ids) == before + 1)
entry = r.history_ids[-1]
check('the entry names the action', entry.title == 'Submitted for Approval', entry.title)
check('the entry records the user', entry.user_id == env.user, entry.user_id.login)
check('the entry records both states',
      (entry.state_from, entry.state_to) == ('draft', 'to_approve'), (entry.state_from, entry.state_to))
check('submit posts to the chatter',
      any('Submitted by' in (m.body or '') for m in r.message_ids), len(r.message_ids))
check('the submitted total is the one the lines add up to',
      r.total_cost == sum(r.line_ids.mapped('subtotal')) == 150800.0, r.total_cost)

# ------------------------------------------------------------- 6. cancel
wiz = env['smartspend.request.cancel'].create({'request_ids': [(6, 0, r.ids)],
                                               'reason': 'Covered by the existing rate contract.'})
wiz.action_confirm()
check('cancel moves the state to Cancelled', r.state == 'cancelled', r.state)
check('the request still exists (never deleted)', bool(r.exists()) and bool(r.line_ids))
check('cancel records who', r.cancelled_by_id == env.user, r.cancelled_by_id.login)
check('cancel records when', bool(r.cancelled_on), r.cancelled_on)
check('cancel records why', 'rate contract' in (r.cancel_reason or ''), r.cancel_reason)
c_entry = r.history_ids[-1]
check('cancel appends a timeline entry with both states',
      (c_entry.title, c_entry.state_from, c_entry.state_to) ==
      ('Request Cancelled', 'to_approve', 'cancelled'),
      (c_entry.title, c_entry.state_from, c_entry.state_to))
check('cancel posts to the chatter',
      any('Cancelled by' in (m.body or '') for m in r.message_ids))
raises('cancelling twice is refused', UserError, lambda: r._apply_cancel('again'))

# ------------------------------------------------- 7. cancel guard on POs
ordered = Req.search([('state', '=', 'po_confirmed')], limit=1) or Req.search([], limit=1)
ordered_state = ordered.state
ordered.sudo().write({'state': 'po_confirmed'})
raises('an already-ordered request cannot be cancelled', UserError,
       lambda: ordered._apply_cancel('nope'))
ordered.sudo().write({'state': ordered_state})

# ---------------------------------------------------------- 8. reset draft
r.action_reset_draft()
check('reset returns the request to draft', r.state == 'draft', r.state)
check('reset clears the cancellation stamps',
      not r.cancelled_by_id and not r.cancelled_on and not r.cancel_reason)
check('reset is itself audited',
      r.history_ids[-1].title == 'Reset to Draft' and r.history_ids[-1].state_to == 'draft',
      r.history_ids[-1].title)
check('submitting again is allowed after a cancel', r._validate_for_submission())

# ------------------------------------------------------------ 9. ownership
other = env['res.users'].sudo().create({
    'name': 'Phase 1 Test Requester', 'login': 'phase1.requester.test',
    'password': 'Phase1-Test-Pw!', 'group_ids': [(6, 0, [env.ref('smartspend.group_smartspend_user').id])],
})
on_behalf = Req.create({
    'user_id': other.id, 'department_id': Dep.id, 'branch_id': Bra.id, 'category_id': Cat.id,
    'line_ids': [(0, 0, {'product_name': 'Headset', 'product_qty': 1, 'price_unit': 3400})],
})
check('creator and requester are told apart',
      on_behalf.create_uid == env.user and on_behalf.user_id == other, (on_behalf.create_uid.login, on_behalf.user_id.login))
check('a request raised for somebody else is flagged as delegated', on_behalf.delegated)
check('the requester is not overwritten by the creator', on_behalf.user_id == other)
check('its opening timeline entry names both',
      'created by' in (on_behalf.history_ids[0].description or ''), on_behalf.history_ids[0].description)
check('a request raised for oneself is not flagged', not r.delegated)

# ------------------------------------------------------------ 10. security
own = Req.with_user(other).create({
    'department_id': Dep.id, 'branch_id': Bra.id, 'category_id': Cat.id,
    'line_ids': [(0, 0, {'product_name': 'Keyboard', 'product_qty': 1, 'price_unit': 2200})],
})
check('a requester can raise a request through the API path', bool(own.id), own.name)
visible = Req.with_user(other).search([])
check('a requester sees the requests they are the requester on — theirs and the delegated one',
      set(visible.ids) == {own.id, on_behalf.id}, visible.mapped('name'))
check("a requester does not see anybody else's requests",
      r.id not in visible.ids and len(Req.sudo().search([])) > len(visible),
      (len(visible), len(Req.sudo().search([]))))
foreign_line = r.line_ids[0]
raises("a requester cannot read another user's request line", AccessError,
       lambda: foreign_line.with_user(other).read(['product_name']))
raises("a requester cannot read another user's timeline", AccessError,
       lambda: r.history_ids[0].with_user(other).read(['title']))
check('a requester can read their own lines',
      own.line_ids.with_user(other).read(['product_name'])[0]['product_name'] == 'Keyboard')
check('a manager still sees everything', len(Req.with_user(env.ref('base.user_admin')).search([])) >= 5)

# ---------------------------------------------------------- 11. attachments
att = env['ir.attachment'].create({
    'name': 'quote.pdf', 'res_model': 'smartspend.request', 'res_id': r.id, 'raw': b'%PDF-1.4 test'})
r.invalidate_recordset(['attachment_ids', 'attachment_count'])
check('files are stored as standard ir.attachment', att in r.attachment_ids, r.attachment_ids.mapped('name'))
check('the form can count them', r.attachment_count == 1, r.attachment_count)

# -------------------------------------------------------- 12. pending.actions
check('pending.actions is absent, so nothing was created to clash with it',
      'pending.actions' not in env, [m for m in env.registry if 'pending' in m])

env.cr.rollback()
print()
failed = [n for n, ok in results if not ok]
print('%s checks, %s failed' % (len(results), len(failed)))
for n in failed:
    print('  FAILED: ' + n)
