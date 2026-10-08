"""The printable documents: /api/smartspend/document, over HTTP.

Five documents come from one endpoint, so this checks each one carries the
record it claims — the order's own number and totals, the receipt's ordered
against received, the invoice's payment state — that none of them is composed
out of thin air, and that a supplier cannot print another supplier's order.

Reads only: the endpoint is readonly, and this suite asserts the request count
is unchanged after every document has been printed.
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
    req = urllib.request.Request(BASE + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 method=method)
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


def sign_in(login, password):
    code, body = call('/api/smartspend/login', 'POST',
                      {'login': login, 'password': password}, token=None)
    return body.get('token') if code == 200 else None


def document(kind, reference, token=TOKEN):
    return call('/api/smartspend/document', 'POST', {'kind': kind, 'id': reference}, token=token)


before = len(call('/api/smartspend/requests')[1])
requests = call('/api/smartspend/requests')[1]
settled = next((r for r in requests if r['status'] == 'Paid'), None)
ordered = next((r for r in requests if r['status'] in ('PO Confirmed', 'Paid')), None)
anyone = requests[0] if requests else None

# ---------------------------------------------------------------- the request
code, doc = document('request', anyone['id'])
check('a request prints as a Purchase Request',
      code == 200 and doc['docType'] == 'Purchase Request' and doc['reference'] == anyone['id'],
      doc.get('error') or doc.get('reference'))
check('with the lines the request actually holds',
      len(doc['lines']) == len(anyone['lineItems'])
      and doc['lines'][0]['product'] == anyone['lineItems'][0]['productName'],
      doc['lines'][:1])
check('its branch and department on the face of it',
      any(f['value'] == anyone['location'] for f in doc['facts'])
      and any(f['value'] == anyone['department'] for f in doc['facts']))
check('a total in words, in Indian numbering',
      doc['amountInWords'].endswith('only')
      and ('lakh' in doc['amountInWords'] or 'thousand' in doc['amountInWords']
           or 'rupees' in doc['amountInWords']),
      doc['amountInWords'])
check('and the company it is issued by', bool(doc['company']['name']), doc['company'])

# ------------------------------------------------------------------ the order
if ordered:
    code, po = document('po', ordered['id'])
    check('a confirmed request prints a Purchase Order',
          code == 200 and po['docType'] == 'Purchase Order' and po['reference'].startswith('P'),
          po.get('error') or po.get('reference'))
    check('the order names the supplier it went to',
          any(p['role'] == 'Supplier' and p['name'] for p in po['parties']), po['parties'][:1])
    check('and says which request it answers',
          any(f['value'] == ordered['id'] for f in po['facts']))
    check('its total is the strong line of the totals block',
          any(t.get('strong') and t['value'].startswith('₹') for t in po['totals']), po['totals'])

    # ---------------------------------------------------------- goods receipt
    code, grn = document('grn', ordered['id'])
    if code == 200:
        check('a receipt prints ordered against received',
              grn['docType'] == 'Goods Receipt Note'
              and [c['label'] for c in grn['columns']][1:3] == ['Ordered', 'Received'],
              [c['label'] for c in grn['columns']])
        check('and says where its numbers come from', 'received' in (grn['note'] or '').lower(),
              grn.get('note'))
        check('numbered from the order it belongs to', grn['reference'].endswith(po['reference']),
              grn['reference'])
    else:
        check('nothing received yet is refused in words, not a crash',
              code == 404 and 'received' in (grn.get('error') or '').lower(), grn)

# ---------------------------------------------------------------- the invoice
if settled:
    code, bill = document('invoice', settled['id'])
    check('a settled request prints its Vendor Invoice',
          code == 200 and bill['docType'] == 'Vendor Invoice', bill.get('error'))
    check('stamped paid, because it is', bill['stamp'] == 'PAID' and bill['status'] == 'Paid',
          (bill.get('stamp'), bill.get('status')))
    check('and carries an amount due line', any(t['label'] == 'Amount due' for t in bill['totals']),
          bill['totals'])

# --------------------------------------------------------------- the contract
contracts = call('/api/smartspend/contracts')[1]
if contracts:
    code, rc = document('contract', contracts[0]['id'])
    check('a rate contract prints its agreed rates',
          code == 200 and rc['docType'] == 'Rate Contract'
          and len(rc['lines']) == len(contracts[0]['lines']),
          rc.get('error') or len(rc.get('lines', [])))
    check('with the period it holds for',
          any(f['label'] == 'Valid until' for f in rc['facts']), rc['facts'])

# ------------------------------------------------------------- who may print
primus = sign_in('primus@smartspend.demo', 'primus')
apex = sign_in('apex@smartspend.demo', 'apex')
if primus and apex and ordered:
    theirs = ordered['vendor'] or ''
    mine_token, other_token = (primus, apex) if 'Primus' in theirs else (apex, primus)
    code, own = document('po', ordered['id'], token=mine_token)
    check("the supplier the order went to can print it", code == 200, own.get('error'))
    code, other = document('po', ordered['id'], token=other_token)
    check("another supplier cannot print it", code == 404, (code, other.get('error')))
    for token in (primus, apex):
        call('/api/smartspend/logout', 'POST', {}, token=token)

# ---------------------------------------------------------------- the refusals
check('an unknown kind of document is refused', document('quote', anyone['id'])[0] == 400)
check('a missing reference is refused', document('po', '')[0] == 400)
check('a reference that does not exist is a plain 404',
      document('request', 'PR-0000-000')[0] == 404)
check('no token, no document', document('request', anyone['id'], token=None)[0] == 401)

check('printing saved nothing', len(call('/api/smartspend/requests')[1]) == before)

print()
print('%s checks, %s failed' % (len(ok), ok.count(False)))
