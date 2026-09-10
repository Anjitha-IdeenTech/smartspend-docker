"""Regression: the portal's API contract must be byte-for-byte what it was."""
import json, os, sys, urllib.error, urllib.request

BASE = os.environ.get('SMARTSPEND_URL', 'http://127.0.0.1:8019')
DB = os.environ.get('SMARTSPEND_DB', '')
TOKEN = os.environ['SMARTSPEND_TOKEN']

# The exact key set _to_portal_dict emitted BEFORE Phase 1 (read off the
# pre-change source). The portal replaces its local copy with this object, so
# it may not gain or lose a key.
BASELINE_KEYS = {
    'id','productName','productQty','targetPrice','totalCost','location','department',
    'expenseCategory','status','urgency','createdDate','deliveryDate','buyer','vendor',
    'savings','selectedSourcingMethod','attachments','lineItems','history',
    'clarificationComments','vendorBids','contract','contractVendor','contractCoverage',
    'purchaseOrders','expenseType','budgetName','budgetAvailable','budgetBreach',
    # The two release steps. They were component state in the portal, so they
    # never crossed the API; stored on the request, they have to.
    'poReleased','poAcknowledged',
}
BASELINE_MASTER_KEYS = {'branches','departments','categories','urgencies','sourcingMethods','statuses'}

results = []
def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (' :: ' + str(detail) if detail else ''))

def call(path, method='GET', body=None, token=TOKEN):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if DB:
        req.add_header('X-Odoo-Database', DB)
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
            return e.code, raw

print('=' * 70)
print('API CONTRACT REGRESSION  (existing endpoints, existing shapes)')
print('=' * 70)

# ---- 1. /me -----------------------------------------------------------
st, me = call('/api/smartspend/me')
check('GET /me returns 200', st == 200, st)
check('GET /me keys unchanged',
      set(me) == {'id','name','login','email','is_manager','is_buyer','roles','defaultRole','company'},
      sorted(me) if isinstance(me, dict) else me)

# ---- 2. bearer still enforced ----------------------------------------
st, _ = call('/api/smartspend/me', token=None)
check('GET /me without a token is 401', st == 401, st)

# ---- 3. /master-data --------------------------------------------------
st, md = call('/api/smartspend/master-data')
check('GET /master-data returns 200', st == 200, st)
check('GET /master-data keys unchanged', set(md) == BASELINE_MASTER_KEYS, sorted(md))
check('master-data statuses keeps the 8 the portal knows, in order',
      md['statuses'][:8] == ['Draft','Pending Approval','Needs Clarification','Sourcing',
                             'Approved','PO Confirmed','Rejected','Paid'], md['statuses'])
check('master-data statuses gained Cancelled at the end (portal ignores this list)',
      md['statuses'][8:] == ['Cancelled'], md['statuses'])
check('master-data branches shape unchanged',
      set(md['branches'][0]) == {'id','name','code','city'}, sorted(md['branches'][0]))
check('master-data departments shape unchanged',
      set(md['departments'][0]) == {'id','name','code','approver'}, sorted(md['departments'][0]))

# ---- 4. GET /requests -------------------------------------------------
st, reqs = call('/api/smartspend/requests')
check('GET /requests returns 200', st == 200, st)
# Whatever was there before this run must still be there after it.
check('GET /requests returns the requests that were already there',
      len(reqs) >= 1, len(reqs))
baseline_ids = {r['id'] for r in reqs}
bad = [r['id'] for r in reqs if set(r) != BASELINE_KEYS]
check('GET /requests: every record has exactly the baseline keys', not bad,
      (sorted(set(reqs[0]) ^ BASELINE_KEYS) if bad else ''))
check('GET /requests: totals are server-computed',
      all(abs(r['totalCost'] - sum(l['productQty'] * l['targetPrice'] for l in r['lineItems'])) < 0.01
          for r in reqs), [(r['id'], r['totalCost']) for r in reqs])

# ---- 5. POST /submit — the exact payload the portal builds -------------
payload = {
    "id": "PR-2026-0999",
    "productName": "Dell Latitude 5440 Laptop",
    "productQty": 5, "targetPrice": 70000, "totalCost": 999999,   # portal's number: must be ignored
    "location": "Bangalore Office", "department": "IT & Infrastructure",
    "expenseCategory": "IT Hardware & Laptops",
    "lineItems": [
        {"productName": "Dell Latitude 5440 Laptop", "productQty": 5, "targetPrice": 70000},
        {"productName": "USB-C Docking Station", "productQty": 5, "targetPrice": 8500},
    ],
    "status": "Pending Approval", "urgency": "High",
    "deliveryDate": "Dec 25, 2026",
    "createdDate": "August 31, 10:00",
    "buyer": "SCM-IT-14", "vendor": "Pending Sourcing", "savings": 0,
    "history": [{"title": "Request Submitted", "date": "Now", "desc": "Submitted via extraction panel"}],
    "clarificationComments": [], "vendorBids": [],
    "selectedSourcingMethod": "RFQ", "attachments": ["specs.pdf"],
}
st, created = call('/api/smartspend/submit', 'POST', payload)
check('POST /submit returns 200', st == 200, created if st != 200 else '')
check('POST /submit response has exactly the baseline keys',
      isinstance(created, dict) and set(created) == BASELINE_KEYS,
      sorted(set(created) ^ BASELINE_KEYS) if isinstance(created, dict) else created)
check('POST /submit: record created and echoed', created.get('id') == 'PR-2026-0999', created.get('id'))
check('POST /submit: Odoo recomputed the total, not the portal (5*70000 + 5*8500 = 392500)',
      created['totalCost'] == 392500.0, created['totalCost'])
check('POST /submit: status round-trips as a portal label',
      created['status'] == 'Pending Approval', created['status'])
check('POST /submit: lineItems shape unchanged',
      set(created['lineItems'][0]) == {'productName','productQty','targetPrice'},
      sorted(created['lineItems'][0]))
check('POST /submit: history shape unchanged',
      set(created['history'][0]) == {'title','date','desc'}, sorted(created['history'][0]))
check('POST /submit: dates come back in the portal formats',
      created['deliveryDate'] == 'Dec 25, 2026' and ',' in created['createdDate'],
      (created['deliveryDate'], created['createdDate']))
check('POST /submit: attachments echoed', created['attachments'] == ['specs.pdf'], created['attachments'])
first_history = list(created['history'])

# ---- 6. history is now additive, not overwritten -----------------------
payload2 = dict(payload, urgency="Medium", history=list(created['history']))
st, updated = call('/api/smartspend/submit', 'POST', payload2)
check('POST /submit (update) returns 200', st == 200, updated if st != 200 else '')
check('POST /submit (update): urgency changed', updated['urgency'] == 'Medium', updated['urgency'])
check('POST /submit (update): timeline not duplicated by the round-trip',
      len(updated['history']) == len(first_history),
      (len(first_history), len(updated['history'])))
titles = [h['title'] for h in updated['history']]
check('POST /submit (update): the portal-authored entry survived',
      'Request Submitted' in titles, titles)

# ---- 7. server-authored history survives a portal save -----------------
# Simulate the real race: Odoo writes an entry, then the portal saves the copy
# it read BEFORE that entry existed. It used to wipe it.
st, _ = call('/api/smartspend/decide', 'POST',
             {'id': 'PR-2026-0999', 'decision': 'clarify', 'comment': 'Which floor is this for?'})
st, after_decide = call('/api/smartspend/requests')
mine = [r for r in after_decide if r['id'] == 'PR-2026-0999'][0]
server_titles = [h['title'] for h in mine['history']]
check('Odoo wrote its own timeline entry', 'Info Requested' in server_titles, server_titles)
# The portal now posts its STALE copy back (payload2's history, without the new entry).
st, stale = call('/api/smartspend/submit', 'POST', dict(payload, history=first_history))
stale_titles = [h['title'] for h in stale['history']]
check('a stale portal save no longer erases the entry Odoo wrote',
      'Info Requested' in stale_titles, stale_titles)

# ---- 8. quantity/price coming off a free-typed portal box --------------
st, clamped = call('/api/smartspend/submit', 'POST', dict(
    payload, id='PR-2026-0998',
    lineItems=[{"productName": "Ergonomic Office Chair", "productQty": 0, "targetPrice": -100}]))
check('POST /submit survives an emptied quantity box', st == 200, clamped if st != 200 else '')
check('an emptied quantity is stored as one unit, never zero',
      clamped['lineItems'][0]['productQty'] == 1, clamped['lineItems'][0])
check('a negative unit price is stored as zero',
      clamped['lineItems'][0]['targetPrice'] == 0.0, clamped['lineItems'][0])

# ---- 9. /parse ---------------------------------------------------------
st, parsed = call('/api/smartspend/parse', 'POST',
                  {'text': 'I need 12 Dell Latitude laptops for the Mumbai office urgently'})
check('POST /parse returns 200', st == 200, parsed if st != 200 else '')
check('POST /parse response has exactly the baseline keys',
      isinstance(parsed, dict) and set(parsed) == BASELINE_KEYS,
      sorted(set(parsed) ^ BASELINE_KEYS) if isinstance(parsed, dict) else parsed)
check('POST /parse: reference came from the Odoo sequence',
      parsed['id'].startswith('PR-'), parsed['id'])
check('POST /parse: quantity and branch extracted',
      parsed['lineItems'][0]['productQty'] == 12 and parsed['location'] == 'Mumbai Office',
      (parsed['lineItems'][0], parsed['location']))

# ---- 10. other read routes still answer --------------------------------
for path in ('/api/smartspend/approvals', '/api/smartspend/contracts',
             '/api/smartspend/vendors', '/api/smartspend/products', '/api/smartspend/budgets'):
    st, _b = call(path)
    check('GET %s returns 200' % path, st == 200, st)

# ---- 11. nothing pre-existing was disturbed --------------------------
st, final = call('/api/smartspend/requests')
check('every request that existed before this run still exists',
      baseline_ids <= {r['id'] for r in final},
      sorted(baseline_ids - {r['id'] for r in final}))

print()
failed = [r for r in results if not r[1]]
print('%s checks, %s failed' % (len(results), len(failed)))
sys.exit(1 if failed else 0)
