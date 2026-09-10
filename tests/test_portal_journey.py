"""The whole portal journey, exactly as the browser at :5173 performs it.

Every portal call goes over HTTP from that origin, with the headers the app
sends and no others. Odoo is inspected out of band (XML-RPC as admin) so the
journey never gets to mark its own homework.
"""
import json, os, sys, urllib.error, urllib.request, xmlrpc.client

PORTAL = os.environ.get('SMARTSPEND_PORTAL', 'http://127.0.0.1:5173')
BASE = os.environ.get('SMARTSPEND_URL', 'http://127.0.0.1:8019')
DB = os.environ.get('SMARTSPEND_DB') or os.environ.get('ODOO_DB', 'odoo_19')
KEY = os.environ['SMARTSPEND_TOKEN']

UID = xmlrpc.client.ServerProxy(BASE + '/xmlrpc/2/common').authenticate(DB, 'admin', KEY, {})

def odoo(model, method, *args, **kw):
    """Inspect and drive Odoo out of band, over JSON-RPC.

    JSON-RPC rather than XML-RPC because a button that returns nothing (like
    ``button_cancel``) cannot be marshalled back over XML-RPC at all.
    """
    payload = {'jsonrpc': '2.0', 'method': 'call', 'id': 1, 'params': {
        'service': 'object', 'method': 'execute_kw',
        'args': [DB, UID, KEY, model, method, list(args), kw]}}
    r = urllib.request.Request(BASE + '/jsonrpc', data=json.dumps(payload).encode(),
                               headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(r) as resp:
        out = json.loads(resp.read().decode())
    if out.get('error'):
        raise RuntimeError(out['error'].get('data', {}).get('message') or out['error'])
    return out.get('result')   # a method that returns nothing sends no result key

results = []
def check(name, cond, detail=''):
    results.append((name, cond))
    print(('  PASS  ' if cond else '  FAIL  ') + name + (' :: %s' % (detail,) if detail else ''))
def step(n, title):
    print('\n' + '=' * 78); print('%s  %s' % (n, title)); print('=' * 78)

def call(path, method='GET', body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Origin', PORTAL)          # exactly what the browser sends
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

# ---------------------------------------------------------------- 1. load
step('1', 'The employee opens the portal and signs in')
try:
    req = urllib.request.Request(PORTAL + '/'); req.add_header('Accept', 'text/html')
    with urllib.request.urlopen(req, timeout=5) as r:
        html = r.read().decode()
    check('the portal page is served', 'SmartSpend' in html and r.status == 200, r.status)
except Exception:
    # Every other step is the API the portal calls; the dev server only has to
    # be up if you want this one line checked too.
    print('  SKIP  the portal page is served :: %s is not running' % PORTAL)

st, login = call('/api/smartspend/login', 'POST',
                 {'login': 'phase1.requester.test', 'password': 'Phase1-Test-Pw!'})
check('POST /login succeeds', st == 200, login if st != 200 else login['user']['login'])
EMP = login['token']
check('the portal is told only the roles the account holds',
      login['user']['roles'] == ['Employee'], login['user']['roles'])

for path in ('/api/smartspend/me', '/api/smartspend/master-data', '/api/smartspend/requests'):
    st, _b = call(path, token=EMP)
    check('the three calls the app fires on load: %s' % path.split('/')[-1], st == 200, st)

st, mine = call('/api/smartspend/requests', token=EMP)
check('a new requester starts with an empty list', mine == [], len(mine))

# ------------------------------------------------------- 2. dictate a request
step('2', 'The employee dictates a requisition (Scene 2 -> the parser)')
st, parsed = call('/api/smartspend/parse', 'POST',
                  {'text': 'I need 6 Dell Latitude laptops and 6 docking stations '
                           'for the Bangalore office urgently'}, token=EMP)
check('POST /parse returns a draft', st == 200, parsed.get('id'))
REF = parsed['id']
check('it read the quantity, the branch and the urgency',
      parsed['lineItems'][0]['productQty'] == 6 and parsed['location'] == 'Bangalore Office'
      and parsed['urgency'] == 'High',
      (parsed['lineItems'][0]['productQty'], parsed['location'], parsed['urgency']))
check('the reference came from the Odoo sequence', REF.startswith('PR-'), REF)
rid = odoo('smartspend.request', 'search', [['name', '=', REF]])[0]
check('and the record really exists in Odoo', bool(rid), rid)

# ------------------------------------------- 3. the extraction form is saved
step('3', 'The employee edits the extraction form and submits it (Scene 4)')
form = dict(parsed, urgency='High', deliveryDate='Dec 15, 2026',
            location='Bangalore Office', department='IT & Infrastructure',
            expenseCategory='IT Hardware & Laptops', status='Pending Approval',
            totalCost=999999)                      # the portal's number: must be ignored
st, saved = call('/api/smartspend/submit', 'POST', form, token=EMP)
check('POST /submit saves it', st == 200, saved.get('id'))
lines = odoo('smartspend.request.line', 'search_read',
             [['request_id', '=', rid]], ['product_name', 'product_qty', 'price_unit', 'subtotal'])
expected = sum(l['product_qty'] * l['price_unit'] for l in lines)
rec = odoo('smartspend.request', 'read', [rid],
           ['state', 'total_cost', 'user_id', 'department_id', 'branch_id', 'category_id',
            'contract_id', 'contract_coverage', 'contract_match_label', 'delivery_date'])[0]
check('Odoo recomputed the total and ignored the portal\'s',
      rec['total_cost'] == expected and saved['totalCost'] == expected,
      (saved['totalCost'], rec['total_cost'], expected))
check('the free text resolved to real master records',
      all(rec[f] for f in ('department_id', 'branch_id', 'category_id')),
      [rec['department_id'], rec['branch_id'], rec['category_id']])
check('the requester is the portal account, not admin',
      rec['user_id'][1] == 'Phase 1 Test Requester', rec['user_id'])
check('the state the portal set is the state Odoo holds',
      rec['state'] == 'to_approve' and saved['status'] == 'Pending Approval', rec['state'])
check('a rate contract was matched on the way in', bool(rec['contract_id']), rec['contract_id'])
print('     -> %s  %s  total %s  %s' % (REF, rec['state'], rec['total_cost'], rec['contract_match_label']))

# ----------------------------------------------- 4. a save Odoo will refuse
step('4', 'The employee types a needed-by date in the past (the error banner)')
st, refused = call('/api/smartspend/submit', 'POST',
                   dict(saved, deliveryDate='Jan 05, 2020'), token=EMP)
check('Odoo refuses it with a real status', st == 400, st)
check('and a message the banner can show',
      isinstance(refused, dict) and 'before it was raised' in refused.get('error', ''),
      refused.get('error'))
after = odoo('smartspend.request', 'read', [rid],
             ['delivery_date', 'urgency', 'buyer_ref'])[0]
check('the bad date was not stored', str(after['delivery_date']) == '2026-12-15', after['delivery_date'])
# A refused call must leave the record exactly as it found it, not commit the
# half of the payload that happened to pass.
st, half = call('/api/smartspend/submit', 'POST',
                dict(saved, deliveryDate='Jan 05, 2020', urgency='Low', buyer='SCM-BROKEN'),
                token=EMP)
post = odoo('smartspend.request', 'read', [rid],
            ['delivery_date', 'urgency', 'buyer_ref'])[0]
check('a refused save changes nothing at all, not even the valid fields',
      st == 400 and post == after,
      [k for k in after if after[k] != post[k]])

# ------------------------------------------------------ 5. role separation
step('5', 'The employee tries to do the manager\'s and the buyer\'s job')
for path, body, who in (('/api/smartspend/decide', {'id': REF, 'decision': 'approve'}, 'approve'),
                        ('/api/smartspend/purchase-order', {'id': REF}, 'raise a PO'),
                        ('/api/smartspend/reset', {}, 'reset the demo')):
    st, denied = call(path, 'POST', body, token=EMP)
    check('a requester may not %s' % who, st == 403, (st, denied.get('error')))

# ------------------------------------------------------------ 6. approval
step('6', 'The manager approves it')
st, mgr = call('/api/smartspend/login', 'POST',
               {'login': 'phase1.manager.test', 'password': 'Phase1-Test-Pw!'})
MGR = mgr['token']
check('the manager signs in and gets manager roles',
      'Manager' in mgr['user']['roles'] and mgr['user']['is_manager'], mgr['user']['roles'])
st, queue = call('/api/smartspend/approvals', token=MGR)
check('the request is in their approval queue',
      any(r['id'] == REF for r in queue), [r['id'] for r in queue])
st, approved = call('/api/smartspend/decide', 'POST',
                    {'id': REF, 'decision': 'approve', 'comment': 'Fine, go ahead.'}, token=MGR)
check('POST /decide approves it', st == 200 and approved['status'] == 'Approved', approved.get('status'))
check('Odoo agrees', odoo('smartspend.request', 'read', [rid], ['state'])[0]['state'] == 'approved')

# --------------------------------------------------- 7. the purchase order
step('7', 'The buyer raises the purchase order')
st, ordered = call('/api/smartspend/purchase-order', 'POST', {'id': REF}, token=MGR)
check('POST /purchase-order raises it', st == 200, ordered.get('purchaseOrders'))
po_names = ordered['purchaseOrders']
check('the order reference comes back to the portal', len(po_names) == 1, po_names)
check('the request is PO Confirmed', ordered['status'] == 'PO Confirmed', ordered['status'])
po_id = odoo('purchase.order', 'search', [['name', '=', po_names[0]]])[0]
st, again = call('/api/smartspend/purchase-order', 'POST', {'id': REF}, token=MGR)
check('clicking it twice does not raise a second order',
      again['purchaseOrders'] == po_names, again['purchaseOrders'])

# ------------------------------------------- 8. today's fix, through the API
step('8', "The buyer cancels the order, then raises a replacement (today's fix)")
odoo('purchase.order', 'button_cancel', [po_id])
rec = odoo('smartspend.request', 'read', [rid],
           ['state', 'purchase_order_count', 'purchase_order_live_count'])[0]
check('cancelling takes the request back out of PO Confirmed',
      rec['state'] == 'approved', rec['state'])
check('no order stands, but the cancelled one is kept as history',
      rec['purchase_order_live_count'] == 0 and rec['purchase_order_count'] == 1,
      (rec['purchase_order_live_count'], rec['purchase_order_count']))
tl = odoo('smartspend.request.history', 'search_read', [['request_id', '=', rid]],
          ['title', 'state_from', 'state_to'], order='event_date, id')
check('the cancellation is on the timeline',
      tl[-1]['title'] == 'Purchase Order Cancelled' and tl[-1]['state_to'] == 'approved', tl[-1])
st, replaced = call('/api/smartspend/purchase-order', 'POST', {'id': REF}, token=MGR)
check('the portal can now raise a replacement', st == 200, replaced.get('error'))
check('and it is a different order',
      len(replaced['purchaseOrders']) == 2 and replaced['purchaseOrders'] != po_names,
      replaced['purchaseOrders'])
check('the request is PO Confirmed again', replaced['status'] == 'PO Confirmed', replaced['status'])

# --------------------------------------------- 9. the rate-contract button
step('9', "The rate-contract smart button, as the Odoo form renders it")
rec = odoo('smartspend.request', 'read', [rid],
           ['contract_id', 'contract_match_label', 'contract_coverage'])[0]
cid = rec['contract_id'][0]
card = odoo('smartspend.contract.line', 'search_count', [['contract_id', '=', cid]])
matched = odoo('smartspend.contract', 'read', [cid], ['matched_line_ids'],
               context={'smartspend_request_id': rid})[0]['matched_line_ids']
priced = odoo('smartspend.request.line', 'search_count',
              [['request_id', '=', rid], ['contract_line_id', '!=', False]])
items = odoo('smartspend.request.line', 'search_count', [['request_id', '=', rid]])
print('     button: "%s"  ·  "%s"   (card holds %s rates)' % (
    rec['contract_id'][1], rec['contract_match_label'], card))
check('the label counts the request\'s items, not the rate card',
      rec['contract_match_label'] == '%s of %s items priced' % (priced, items),
      rec['contract_match_label'])
check('it agrees with Lines Covered (%)',
      round(100.0 * priced / items) == round(rec['contract_coverage']),
      (rec['contract_match_label'], rec['contract_coverage']))
check('the tab holds only the rates that price this request',
      len(matched) == priced and len(matched) <= card, (len(matched), priced, card))

# ------------------------------------------------------------- 10. sign out
step('10', 'Sign out')
st, out = call('/api/smartspend/logout', 'POST', {}, token=EMP)
check('POST /logout returns ok', st == 200 and out == {'ok': True}, out)
st, _ = call('/api/smartspend/me', token=EMP)
check('the revoked token stops working', st == 401, st)
st, _ = call('/api/smartspend/me', token=MGR)
check("and the manager's token is untouched", st == 200, st)

print('\n' + '=' * 78)
failed = [n for n, c in results if not c]
print('%s checks, %s failed' % (len(results), len(failed)))
for n in failed:
    print('  FAILED: ' + n)
sys.exit(1 if failed else 0)
