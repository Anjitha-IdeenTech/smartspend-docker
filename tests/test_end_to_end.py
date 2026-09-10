"""End to end, exactly as the browser at http://127.0.0.1:5173 does it.

Same origin header, same headers, same order, same payload shapes, NO
X-Odoo-Database header — against an Odoo whose database is resolvable.
"""
import json, os, sys, urllib.error, urllib.request

BASE = os.environ.get('SMARTSPEND_URL', 'http://127.0.0.1:8019')
DB = os.environ.get('SMARTSPEND_DB', '')
ORIGIN = 'http://127.0.0.1:5173'
results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS  ' if ok else 'FAIL  ') + name + (' :: %s' % (detail,) if detail else ''))

def call(path, method='GET', body=None, token=None, preflight=False):
    if preflight:
        req = urllib.request.Request(BASE + path, method='OPTIONS')
        req.add_header('Origin', ORIGIN)
        req.add_header('Access-Control-Request-Method', method)
        req.add_header('Access-Control-Request-Headers', 'content-type,authorization')
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Origin', ORIGIN)
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:200]

print('=' * 70)
print('END TO END  —  portal at %s  ->  Odoo  ->  record' % ORIGIN)
print('=' * 70)

# 1. preflight, as the browser sends before the credentialed POST
st, hdrs = call('/api/smartspend/login', 'POST', preflight=True)
check('CORS preflight on /login is allowed', st in (200, 204), st)
check('preflight allows the portal origin', hdrs.get('Access-Control-Allow-Origin') == '*',
      hdrs.get('Access-Control-Allow-Origin'))

# 2. sign in with real Odoo credentials — the portal's SignInScreen
st, login = call('/api/smartspend/login', 'POST',
                 {'login': 'phase1.requester.test', 'password': 'Phase1-Test-Pw!'})
check('POST /login signs a requester in', st == 200, login if st != 200 else login.get('user', {}).get('login'))
token = login.get('token')
check('POST /login returns a bearer token and the user', bool(token) and set(login) == {'token', 'user'}, sorted(login))
check('roles come from real Odoo groups, not a dropdown',
      login['user']['roles'] == ['Employee'] and login['user']['defaultRole'] == 'Employee',
      (login['user']['roles'], login['user']['defaultRole']))

# 3. the three calls the portal fires on load
st, me = call('/api/smartspend/me', token=token)
check('GET /me on load', st == 200, st)
st, md = call('/api/smartspend/master-data', token=token)
check('GET /master-data on load', st == 200 and md['branches'], len(md.get('branches', [])))
st, before = call('/api/smartspend/requests', token=token)
check('GET /requests on load', st == 200, st)
check('a brand-new requester starts with an empty list', before == [], len(before))

# 4. raise a request — exactly what createRequisitionFromForm() posts
new_request = {
    "id": "PR-2026-0901",
    "productName": "Dell Latitude 5440 Laptop",
    "productQty": 3, "targetPrice": 70000, "totalCost": 210000,
    "location": "Bangalore Office", "department": "IT & Infrastructure",
    "expenseCategory": "IT Hardware & Laptops",
    "lineItems": [
        {"productName": "Dell Latitude 5440 Laptop", "productQty": 3, "targetPrice": 70000},
        {"productName": "USB-C Docking Station", "productQty": 3, "targetPrice": 8500},
    ],
    "status": "Pending Approval", "urgency": "High",
    "deliveryDate": "Sep 25, 2026",
    "createdDate": "Aug 31, 10:30",
    "buyer": "SCM-IT-14", "vendor": "Pending Sourcing", "savings": 0,
    "history": [{"title": "Request Submitted", "date": "Now", "desc": "Submitted via extraction panel"}],
    "clarificationComments": [], "vendorBids": [],
    "selectedSourcingMethod": "RFQ", "attachments": ["hardware_specifications.pdf"],
}
st, saved = call('/api/smartspend/submit', 'POST', new_request, token=token)
check('POST /submit creates the request', st == 200, saved if st != 200 else saved.get('id'))
check('the reference the portal chose was honoured', saved['id'] == 'PR-2026-0901', saved['id'])
check('Odoo, not the portal, computed the total (3*70000 + 3*8500 = 235500)',
      saved['totalCost'] == 235500.0, saved['totalCost'])
check('both lines landed', len(saved['lineItems']) == 2, saved['lineItems'])
check('branch, department and category round-trip',
      (saved['location'], saved['department'], saved['expenseCategory']) ==
      ('Bangalore Office', 'IT & Infrastructure', 'IT Hardware & Laptops'),
      (saved['location'], saved['department'], saved['expenseCategory']))
check('the state the portal set is the state Odoo holds',
      saved['status'] == 'Pending Approval', saved['status'])
check('Odoo matched a rate contract on the way in', bool(saved['contract']), saved['contract'])
check('Odoo answered with the budget it was checked against',
      'budgetName' in saved and 'budgetBreach' in saved, (saved['budgetName'], saved['budgetBreach']))

# 5. the portal reloads and sees it
st, after = call('/api/smartspend/requests', token=token)
check('the new request comes back on the next load',
      st == 200 and [r['id'] for r in after] == ['PR-2026-0901'], [r['id'] for r in after])
check('the reloaded copy is identical to the one POST returned',
      after[0] == saved, 'differs')

# 6. the portal edits it (its sync effect re-POSTs the whole record)
st, edited = call('/api/smartspend/submit', 'POST',
                  dict(saved, urgency='Medium', deliveryDate='Oct 10, 2026'), token=token)
check('POST /submit updates in place', st == 200 and edited['id'] == 'PR-2026-0901', edited.get('id'))
check('the edit stuck', (edited['urgency'], edited['deliveryDate']) == ('Medium', 'Oct 10, 2026'),
      (edited['urgency'], edited['deliveryDate']))
check('editing did not duplicate the request', len(call('/api/smartspend/requests', token=token)[1]) == 1)

# 7. a requester may not act as a manager or a buyer
st, denied = call('/api/smartspend/decide', 'POST',
                  {'id': 'PR-2026-0901', 'decision': 'approve'}, token=token)
check('a requester cannot approve their own request', st == 403, (st, denied))
st, denied = call('/api/smartspend/purchase-order', 'POST', {'id': 'PR-2026-0901'}, token=token)
check('a requester cannot raise a purchase order', st == 403, (st, denied))
st, denied = call('/api/smartspend/reset', 'POST', {}, token=token)
check('a requester cannot reset the demo data', st == 403, (st, denied))

# 8. a requester cannot see anybody else's request
st, others = call('/api/smartspend/requests', token=token)
check('the requester still sees only their own request', len(others) == 1, len(others))

# 9. sign out revokes the token
st, out = call('/api/smartspend/logout', 'POST', {}, token=token)
check('POST /logout returns ok', st == 200 and out == {'ok': True}, out)
st, _ = call('/api/smartspend/me', token=token)
check('the revoked token no longer works', st == 401, st)

print()
failed = [n for n, ok in results if not ok]
print('%s checks, %s failed' % (len(results), len(failed)))
for n in failed:
    print('  FAILED: ' + n)
sys.exit(1 if failed else 0)
