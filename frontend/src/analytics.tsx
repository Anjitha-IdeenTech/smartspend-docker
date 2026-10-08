/**
 * Analytic distribution under each request line — Odoo's split of an item's
 * cost across analytic accounts (`/api/smartspend/analytics`).
 *
 * Shows the split as chips ("IT & Infrastructure 60% · Operations 40%") and
 * edits it in place: accounts grouped by plan, each plan adding up to 100%.
 * Odoo checks the same rule and carries the split onto the purchase order.
 */
import { useEffect, useState } from 'react';
import { PieChart, Plus, Trash2 } from 'lucide-react';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
interface Plan { id: number; name: string; accounts: { id: number; name: string; code: string }[] }
type Distribution = Record<string, number>;

// Shared by every line on screen: one fetch of the accounts, one of the request.
let accountsCache: Promise<Plan[]> | null = null;
const requestCache = new Map<string, Promise<{ productName: string; distribution: Distribution }[]>>();
const listeners = new Set<(id: string) => void>();

const loadAccounts = (fetcher: Fetcher) => accountsCache ??= fetcher('/api/smartspend/analytic-accounts', { method: 'GET' })
  .then(r => r.ok ? r.json() : { plans: [] }).then(d => d.plans ?? []).catch(() => { accountsCache = null; return []; });
const loadRequest = (fetcher: Fetcher, id: string) => {
  if (!requestCache.has(id)) {
    requestCache.set(id, fetcher(`/api/smartspend/analytics?id=${encodeURIComponent(id)}`, { method: 'GET' })
      .then(r => r.ok ? r.json() : { lines: [] }).then(d => d.lines ?? []).catch(() => { requestCache.delete(id); return []; }));
  }
  return requestCache.get(id)!;
};
const fold = (s: string) => s.trim().toLowerCase();

export function LineAnalytics({ requestId, productName, fetcher, offline }: {
  requestId: string; productName: string; fetcher: Fetcher; offline: boolean;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dist, setDist] = useState<Distribution>({});
  const [editing, setEditing] = useState<{ account: number | ''; pct: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const usable = !offline && !!requestId && requestId !== 'New' && productName.trim().length > 1;
  useEffect(() => {
    const onChange = (id: string) => { if (id === requestId) setTick(t => t + 1); };
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, [requestId]);
  useEffect(() => {
    if (!usable) return;
    let stale = false;
    void loadAccounts(fetcher).then(p => { if (!stale) setPlans(p); });
    void loadRequest(fetcher, requestId).then(lines => {
      if (stale) return;
      const mine = lines.find(l => fold(l.productName) === fold(productName));
      setDist(mine?.distribution ?? {});
    });
    return () => { stale = true; };
  }, [requestId, productName, usable, tick]);

  if (!usable) return null;
  const account = (id: string | number) => plans.flatMap(p => p.accounts.map(a => ({ ...a, plan: p.name }))).find(a => String(a.id) === String(id));
  const entries = Object.entries(dist);

  const startEdit = () => {
    setError('');
    setEditing(entries.length ? entries.map(([id, pct]) => ({ account: Number(id), pct: Number(pct) })) : [{ account: '', pct: 100 }]);
  };
  const byPlan = (rows: { account: number | ''; pct: number }[]) => {
    const totals: Record<string, number> = {};
    rows.forEach(r => { const a = r.account ? account(r.account) : null; if (a) totals[a.plan] = (totals[a.plan] || 0) + (Number(r.pct) || 0); });
    return totals;
  };
  const save = async () => {
    if (!editing) return;
    const rows = editing.filter(r => r.account && Number(r.pct) > 0);
    const totals = byPlan(rows);
    const off = Object.entries(totals).find(([, t]) => Math.abs(t - 100) > 0.01);
    if (off) { setError(`The ${off[0]} split adds up to ${Math.round(off[1] * 100) / 100}% — it has to be 100%.`); return; }
    const next: Distribution = {};
    rows.forEach(r => { next[String(r.account)] = (next[String(r.account)] || 0) + Number(r.pct); });
    setBusy(true); setError('');
    try {
      const res = await fetcher('/api/smartspend/analytics', { method: 'POST', body: JSON.stringify({ id: requestId, lines: [{ productName, distribution: next }] }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'The split was not saved.'); return; }
      requestCache.set(requestId, Promise.resolve(body.lines ?? []));
      setEditing(null);
      listeners.forEach(fn => fn(requestId));
    } catch (e) { setError(e instanceof Error ? e.message : 'The split was not saved.'); }
    finally { setBusy(false); }
  };

  if (editing) {
    const totals = byPlan(editing);
    return (
      <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5 text-[11px] space-y-2">
        <p className="font-bold text-textPrimary inline-flex items-center gap-1"><PieChart className="h-3.5 w-3.5 text-brand" />Analytic distribution</p>
        {editing.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select value={row.account} onChange={e => setEditing(editing.map((r, j) => j === i ? { ...r, account: e.target.value ? Number(e.target.value) : '' } : r))}
                    className="flex-1 bg-surface border border-borderTheme rounded-md px-2 py-1 text-xs text-textPrimary">
              <option value="">Choose an analytic account…</option>
              {plans.map(p => (
                <optgroup key={p.id} label={p.name}>
                  {p.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.code ? ` (${a.code})` : ''}</option>)}
                </optgroup>
              ))}
            </select>
            <input type="number" min={0} max={100} step={0.01} value={row.pct}
                   onChange={e => setEditing(editing.map((r, j) => j === i ? { ...r, pct: Number(e.target.value) } : r))}
                   className="w-20 bg-surface border border-borderTheme rounded-md px-2 py-1 text-xs text-right tabular-nums text-textPrimary" />
            <span className="text-textFaint">%</span>
            <button type="button" onClick={() => setEditing(editing.filter((_, j) => j !== i))} className="text-textFaint hover:text-neg"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setEditing([...editing, { account: '', pct: Math.max(0, 100 - (Object.values(totals)[0] ?? 0)) }])}
                  className="inline-flex items-center gap-1 font-bold text-brand hover:underline"><Plus className="h-3 w-3" />Add account</button>
          {Object.entries(totals).map(([plan, t]) => (
            <span key={plan} className={`font-bold ${Math.abs(t - 100) > 0.01 ? 'text-neg' : 'text-pos'}`}>{plan}: {Math.round(t * 100) / 100}%</span>
          ))}
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-borderTheme bg-surface px-2.5 py-1 font-bold text-textSecondary">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="rounded-md bg-brand px-2.5 py-1 font-bold text-onbrand disabled:opacity-50">{busy ? 'Saving…' : 'Save split'}</button>
          </span>
        </div>
        {error && <p className="text-neg font-semibold">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wider text-[10px] text-textFaint"><PieChart className="h-3.5 w-3.5 text-brand" />Analytic</span>
      {entries.length ? entries.map(([id, pct]) => (
        <span key={id} className="rounded-full border border-borderTheme bg-secondary px-2 py-0.5 font-semibold text-textSecondary">
          {account(id)?.name ?? `#${id}`} <b className="text-textPrimary">{Math.round(Number(pct) * 100) / 100}%</b>
        </span>
      )) : <span className="text-textFaint">not set</span>}
      <button type="button" onClick={startEdit} className="font-bold text-brand hover:underline">{entries.length ? 'Edit split' : 'Set'}</button>
    </div>
  );
}
