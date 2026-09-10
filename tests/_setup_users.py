"""Create the two throwaway accounts the suites sign in as, and snapshot the
database so the teardown can remove exactly what this run creates and nothing
else."""
U = env['res.users'].with_context(active_test=False)


def ensure(login, name, group):
    vals = {'name': name, 'login': login, 'password': 'Phase1-Test-Pw!',
            'group_ids': [(6, 0, [env.ref(group).id])]}
    user = U.search([('login', '=', login)], limit=1)
    if user:
        user.write(dict(vals, active=True))
    else:
        user = U.create(vals)
    return user


requester = ensure('phase1.requester.test', 'Phase 1 Test Requester',
                   'smartspend.group_smartspend_user')
manager = ensure('phase1.manager.test', 'Phase 1 Test Manager',
                 'smartspend.group_smartspend_manager')

# Every request that existed when the run started is off limits to the
# teardown. Recorded once: the suites run in sequence and each teardown clears
# up after the one before it, all against this same baseline.
Param = env['ir.config_parameter'].sudo()
if not Param.get_param('smartspend.test.baseline_ids'):
    existing = env['smartspend.request'].sudo().with_context(active_test=False).search([]).ids
    Param.set_param('smartspend.test.baseline_ids', ','.join(str(i) for i in existing) or '0')
    print('BASELINE=%s requests' % len(existing))

print('REQUESTER=%s MANAGER=%s' % (requester.id, manager.id))
env.cr.commit()
