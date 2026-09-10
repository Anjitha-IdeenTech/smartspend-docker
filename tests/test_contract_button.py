results = []
def check(n, c, d=''):
    results.append((n, c)); print(('PASS  ' if c else 'FAIL  ') + n + (' :: %s' % (d,) if d else ''))

admin = env.ref('base.user_admin')
Req = env['smartspend.request'].with_user(admin)
Contract = env['smartspend.contract'].with_user(admin)

print('=' * 74); print('RATE CONTRACT BUTTON -> CONTRACT FORM'); print('=' * 74)

for r in Req.search([('contract_id', '!=', False)], order='id'):
    act = r.action_view_contract()
    check('%s: lands on the contract form, not a list' % r.name,
          act['res_model'] == 'smartspend.contract' and act['view_mode'] == 'form'
          and act['res_id'] == r.contract_id.id, (act['res_model'], act['view_mode']))
    check('%s: carries the request in context' % r.name,
          act['context'].get('smartspend_request_id') == r.id)

    # what the form actually renders, with that context
    c = Contract.browse(r.contract_id.id).with_context(**act['context'])
    matched = c.matched_line_ids.mapped('product_name')
    covered = r.line_ids.filtered('contract_line_id').contract_line_id.mapped('product_name')
    print('\n  %s -> %s' % (r.name, r.contract_id.name))
    print('    tab "Rates for This Request" (%s): %s' % (len(matched), matched))
    print('    tab "Contracted Rates"       (%s): %s' % (c.line_count, c.line_ids.mapped("product_name")))
    check('%s: the tab holds exactly this request\'s rates' % r.name,
          sorted(matched) == sorted(covered), (sorted(matched), sorted(covered)))
    check('%s: the tab is a strict slice of the card' % r.name,
          set(matched) <= set(c.line_ids.mapped('product_name')) and len(matched) <= c.line_count)
    check('%s: the form knows which request opened it' % r.name,
          c.matched_request_id == r, c.matched_request_id.name)

print()
# opened from the menu: no request context, tab hidden, whole card intact
plain = Contract.search([], limit=1)
check('opened from the menu the tab is empty, so it is hidden',
      not plain.matched_request_id and not plain.matched_line_ids)
check('and the full card is still all there', plain.line_count == len(plain.line_ids), plain.line_count)

# a crafted context must not leak another user's request
other = env['res.users'].sudo().create({
    'name': 'Ctx Probe', 'login': 'phase1.ctxprobe.test',
    'group_ids': [(6, 0, [env.ref('smartspend.group_smartspend_user').id])]})
victim = Req.search([('contract_id', '!=', False)], limit=1)
probed = env['smartspend.contract'].with_user(other).browse(victim.contract_id.id).with_context(
    smartspend_request_id=victim.id)
check("a crafted context cannot expose a request the user may not read",
      not probed.matched_request_id and not probed.matched_line_ids,
      (probed.matched_request_id.name, probed.matched_line_ids.mapped('product_name')))

# The guard turns on who is asking, so the cache must be keyed on the reader
# too — otherwise whoever computes first hands their answer to everyone else
# in the same transaction. Both orders, because each leaks a different way.
for first, second, label in ((admin, other, 'privileged reader first'),
                             (other, admin, 'unprivileged reader first')):
    env.invalidate_all()
    a = env['smartspend.contract'].with_user(first).browse(victim.contract_id.id).with_context(
        smartspend_request_id=victim.id)
    a.matched_line_ids  # prime the cache as this user
    b = env['smartspend.contract'].with_user(second).browse(victim.contract_id.id).with_context(
        smartspend_request_id=victim.id)
    expected = bool(second == admin)
    check('%s: each reader gets their own answer, not the cached one' % label,
          bool(b.matched_line_ids) == expected,
          (second.login, b.matched_line_ids.mapped('product_name')))
check('and the contract itself still renders for them', bool(probed.name), probed.name)

# views compile
for vt in ('form', 'list', 'search'):
    try:
        Contract.get_view(view_type=vt); check('contract %s view compiles' % vt, True)
    except Exception as e:
        check('contract %s view compiles' % vt, False, repr(e)[:140])
arch = Contract.get_view(view_type='form')['arch']
check('the form exposes the matched-rates tab', 'matched_line_ids' in arch and 'matched_request_id' in arch)
check('the whole-card tab is still there', 'name="rates"' in arch)
try:
    Req.get_view(view_type='form'); check('request form still compiles', True)
except Exception as e:
    check('request form still compiles', False, repr(e)[:140])

print()
print('-' * 74)
print('THE SMART BUTTON LABEL')
print('-' * 74)
for r in Req.search([('contract_id', '!=', False)], order='id'):
    priced = len(r.line_ids.filtered('contract_line_id'))
    items = len(r.line_ids)
    c = Contract.browse(r.contract_id.id).with_context(smartspend_request_id=r.id)
    print('  %-13s "%s"  ·  "%s"   cover=%.0f%%  unpriced=%s' % (
        r.name, r.contract_reference, r.contract_match_label,
        r.contract_coverage, c.matched_unpriced or '-'))
    # The label is counted against the request's own items, so it can never
    # read "fully covered" while an item is going unpriced.
    check('%s: the label counts the request, not the rate card' % r.name,
          r.contract_match_label == '%s of %s items priced' % (priced, items),
          r.contract_match_label)
    check('%s: the label agrees with Lines Covered (%%)' % r.name,
          round(100.0 * priced / items) == round(r.contract_coverage),
          (r.contract_match_label, r.contract_coverage))
    check('%s: every unpriced item is named' % r.name,
          sorted(filter(None, (c.matched_unpriced or '').split(', '))) ==
          sorted(r.line_ids.filtered(lambda l: not l.contract_line_id).mapped('product_name')),
          c.matched_unpriced)
arch = Req.get_view(view_type='form')['arch']
check('the unsupported integer widget on the Float is gone',
      'name="contract_coverage" widget="integer"' not in arch)
check('the stat button renders a Char label instead',
      'name="contract_match_label"' in arch)
check('contract_coverage is untouched, so the API value is unchanged',
      env['smartspend.request']._fields['contract_coverage'].type == 'float')

print()
print('-' * 74)
print('ORDERS ON CONTRACT')
print('-' * 74)
PO = env['purchase.order'].sudo()
print('  %-13s %-9s %-8s %s' % ('CONTRACT', 'BUTTON', 'LIVE', 'CANCELLED'))
for c in Contract.search([], order='name'):
    all_po = c.sudo().purchase_order_ids
    live = all_po.filtered(lambda o: o.state != 'cancel')
    print('  %-13s %-9s %-8s %s' % (c.name, c.purchase_order_count, len(live), len(all_po) - len(live)))
    # A cancelled order is not spend under the agreement, and the list behind
    # the button must show exactly what the button counted.
    check('%s: the order count is live orders only' % c.name,
          c.purchase_order_count == len(live), (c.purchase_order_count, len(live)))
    opened = PO.search(c.action_view_purchase_orders()['domain'])
    check('%s: the order list matches its count' % c.name,
          opened == live, (len(opened), c.purchase_order_count))
    check('%s: no cancelled order is listed' % c.name,
          not opened.filtered(lambda o: o.state == 'cancel'),
          opened.filtered(lambda o: o.state == 'cancel').mapped('name'))

# and it tracks state, rather than being a one-off filter
rc = Contract.search([], order='name', limit=1)
dead = rc.sudo().purchase_order_ids.filtered(lambda o: o.state == 'cancel')[:1]
if dead:
    before = rc.purchase_order_count
    dead.write({'state': 'draft'})
    rc.invalidate_recordset(['purchase_order_count'])
    check('reviving a cancelled order puts it back in the count',
          rc.purchase_order_count == before + 1, (before, rc.purchase_order_count))
    dead.write({'state': 'cancel'})
    rc.invalidate_recordset(['purchase_order_count'])
    check('and cancelling it again removes it', rc.purchase_order_count == before,
          rc.purchase_order_count)

env.cr.rollback()
print()
failed = [n for n, c in results if not c]
print('%s checks, %s failed' % (len(results), len(failed)))
for n in failed: print('  FAILED: ' + n)
