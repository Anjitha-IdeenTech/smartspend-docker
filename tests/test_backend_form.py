results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS  ' if ok else 'FAIL  ') + name + (' :: %s' % (detail,) if detail else ''))

admin = env.ref('base.user_admin')
Req = env['smartspend.request'].with_user(admin)

print('=' * 70); print('ODOO BACKEND FORM'); print('=' * 70)

for vtype in ('form', 'list', 'kanban', 'search'):
    try:
        v = Req.get_view(view_type=vtype)
        check('smartspend.request %s view compiles' % vtype, bool(v.get('arch')))
    except Exception as e:
        check('smartspend.request %s view compiles' % vtype, False, repr(e)[:200])

try:
    v = env['smartspend.request.cancel'].with_user(admin).get_view(view_type='form')
    check('cancel wizard form compiles', bool(v.get('arch')))
except Exception as e:
    check('cancel wizard form compiles', False, repr(e)[:200])

try:
    v = env['smartspend.department'].with_user(admin).get_view(view_type='form')
    check('department form compiles (cost centre added)', 'analytic_account_id' in v['arch'])
except Exception as e:
    check('department form compiles (cost centre added)', False, repr(e)[:200])

# Read one real record exactly as the web client does.
rec = Req.search([], limit=1)
arch_fields = list(Req.get_view(view_type='form')['models']['smartspend.request'])
data = rec.web_read({f: {} for f in arch_fields if Req._fields[f].type not in
                     ('one2many', 'many2many')})
check('an existing request opens in the form view', bool(data) and data[0]['id'] == rec.id, rec.name)

visible = set(arch_fields)
for f in ('description', 'notes', 'submitted_by_id', 'submitted_on', 'cancelled_by_id',
          'cancelled_on', 'cancel_reason', 'analytic_account_id', 'attachment_ids',
          'attachment_count', 'delegated', 'create_uid', 'currency_id'):
    check('form exposes %s' % f, f in visible)

line_arch = env['smartspend.request.line'].with_user(admin).get_view(
    view_id=None, view_type='list')
lv = str(Req.get_view(view_type='form')['arch'])
for f in ('product_uom_id', 'product_category_id', 'description', 'notes'):
    check('line list exposes %s' % f, 'name="%s"' % f in lv)
for f in ('user_id', 'state_from', 'state_to'):
    check('timeline list exposes %s' % f, 'name="%s"' % f in lv)
check('the form offers a Cancel Request button', 'action_cancel' in lv)
check('the form offers the attachments smart button', 'action_view_attachments' in lv)

# The action the header button returns must resolve.
act = rec.action_cancel()
check('Cancel Request opens the reason wizard',
      act['res_model'] == 'smartspend.request.cancel' and act['target'] == 'new', act['res_model'])
act2 = rec.action_view_attachments()
check('the attachments button opens ir.attachment filtered to this request',
      act2['res_model'] == 'ir.attachment' and ('res_id', '=', rec.id) in act2['domain'], act2['domain'])

env.cr.rollback()
print()
failed = [n for n, ok in results if not ok]
print('%s checks, %s failed' % (len(results), len(failed)))
for n in failed:
    print('  FAILED: ' + n)
