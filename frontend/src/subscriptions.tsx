/**
 * Subscriptions — products bought every month or every year, ordered on
 * autopilot (`/api/smartspend/subscriptions`).
 *
 * Odoo raises each purchase order on the 1st when it falls due (monthly: every
 * month; yearly: the start month, once a year). This screen is where the buyer
 * sets them up and watches them run: what they cost a month and a year, the
 * orders coming up over the next twelve months, how long until each one's next
 * order, and every order already raised.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Pause, Play, Plus,
  Repeat, Search, ShoppingCart, Square, Trash2, X, Zap,
} from 'lucide-react';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

interface SubLine { productName: string; qty: number; price: number; subtotal?: number }
interface SubOrder { po: string; cycle: string; raisedAt: string; amount: number; state: string; stateLabel: string }
export interface Subscription {
  id: string; title: string; state: 'draft' | 'active' | 'paused' | 'ended' | 'cancelled'; stateLabel: string;
  vendor: string; vendorId: number; frequency: 'monthly' | 'yearly';
  startDate: string; endDate: string; nextOrderDate: string; autoConfirm: boolean;
  department: string; branch: string; category: string; owner: string; note: string;
  lines: SubLine[]; perOrder: number; monthlyCost: number; annualCost: number;
  orderedTotal: number; orderCount: number; orders: SubOrder[];
}
interface ForecastMonth { month: string; label: string; total: number; items: { id: string; title: string; amount: number; frequency: string }[] }
interface Feed {
  today: string; subscriptions: Subscription[]; forecast: ForecastMonth[];
  vendors: { id: number; name: string }[]; departments: string[]; branches: string[]; categories: string[];
}

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const compact = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(n);
const day = (iso: string) => iso ? new Date(`${iso}T00:00:00`) : null;
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  iso ? (day(iso) as Date).toLocaleDateString('en-IN', opts) : '—';
const daysUntil = (iso: string, today: string) => {
  const a = day(iso), b = day(today);
  return a && b ? Math.round((a.getTime() - b.getTime()) / 86400000) : null;
};
const firstOf = (iso: string) => {
  const d = day(iso); if (!d) return '';
  if (d.getDate() !== 1) { d.setMonth(d.getMonth() + 1, 1); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const addCycle = (iso: string, frequency: string, n: number) => {
  const d = day(iso) as Date;
  d.setMonth(d.getMonth() + (frequency === 'yearly' ? 12 * n : n), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const STATE_TONE: Record<string, string> = {
  active: 'bg-pos/10 text-pos border-pos/25',
  paused: 'bg-gold/10 text-gold border-gold/30',
  draft: 'bg-brand/10 text-brand border-brand/25',
  ended: 'bg-secondary text-textFaint border-borderTheme',
  cancelled: 'bg-neg/10 text-neg border-neg/25',
};

/** How far through the current cycle: a ring that closes as the next order nears. */
function CycleRing({ sub, today }: { sub: Subscription; today: string }) {
  const left = sub.nextOrderDate ? daysUntil(sub.nextOrderDate, today) : null;
  const span = sub.frequency === 'yearly' ? 365 : 30;
  const pct = left === null ? 0 : Math.max(0, Math.min(1, 1 - left / span));
  const r = 26, c = 2 * Math.PI * r;
  const tone = sub.state === 'active' ? (left !== null && left <= 3 ? '#e11d48' : 'rgb(99 86 168)') : '#94a3b8';
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-secondary" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke={tone}
                strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        {sub.state === 'active' && left !== null ? (
          <div><div className="font-outfit text-base font-black text-textPrimary">{left <= 0 ? 'Today' : left}</div>
            {left > 0 && <div className="text-[8px] font-bold uppercase tracking-wider text-textFaint mt-0.5">day{left === 1 ? '' : 's'}</div>}</div>
        ) : sub.state === 'paused' ? <Pause className="h-5 w-5 text-gold" /> : <Square className="h-4 w-4 text-textFaint" />}
      </div>
    </div>
  );
}

/** Twelve months ahead, a bar for what goes out each month — yearly renewals stand out. */
function Forecast({ months, onPick }: { months: ForecastMonth[]; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...months.map(m => m.total));
  const total = months.reduce((s, m) => s + m.total, 0);
  return (
    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-5">
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-extrabold text-textPrimary inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-brand" />Orders on autopilot · next 12 months</p>
          <p className="text-[11px] text-textFaint mt-0.5">Each bar is what the subscriptions will order that month. Hover for the detail.</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">12-month total</p>
          <p className="font-outfit text-lg font-black text-textPrimary tabular-nums">{compact(total)}</p>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-1.5 items-end h-40">
        {months.map(m => {
          const h = m.total ? Math.max(6, (m.total / max) * 100) : 2;
          const yearly = m.items.some(i => i.frequency === 'yearly');
          return (
            <div key={m.month} className="relative h-full flex flex-col justify-end items-center"
                 onMouseEnter={() => setHover(m.month)} onMouseLeave={() => setHover(null)}>
              <div className={`w-full rounded-t-lg transition-all ${yearly ? 'bg-gradient-to-t from-amber-500 to-amber-300' : 'bg-gradient-to-t from-brand to-brand/50'} ${hover === m.month ? 'opacity-100' : 'opacity-85'}`}
                   style={{ height: `${h}%` }} />
              {hover === m.month && m.items.length > 0 && (
                <div className="absolute bottom-full mb-2 z-20 w-56 rounded-xl border border-borderTheme bg-surface p-3 shadow-xl text-left">
                  <p className="text-[11px] font-extrabold text-textPrimary">{m.label} · {inr(m.total)}</p>
                  {m.items.map(i => (
                    <button key={i.id} onClick={() => onPick(i.id)} className="mt-1 flex w-full justify-between gap-2 text-[11px] text-textSecondary hover:text-brand">
                      <span className="truncate">{i.title}{i.frequency === 'yearly' ? ' ★' : ''}</span><span className="tabular-nums">{inr(i.amount)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-12 gap-1.5 mt-1.5">
        {months.map(m => <div key={m.month} className="text-center text-[9px] font-bold uppercase tracking-wider text-textFaint">{m.label.slice(0, 3)}</div>)}
      </div>
      <p className="mt-2 text-[10px] text-textFaint"><span className="inline-block h-2 w-2 rounded-sm bg-gradient-to-t from-brand to-brand/50 align-middle mr-1" />Monthly orders <span className="inline-block h-2 w-2 rounded-sm bg-amber-400 align-middle ml-3 mr-1" />A yearly renewal falls in that month</p>
    </div>
  );
}

interface Draft {
  id: string | null; title: string; vendorId: number | ''; frequency: 'monthly' | 'yearly';
  startDate: string; endDate: string; autoConfirm: boolean;
  department: string; branch: string; category: string; note: string; lines: SubLine[];
}

const field = 'w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand';
const label = 'text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5';

function Editor({ feed, draft, setDraft, onClose, onSaved, fetcher }: {
  feed: Feed; draft: Draft; setDraft: (d: Draft) => void; onClose: () => void;
  onSaved: (msg: string) => void; fetcher: Fetcher;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const per = draft.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const first = draft.startDate ? firstOf(draft.startDate) : '';
  const schedule = first ? Array.from({ length: 6 }, (_, i) => addCycle(first, draft.frequency, i))
    .filter(d => !draft.endDate || d <= draft.endDate) : [];
  const setLine = (i: number, patch: Partial<SubLine>) =>
    setDraft({ ...draft, lines: draft.lines.map((l, j) => j === i ? { ...l, ...patch } : l) });

  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetcher('/api/smartspend/subscriptions/save', {
        method: 'POST',
        body: JSON.stringify({ ...draft, id: draft.id || undefined, startDate: first, endDate: draft.endDate || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'The subscription was not saved.'); return; }
      onSaved(draft.id ? `${body.id} updated.` : `${body.id} started — first order on ${fmt(body.nextOrderDate)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The subscription was not saved.');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <aside onClick={e => e.stopPropagation()} className="h-full w-full max-w-2xl bg-surface border-l border-borderTheme shadow-2xl flex flex-col">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-borderTheme">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand"><Repeat className="h-5 w-5" /></span>
          <div className="flex-1">
            <h3 className="font-outfit font-extrabold text-lg text-textPrimary">{draft.id ? `Edit ${draft.id}` : 'New subscription'}</h3>
            <p className="text-[11px] text-textSecondary">A purchase order goes to the vendor on the 1st — every month, or once a year.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={label}>Subscription *</label>
              <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Microsoft 365 Business licences" className={field} />
            </div>
            <div>
              <label className={label}>Vendor *</label>
              <select value={draft.vendorId} onChange={e => setDraft({ ...draft, vendorId: e.target.value ? Number(e.target.value) : '' })} className={field}>
                <option value="">Choose…</option>
                {feed.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>How often *</label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-borderTheme bg-secondary p-1">
                {(['monthly', 'yearly'] as const).map(f => (
                  <button key={f} type="button" onClick={() => setDraft({ ...draft, frequency: f })}
                          className={`rounded-md py-1.5 text-xs font-bold transition-all ${draft.frequency === f ? 'bg-brand text-onbrand shadow-sm' : 'text-textSecondary'}`}>
                    {f === 'monthly' ? 'Every month' : 'Every year'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>First order *</label>
              <input type="month" value={draft.startDate.slice(0, 7)} onChange={e => setDraft({ ...draft, startDate: e.target.value ? `${e.target.value}-01` : '' })} className={field} />
            </div>
            <div>
              <label className={label}>Last order (optional)</label>
              <input type="month" value={draft.endDate.slice(0, 7)}
                     onChange={e => { const v = e.target.value; if (!v) { setDraft({ ...draft, endDate: '' }); return; }
                       const [y, m] = v.split('-').map(Number); const last = new Date(y, m, 0).getDate();
                       setDraft({ ...draft, endDate: `${v}-${String(last).padStart(2, '0')}` }); }} className={field} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={label + ' mb-0'}>Items on each order *</label>
              <button onClick={() => setDraft({ ...draft, lines: [...draft.lines, { productName: '', qty: 1, price: 0 }] })}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline"><Plus className="h-3 w-3" />Add item</button>
            </div>
            <div className="space-y-2">
              {draft.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={l.productName} onChange={e => setLine(i, { productName: e.target.value })} placeholder="Product or service" className={`${field} col-span-6`} />
                  <input type="number" min={0} value={l.qty} onChange={e => setLine(i, { qty: Number(e.target.value) })} title="Quantity" className={`${field} col-span-2`} />
                  <input type="number" min={0} value={l.price} onChange={e => setLine(i, { price: Number(e.target.value) })} title="Unit price ₹" className={`${field} col-span-3`} />
                  <button onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} disabled={draft.lines.length === 1}
                          className="col-span-1 flex justify-center text-textFaint hover:text-neg disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* What it will do — worked out as it is typed. */}
          <div className="rounded-2xl border border-brand/25 bg-brand/5 p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">Per order (excl. tax)</p><p className="font-outfit text-lg font-black text-textPrimary tabular-nums">{inr(per)}</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">Per month</p><p className="font-outfit text-lg font-black text-textPrimary tabular-nums">{inr(draft.frequency === 'monthly' ? per : per / 12)}</p></div>
              <div><p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">Per year</p><p className="font-outfit text-lg font-black text-textPrimary tabular-nums">{inr(draft.frequency === 'monthly' ? per * 12 : per)}</p></div>
            </div>
            {schedule.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint mb-1.5">Orders go out on</p>
                <div className="flex flex-wrap gap-1.5">
                  {schedule.map((d, i) => (
                    <span key={d} className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${i === 0 ? 'border-brand bg-brand text-onbrand' : 'border-borderTheme bg-surface text-textSecondary'}`}>{fmt(d)}</span>
                  ))}
                  {!draft.endDate && <span className="px-1 py-1 text-[11px] text-textFaint">… until ended</span>}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {([['department', 'Department', feed.departments], ['branch', 'Branch / Site', feed.branches], ['category', 'Expense category', feed.categories]] as const).map(([k, l, opts]) => (
              <div key={k}>
                <label className={label}>{l}</label>
                <select value={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.value })} className={field}>
                  <option value="">—</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2.5 rounded-xl border border-borderTheme px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={draft.autoConfirm} onChange={e => setDraft({ ...draft, autoConfirm: e.target.checked })} className="mt-0.5 h-4 w-4" />
            <span className="text-xs text-textSecondary"><b className="text-textPrimary">Confirm each order automatically.</b> Off: each order waits as an RFQ for you to check and confirm.</span>
          </label>
          <div>
            <label className={label}>Notes</label>
            <textarea rows={2} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} className={field} placeholder="e.g. Seats reviewed every March" />
          </div>
          {error && <p className="text-xs text-neg bg-neg/10 border border-neg/25 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary">Cancel</button>
          <button onClick={save} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50">
            <Repeat className="h-4 w-4" />{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Start subscription'}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function SubscriptionsDesk({ fetcher, offline }: { fetcher: Fetcher; offline: boolean }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'ended'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const res = await fetcher('/api/smartspend/subscriptions', { method: 'GET' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'Subscriptions could not be loaded.'); return; }
      setFeed(body); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Subscriptions could not be loaded.'); }
  };
  useEffect(() => { if (!offline) void load(); }, [offline]);

  const say = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(''), 5000); };
  const act = async (sub: Subscription, action: 'pause' | 'resume' | 'end' | 'generate', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${sub.id}:${action}`); setError('');
    try {
      const res = await fetcher(`/api/smartspend/subscriptions/${sub.id}/action`, { method: 'POST', body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'That did not go through.'); return; }
      say(action === 'generate' ? `${body.orders[0]?.po ?? 'Order'} raised to ${body.vendor} for ${inr(body.orders[0]?.amount ?? 0)}. Next order on ${fmt(body.nextOrderDate)}.`
        : action === 'pause' ? `${sub.id} paused — no orders until resumed.`
        : action === 'resume' ? `${sub.id} resumed — next order on ${fmt(body.nextOrderDate)}.` : `${sub.id} ended.`);
      if (action === 'generate') setOpen(sub.id);
      await load();
    } finally { setBusy(''); }
  };
  const edit = (sub?: Subscription) => setDraft(sub ? {
    id: sub.id, title: sub.title, vendorId: sub.vendorId, frequency: sub.frequency, startDate: sub.startDate,
    endDate: sub.endDate, autoConfirm: sub.autoConfirm, department: sub.department, branch: sub.branch,
    category: sub.category, note: sub.note, lines: sub.lines.map(l => ({ productName: l.productName, qty: l.qty, price: l.price })),
  } : {
    id: null, title: '', vendorId: '', frequency: 'monthly', startDate: firstOf(feed?.today || new Date().toISOString().slice(0, 10)),
    endDate: '', autoConfirm: true, department: '', branch: '', category: '', note: '', lines: [{ productName: '', qty: 1, price: 0 }],
  });

  const subs = feed?.subscriptions ?? [];
  const active = subs.filter(s => s.state === 'active');
  const next = useMemo(() => [...active].filter(s => s.nextOrderDate).sort((a, b) => a.nextOrderDate.localeCompare(b.nextOrderDate))[0], [feed]);
  const shown = subs
    .filter(s => filter === 'all' || (filter === 'ended' ? ['ended', 'cancelled'].includes(s.state) : s.state === filter))
    .filter(s => `${s.id} ${s.title} ${s.vendor} ${s.lines.map(l => l.productName).join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  if (offline) return <div className="max-w-6xl mx-auto rounded-2xl bg-surface border border-borderTheme p-6 text-xs text-textFaint">Subscriptions run in Odoo — sign in against the server to manage them.</div>;
  if (!feed) return <div className={`max-w-6xl mx-auto rounded-2xl bg-surface border border-borderTheme p-6 text-xs ${error ? 'text-neg' : 'text-textFaint'}`}>{error || 'Loading subscriptions…'}</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl p-6 text-white shadow-xl"
           style={{ background: 'radial-gradient(1200px 400px at 0% 0%, rgba(139,92,246,.55), transparent 60%), radial-gradient(800px 300px at 100% 100%, rgba(236,72,153,.35), transparent 60%), #17122e' }}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]"><Repeat className="h-3.5 w-3.5" />Subscriptions</div>
            <h2 className="mt-2 font-outfit text-3xl font-black">Recurring buys, on autopilot.</h2>
            <p className="text-xs text-white/65 mt-1 max-w-lg">Set it once — the purchase order goes to the vendor on the 1st, every month or every year, until you pause or end it.</p>
            <button onClick={() => edit()} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#17122e] shadow hover:brightness-95"><Plus className="h-4 w-4" />New subscription</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: 'Active', v: String(active.length), s: `${subs.filter(s => s.state === 'paused').length} paused` },
              { k: 'Per month', v: compact(active.reduce((t, s) => t + s.monthlyCost, 0)), s: 'run-rate' },
              { k: 'Per year', v: compact(active.reduce((t, s) => t + s.annualCost, 0)), s: 'committed' },
              { k: 'Next order', v: next ? (() => { const d = daysUntil(next.nextOrderDate, feed.today) ?? 0; return d <= 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`; })() : '—', s: next ? `${fmt(next.nextOrderDate, { day: 'numeric', month: 'short' })} · ${next.title}` : 'nothing scheduled' },
            ].map(t => (
              <div key={t.k} className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3 min-w-[120px]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-white/50">{t.k}</p>
                <p className="font-outfit text-xl font-black tabular-nums">{t.v}</p>
                <p className="text-[10px] text-white/55 truncate max-w-[150px]">{t.s}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(toast || error) && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold ${error ? 'border-neg/25 bg-neg/10 text-neg' : 'border-pos/30 bg-pos/10 text-pos'}`}>
          {error ? <X className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{error || toast}
        </div>
      )}

      <Forecast months={feed.forecast} onPick={id => { setOpen(id); document.getElementById(`sub-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-borderTheme bg-surface p-1 gap-1">
          {(['all', 'active', 'paused', 'ended'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${filter === f ? 'bg-brand text-onbrand' : 'text-textSecondary hover:text-textPrimary'}`}>{f}</button>
          ))}
        </div>
        <div className="relative w-72">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-textFaint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search subscriptions…" className="w-full bg-surface border border-borderTheme rounded-xl pl-9 pr-3 py-2 text-xs text-textPrimary focus:outline-none focus:border-brand" />
        </div>
      </div>

      {!shown.length ? (
        <div className="rounded-3xl border border-dashed border-borderTheme bg-surface/60 p-10 text-center">
          <Repeat className="h-9 w-9 mx-auto text-textFaint" />
          <p className="text-sm font-bold text-textPrimary mt-2">{subs.length ? 'No subscription matches.' : 'No subscriptions yet'}</p>
          {!subs.length && <p className="text-xs text-textFaint mt-1">Licences, AMCs, consumables — anything bought every month or every year.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {shown.map(sub => {
            const expanded = open === sub.id;
            const last = sub.orders[0];
            return (
              <div key={sub.id} id={`sub-${sub.id}`} className={`rounded-2xl bg-surface border shadow-sm overflow-hidden transition-all ${expanded ? 'border-brand/40 ring-1 ring-brand/20' : 'border-borderTheme'}`}>
                <div className="p-5 flex gap-4">
                  <CycleRing sub={sub} today={feed.today} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-textFaint">{sub.id}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATE_TONE[sub.state]}`}>{sub.stateLabel}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${sub.frequency === 'yearly' ? 'bg-amber-400/15 text-amber-600' : 'bg-brand/10 text-brand'}`}>
                        <Repeat className="h-3 w-3" />{sub.frequency === 'monthly' ? 'Monthly · on the 1st' : `Yearly · every ${fmt(sub.startDate, { day: 'numeric', month: 'short' })}`}
                      </span>
                    </div>
                    <h4 className="mt-1 font-outfit text-base font-extrabold text-textPrimary truncate">{sub.title}</h4>
                    <p className="text-[11px] text-textSecondary truncate">{sub.vendor} · {sub.lines.map(l => `${l.qty}× ${l.productName}`).join(', ')}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div><p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">Per order <span className="normal-case tracking-normal font-semibold">(excl. tax)</span></p><p className="text-sm font-extrabold text-textPrimary tabular-nums">{inr(sub.perOrder)}</p></div>
                      <div><p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">Next order</p><p className="text-sm font-extrabold text-textPrimary">{sub.state === 'active' ? fmt(sub.nextOrderDate) : '—'}</p></div>
                      <div><p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">Ordered so far</p><p className="text-sm font-extrabold text-textPrimary tabular-nums">{inr(sub.orderedTotal)}</p></div>
                    </div>
                    {last && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-textFaint"><ShoppingCart className="h-3 w-3" />Last: <b className="text-textSecondary">{last.po}</b> · {fmt(last.cycle || last.raisedAt.slice(0, 10), { month: 'short', year: 'numeric' })} · {last.stateLabel}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-borderTheme bg-secondary/40 px-5 py-2.5">
                  {sub.state === 'active' && (<>
                    <button onClick={() => act(sub, 'generate', `Raise the ${fmt(sub.nextOrderDate, { month: 'long', year: 'numeric' })} order to ${sub.vendor} now (${inr(sub.perOrder)} before tax)?`)} disabled={!!busy}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-bold text-onbrand disabled:opacity-50"><Zap className="h-3.5 w-3.5" />{busy === `${sub.id}:generate` ? 'Raising…' : 'Raise next order now'}</button>
                    <button onClick={() => act(sub, 'pause')} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg border border-borderTheme bg-surface px-2.5 py-1.5 text-[11px] font-bold text-textSecondary"><Pause className="h-3.5 w-3.5" />Pause</button>
                  </>)}
                  {sub.state === 'paused' && (
                    <button onClick={() => act(sub, 'resume')} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg bg-pos px-2.5 py-1.5 text-[11px] font-bold text-white"><Play className="h-3.5 w-3.5" />Resume</button>
                  )}
                  {['active', 'paused', 'draft'].includes(sub.state) && (<>
                    <button onClick={() => edit(sub)} className="rounded-lg border border-borderTheme bg-surface px-2.5 py-1.5 text-[11px] font-bold text-textSecondary">Edit</button>
                    <button onClick={() => act(sub, 'end', `End ${sub.id}? No further orders will be raised.`)} disabled={!!busy} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-neg hover:bg-neg/10">End</button>
                  </>)}
                  <button onClick={() => setOpen(expanded ? null : sub.id)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-brand">
                    {sub.orderCount} order{sub.orderCount === 1 ? '' : 's'} {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-borderTheme px-5 py-4">
                    {sub.orders.length ? (
                      <ol className="relative border-l-2 border-brand/20 ml-2 space-y-3">
                        {sub.orders.map(o => (
                          <li key={o.po} className="ml-4">
                            <span className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-surface ${o.state === 'cancel' ? 'bg-neg' : o.state === 'purchase' || o.state === 'done' ? 'bg-pos' : 'bg-gold'}`} />
                            <div className="flex items-center gap-3 text-xs">
                              <span className="font-mono font-bold text-textPrimary">{o.po}</span>
                              <span className="text-textSecondary">{fmt(o.cycle || o.raisedAt.slice(0, 10), { month: 'long', year: 'numeric' })}</span>
                              <span className="text-[10px] font-bold text-textFaint">{o.stateLabel}</span>
                              <span className="ml-auto font-bold tabular-nums text-textPrimary">{inr(o.amount)}</span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="text-xs text-textFaint inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />No orders yet — the first goes out on {fmt(sub.nextOrderDate || sub.startDate)}.</p>}
                    {(sub.department || sub.branch || sub.category || sub.note) && (
                      <p className="mt-3 text-[11px] text-textFaint">{[sub.department, sub.branch, sub.category].filter(Boolean).join(' · ')}{sub.note && <> — {sub.note}</>}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {draft && <Editor feed={feed} draft={draft} setDraft={setDraft} fetcher={fetcher} onClose={() => setDraft(null)}
                        onSaved={msg => { setDraft(null); say(msg); void load(); }} />}
    </div>
  );
}
