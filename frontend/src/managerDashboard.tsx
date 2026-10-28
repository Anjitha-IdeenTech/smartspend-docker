/**
 * The procurement manager's dashboard — the whole buying picture on one screen.
 *
 * Everything here is worked out from live data: the requests the portal has
 * loaded from Odoo (value, status, branch, department, approval chain and
 * timeline), plus the auction, rate contract, subscription, backorder and
 * budget feeds. Companies come from the portal's Company master by branch.
 * Nothing is sample data; a period, company or branch filter narrows every
 * panel at once.
 *
 * One colour means one thing everywhere: green approved, amber waiting,
 * red rejected, indigo totals.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight, BadgeCheck, Building2, CalendarClock, CheckCircle2, ClipboardCheck, FileSignature, FileText,
  Gavel, Hourglass, Landmark, LayoutDashboard, MapPin, PieChart, PiggyBank, Repeat, Store, Timer,
  TrendingUp, Truck, Wallet, XCircle,
} from 'lucide-react';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

/** The part of a portal request the dashboard reads. */
export interface DashRequest {
  id: string;
  productName: string;
  totalCost: number;
  location: string;
  department: string;
  expenseCategory: string;
  status: string;
  urgency: string;
  createdDate: string;
  submittedAt?: string;
  vendor: string;
  savings: number;
  history: Array<{ title: string; date: string; desc?: string }>;
  approvalChain?: { order: number; designation: string; state: string; delegatedTo?: string }[];
  purchaseOrders?: string[];
  budgetBreach?: boolean;
  lineItems?: { productName: string; productQty: number; targetPrice: number }[];
}

export interface DashCompany { name: string; short: string; branches: string[] }

// ---------------------------------------------------------------------------
// Colours, buckets and formatting
// ---------------------------------------------------------------------------

export const C = {
  indigo: '#4F46E5', violet: '#8B5CF6', green: '#10B981', amber: '#F59E0B', red: '#EF4444',
  pink: '#EC4899', cyan: '#06B6D4', orange: '#F97316', slate: '#94A3B8', sky: '#0EA5E9', teal: '#14B8A6',
};
export const SERIES = [C.indigo, C.green, C.amber, C.pink, C.cyan, C.violet, C.orange, C.teal];

const PENDING = ['Pending Approval', 'Needs Clarification'];
const APPROVED = ['Sourcing', 'Approved', 'PO Confirmed', 'Paid'];
const ORDERED = ['PO Confirmed', 'Paid'];

/** Where a request stands, in plain words, in pipeline order. */
const STAGES: { label: string; statuses: string[]; color: string }[] = [
  { label: 'Waiting for approval', statuses: ['Pending Approval'], color: C.amber },
  { label: 'Question asked', statuses: ['Needs Clarification'], color: C.orange },
  { label: 'Approved', statuses: ['Sourcing', 'Approved'], color: C.green },
  { label: 'Order placed', statuses: ['PO Confirmed'], color: C.indigo },
  { label: 'Paid', statuses: ['Paid'], color: C.teal },
  { label: 'Rejected', statuses: ['Rejected'], color: C.red },
  { label: 'Draft', statuses: ['Draft'], color: C.slate },
];

/** ₹ in the Indian short form: ₹4.2 Cr, ₹12.5 L, ₹8.4 K. */
export const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
export const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
export const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const DAY = 86400000;
export const shortDate = (iso?: string) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** A round number at or above `v`, for a chart's top gridline. */
const niceCeil = (v: number) => {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  return ([1, 2, 2.5, 5, 10].find(m => m * e >= v) ?? 10) * e;
};

export const submitted = (r: DashRequest) => {
  const t = r.submittedAt ? Date.parse(r.submittedAt) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * A timeline date ("October 19, 05:22" — Odoo leaves the year out) as a time,
 * in the year the request was submitted.
 */
export const historyTime = (date: string, after: number | null) => {
  const year = new Date(after ?? Date.now()).getFullYear();
  let t = Date.parse(`${date.replace(',', `, ${year}`)}`);
  if (!Number.isFinite(t)) return null;
  if (after && t < after - DAY) t = Date.parse(`${date.replace(',', `, ${year + 1}`)}`);
  return Number.isFinite(t) ? t : null;
};

/** Hours from submission to the last approval signature, when it has one. */
const approvalHours = (r: DashRequest) => {
  const from = submitted(r);
  if (from === null) return null;
  const signed = r.history.filter(h => /^Approved/.test(h.title)).map(h => historyTime(h.date, from)).filter((t): t is number => t !== null);
  if (!signed.length) return null;
  const hours = (Math.max(...signed) - from) / 3600000;
  return hours >= 0 ? hours : null;
};

export const ageDays = (r: DashRequest, now: number) => {
  const t = submitted(r);
  return t === null ? 0 : Math.max(0, Math.floor((now - t) / DAY));
};

export const duration = (hours: number) => hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min`
  : hours < 48 ? `${hours.toFixed(1)} hrs` : `${(hours / 24).toFixed(1)} days`;

export type Period = 'all' | '30d' | 'month' | 'quarter' | 'year';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All time' }, { key: '30d', label: 'Last 30 days' }, { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' }, { key: 'year', label: 'This year' },
];
export const periodStart = (p: Period, now: Date): number | null => {
  if (p === 'all') return null;
  if (p === '30d') return now.getTime() - 30 * DAY;
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (p === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
  return new Date(now.getFullYear(), 0, 1).getTime();
};

// ---------------------------------------------------------------------------
// Building blocks (plain SVG and divs — the portal ships no chart library)
// ---------------------------------------------------------------------------

function useCount(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** A number that counts up, shown through `format`. */
export function Counter({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{format(useCount(value))}</>;
}

/** False on the first frame, so bars can grow in from zero. */
function useGrown() {
  const [grown, setGrown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(id); }, []);
  return grown;
}

export const whole = (n: number) => Math.round(n).toLocaleString('en-IN');

export function Card({ title, subtitle, icon: Icon, color, right, children, className = '' }: {
  title: string; subtitle?: string; icon: LucideIcon; color: string; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-3xl bg-surface border border-borderTheme shadow-sm p-6 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl text-white shadow-sm" style={{ background: color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-outfit text-lg font-extrabold text-textPrimary leading-tight">{title}</h3>
            {subtitle && <p className="text-xs text-textSecondary mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs font-semibold text-textSecondary">
          <span className="h-3 w-3 rounded-[4px]" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

function Donut({ parts, size = 200, thickness = 30, center }: {
  parts: { label: string; value: number; color: string }[]; size?: number; thickness?: number; center?: ReactNode;
}) {
  const grown = useGrown();
  const total = sum(parts, p => p.value);
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F7" strokeWidth={thickness} />
        {total > 0 && parts.filter(p => p.value > 0).map(p => {
          const len = (p.value / total) * c;
          const el = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={thickness}
                    strokeDasharray={`${grown ? Math.max(len - 1.5, 0.5) : 0} ${c}`} strokeDashoffset={-offset}
                    style={{ transition: 'stroke-dasharray 900ms cubic-bezier(.2,.8,.2,1)' }}>
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

/** Donut + a legend that spells out each slice's number and share. */
export function DonutWithLegend({ parts, centerValue, centerLabel, format = whole }: {
  parts: { label: string; value: number; color: string }[]; centerValue: string; centerLabel: string; format?: (n: number) => string;
}) {
  const total = sum(parts, p => p.value);
  return (
    <div className="flex flex-col items-center gap-5 2xl:flex-row">
      <Donut parts={parts} size={180} thickness={28} center={<div>
        <p className={`font-outfit font-extrabold text-textPrimary ${centerValue.length > 5 ? 'text-xl' : 'text-3xl'}`}>{centerValue}</p>
        <p className="text-[11px] font-bold uppercase tracking-wider text-textFaint">{centerLabel}</p>
      </div>} />
      <div className="w-full min-w-0 flex-1 space-y-2">
        {parts.filter(p => p.value > 0).map(p => (
          <div key={p.label} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: `${p.color}12` }}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="flex-1 truncate text-sm font-semibold text-textPrimary">{p.label}</span>
            <span className="text-sm font-extrabold tabular-nums text-textPrimary">{format(p.value)}</span>
            <span className="w-11 text-right text-xs font-bold tabular-nums" style={{ color: p.color }}>{pct(p.value, total).toFixed(0)}%</span>
          </div>
        ))}
        {!total && <p className="text-sm text-textFaint">Nothing to show for this selection.</p>}
      </div>
    </div>
  );
}

/** Columns with a ₹ axis: one or two series per group, details on hover. */
export function ColumnChart({ groups, series, height = 260, format = money }: {
  groups: { label: string; title?: string; values: number[]; note?: string }[];
  series: { label: string; color: string }[];
  height?: number; format?: (n: number) => string;
}) {
  const grown = useGrown();
  const top = niceCeil(Math.max(0, ...groups.flatMap(g => g.values)));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  return (
    <div className="flex gap-3">
      <div className="relative w-16 shrink-0" style={{ height }}>
        {ticks.map(t => (
          <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] font-semibold text-textFaint tabular-nums"
                style={{ top: `${(1 - t) * 100}%` }}>{format(top * t)}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }}>
          {ticks.map(t => <div key={t} className="absolute inset-x-0 border-t border-dashed border-borderTheme" style={{ top: `${(1 - t) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end justify-around gap-2 px-1">
            {groups.map(g => (
              <div key={g.label} className="group relative flex h-full flex-1 items-end justify-center gap-1 min-w-0">
                <div className="pointer-events-none absolute top-2 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-[11px] text-white shadow-lg group-hover:block">
                  <p className="font-bold">{g.title ?? g.label}</p>
                  {series.map((s, i) => <p key={s.label}><span style={{ color: s.color }}>●</span> {s.label}: <b>{format(g.values[i] || 0)}</b></p>)}
                  {g.note && <p className="text-white/70">{g.note}</p>}
                </div>
                {series.map((s, i) => (
                  <div key={s.label} className="w-full max-w-[34px] rounded-t-lg transition-[height] duration-700 ease-out group-hover:brightness-110"
                       style={{ height: grown ? `${pct(g.values[i] || 0, top)}%` : 0, background: `linear-gradient(180deg, ${s.color}, ${s.color}CC)`, minHeight: g.values[i] ? 3 : 0 }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-around gap-2 px-1">
          {groups.map(g => <span key={g.label} className="flex-1 truncate text-center text-[11px] font-semibold text-textSecondary" title={g.label}>{g.label}</span>)}
        </div>
      </div>
    </div>
  );
}

/** A horizontal bar per row, with its value written at the end. */
export function HBars({ rows, format = money }: {
  rows: { name: string; value: number; note?: string; color: string }[]; format?: (n: number) => string;
}) {
  const grown = useGrown();
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="space-y-4">
      {rows.map(r => (
        <div key={r.name}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold text-textPrimary">{r.name}</span>
            <span className="shrink-0 text-sm font-extrabold tabular-nums text-textPrimary">{format(r.value)}
              {r.note && <span className="ml-1.5 text-xs font-medium text-textFaint">{r.note}</span>}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full transition-[width] duration-700 ease-out"
                 style={{ width: grown ? `${Math.max(pct(r.value, max), r.value ? 1.5 : 0)}%` : 0, background: r.color }} />
          </div>
        </div>
      ))}
      {!rows.length && <p className="text-sm text-textFaint">Nothing to show for this selection.</p>}
    </div>
  );
}

/** Approved / waiting / rejected / draft counts as one bar, numbers written inside. */
function StatusBar({ approved, pending, rejected, other }: { approved: number; pending: number; rejected: number; other: number }) {
  const grown = useGrown();
  const total = approved + pending + rejected + other;
  const parts = [
    { label: 'Approved', n: approved, color: C.green }, { label: 'Waiting', n: pending, color: C.amber },
    { label: 'Rejected', n: rejected, color: C.red }, { label: 'Draft', n: other, color: C.slate },
  ];
  return (
    <div className="flex h-8 w-full overflow-hidden rounded-xl bg-secondary">
      {total > 0 && parts.filter(p => p.n > 0).map(p => (
        <div key={p.label} title={`${p.label}: ${p.n}`}
             className="flex h-full items-center justify-center overflow-hidden text-xs font-extrabold text-white transition-[width] duration-700 ease-out"
             style={{ width: grown ? `${pct(p.n, total)}%` : 0, background: p.color }}>
          {pct(p.n, total) >= 6 ? p.n : ''}
        </div>
      ))}
    </div>
  );
}

export function BigStat({ icon: Icon, label, count, value, note, from, to, onClick, countSuffix }: {
  icon: LucideIcon; label: string; count: number; value: number; note: ReactNode; from: string; to: string; onClick?: () => void;
  /** A word after the big number, when the count alone would not say what it counts. */
  countSuffix?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className="group relative overflow-hidden rounded-3xl p-5 text-left text-white shadow-lg transition-all enabled:hover:-translate-y-1 enabled:hover:shadow-xl disabled:cursor-default"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <Icon className="absolute -right-5 -bottom-5 h-28 w-28 text-white/15 transition-transform duration-500 group-hover:scale-110" />
      <div className="relative flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20"><Icon className="h-5 w-5" /></span>
        <span className="text-sm font-bold">{label}</span>
      </div>
      <p className="relative mt-4 font-outfit text-5xl font-extrabold leading-none tabular-nums"><Counter value={count} format={whole} />{countSuffix && <span className="ml-2 text-lg font-bold text-white/85">{countSuffix}</span>}</p>
      <p className="relative mt-2 text-lg font-bold tabular-nums"><Counter value={value} format={money} /></p>
      <p className="relative mt-1 text-xs font-medium text-white/85">{note}</p>
      {onClick && <ArrowRight className="absolute right-5 top-5 h-4 w-4 opacity-70 transition-transform group-hover:translate-x-1" />}
    </button>
  );
}

export function SmallStat({ icon: Icon, label, value, format, note, color, onClick }: {
  icon: LucideIcon; label: string; value: number; format: (n: number) => string; note: ReactNode; color: string; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className="flex items-center gap-4 rounded-3xl border border-borderTheme bg-surface p-5 text-left shadow-sm transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:cursor-default">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: `${color}1A`, color }}>
        <Icon className="h-7 w-7" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-textFaint">{label}</p>
        <p className="font-outfit text-2xl font-extrabold text-textPrimary tabular-nums leading-tight"><Counter value={value} format={format} /></p>
        <p className="text-xs text-textSecondary">{note}</p>
      </div>
    </button>
  );
}

export function CountPill({ n, color }: { n: number; color: string }) {
  return n
    ? <span className="inline-flex min-w-[28px] justify-center rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ background: `${color}1F`, color }}>{n}</span>
    : <span className="text-xs text-textFaint">0</span>;
}

export function ActivityRow({ icon: Icon, color, label, value, note, alert, onClick }: {
  icon: LucideIcon; color: string; label: string; value: string; note: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className="group flex w-full items-center gap-3 rounded-2xl border border-borderTheme p-3 text-left transition-all enabled:hover:border-brand/40 enabled:hover:bg-secondary/60 disabled:cursor-default">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1A`, color }}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-textPrimary">{label}</p>
        <p className={`truncate text-xs ${alert ? 'font-semibold text-red-600' : 'text-textFaint'}`}>{note}</p>
      </div>
      <span className="font-outfit text-xl font-extrabold text-textPrimary tabular-nums">{value}</span>
      {onClick && <ArrowRight className="h-4 w-4 text-textFaint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Live feeds beyond the requests
// ---------------------------------------------------------------------------

interface Feeds {
  auctions: { id: string; state: string; savings?: number; approval?: unknown }[];
  contracts: { id: string; running: boolean; validUntil: string }[];
  subscriptions: { id: string; state: string; monthlyCost: number; nextOrderDate: string }[];
  backorders: { id: number; state: string; qtyPending: number; amountPending: number; overdue: boolean }[];
  budgets: { id: number; name: string; department: string; branch: string; allocated: number; consumed: number; available: number; usedPercent: number }[];
}

function useFeeds(fetcher: Fetcher, offline: boolean) {
  const [feeds, setFeeds] = useState<Partial<Feeds>>({});
  useEffect(() => {
    if (offline) return;
    let stale = false;
    const get = async (path: string) => {
      try {
        const res = await fetcher(path, { method: 'GET' });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    };
    (async () => {
      const [auctions, contracts, subscriptions, backorders, budgets] = await Promise.all([
        get('/api/smartspend/auctions'), get('/api/smartspend/contracts?all=1'),
        get('/api/smartspend/subscriptions'), get('/api/smartspend/backorders'), get('/api/smartspend/budgets'),
      ]);
      if (stale) return;
      setFeeds({
        auctions: Array.isArray(auctions) ? auctions : [],
        contracts: Array.isArray(contracts) ? contracts : [],
        subscriptions: subscriptions?.subscriptions ?? [],
        backorders: backorders?.backorders ?? [],
        budgets: Array.isArray(budgets) ? budgets : [],
      });
    })();
    return () => { stale = true; };
  }, [offline]);
  return feeds;
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

export function ManagerDashboard({ requests, companies, userName, fetcher, offline, onOpenRequest, onNav }: {
  requests: DashRequest[];
  companies: DashCompany[];
  userName: string;
  fetcher: Fetcher;
  offline: boolean;
  /** Open a request: the approval queue for one waiting on a decision, tracking otherwise. */
  onOpenRequest: (id: string, status: string) => void;
  /** Go to another manager screen by its nav key. */
  onNav: (key: string) => void;
}) {
  const [period, setPeriod] = useState<Period>('all');
  const [company, setCompany] = useState('');
  const [branch, setBranch] = useState('');
  const [grain, setGrain] = useState<'week' | 'month'>('week');
  const [split, setSplit] = useState<'department' | 'category'>('department');
  const feeds = useFeeds(fetcher, offline);
  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();

  const companyOf = (b: string) => companies.find(c => c.branches.some(x => x.trim().toLowerCase() === (b || '').trim().toLowerCase()));
  const companyName = (b: string) => companyOf(b)?.name ?? 'Unassigned';

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    companies.forEach(c => { if (!company || c.name === company) c.branches.forEach(b => set.add(b)); });
    requests.forEach(r => { if (r.location && (!company || companyName(r.location) === company)) set.add(r.location); });
    return [...set].sort();
  }, [companies, requests, company]);

  // Every panel reads `rows`: the requests in the chosen period, company and branch.
  const rows = useMemo(() => {
    const from = periodStart(period, now);
    return requests.filter(r => {
      if (from !== null) { const t = submitted(r); if (t === null || t < from) return false; }
      if (company && companyName(r.location) !== company) return false;
      if (branch && r.location !== branch) return false;
      return true;
    });
  }, [requests, period, company, branch, companies]);

  const live = rows.filter(r => r.status !== 'Draft');
  const pending = rows.filter(r => PENDING.includes(r.status));
  const approved = rows.filter(r => APPROVED.includes(r.status));
  const rejected = rows.filter(r => r.status === 'Rejected');
  const ordered = rows.filter(r => ORDERED.includes(r.status));
  const paid = rows.filter(r => r.status === 'Paid');
  const value = (list: DashRequest[]) => sum(list, r => r.totalCost);
  const totalValue = value(live);
  const decided = approved.length + rejected.length;
  const approvalRate = pct(approved.length, decided);
  const cycle = approved.map(approvalHours).filter((h): h is number => h !== null);
  const avgCycle = cycle.length ? sum(cycle, h => h) / cycle.length : 0;
  const auctionSavings = sum((feeds.auctions ?? []).filter(a => a.state === 'awarded'), a => a.savings ?? 0);
  const savings = sum(rows, r => r.savings) + auctionSavings;
  const poCount = sum(ordered, r => (r.purchaseOrders?.length || 1));
  const overWeek = pending.filter(r => ageDays(r, nowMs) > 7).length;

  // --- Company and branch -------------------------------------------------
  const tally = (subset: DashRequest[]) => ({
    total: subset.filter(r => r.status !== 'Draft').length,
    value: value(subset.filter(r => r.status !== 'Draft')),
    approved: subset.filter(r => APPROVED.includes(r.status)).length,
    pending: subset.filter(r => PENDING.includes(r.status)).length,
    rejected: subset.filter(r => r.status === 'Rejected').length,
    drafts: subset.filter(r => r.status === 'Draft').length,
    approvedValue: value(subset.filter(r => APPROVED.includes(r.status))),
  });
  const companyRows = useMemo(() => {
    const names = new Set<string>(companies.filter(c => !company || c.name === company).map(c => c.name));
    rows.forEach(r => names.add(companyName(r.location)));
    return [...names].map(name => {
      const c = companies.find(x => x.name === name);
      return { name, short: c?.short ?? name, branches: c?.branches ?? [], ...tally(rows.filter(r => companyName(r.location) === name)) };
    }).sort((a, b) => b.value - a.value);
  }, [rows, companies, company]);
  const branchRows = useMemo(() => [...new Set(rows.map(r => r.location || 'Unassigned'))].map(name => ({
    name, company: companyOf(name)?.short ?? '—', ...tally(rows.filter(r => (r.location || 'Unassigned') === name)),
  })).sort((a, b) => b.value - a.value), [rows, companies]);

  // --- Spend over time ----------------------------------------------------
  const trend = useMemo(() => {
    const times = live.map(submitted).filter((t): t is number => t !== null);
    const buckets: { label: string; start: number; end: number }[] = [];
    if (grain === 'week') {
      const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const earliest = times.length ? Math.min(...times) : nowMs;
      const weeks = Math.min(12, Math.max(6, Math.ceil((monday.getTime() - earliest) / (7 * DAY)) + 1));
      for (let i = weeks - 1; i >= 0; i--) {
        const s = monday.getTime() - i * 7 * DAY;
        buckets.push({ label: new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), start: s, end: s + 7 * DAY });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const s = new Date(now.getFullYear(), now.getMonth() - i, 1), e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ label: s.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), start: s.getTime(), end: e.getTime() });
      }
    }
    return buckets.map(b => {
      const inside = live.filter(r => { const t = submitted(r); return t !== null && t >= b.start && t < b.end; });
      return {
        label: b.label,
        title: grain === 'week' ? `Week of ${b.label}` : b.label,
        values: [value(inside), value(inside.filter(r => APPROVED.includes(r.status)))],
        note: plural(inside.length, 'request'),
      };
    });
  }, [live, grain, now]);

  // --- Breakdowns ---------------------------------------------------------
  const groupBy = (key: (r: DashRequest) => string, subset: DashRequest[]) => {
    const m = new Map<string, { count: number; value: number }>();
    subset.forEach(r => {
      const k = key(r) || 'Unassigned';
      const e = m.get(k) ?? { count: 0, value: 0 };
      e.count++; e.value += r.totalCost || 0; m.set(k, e);
    });
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value);
  };
  const splitRows = groupBy(r => split === 'department' ? r.department : r.expenseCategory, live).slice(0, 6);
  const vendors = groupBy(r => r.vendor, ordered.filter(r => r.vendor)).slice(0, 5);
  const stages = STAGES.map(s => ({ label: s.label, color: s.color, value: rows.filter(r => s.statuses.includes(r.status)).length }));

  // --- Waiting for approval -----------------------------------------------
  const queue = [...pending].sort((a, b) => ageDays(b, nowMs) - ageDays(a, nowMs) || b.totalCost - a.totalCost).slice(0, 6);
  const waitingOn = (r: DashRequest) => {
    if (r.status === 'Needs Clarification') return 'Waiting for an answer';
    const step = (r.approvalChain ?? []).filter(s => s.state === 'pending').sort((a, b) => a.order - b.order)[0];
    return step ? (step.delegatedTo ? `${step.designation} (delegated to ${step.delegatedTo})` : step.designation) : 'Approver';
  };

  // --- Other feeds ----------------------------------------------------------
  const auctions = feeds.auctions ?? [];
  const auctionToApprove = auctions.filter(a => a.state === 'closed' && !a.approval).length;
  const auctionLive = auctions.filter(a => a.state === 'live' || a.state === 'scheduled').length;
  const runningContracts = (feeds.contracts ?? []).filter(c => c.running);
  const expiring = runningContracts.filter(c => { const e = Date.parse(`${c.validUntil}T00:00:00`); return Number.isFinite(e) && e - nowMs <= 30 * DAY; });
  const subs = (feeds.subscriptions ?? []).filter(s => s.state === 'active');
  const openBackorders = (feeds.backorders ?? []).filter(b => b.state !== 'done' && b.state !== 'cancel');
  const budgets = (feeds.budgets ?? []).filter(b => !branch || !b.branch || b.branch === branch);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (userName || '').replace(/^Demo\s+/i, '').trim();
  const scopeLabel = branch || companies.find(c => c.name === company)?.short || 'All companies';
  const selectCls = 'rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-sm font-semibold text-textPrimary normal-case tracking-normal focus:outline-none focus:border-brand';
  const toggleCls = (on: boolean) => `rounded-lg px-3 py-1 transition-colors ${on ? 'bg-surface text-brand shadow-sm' : 'text-textFaint hover:text-textPrimary'}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* ── Title + filters ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-borderTheme bg-surface px-6 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-md"
                style={{ background: `linear-gradient(135deg, ${C.indigo}, ${C.violet})` }}>
            <LayoutDashboard className="h-7 w-7" />
          </span>
          <div>
            <p className="text-sm font-semibold text-textSecondary">{greeting}{name ? `, ${name}` : ''}</p>
            <h2 className="font-outfit text-3xl font-extrabold text-textPrimary leading-tight">Procurement Dashboard</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-textFaint">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live from Odoo · showing <b className="text-textSecondary">{scopeLabel}</b>, {PERIODS.find(p => p.key === period)?.label.toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-bold uppercase tracking-wider text-textFaint">Period
            <select value={period} onChange={e => setPeriod(e.target.value as Period)} className={`${selectCls} mt-1 block`}>
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase tracking-wider text-textFaint">Company
            <select value={company} onChange={e => { setCompany(e.target.value); setBranch(''); }} className={`${selectCls} mt-1 block`}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.name} value={c.name}>{c.short}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase tracking-wider text-textFaint">Branch
            <select value={branch} onChange={e => setBranch(e.target.value)} className={`${selectCls} mt-1 block`}>
              <option value="">All branches</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          {(company || branch || period !== 'all') && (
            <button onClick={() => { setCompany(''); setBranch(''); setPeriod('all'); }}
                    className="rounded-xl px-3 py-2 text-sm font-bold text-brand hover:bg-brand/10">Clear filters</button>
          )}
        </div>
      </div>

      {/* ── The four numbers that matter ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <BigStat icon={FileText} label="Total Requests" count={live.length} value={totalValue} from={C.indigo} to={C.violet}
                 note={<>Submitted for approval{rows.length > live.length ? ` · ${plural(rows.length - live.length, 'draft')} not counted` : ''}</>}
                 onClick={() => onNav('tracking')} />
        <BigStat icon={CheckCircle2} label="Approved" count={approved.length} value={value(approved)} from="#059669" to={C.teal}
                 note={decided ? <>{approvalRate.toFixed(0)}% of decided requests were approved</> : 'None decided yet'} />
        <BigStat icon={Hourglass} label="Pending Approval" count={pending.length} value={value(pending)} from={C.amber} to={C.orange}
                 note={pending.length ? <>{overWeek ? `${overWeek} waiting more than a week · ` : ''}click to review</> : 'Nothing waiting — all caught up'}
                 onClick={() => onNav('queue')} />
        <BigStat icon={XCircle} label="Rejected" count={rejected.length} value={value(rejected)} from={C.red} to={C.pink}
                 note={decided ? <>{pct(rejected.length, decided).toFixed(0)}% of decided requests</> : 'None decided yet'} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <SmallStat icon={ClipboardCheck} label="Purchase orders" value={poCount} format={whole} color={C.indigo}
                   note={<>{money(value(ordered))} ordered from vendors</>} onClick={() => onNav('tracking')} />
        <SmallStat icon={Wallet} label="Paid to vendors" value={value(paid)} format={money} color={C.teal}
                   note={<>{plural(paid.length, 'request')} fully settled</>} />
        <SmallStat icon={PiggyBank} label="Money saved" value={savings} format={money} color={C.pink}
                   note="Through negotiation and reverse auctions" />
        <SmallStat icon={Timer} label="Avg. approval time" value={avgCycle} format={n => cycle.length ? duration(n) : '—'} color={C.sky}
                   note="From submission to final approval" />
      </div>

      {/* ── Company-wise + status ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Building2} color={C.indigo} title="Company-wise Requests" className="lg:col-span-3"
              subtitle="Requests per company — how many are approved, waiting or rejected. Click a company to filter."
              right={<Legend items={[{ label: 'Approved', color: C.green }, { label: 'Waiting', color: C.amber }, { label: 'Rejected', color: C.red }, { label: 'Draft', color: C.slate }]} />}>
          <div className="space-y-3">
            {companyRows.map(c => (
              <button key={c.name} type="button" onClick={() => { setCompany(company === c.name ? '' : c.name); setBranch(''); }}
                      className={`block w-full rounded-2xl p-3 text-left transition-colors hover:bg-secondary/70 ${company === c.name ? 'bg-brand/5 ring-1 ring-brand/30' : ''}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-base font-extrabold text-textPrimary">{c.short}</p>
                    <p className="text-xs text-textFaint">{c.branches.join(', ') || '—'}</p>
                  </div>
                  <p className="text-right">
                    <span className="font-outfit text-xl font-extrabold text-textPrimary tabular-nums">{money(c.value)}</span>
                    <span className="ml-2 text-xs font-semibold text-textSecondary">{plural(c.total, 'request')}</span>
                  </p>
                </div>
                <StatusBar approved={c.approved} pending={c.pending} rejected={c.rejected} other={c.drafts} />
              </button>
            ))}
          </div>
        </Card>

        <Card icon={PieChart} color={C.violet} title="Where Requests Stand" subtitle="Every request by its current stage" className="lg:col-span-2">
          <DonutWithLegend parts={stages} centerValue={whole(rows.length)} centerLabel="Requests" />
        </Card>
      </div>

      {/* ── Branch-wise ───────────────────────────────────────────────── */}
      <Card icon={MapPin} color={C.pink} title="Branch-wise Spend" subtitle="Value of requests from each branch. Click a branch to focus the dashboard on it."
            right={<Legend items={[{ label: 'Total requested', color: C.indigo }, { label: 'Approved', color: C.green }]} />}>
        <div className="grid xl:grid-cols-2 gap-8">
          <ColumnChart groups={branchRows.map(b => ({ label: b.name, values: [b.value, b.approvedValue], note: `${b.company} · ${plural(b.total, 'request')}` }))}
                       series={[{ label: 'Total requested', color: C.indigo }, { label: 'Approved', color: C.green }]} />
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 px-2 text-center">Requests</th>
                  <th className="py-2 px-2 text-center">Approved</th>
                  <th className="py-2 px-2 text-center">Waiting</th>
                  <th className="py-2 px-2 text-center">Rejected</th>
                  <th className="py-2 pl-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {branchRows.map(b => (
                  <tr key={b.name} onClick={() => setBranch(branch === b.name ? '' : b.name)}
                      className={`cursor-pointer border-b border-borderTheme/70 transition-colors hover:bg-secondary/70 ${branch === b.name ? 'bg-brand/5' : ''}`}>
                    <td className="py-3 pr-3">
                      <p className="text-sm font-bold text-textPrimary whitespace-nowrap">{b.name}</p>
                      <p className="text-[11px] text-textFaint">{b.company}</p>
                    </td>
                    <td className="py-3 px-2 text-center text-sm font-extrabold text-textPrimary">{b.total}</td>
                    <td className="py-3 px-2 text-center"><CountPill n={b.approved} color={C.green} /></td>
                    <td className="py-3 px-2 text-center"><CountPill n={b.pending} color={C.amber} /></td>
                    <td className="py-3 px-2 text-center"><CountPill n={b.rejected} color={C.red} /></td>
                    <td className="py-3 pl-2 text-right text-sm font-extrabold text-textPrimary whitespace-nowrap">{money(b.value)}</td>
                  </tr>
                ))}
                {!branchRows.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-textFaint">No requests for this selection.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* ── Over time + department ───────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={TrendingUp} color={C.green} title="Spend Over Time" subtitle="Value requested and approved, by the date requests were submitted" className="lg:col-span-3"
              right={<div className="flex flex-wrap items-center gap-4">
                <Legend items={[{ label: 'Requested', color: C.indigo }, { label: 'Approved', color: C.green }]} />
                <div className="flex rounded-xl bg-secondary p-1 text-xs font-bold">
                  {(['week', 'month'] as const).map(g => (
                    <button key={g} onClick={() => setGrain(g)} className={toggleCls(grain === g)}>{g === 'week' ? 'Weekly' : 'Monthly'}</button>))}
                </div>
              </div>}>
          <ColumnChart groups={trend} series={[{ label: 'Requested', color: C.indigo }, { label: 'Approved', color: C.green }]} />
        </Card>

        <Card icon={PieChart} color={C.orange} title={split === 'department' ? 'Department-wise Spend' : 'Category-wise Spend'}
              subtitle="Share of the total value requested" className="lg:col-span-2"
              right={<div className="flex rounded-xl bg-secondary p-1 text-xs font-bold">
                {(['department', 'category'] as const).map(s => (
                  <button key={s} onClick={() => setSplit(s)} className={toggleCls(split === s)}>{s === 'department' ? 'Department' : 'Category'}</button>))}
              </div>}>
          <DonutWithLegend parts={splitRows.map((d, i) => ({ label: d.name, value: d.value, color: SERIES[i % SERIES.length] }))}
                           centerValue={money(totalValue)} centerLabel="Total" format={money} />
        </Card>
      </div>

      {/* ── Waiting for approval + vendors ───────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Hourglass} color={C.amber} title="Waiting for Your Approval" subtitle="Longest waiting first. Click a request to approve or reject it." className="lg:col-span-3"
              right={pending.length ? <button onClick={() => onNav('queue')} className="flex items-center gap-1 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100">
                See all {pending.length} <ArrowRight className="h-3.5 w-3.5" /></button> : undefined}>
          {queue.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                    <th className="py-2 pr-3">Request</th><th className="py-2 px-2">Branch</th>
                    <th className="py-2 px-2 text-right">Amount</th><th className="py-2 pl-2 text-right">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(r => {
                    const age = ageDays(r, nowMs);
                    const tone = age > 7 ? C.red : age > 3 ? C.amber : C.green;
                    return (
                      <tr key={r.id} onClick={() => onOpenRequest(r.id, r.status)} className="cursor-pointer border-b border-borderTheme/70 hover:bg-secondary/70">
                        <td className="py-3 pr-3">
                          <p className="text-sm font-bold text-textPrimary">{r.productName}</p>
                          <p className="text-[11px] text-textFaint"><span className="font-mono">{r.id}</span> · {waitingOn(r)}</p>
                        </td>
                        <td className="py-3 px-2 text-sm text-textSecondary whitespace-nowrap">{r.location || '—'}</td>
                        <td className="py-3 px-2 text-right text-sm font-extrabold text-textPrimary whitespace-nowrap">{money(r.totalCost)}</td>
                        <td className="py-3 pl-2 text-right">
                          <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `${tone}1F`, color: tone }}>
                            {age ? plural(age, 'day') : 'Today'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-10 text-sm font-bold text-emerald-700">
              <CheckCircle2 className="h-5 w-5" /> All caught up — nothing is waiting for approval.
            </div>
          )}
        </Card>

        <Card icon={Store} color={C.teal} title="Top Vendors" subtitle="Value of purchase orders placed with each vendor" className="lg:col-span-2">
          <HBars rows={vendors.map((v, i) => ({ name: v.name, value: v.value, note: plural(v.count, 'order'), color: SERIES[i % SERIES.length] }))} />
        </Card>
      </div>

      {/* ── Budgets + other activity ─────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Landmark} color={C.sky} title="Budget Usage" subtitle="How much of each budget approved requests and orders have used" className="lg:col-span-3">
          {offline ? <p className="text-sm text-textFaint">Sign in against the server to see budgets.</p> : (
            <div className="space-y-5">
              {budgets.map(b => {
                const over = b.available < 0;
                const tone = over ? C.red : b.usedPercent >= 80 ? C.amber : C.green;
                return (
                  <div key={b.id}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-bold text-textPrimary">{b.name}</p>
                      <p className="text-sm text-textSecondary">Used <b className="text-textPrimary">{money(b.consumed)}</b> of {money(b.allocated)}</p>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-secondary">
                      <div className="flex h-full items-center justify-end rounded-full pr-2 text-[10px] font-extrabold text-white transition-[width] duration-700"
                           style={{ width: `${Math.min(100, Math.max(b.usedPercent, 6))}%`, background: tone }}>
                        {b.usedPercent.toFixed(0)}%
                      </div>
                    </div>
                    <p className="mt-1 text-xs font-semibold" style={{ color: tone }}>
                      {over ? `Over budget by ${money(-b.available)}` : `${money(b.available)} left`}
                    </p>
                  </div>
                );
              })}
              {!budgets.length && <p className="text-sm text-textFaint">No running budgets — they are set up in Odoo under SmartSpend → Budgets.</p>}
            </div>
          )}
        </Card>

        <Card icon={CalendarClock} color={C.violet} title="Other Activity" subtitle="Click any line to open it" className="lg:col-span-2">
          {offline ? <p className="text-sm text-textFaint">Sign in against the server to see this.</p> : (
            <div className="space-y-2.5">
              <ActivityRow icon={Gavel} color={C.red} label="Auctions waiting for your approval" value={String(auctionToApprove)}
                           note={auctionLive ? `${auctionLive} running or scheduled` : `${money(auctionSavings)} saved through auctions`}
                           alert={auctionToApprove > 0} onClick={() => onNav('auctions')} />
              <ActivityRow icon={FileSignature} color={C.indigo} label="Rate contracts in force" value={String(runningContracts.length)}
                           note={expiring.length ? `${expiring.length} ending within 30 days` : 'None ending in the next 30 days'}
                           alert={expiring.length > 0} onClick={() => onNav('masters')} />
              <ActivityRow icon={Repeat} color={C.violet} label="Subscriptions per month" value={money(sum(subs, s => s.monthlyCost))}
                           note={subs.length ? `${plural(subs.length, 'active subscription')} · next order ${shortDate(subs.map(s => s.nextOrderDate).filter(Boolean).sort()[0])}` : 'No active subscriptions'}
                           onClick={() => onNav('subscriptions')} />
              <ActivityRow icon={Truck} color={C.amber} label="Deliveries still to arrive" value={String(openBackorders.length)}
                           note={openBackorders.length ? `${money(sum(openBackorders, b => b.amountPending))} of goods pending` : 'Every order received in full'}
                           alert={openBackorders.some(b => b.overdue)} onClick={() => onNav('backorders')} />
              <ActivityRow icon={BadgeCheck} color={C.green} label="Approval rate" value={`${approvalRate.toFixed(0)}%`}
                           note={`${approved.length} approved · ${rejected.length} rejected`} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
