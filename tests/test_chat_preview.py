"""The New Request chat's read of a message: /parse-preview, over HTTP.

What each message is read as, what it is said to have named (so the chat asks
for the rest), and that reading a message saves nothing — the draft request is
only created when the requester submits.
"""
import json, os, urllib.error, urllib.request

BASE = os.environ.get('SMARTSPEND_URL', 'http://127.0.0.1:8019')
DB = os.environ.get('SMARTSPEND_DB', '')
TOKEN = os.environ['SMARTSPEND_TOKEN']

ok = []
def check(name, passed, detail=''):
    ok.append(bool(passed))
    print(('PASS  ' if passed else 'FAIL  ') + name + (' :: ' + str(detail) if detail else ''))

def call(path, method='GET', body=None, token=TOKEN):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header('Content-Type', 'application/json')
    if DB:
        req.add_header('X-Odoo-Database', DB)
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b'null')
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b'null')

preview = lambda text: call('/api/smartspend/parse-preview', 'POST', {'text': text})
before = len(call('/api/smartspend/requests')[1])

code, d = preview('I need 20 laptops and 20 docking stations for the Bangalore IT team')
check('a full sentence: both items, with quantities', code == 200 and [(l['productName'], l['productQty']) for l in d['lineItems']]
      == [('Dell Latitude 5440 Laptop', 20), ('USB-C Docking Station', 20)], d.get('lineItems'))
check('and says it named the branch and department', d['found'] == {'products': True, 'quantity': True, 'location': True, 'department': True}, d['found'])
check('priced at the catalogue rate', d['lineItems'][0]['targetPrice'] == 70000, d['lineItems'][0]['targetPrice'])

code, d = preview('for Mumbai')
check('a detail alone names a branch, not a product', d['found']['location'] and not d['found']['products'] and d['location'] == 'Mumbai Office', d['found'])

code, d = preview('some monitors')
check('a product with no number: quantity not stated', d['found']['products'] and not d['found']['quantity'], d['found'])
code, d = preview('twelve chairs')
check('a spelled-out number is a quantity', d['found']['quantity'] and d['lineItems'][0]['productQty'] == 12, d['lineItems'])
code, d = preview('a laptop')
check('"a laptop" is not a considered quantity', not d['found']['quantity'], d['found'])
code, d = preview('need office supplies')
check('nothing in the catalogue: not reported as a product', not d['found']['products'], d['found'])

code, d = call('/api/smartspend/parse-preview', 'POST', {'text': '', 'items': [{'productName': 'USB-C Docking Station', 'productQty': 3}]})
check('a staged item alone is priced from the catalogue', code == 200 and d['lineItems'][0]['targetPrice'] == 8500, d.get('lineItems'))

check('reading messages saved nothing', len(call('/api/smartspend/requests')[1]) == before)
check('an empty message is refused', preview('')[0] == 400)
check('no token, no preview', call('/api/smartspend/parse-preview', 'POST', {'text': 'laptop'}, token=None)[0] == 401)

print()
print('%s checks, %s failed' % (len(ok), ok.count(False)))
