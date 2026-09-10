from odoo import fields
admin = env.ref('base.user_admin')
e = env(user=admin.id)
exp = fields.Datetime.add(fields.Datetime.now(), days=1)
tok = e['res.users.apikeys'].sudo()._generate('rpc', 'SmartSpend Phase1 Regression', exp)
print('TOKEN_ADMIN=' + tok)
env.cr.commit()
