// Mirrors the NEW submit / decide / purchase-order failure branches verbatim,
// against the real backend, so the rows the banner renders are the rows the
// component will render.
const BASE = process.env.SMARTSPEND_URL || 'http://127.0.0.1:8019';
let token = null, pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? ' :: ' + d : '')); };

const syncErrors = [];
const noteSyncError = (err) => {
  const i = syncErrors.findIndex(e => e.key === err.key);
  if (i >= 0) syncErrors.splice(i, 1);
  syncErrors.push(err);
};
const clearSyncError = (key) => {
  const i = syncErrors.findIndex(e => e.key === key);
  if (i >= 0) syncErrors.splice(i, 1);
};
const refusalMessage = async (res) => {
  const failure = await res.json().catch(() => ({}));
  return failure?.error || `Odoo refused this (HTTP ${res.status}).`;
};
const unreachableMessage = (e, url) =>
  e instanceof TypeError ? `Could not reach ${url}. Is Odoo running?`
    : e instanceof Error ? e.message : `Could not reach ${url}.`;
const SIMULATED = ' This screen is showing a local result — Odoo still holds the previous state.';

const apiFetch = (path, init = {}) => fetch(`${BASE}${path}`, {
  ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});

async function submitRequestToOdoo(reqItem, url = BASE) {
  const f = (m) => noteSyncError({ key: `save:${reqItem.id}`, id: reqItem.id,
    what: 'was not saved to Odoo', message: m, retry: () => submitRequestToOdoo(reqItem, url) });
  try {
    const res = await apiFetch('/api/smartspend/submit', { method: 'POST', body: JSON.stringify(reqItem) });
    if (res.ok) { const u = await res.json(); clearSyncError(`save:${reqItem.id}`); return u; }
    f(await refusalMessage(res));
  } catch (e) { f(unreachableMessage(e, url)); }
  return null;
}
async function decideInOdoo(id, decision, comment) {
  const what = decision === 'approve' ? 'approval was not recorded in Odoo'
    : decision === 'reject' ? 'rejection was not recorded in Odoo'
      : 'clarification request was not recorded in Odoo';
  const f = (m) => noteSyncError({ key: `decide:${id}`, id, what,
    message: m + SIMULATED, retry: () => decideInOdoo(id, decision, comment) });
  try {
    const res = await apiFetch('/api/smartspend/decide', { method: 'POST', body: JSON.stringify({ id, decision, comment: comment || '' }) });
    if (res.ok) { const u = await res.json(); clearSyncError(`decide:${id}`); return u; }
    f(await refusalMessage(res));
  } catch (e) { f(unreachableMessage(e, BASE)); }
  return null;
}
async function createPurchaseOrderInOdoo(reqId, url = BASE) {
  const f = (m) => noteSyncError({ key: `po:${reqId}`, id: reqId,
    what: 'purchase order was not raised in Odoo', message: m + SIMULATED,
    retry: () => createPurchaseOrderInOdoo(reqId, url) });
  try {
    const res = await apiFetch('/api/smartspend/purchase-order', { method: 'POST', body: JSON.stringify({ id: reqId }) });
    if (res.ok) { const u = await res.json(); clearSyncError(`po:${reqId}`); return u; }
    f(await refusalMessage(res));
  } catch (e) { f(unreachableMessage(e, url)); }
  return null;
}
const signIn = async (login) => {
  const r = await (await fetch(`${BASE}/api/smartspend/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: 'Phase1-Test-Pw!' }) })).json();
  token = r.token; return r.user;
};
const row = (k) => syncErrors.find(e => e.key === k);

console.log('='.repeat(72));
console.log('FAILED CALLS ARE VISIBLE — submit / decide / purchase-order');
console.log('='.repeat(72));

const REQ = {
  id: 'PR-2026-0888', productName: 'Dell Latitude 5440 Laptop', productQty: 2,
  targetPrice: 70000, totalCost: 140000, location: 'Bangalore Office',
  department: 'IT & Infrastructure', expenseCategory: 'IT Hardware & Laptops',
  lineItems: [{ productName: 'Dell Latitude 5440 Laptop', productQty: 2, targetPrice: 70000 }],
  status: 'Pending Approval', urgency: 'High', buyer: 'SCM-IT-14', vendor: 'Primus Technologies',
  savings: 0, history: [], clarificationComments: [], vendorBids: [],
  selectedSourcingMethod: 'RFQ', attachments: [],
  createdDate: 'Aug 31, 10:30', deliveryDate: 'Oct 20, 2026',
};

await signIn('phase1.requester.test');
ok('a good save leaves the banner empty', !!(await submitRequestToOdoo(REQ)) && syncErrors.length === 0, syncErrors.length);

console.log('\n--- SUBMIT refused (needed-by before the request date) ---');
await submitRequestToOdoo({ ...REQ, deliveryDate: 'Jan 05, 2020' });
ok('a refused save adds a row', !!row('save:PR-2026-0888'));
console.log('   BANNER -> "' + row('save:PR-2026-0888').id + ' — ' + row('save:PR-2026-0888').what + '"');
console.log('             "' + row('save:PR-2026-0888').message + '"');
ok('a save row carries no "local result" note (nothing was simulated)',
   !row('save:PR-2026-0888').message.includes('local result'));

console.log('\n--- DECIDE refused (a requester approving) ---');
ok('decideInOdoo returns null so the caller simulates', (await decideInOdoo('PR-2026-0888', 'approve')) === null);
ok('a refused decision adds its own row', !!row('decide:PR-2026-0888'));
console.log('   BANNER -> "' + row('decide:PR-2026-0888').id + ' — ' + row('decide:PR-2026-0888').what + '"');
console.log('             "' + row('decide:PR-2026-0888').message + '"');
ok('the decision row says the screen is showing a local result',
   row('decide:PR-2026-0888').message.includes('local result'));

console.log('\n--- PURCHASE ORDER refused (a requester raising one) ---');
ok('createPurchaseOrderInOdoo returns null so the caller simulates',
   (await createPurchaseOrderInOdoo('PR-2026-0888')) === null);
ok('a refused purchase order adds its own row', !!row('po:PR-2026-0888'));
console.log('   BANNER -> "' + row('po:PR-2026-0888').id + ' — ' + row('po:PR-2026-0888').what + '"');
console.log('             "' + row('po:PR-2026-0888').message + '"');

console.log('\n--- three different failures on ONE request are three rows ---');
ok('three independent rows, not one overwriting the others', syncErrors.length === 3, syncErrors.map(e => e.key).join(', '));

console.log('\n--- repeated failures do not stack ---');
await decideInOdoo('PR-2026-0888', 'approve');
await decideInOdoo('PR-2026-0888', 'approve');
ok('still three rows', syncErrors.length === 3, syncErrors.length);

console.log('\n--- a rejection reads differently from an approval ---');
await decideInOdoo('PR-2026-0888', 'reject');
ok('the row now names the rejection', row('decide:PR-2026-0888').what.startsWith('rejection'), row('decide:PR-2026-0888').what);
await decideInOdoo('PR-2026-0888', 'clarify', 'why?');
ok('and the clarification request', row('decide:PR-2026-0888').what.startsWith('clarification'), row('decide:PR-2026-0888').what);

console.log('\n--- Retry as a manager: each row clears on its own ---');
await signIn('phase1.manager.test');
await row('save:PR-2026-0888').retry();
ok('retrying the save still fails (the date is still wrong)', !!row('save:PR-2026-0888'));
await submitRequestToOdoo({ ...REQ, deliveryDate: 'Nov 11, 2026' });
ok('correcting the date and saving clears the save row', !row('save:PR-2026-0888'), syncErrors.map(e => e.key).join(', '));
await row('decide:PR-2026-0888').retry();
ok('retrying the decision as a manager clears the decision row', !row('decide:PR-2026-0888'), syncErrors.map(e => e.key).join(', '));
await row('po:PR-2026-0888').retry();
ok('retrying the purchase order as a manager clears its row', !row('po:PR-2026-0888'), syncErrors.map(e => e.key).join(', '));
ok('banner is empty once everything is in Odoo', syncErrors.length === 0, syncErrors.length);

console.log('\n--- backend unreachable ---');
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
await submitRequestToOdoo(REQ); await decideInOdoo('PR-2026-0888', 'approve'); await createPurchaseOrderInOdoo('PR-2026-0888');
globalThis.fetch = realFetch;
ok('all three report being unable to reach Odoo', syncErrors.length === 3, syncErrors.length);
ok('with wording the sign-in screen already uses',
   syncErrors.every(e => e.message.startsWith(`Could not reach ${BASE}. Is Odoo running?`)),
   syncErrors[0].message);

console.log('\n' + (fail ? `${pass} passed, ${fail} FAILED` : `${pass} checks, 0 failed`));
process.exit(fail ? 1 : 0);
