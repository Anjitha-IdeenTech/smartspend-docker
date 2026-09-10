"""Remove exactly what this run created — never anything that predates it.

The baseline is the set of request ids that existed when _setup_users.py ran.
Anything outside it was made by the suites, so only that is removed. A request
raised by a real user before the run is therefore never at risk.
"""
Param = env['ir.config_parameter'].sudo()
raw = Param.get_param('smartspend.test.baseline_ids')
if raw is False or raw is None:
    print('no baseline recorded — refusing to delete anything')
else:
    baseline = {int(i) for i in raw.split(',') if i and i != '0'}
    Req = env['smartspend.request'].sudo().with_context(active_test=False)
    doomed = Req.search([]).filtered(lambda r: r.id not in baseline)
    print('removing requests created by this run:', doomed.mapped('name') or 'none')
    orders = doomed.purchase_order_ids.filtered(lambda o: o.state in ('draft', 'sent'))
    orders.button_cancel()
    doomed.unlink()

    survivors = set(Req.search([]).ids)
    missing = baseline - survivors
    assert not missing, 'a pre-existing request went missing: %s' % sorted(missing)
    print('requests left:', len(survivors))
    print('BASELINE INTACT')

users = env['res.users'].sudo().with_context(active_test=False).search(
    [('login', 'in', ['phase1.requester.test', 'phase1.manager.test'])])
print('removing test users:', users.mapped('login') or 'none')
users.unlink()
env.cr.commit()
