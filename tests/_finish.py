"""End of run: drop the baseline marker and revoke the API keys the suites minted."""
Param = env['ir.config_parameter'].sudo()
Param.search([('key', '=', 'smartspend.test.baseline_ids')]).unlink()
keys = env['res.users.apikeys'].sudo().search([('name', 'like', 'SmartSpend Phase1%')])
print('revoking %s regression key(s)' % len(keys))
keys._remove()
env.cr.commit()
