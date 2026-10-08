/**
 * Products the catalogue does not have (`/api/smartspend/product-check`,
 * `/api/smartspend/product-requests`).
 *
 * Nobody is made to wait to ask: a request naming a new product goes for
 * approval as usual, and a product creation request goes to the procurement
 * manager alongside it. Three pieces:
 *
 * - `NewProductHint` under each line of the request form — "new product", the
 *   closest catalogue names to switch to, or the state of an earlier ask;
 * - `ProductRequestsPanel` on the employee portal — decisions announced until
 *   seen, their own requests, and asking for a product on its own;
 * - `ProductRequestsDesk` for the procurement manager — approve into the
 *   catalogue, point at an existing product, or reject.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, CheckCircle2, Link2, PackagePlus, Sparkles, X, XCircle } from 'lucide-react';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

interface Check {
  known: boolean; match: string; suggestions: string[];
  pending: { name: string; state: string; stateLabel: string; note: string } | null;
}
export interface ProductRequest {
  id: number; name: string; productName: string; description: string; reason: string; estimatedPrice: number;
  category: string; productCategoryId: number | false; productCategory: string; requestedBy: string;
  requests: { id: string; status: string }[]; state: 'pending' | 'approved' | 'mapped' | 'rejected'; stateLabel: string;
  product: string; decisionNote: string; decidedBy: string; decidedAt: string; createdAt: string; seen: boolean;
  matches?: { id: number; name: string }[];
}
interface Feed { canDecide: boolean; requests: ProductRequest[]; productCategories: { id: number; name: string }[]; expenseCategories: string[] }

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const when = (s: string) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
const field = 'w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand';
const label = 'text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5';
const TONE: Record<string, string> = {
  pending: 'bg-gold/10 text-gold border-gold/30', approved: 'bg-pos/10 text-pos border-pos/25',
  mapped: 'bg-brand/10 text-brand border-brand/25', rejected: 'bg-neg/10 text-neg border-neg/25',
};

// ---------------------------------------------------------------------------
// Under each request line.
// ---------------------------------------------------------------------------
export function NewProductHint({ product, fetcher, offline, onPick }: {
  product: string; fetcher: Fetcher; offline: boolean; onPick: (name: string) => void;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    const typed = product.trim();
    if (offline || typed.length < 3) { setCheck(null); return; }
    let stale = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetcher(`/api/smartspend/product-check?name=${encodeURIComponent(typed)}`, { method: 'GET' });
        const body = res.ok ? await res.json() : null;
        if (!stale) setCheck(body);
      } catch { if (!stale) setCheck(null); }
    }, 500);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [product, offline]);

  if (!check) return null;
  if (check.known) {
    return (
      <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-pos ml-3">
        <CheckCircle2 className="h-3.5 w-3.5" />In the catalogue{check.match && check.match.toLowerCase() !== product.trim().toLowerCase() ? ` as “${check.match}”` : ''}
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-[11px] space-y-1.5">
      <p className="inline-flex items-start gap-1.5 text-textSecondary">
        <PackagePlus className="h-3.5 w-3.5 text-gold shrink-0 mt-0.5" />
        {check.pending ? (
          check.pending.state === 'rejected'
            ? <span><b className="text-neg">Not added to the catalogue</b> ({check.pending.name}){check.pending.note && <>: “{check.pending.note}”</>} — choose another product.</span>
            : <span><b className="text-textPrimary">Already requested</b> as a new product ({check.pending.name} · {check.pending.stateLabel}). Your request can still go ahead.</span>
        ) : (
          <span><b className="text-textPrimary">New product</b> — not in the catalogue yet. When you submit, a product creation request goes to the procurement manager; your request still goes for approval meanwhile.</span>
        )}
      </p>
      {check.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-textFaint font-semibold">Did you mean:</span>
          {check.suggestions.map(s => (
            <button key={s} type="button" onClick={() => onPick(s)}
                    className="rounded-full border border-borderTheme bg-surface px-2 py-0.5 font-bold text-textSecondary hover:border-brand/40 hover:text-brand">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ask for a product on its own.
// ---------------------------------------------------------------------------
function AskDialog({ fetcher, categories, onClose, onDone }: {
  fetcher: Fetcher; categories: string[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [v, setV] = useState({ productName: '', description: '', reason: '', estimatedPrice: '', category: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetcher('/api/smartspend/product-requests/create', { method: 'POST', body: JSON.stringify(v) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'The request was not sent.'); return; }
      onDone(body.alreadyRequested ? `“${body.productName}” was already requested (${body.name}) — you will be told when it is decided.`
        : `${body.name} sent — the procurement manager will review “${body.productName}”.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The request was not sent.'); }
    finally { setBusy(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-surface border border-borderTheme shadow-xl">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-borderTheme">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><PackagePlus className="h-5 w-5" /></span>
          <div className="flex-1">
            <h3 className="font-outfit font-extrabold text-lg text-textPrimary">Request a new product</h3>
            <p className="text-[11px] text-textSecondary">For something the catalogue does not have. The procurement manager reviews it, and you are told the outcome here.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div><label className={label}>Product *</label><input value={v.productName} onChange={e => setV({ ...v, productName: e.target.value })} placeholder="e.g. Standing Desk Converter" className={field} /></div>
          <div><label className={label}>Specification</label><textarea rows={2} value={v.description} onChange={e => setV({ ...v, description: e.target.value })} placeholder="Make, model, size…" className={field} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Estimated unit price ₹</label><input type="number" min={0} value={v.estimatedPrice} onChange={e => setV({ ...v, estimatedPrice: e.target.value })} className={field} /></div>
            <div><label className={label}>Expense category</label>
              <select value={v.category} onChange={e => setV({ ...v, category: e.target.value })} className={field}>
                <option value="">—</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
          </div>
          <div><label className={label}>Why it is needed</label><input value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} className={field} /></div>
          {error && <p className="text-xs text-neg bg-neg/10 border border-neg/25 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary">Cancel</button>
          <button onClick={send} disabled={busy || v.productName.trim().length < 3}
                  className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold disabled:opacity-50">{busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Employee portal: decisions to announce, and their own requests.
// ---------------------------------------------------------------------------
export function ProductRequestsPanel({ fetcher, offline, userKey }: { fetcher: Fetcher; offline: boolean; userKey: string }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState('');
  const load = async () => {
    try {
      const res = await fetcher('/api/smartspend/product-requests', { method: 'GET' });
      if (res.ok) setFeed(await res.json());
    } catch { /* the panel simply stays as it was */ }
  };
  useEffect(() => {
    if (offline || !userKey) return;
    void load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [offline, userKey]);
  if (offline || !feed) return null;

  const mine = feed.requests;
  const news = mine.filter(r => r.state !== 'pending' && !r.seen);
  const open = mine.filter(r => r.state === 'pending');
  const dismiss = async (ids: number[]) => {
    setFeed(f => f && ({ ...f, requests: f.requests.map(r => ids.includes(r.id) ? { ...r, seen: true } : r) }));
    try { await fetcher('/api/smartspend/product-requests/seen', { method: 'POST', body: JSON.stringify({ ids }) }); } catch { /* shown again next time */ }
  };

  return (
    <div className="space-y-3">
      {news.map(r => (
        <div key={r.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 auction-slide-in ${r.state === 'rejected' ? 'border-neg/30 bg-neg/5' : 'border-pos/30 bg-pos/5'}`}>
          {r.state === 'rejected' ? <XCircle className="h-5 w-5 shrink-0 text-neg mt-0.5" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-pos mt-0.5" />}
          <div className="flex-1 text-xs">
            <p className="font-bold text-textPrimary">
              {r.state === 'approved' && <>“{r.productName}” is now in the catalogue</>}
              {r.state === 'mapped' && <>“{r.productName}” is in the catalogue as “{r.product}”</>}
              {r.state === 'rejected' && <>“{r.productName}” was not added to the catalogue</>}
            </p>
            <p className="text-textSecondary mt-0.5">
              {r.decidedBy} · {r.name}{r.decisionNote && <> · “{r.decisionNote}”</>}
              {r.requests.length > 0 && (r.state === 'rejected'
                ? <> — change that item on {r.requests.map(q => q.id).join(', ')}.</>
                : <> — {r.requests.map(q => q.id).join(', ')} can go ahead.</>)}
              {r.requests.length === 0 && r.state !== 'rejected' && <> — you can request it now.</>}
            </p>
          </div>
          <button onClick={() => dismiss([r.id])} className="text-[11px] font-bold text-textFaint hover:text-textPrimary">Got it</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-borderTheme bg-surface px-4 py-2.5">
        <PackagePlus className="h-4 w-4 text-brand" />
        <span className="text-xs font-bold text-textPrimary">Can't find a product?</span>
        <span className="text-[11px] text-textFaint">Just type it in your request — or ask for it to be added.</span>
        {open.length > 0 && (
          <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold"
                title={open.map(r => `${r.name} · ${r.productName}`).join('\n')}>
            {open.length} waiting for approval
          </span>
        )}
        <button onClick={() => setAsking(true)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-borderTheme bg-secondary px-3 py-1.5 text-[11px] font-bold text-textSecondary hover:text-textPrimary">
          <PackagePlus className="h-3.5 w-3.5" />Request a new product
        </button>
      </div>
      {toast && <p className="text-xs font-bold text-pos bg-pos/10 border border-pos/25 rounded-xl px-3 py-2">{toast}</p>}
      {asking && <AskDialog fetcher={fetcher} categories={feed.expenseCategories} onClose={() => setAsking(false)}
                            onDone={msg => { setAsking(false); setToast(msg); window.setTimeout(() => setToast(''), 6000); void load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The procurement manager's desk.
// ---------------------------------------------------------------------------
export function ProductRequestsDesk({ fetcher, offline, onCount }: { fetcher: Fetcher; offline: boolean; onCount?: (n: number) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [form, setForm] = useState<Record<number, { name: string; categoryId: number | ''; note: string; mapTo: number | '' }>>({});

  const load = async () => {
    try {
      const res = await fetcher('/api/smartspend/product-requests', { method: 'GET' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'Product requests could not be loaded.'); return; }
      setFeed(body); setError('');
      onCount?.(body.requests.filter((r: ProductRequest) => r.state === 'pending').length);
    } catch (e) { setError(e instanceof Error ? e.message : 'Product requests could not be loaded.'); }
  };
  useEffect(() => { if (!offline) void load(); }, [offline]);

  const get = (r: ProductRequest) => form[r.id] ?? { name: r.productName, categoryId: r.productCategoryId || '', note: '', mapTo: r.matches?.[0]?.id ?? '' };
  const set = (r: ProductRequest, patch: Partial<ReturnType<typeof get>>) => setForm(f => ({ ...f, [r.id]: { ...get(r), ...patch } }));

  const decide = async (r: ProductRequest, decision: 'approve' | 'map' | 'reject') => {
    const v = get(r);
    if (decision === 'reject' && !v.note.trim()) { setError(`Say why “${r.productName}” is not being added — the requester sees it.`); return; }
    setBusy(r.id); setError('');
    try {
      const res = await fetcher(`/api/smartspend/product-requests/${r.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, productCategoryId: v.categoryId || null, finalName: v.name, productId: v.mapTo || null, note: v.note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'The decision was not saved.'); return; }
      setToast(decision === 'approve' ? `“${body.product}” added to the catalogue — ${r.requestedBy} has been told.`
        : decision === 'map' ? `“${r.productName}” linked to “${body.product}” — ${r.requestedBy} has been told.`
        : `“${r.productName}” rejected — ${r.requestedBy} has been told.`);
      window.setTimeout(() => setToast(''), 6000);
      await load();
    } finally { setBusy(null); }
  };

  if (offline) return <div className="rounded-2xl bg-surface border border-borderTheme p-6 text-xs text-textFaint">The product master lives in Odoo — sign in against the server.</div>;
  if (!feed) return <div className={`rounded-2xl bg-surface border border-borderTheme p-6 text-xs ${error ? 'text-neg' : 'text-textFaint'}`}>{error || 'Loading product requests…'}</div>;

  const pending = feed.requests.filter(r => r.state === 'pending');
  const decided = feed.requests.filter(r => r.state !== 'pending').slice(0, 20);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl p-6 text-white shadow-xl"
           style={{ background: 'radial-gradient(900px 300px at 0% 0%, rgba(16,185,129,.4), transparent 60%), radial-gradient(700px 300px at 100% 100%, rgba(139,92,246,.4), transparent 60%), #17122e' }}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]"><PackagePlus className="h-3.5 w-3.5" />New products</div>
            <h2 className="mt-2 font-outfit text-3xl font-black">Keep the catalogue clean — without making anyone wait.</h2>
            <p className="text-xs text-white/65 mt-1 max-w-xl">Products people asked for that the catalogue does not have. Their requests carry on meanwhile; only the purchase order waits for your decision.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3 min-w-[120px]"><p className="text-[9px] font-bold uppercase tracking-wider text-white/50">Waiting</p><p className="font-outfit text-2xl font-black">{pending.length}</p></div>
            <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3 min-w-[120px]"><p className="text-[9px] font-bold uppercase tracking-wider text-white/50">Requests held</p><p className="font-outfit text-2xl font-black">{new Set(pending.flatMap(r => r.requests.map(q => q.id))).size}</p></div>
          </div>
        </div>
      </div>

      {(toast || error) && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold ${error ? 'border-neg/25 bg-neg/10 text-neg' : 'border-pos/30 bg-pos/10 text-pos'}`}>
          {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{error || toast}
        </div>
      )}

      {!pending.length && (
        <div className="rounded-3xl border border-dashed border-borderTheme bg-surface/60 p-10 text-center">
          <Check className="h-9 w-9 mx-auto text-pos" />
          <p className="text-sm font-bold text-textPrimary mt-2">Nothing waiting</p>
          <p className="text-xs text-textFaint mt-1">When someone asks for a product the catalogue does not have, it appears here.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pending.map(r => {
          const v = get(r);
          return (
            <div key={r.id} className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
              <div className="p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-textFaint">{r.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${TONE[r.state]}`}>{r.stateLabel}</span>
                  <span className="ml-auto text-[10px] text-textFaint">{r.requestedBy} · {when(r.createdAt)}</span>
                </div>
                <div>
                  <h4 className="font-outfit text-lg font-extrabold text-textPrimary">{r.productName}</h4>
                  <p className="text-[11px] text-textSecondary">
                    {[r.category, r.estimatedPrice ? `about ${inr(r.estimatedPrice)} each` : '', r.reason].filter(Boolean).join(' · ') || 'No details given'}
                  </p>
                  {r.description && <p className="text-[11px] text-textFaint mt-1">“{r.description}”</p>}
                  {r.requests.length > 0 && (
                    <p className="mt-1.5 text-[10px] font-bold text-gold">Holding the purchase order of {r.requests.map(q => `${q.id} (${q.status})`).join(', ')}</p>
                  )}
                </div>
                {!!r.matches?.length && (
                  <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand inline-flex items-center gap-1"><Sparkles className="h-3 w-3" />Possibly already in the catalogue</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.matches.map(m => (
                        <button key={m.id} onClick={() => set(r, { mapTo: m.id })}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${v.mapTo === m.id ? 'border-brand bg-brand text-onbrand' : 'border-borderTheme bg-surface text-textSecondary'}`}>
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={label}>Name in catalogue</label><input value={v.name} onChange={e => set(r, { name: e.target.value })} className={field} /></div>
                  <div><label className={label}>Product category</label>
                    <select value={v.categoryId} onChange={e => set(r, { categoryId: e.target.value ? Number(e.target.value) : '' })} className={field}>
                      <option value="">Default</option>{feed.productCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select></div>
                </div>
                <div><label className={label}>Note to the requester</label><input value={v.note} onChange={e => set(r, { note: e.target.value })} placeholder="Required when rejecting" className={field} /></div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-borderTheme bg-secondary/40 px-5 py-2.5">
                <button onClick={() => decide(r, 'approve')} disabled={busy === r.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-pos px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Approve &amp; add</button>
                {!!r.matches?.length && (
                  <button onClick={() => decide(r, 'map')} disabled={busy === r.id || !v.mapTo}
                          className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-surface px-3 py-1.5 text-[11px] font-bold text-brand disabled:opacity-50"><Link2 className="h-3.5 w-3.5" />Use existing</button>
                )}
                <button onClick={() => decide(r, 'reject')} disabled={busy === r.id}
                        className="ml-auto rounded-lg px-3 py-1.5 text-[11px] font-bold text-neg hover:bg-neg/10 disabled:opacity-50">Reject</button>
              </div>
            </div>
          );
        })}
      </div>

      {decided.length > 0 && (
        <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-5">
          <p className="text-xs font-extrabold text-textPrimary mb-3">Decided</p>
          <div className="space-y-2">
            {decided.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-mono font-bold text-textFaint">{r.name}</span>
                <span className="font-semibold text-textPrimary">{r.productName}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${TONE[r.state]}`}>{r.state === 'mapped' ? `Uses “${r.product}”` : r.stateLabel}</span>
                <span className="ml-auto text-[11px] text-textFaint">{r.decidedBy} · {when(r.decidedAt)}{r.decisionNote && ` · “${r.decisionNote}”`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
