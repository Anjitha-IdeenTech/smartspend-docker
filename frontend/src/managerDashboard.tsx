/**
 * The procurement manager's dashboard — the whole buying picture on one screen.
 *
 * Everything here is worked out from live data: the requests the portal has
 * loaded from Odoo (value, status, branch, department, approval chain and
 * timeline), plus the auction, rate contract, subscription and backorder
 * feeds. Companies come from the portal's Company master by branch. Nothing is
 * sample data; a period, company or branch filter narrows every panel at once.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, Building2, CheckCircle2, Clock, FileSignature,
  Gavel, Hourglass, IndianRupee, LayoutDashboard, MapPin, PiggyBank, Repeat, ShoppingCart,
  Landmark, Sparkles, Store, Timer, TrendingUp, Truck, Users, Wallet, ClipboardCheck,
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
// Buckets and formatting
// ---------------------------------------------------------------------------

const PENDING = ['Pending Approval', 'Needs Clarification'];
const APPROVED = ['Sourcing', 'Approved', 'PO Confirmed', 'Paid'];
const ORDERED = ['PO Confirmed', 'Paid'];

/** Status → colour (CSS channel variable) and short label, in pipeline order. */
const STATUS_STYLE: { status: string; label: string; color: string }[] = [
  { status: 'Draft', label: 'Draft', color: '--text-faint' },
  { status: 'Pending Approval', label: 'Pending approval', color: '--accent-approvals' },
  { status: 'Needs Clarification', label: 'Info requested', color: '--accent-alerts' },
  { status: 'Sourcing', label: 'Sourcing', color: '--accent-analytics' },
  { status: 'Approved', label: 'Approved', color: '--accent-budget' },
  { status: 'PO Confirmed', label: 'PO raised', color: '--brand-violet' },
  { status: 'Paid', label: 'Paid', color: '--accent-savings' },
  { status: 'Rejected', label: 'Rejected', color: '--accent-expenses' },
];
const rgb = (v: string, a = 1) => `rgb(var(${v}) / ${a})`;

/** ₹ in the Indian short form: ₹4.2 Cr, ₹12.5 L, ₹8.4 K. */
export const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const DAY = 86400000;
const shortDate = (iso?: string) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const submitted = (r: DashRequest) => {
  const t = r.submittedAt ? Date.parse(r.submittedAt) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * A timeline date ("October 19, 05:22" — Odoo leaves the year out) as a time,
 * in the year the request was submitted.
 */
const historyTime = (date: string, after: number | null) => {
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

const ageDays = (r: DashRequest, now: number) => {
  const t = submitted(r);
  return t === null ? 0 : Math.max(0, Math.floor((now - t) / DAY));
};

const duration = (hours: number) => hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min`
  : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;

type Period = 'all' | '30d' | 'month' | 'quarter' | 'year';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All time' }, { key: '30d', label: 'Last 30 days' }, { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' }, { key: 'year', label: 'This year' },
];
const periodStart = (p: Period, now: Date): number | null => {
  if (p === 'all') return null;
  if (p === '30d') return now.getTime() - 30 * DAY;
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (p === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
  return new Date(now.getFullYear(), 0, 1).getTime();
};

// ---------------------------------------------------------------------------
// Small visual building blocks (plain SVG — the portal ships no chart library)
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
function Counter({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{format(useCount(value))}</>;
}

function Spark({ data, color }: { data: number[]; color: string }) {
  const id = useId().replace(/:/g, '');
  if (data.length < 2) return null;
  const W = 120, H = 34, max = Math.max(...data, 1);
  const pts = data.map((d, i) => [(i / (data.length - 1)) * W, H - 3 - (d / max) * (H - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-9" preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.35" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Donut({ parts, size = 168, thickness = 20, center }: {
  parts: { label: string; value: number; color: string }[]; size?: number; thickness?: number; center?: ReactNode;
}) {
  const total = sum(parts, p => p.value);
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={rgb('--border-color')} strokeWidth={thickness} />
        {total > 0 && parts.filter(p => p.value > 0).map(p => {
          const len = (p.value / total) * c;
          const el = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={thickness}
                    strokeDasharray={`${Math.max(len - 2, 0.5)} ${c}`} strokeDashoffset={-offset}
                    className="transition-all duration-700"><title>{`${p.label}: ${p.value}`}</title></circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

function Panel({ icon: Icon, title, hint, right, children, className = '', tone = '--accent-budget' }: {
  icon: LucideIcon; title: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string; tone?: string;
}) {
  return (
    <section className={`rounded-2xl bg-surface border border-borderTheme shadow-sm p-5 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: rgb(tone, 0.12), color: rgb(tone) }}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h3 className="font-outfit text-[15px] font-extrabold text-textPrimary leading-tight">{title}</h3>
            {hint && <p className="text-[11px] text-textFaint mt-0.5">{hint}</p>}
          </div>
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

/** One coloured bar split by status — approved / pending / rejected. */
function StackBar({ parts, height = 8 }: { parts: { value: number; color: string; label: string }[]; height?: number }) {
  const total = sum(parts, p => p.value);
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-secondary" style={{ height }}>
      {total > 0 && parts.filter(p => p.value > 0).map(p => (
        <div key={p.label} title={`${p.label}: ${money(p.value)}`} className="h-full transition-all duration-700"
             style={{ width: `${pct(p.value, total)}%`, background: p.color }} />
      ))}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, format, hint, tone, trend, onClick }: {
  icon: LucideIcon; label: string; value: number; format: (n: number) => string; hint: ReactNode; tone: string; trend?: number[];
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className="group relative flex flex-col overflow-hidden rounded-2xl bg-surface border border-borderTheme p-4 text-left shadow-sm transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:cursor-default">
      <span className="absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl opacity-60" style={{ background: rgb(tone, 0.25) }} />
      <div className="relative flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: rgb(tone, 0.12), color: rgb(tone) }}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="relative mt-2 font-outfit text-2xl font-extrabold text-textPrimary tabular-nums leading-none">
        <Counter value={value} format={format} />
      </p>
      <p className="relative mt-1.5 text-[11px] text-textSecondary min-h-[16px]">{hint}</p>
      {trend && <div className="relative mt-2 -mx-1"><Spark data={trend} color={rgb(tone)} /></div>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Live feeds beyond the requests
// ---------------------------------------------------------------------------

interface Feeds {
  auctions: { id: string; state: string; savings?: number; ceiling?: number; awardedTotal?: number; approval?: unknown; title: string; location: string }[];
  contracts: { id: string; vendor: string; running: boolean; validUntil: string; purchaseOrderCount: number }[];
  subscriptions: { id: string; title: string; state: string; monthlyCost: number; annualCost: number; nextOrderDate: string; vendor: string }[];
  backorders: { id: number; state: string; qtyPending: number; amountPending: number; overdue: boolean }[];
  budgets: { id: number; name: string; department: string; branch: string; category: string; periodEnd: string; allocated: number; committed: number; ordered: number; consumed: number; available: number; usedPercent: number }[];
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
  const feeds = useFeeds(fetcher, offline);
  const now = useMemo(() => new Date(), []);

  const companyOf = (b: string) => companies.find(c => c.branches.some(x => x.trim().toLowerCase() === (b || '').trim().toLowerCase()));
  const companyName = (b: string) => companyOf(b)?.name ?? 'Unassigned';

  // Branches the data and the masters know, for the filter.
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
  const decided = approved.length + rejected.length;
  const approvalRate = pct(approved.length, decided);
  const cycle = approved.map(approvalHours).filter((h): h is number => h !== null);
  const avgCycle = cycle.length ? sum(cycle, h => h) / cycle.length : 0;
  const requestSavings = sum(rows, r => r.savings);
  const auctionSavings = sum((feeds.auctions ?? []).filter(a => a.state === 'awarded'), a => a.savings ?? 0);
  const poCount = sum(ordered, r => (r.purchaseOrders?.length || 1));

  // --- Trend: requested vs approved value per week / month -----------------
  const trend = useMemo(() => {
    const times = live.map(submitted).filter((t): t is number => t !== null);
    const end = now.getTime();
    const buckets: { label: string; start: number; end: number }[] = [];
    if (grain === 'week') {
      const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const earliest = times.length ? Math.min(...times) : end;
      const weeks = Math.min(16, Math.max(8, Math.ceil((monday.getTime() - earliest) / (7 * DAY)) + 1));
      for (let i = weeks - 1; i >= 0; i--) {
        const s = monday.getTime() - i * 7 * DAY;
        buckets.push({ label: new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), start: s, end: s + 7 * DAY });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const s = new Date(now.getFullYear(), now.getMonth() - i, 1), e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ label: s.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), start: s.getTime(), end: e.getTime() });
      }
    }
    return buckets.map(b => {
      const inside = live.filter(r => { const t = submitted(r); return t !== null && t >= b.start && t < b.end; });
      return {
        label: b.label,
        requested: sum(inside, r => r.totalCost),
        approved: sum(inside.filter(r => APPROVED.includes(r.status)), r => r.totalCost),
        count: inside.length,
      };
    });
  }, [live, grain, now]);
  const trendMax = Math.max(1, ...trend.map(t => t.requested));

  // --- Company and branch roll-ups -----------------------------------------
  const rollup = (subset: DashRequest[]) => ({
    count: subset.filter(r => r.status !== 'Draft').length,
    value: sum(subset.filter(r => r.status !== 'Draft'), r => r.totalCost),
    approvedValue: sum(subset.filter(r => APPROVED.includes(r.status)), r => r.totalCost),
    pendingValue: sum(subset.filter(r => PENDING.includes(r.status)), r => r.totalCost),
    rejectedValue: sum(subset.filter(r => r.status === 'Rejected'), r => r.totalCost),
    approved: subset.filter(r => APPROVED.includes(r.status)).length,
    pending: subset.filter(r => PENDING.includes(r.status)).length,
    rejected: subset.filter(r => r.status === 'Rejected').length,
    ordered: subset.filter(r => ORDERED.includes(r.status)).length,
    paid: subset.filter(r => r.status === 'Paid').length,
    paidValue: sum(subset.filter(r => r.status === 'Paid'), r => r.totalCost),
    savings: sum(subset, r => r.savings),
  });
  const totalValue = sum(live, r => r.totalCost);
  const companyRows = useMemo(() => {
    const names = new Set<string>(companies.filter(c => !company || c.name === company).map(c => c.name));
    rows.forEach(r => names.add(companyName(r.location)));
    return [...names].map(name => {
      const subset = rows.filter(r => companyName(r.location) === name);
      const c = companies.find(x => x.name === name);
      return { name, short: c?.short ?? name, branches: c?.branches ?? [], ...rollup(subset) };
    }).filter(c => c.count || companies.some(x => x.name === c.name)).sort((a, b) => b.value - a.value);
  }, [rows, companies, company]);
  const branchRows = useMemo(() => {
    const names = new Set<string>(rows.map(r => r.location || 'Unassigned'));
    return [...names].map(name => {
      const subset = rows.filter(r => (r.location || 'Unassigned') === name);
      const done = subset.filter(r => APPROVED.includes(r.status) || r.status === 'Rejected').length;
      return { name, company: companyOf(name)?.short ?? '—', ...rollup(subset), rate: pct(subset.filter(r => APPROVED.includes(r.status)).length, done) };
    }).sort((a, b) => b.value - a.value);
  }, [rows, companies]);
  const branchMax = Math.max(1, ...branchRows.map(b => b.value));

  // --- Breakdowns -----------------------------------------------------------
  const groupBy = (key: (r: DashRequest) => string, subset = live) => {
    const m = new Map<string, { count: number; value: number }>();
    subset.forEach(r => {
      const k = key(r) || 'Unassigned';
      const e = m.get(k) ?? { count: 0, value: 0 };
      e.count++; e.value += r.totalCost || 0; m.set(k, e);
    });
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value);
  };
  const departments = groupBy(r => r.department);
  const categories = groupBy(r => r.expenseCategory);
  const vendors = groupBy(r => r.vendor, ordered.filter(r => r.vendor)).slice(0, 6);
  const vendorMax = Math.max(1, ...vendors.map(v => v.value));
  const urgency = ['High', 'Medium', 'Low'].map(u => ({ label: u, value: live.filter(r => r.urgency === u).length }));

  // Top products by requested value across every line.
  const products = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    live.forEach(r => (r.lineItems?.length ? r.lineItems : [{ productName: r.productName, productQty: 1, targetPrice: r.totalCost }]).forEach(l => {
      const e = m.get(l.productName) ?? { qty: 0, value: 0 };
      e.qty += l.productQty || 0; e.value += (l.productQty || 0) * (l.targetPrice || 0); m.set(l.productName, e);
    }));
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).filter(p => p.name).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [live]);
  const productMax = Math.max(1, ...products.map(p => p.value));

  // --- Pending approvals: ageing and the queue -----------------------------
  const nowMs = now.getTime();
  const ageing = [
    { label: 'Today', test: (d: number) => d < 1, color: '--accent-savings' },
    { label: '1–3 days', test: (d: number) => d >= 1 && d <= 3, color: '--accent-analytics' },
    { label: '4–7 days', test: (d: number) => d >= 4 && d <= 7, color: '--accent-approvals' },
    { label: 'Over a week', test: (d: number) => d > 7, color: '--accent-expenses' },
  ].map(b => {
    const subset = pending.filter(r => b.test(ageDays(r, nowMs)));
    return { ...b, count: subset.length, value: sum(subset, r => r.totalCost) };
  });
  const queue = [...pending].sort((a, b) => ageDays(b, nowMs) - ageDays(a, nowMs) || b.totalCost - a.totalCost).slice(0, 7);
  const waitingOn = (r: DashRequest) => {
    if (r.status === 'Needs Clarification') return 'Waiting on an answer';
    const step = (r.approvalChain ?? []).filter(s => s.state === 'pending').sort((a, b) => a.order - b.order)[0];
    return step ? (step.delegatedTo ? `${step.designation} → ${step.delegatedTo}` : step.designation) : 'Approver';
  };

  // --- Operations from the other feeds -------------------------------------
  const auctions = feeds.auctions ?? [];
  const auctionLive = auctions.filter(a => a.state === 'live').length;
  const auctionScheduled = auctions.filter(a => a.state === 'scheduled').length;
  const auctionToApprove = auctions.filter(a => a.state === 'closed' && !a.approval).length;
  const auctionAwarded = auctions.filter(a => a.state === 'awarded');
  const contracts = feeds.contracts ?? [];
  const runningContracts = contracts.filter(c => c.running);
  const expiringContracts = runningContracts.filter(c => {
    const end = c.validUntil ? Date.parse(`${c.validUntil}T00:00:00`) : NaN;
    return Number.isFinite(end) && end - nowMs <= 30 * DAY;
  });
  const subs = (feeds.subscriptions ?? []).filter(s => s.state === 'active');
  const openBackorders = (feeds.backorders ?? []).filter(b => b.state !== 'done' && b.state !== 'cancel');
  // Budgets are company-wide in Odoo (by department, optionally branch): a
  // branch filter keeps the budgets of that branch and the unbranched ones.
  const budgets = (feeds.budgets ?? []).filter(b => !branch || !b.branch || b.branch === branch);
  const budgetAllocated = sum(budgets, b => b.allocated);
  const budgetConsumed = sum(budgets, b => b.consumed);
  const budgetUsed = pct(budgetConsumed, budgetAllocated);
  const budgetsOver = budgets.filter(b => b.available < 0).length;

  // --- Recent activity across every request --------------------------------
  const activity = useMemo(() => rows.flatMap(r => r.history.map(h => ({
    id: r.id, status: r.status, title: h.title, desc: h.desc, date: h.date, t: historyTime(h.date, submitted(r)) ?? 0,
  }))).sort((a, b) => b.t - a.t).slice(0, 9), [rows]);
  const activityTone = (title: string) => /reject|cancel/i.test(title) ? '--accent-expenses'
    : /approved|acknowledged|paid|cleared|awarded/i.test(title) ? '--accent-savings'
      : /info|clarif|delegat/i.test(title) ? '--accent-approvals' : '--accent-budget';

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (userName || '').replace(/^Demo\s+/i, '').trim() || 'there';
  const scope = [branch || (company ? companies.find(c => c.name === company)?.short : '') || 'All companies', PERIODS.find(p => p.key === period)?.label].filter(Boolean).join(' · ');
  const statusParts = STATUS_STYLE.map(s => ({ label: s.label, value: rows.filter(r => r.status === s.status).length, color: rgb(s.color) }));
  const selectCls = 'rounded-xl border border-white/30 bg-white/15 px-3 py-2 text-xs font-semibold text-white backdrop-blur focus:outline-none focus:ring-2 focus:ring-white/50 [&>option]:text-slate-800';

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl p-6 md:p-8 text-white shadow-lg"
           style={{ background: `linear-gradient(125deg, ${rgb('--accent-budget')} 0%, ${rgb('--brand-violet')} 55%, ${rgb('--brand-fuchsia')} 100%)` }}>
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">
              <LayoutDashboard className="h-3.5 w-3.5" /> Procurement command centre
            </p>
            <h2 className="mt-2 font-outfit text-3xl md:text-4xl font-extrabold leading-tight">{greeting}, {firstName}</h2>
            <p className="mt-1.5 text-sm text-white/80 max-w-xl">
              {pending.length
                ? <><b className="text-white">{pending.length} request{pending.length === 1 ? '' : 's'}</b> worth <b className="text-white">{money(sum(pending, r => r.totalCost))}</b> {pending.length === 1 ? 'is' : 'are'} waiting on a decision{ageing[3].count ? <>, <b className="text-white">{ageing[3].count}</b> for over a week</> : ''}.</>
                : 'Nothing is waiting on a decision — every request in view has been decided.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={period} onChange={e => setPeriod(e.target.value as Period)} className={selectCls}>
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <select value={company} onChange={e => { setCompany(e.target.value); setBranch(''); }} className={selectCls}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.name} value={c.name}>{c.short}</option>)}
            </select>
            <select value={branch} onChange={e => setBranch(e.target.value)} className={selectCls}>
              <option value="">All branches</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div className="relative mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total requested', value: totalValue, f: money, sub: `${live.length} requests` },
            { label: 'Approved', value: sum(approved, r => r.totalCost), f: money, sub: `${approved.length} requests` },
            { label: 'Awaiting approval', value: sum(pending, r => r.totalCost), f: money, sub: `${pending.length} requests` },
            { label: 'Paid out', value: sum(paid, r => r.totalCost), f: money, sub: `${paid.length} requests settled` },
          ].map(s => (
            <div key={s.label} className="rounded-2xl bg-white/12 border border-white/20 px-4 py-3 backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">{s.label}</p>
              <p className="mt-1 font-outfit text-2xl md:text-[28px] font-extrabold tabular-nums leading-none"><Counter value={s.value} format={s.f} /></p>
              <p className="mt-1 text-[11px] text-white/75">{s.sub}</p>
            </div>
          ))}
        </div>
        <p className="relative mt-4 text-[11px] text-white/60">Showing {scope} · live from Odoo</p>
      </div>

      {/* ── KPI tiles ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={ShoppingCart} label="Requests raised" value={live.length} format={n => Math.round(n).toString()} tone="--accent-budget"
             hint={<>{rows.filter(r => r.status === 'Draft').length} still in draft</>} trend={trend.map(t => t.count)} />
        <Kpi icon={BadgeCheck} label="Approval rate" value={approvalRate} format={n => `${n.toFixed(0)}%`} tone="--accent-savings"
             hint={<>{approved.length} approved · {rejected.length} rejected</>} trend={trend.map(t => t.approved)} />
        <Kpi icon={Hourglass} label="Pending approval" value={pending.length} format={n => Math.round(n).toString()} tone="--accent-approvals"
             hint={<>{money(sum(pending, r => r.totalCost))} · oldest {pending.length ? `${Math.max(...pending.map(r => ageDays(r, nowMs)))} d` : '—'}</>}
             onClick={() => onNav('queue')} />
        <Kpi icon={Timer} label="Avg. approval time" value={avgCycle} format={n => cycle.length ? duration(n) : '—'} tone="--accent-analytics"
             hint={cycle.length ? <>across {cycle.length} approved request{cycle.length === 1 ? '' : 's'}</> : 'no approvals in view yet'} />
        <Kpi icon={ClipboardCheck} label="Purchase orders" value={poCount} format={n => Math.round(n).toString()} tone="--brand-violet"
             hint={<>{money(sum(ordered, r => r.totalCost))} ordered</>} onClick={() => onNav('tracking')} />
        <Kpi icon={Wallet} label="Avg. request value" value={live.length ? totalValue / live.length : 0} format={money} tone="--accent-savings"
             hint={live.length ? <>largest {money(Math.max(...live.map(r => r.totalCost || 0)))}</> : 'no requests in view'} />
        <Kpi icon={PiggyBank} label="Savings" value={requestSavings + auctionSavings} format={money} tone="--brand-pink"
             hint={<>{money(requestSavings)} negotiated · {money(auctionSavings)} auctions</>} />
        <Kpi icon={Landmark} label="Budget used" value={budgetUsed} format={n => budgets.length ? `${n.toFixed(0)}%` : '—'} tone={budgetUsed > 100 ? '--accent-expenses' : '--accent-approvals'}
             hint={budgets.length ? <>{money(budgetConsumed)} of {money(budgetAllocated)} · {budgetsOver} over</> : 'no running budgets'} />
      </div>

      {/* ── Trend + status mix ─────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Panel icon={TrendingUp} title="Spend trend" hint="Value requested and approved, by date submitted" className="lg:col-span-2"
               right={<div className="flex rounded-xl bg-secondary p-1 text-[11px] font-bold">
                 {(['week', 'month'] as const).map(g => (
                   <button key={g} onClick={() => setGrain(g)}
                           className={`px-3 py-1 rounded-lg transition-colors ${grain === g ? 'bg-surface text-brand shadow-sm' : 'text-textFaint hover:text-textPrimary'}`}>
                     {g === 'week' ? 'Weekly' : 'Monthly'}
                   </button>))}
               </div>}>
          <div className="flex items-center gap-4 mb-3 text-[11px] font-semibold text-textSecondary">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: rgb('--accent-budget', 0.25) }} />Requested</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: rgb('--accent-budget') }} />Approved</span>
          </div>
          <div className="flex h-56 items-end gap-2">
            {trend.map(t => (
              <div key={t.label} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 min-w-0">
                <div className="relative flex w-full flex-1 items-end justify-center">
                  <div className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded-lg bg-textPrimary px-2 py-1 text-[10px] font-semibold text-surface group-hover:block z-10"
                       style={{ bottom: `${pct(t.requested, trendMax)}%` }}>
                    {t.count} req · {money(t.requested)} · {money(t.approved)} approved
                  </div>
                  <div className="relative w-full max-w-[38px] rounded-t-lg transition-all duration-700"
                       style={{ height: `${Math.max(pct(t.requested, trendMax), t.requested ? 2 : 0)}%`, background: rgb('--accent-budget', 0.22) }}>
                    <div className="absolute inset-x-0 bottom-0 rounded-t-lg transition-all duration-700"
                         style={{ height: `${pct(t.approved, t.requested)}%`, background: `linear-gradient(180deg, ${rgb('--brand-violet')}, ${rgb('--accent-budget')})` }} />
                  </div>
                </div>
                <span className="w-full truncate text-center text-[10px] font-semibold text-textFaint">{t.label}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel icon={Activity} title="Request pipeline" hint="Where every request stands" tone="--brand-violet">
          <div className="flex flex-col items-center gap-4">
            <Donut parts={statusParts} center={<div>
              <p className="font-outfit text-3xl font-extrabold text-textPrimary tabular-nums"><Counter value={rows.length} format={n => Math.round(n).toString()} /></p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">requests</p>
            </div>} />
            <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5">
              {statusParts.map(p => (
                <div key={p.label} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 text-textSecondary truncate"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />{p.label}</span>
                  <span className="font-bold text-textPrimary tabular-nums">{p.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Company-wise ───────────────────────────────────────────────── */}
      <Panel icon={Building2} title="Company-wise" hint="Each legal entity, by the branches the Company master assigns to it" tone="--accent-analytics">
        <div className="grid md:grid-cols-3 gap-4">
          {companyRows.map((c, i) => {
            const share = pct(c.value, totalValue);
            const palette = ['--accent-budget', '--brand-violet', '--brand-pink', '--accent-analytics'][i % 4];
            return (
              <button key={c.name} type="button" onClick={() => { setCompany(company === c.name ? '' : c.name); setBranch(''); }}
                      className={`relative overflow-hidden rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${company === c.name ? 'border-brand ring-2 ring-brand/20' : 'border-borderTheme'}`}>
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: rgb(palette) }} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-outfit text-[15px] font-extrabold text-textPrimary truncate">{c.short}</p>
                    <p className="text-[10px] text-textFaint truncate">{c.branches.join(' · ') || 'No branches in the master'}</p>
                  </div>
                  <Donut size={58} thickness={8} parts={[{ label: 'Share', value: share, color: rgb(palette) }, { label: 'Rest', value: 100 - share, color: 'transparent' }]}
                         center={<span className="text-[11px] font-extrabold text-textPrimary">{share.toFixed(0)}%</span>} />
                </div>
                <p className="mt-2 font-outfit text-2xl font-extrabold text-textPrimary tabular-nums"><Counter value={c.value} format={money} /></p>
                <p className="text-[11px] text-textSecondary">{c.count} requests · {c.ordered} ordered · {money(c.paidValue)} paid</p>
                <div className="mt-3">
                  <StackBar parts={[
                    { label: 'Approved', value: c.approvedValue, color: rgb('--accent-savings') },
                    { label: 'Pending', value: c.pendingValue, color: rgb('--accent-approvals') },
                    { label: 'Rejected', value: c.rejectedValue, color: rgb('--accent-expenses') },
                  ]} />
                </div>
                <div className="mt-2 flex justify-between text-[10px] font-semibold">
                  <span style={{ color: rgb('--accent-savings') }}>✓ {c.approved} approved</span>
                  <span style={{ color: rgb('--accent-approvals') }}>◷ {c.pending} pending</span>
                  <span style={{ color: rgb('--accent-expenses') }}>✕ {c.rejected} rejected</span>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* ── Branch-wise ───────────────────────────────────────────────── */}
      <Panel icon={MapPin} title="Branch-wise" hint="Click a branch to focus the whole dashboard on it" tone="--brand-pink"
             right={branch ? <button onClick={() => setBranch('')} className="text-[11px] font-bold text-brand hover:underline">Show all branches</button> : undefined}>
        <div className="overflow-x-auto -mx-5">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-textFaint">
                {['Branch', 'Company', 'Requests', 'Value', 'Approved', 'Pending', 'Rejected', 'PO / Paid', 'Approval rate'].map((h, i) => (
                  <th key={h} className={`px-5 py-2 whitespace-nowrap ${i >= 2 ? 'text-right' : ''} ${i === 3 ? 'w-[24%]' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branchRows.map(b => (
                <tr key={b.name} onClick={() => setBranch(branch === b.name ? '' : b.name)}
                    className={`cursor-pointer border-t border-borderTheme transition-colors hover:bg-secondary/60 ${branch === b.name ? 'bg-brand/5' : ''}`}>
                  <td className="px-5 py-3 text-xs font-bold text-textPrimary whitespace-nowrap"><MapPin className="mr-1.5 inline h-3.5 w-3.5 text-textFaint" />{b.name}</td>
                  <td className="px-5 py-3 text-xs text-textSecondary whitespace-nowrap">{b.company}</td>
                  <td className="px-5 py-3 text-right text-xs font-bold tabular-nums text-textPrimary">{b.count}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct(b.value, branchMax)}%`, background: `linear-gradient(90deg, ${rgb('--accent-budget')}, ${rgb('--brand-violet')})` }} />
                      </div></div>
                      <span className="w-20 text-right text-xs font-bold tabular-nums text-textPrimary">{money(b.value)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-xs tabular-nums whitespace-nowrap" style={{ color: rgb('--accent-savings') }}><b>{b.approved}</b> <span className="text-textFaint">· {money(b.approvedValue)}</span></td>
                  <td className="px-5 py-3 text-right text-xs tabular-nums whitespace-nowrap" style={{ color: rgb('--accent-approvals') }}><b>{b.pending}</b> <span className="text-textFaint">· {money(b.pendingValue)}</span></td>
                  <td className="px-5 py-3 text-right text-xs font-bold tabular-nums" style={{ color: rgb('--accent-expenses') }}>{b.rejected}</td>
                  <td className="px-5 py-3 text-right text-xs tabular-nums text-textSecondary whitespace-nowrap">{b.ordered} / {b.paid}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${b.rate >= 80 ? 'bg-pos/10 text-pos' : b.rate >= 50 ? 'bg-gold/10 text-gold' : 'bg-neg/10 text-neg'}`}>
                      {b.approved + b.rejected ? `${b.rate.toFixed(0)}%` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {!branchRows.length && <tr><td colSpan={9} className="px-5 py-8 text-center text-xs text-textFaint">No requests in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Pending approvals ─────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Panel icon={Clock} title="Pending approvals" hint="Oldest first — click one to decide it" tone="--accent-approvals" className="lg:col-span-3"
               right={<button onClick={() => onNav('queue')} className="flex items-center gap-1 text-[11px] font-bold text-brand hover:underline">Open To Approve <ArrowRight className="h-3 w-3" /></button>}>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {ageing.map(a => (
              <div key={a.label} className="rounded-xl border border-borderTheme p-2.5" style={{ background: rgb(a.color, 0.06) }}>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: rgb(a.color) }}>{a.label}</p>
                <p className="font-outfit text-xl font-extrabold text-textPrimary tabular-nums">{a.count}</p>
                <p className="text-[10px] text-textFaint tabular-nums">{money(a.value)}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {queue.map(r => {
              const age = ageDays(r, nowMs);
              return (
                <button key={r.id} onClick={() => onOpenRequest(r.id, r.status)}
                        className="group flex w-full items-center gap-3 rounded-xl border border-borderTheme px-3 py-2.5 text-left transition-all hover:border-brand/40 hover:bg-brand/5">
                  <span className={`h-9 w-1 rounded-full ${age > 7 ? 'bg-neg' : age > 3 ? 'bg-gold' : 'bg-pos'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-textPrimary truncate">
                      <span className="font-mono text-textFaint mr-1.5">{r.id}</span>{r.productName}
                    </p>
                    <p className="text-[11px] text-textSecondary truncate">{r.location} · {r.department || '—'} · {waitingOn(r)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-extrabold text-textPrimary tabular-nums">{money(r.totalCost)}</p>
                    <p className={`text-[10px] font-bold ${age > 7 ? 'text-neg' : age > 3 ? 'text-gold' : 'text-textFaint'}`}>{age ? `${age} d waiting` : 'today'}</p>
                  </div>
                  {r.urgency === 'High' && <span className="rounded-full bg-neg/10 px-2 py-0.5 text-[9px] font-bold uppercase text-neg">Urgent</span>}
                  <ArrowRight className="h-3.5 w-3.5 text-textFaint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>
              );
            })}
            {!queue.length && (
              <div className="flex items-center gap-2 rounded-xl bg-pos/5 border border-pos/20 px-4 py-6 text-xs font-semibold text-pos justify-center">
                <CheckCircle2 className="h-4 w-4" /> All caught up — nothing waiting on approval.
              </div>
            )}
            {pending.length > queue.length && <p className="pt-1 text-center text-[11px] text-textFaint">+ {pending.length - queue.length} more in To Approve</p>}
          </div>
        </Panel>

        <Panel icon={Users} title="By department" hint="Value requested by each department" tone="--accent-budget" className="lg:col-span-2">
          <BarList rows={departments} total={totalValue} color="--accent-budget" />
          <div className="mt-5 pt-4 border-t border-borderTheme">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-textFaint">Urgency mix</p>
            <div className="flex items-center gap-4">
              <Donut size={84} thickness={11} parts={urgency.map((u, i) => ({ ...u, color: rgb(['--accent-expenses', '--accent-approvals', '--accent-savings'][i]) }))}
                     center={<span className="text-xs font-extrabold text-textPrimary">{live.length}</span>} />
              <div className="flex-1 space-y-1.5">
                {urgency.map((u, i) => (
                  <div key={u.label} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-textSecondary"><span className="h-2 w-2 rounded-full" style={{ background: rgb(['--accent-expenses', '--accent-approvals', '--accent-savings'][i]) }} />{u.label}</span>
                    <span className="font-bold text-textPrimary tabular-nums">{u.value} <span className="font-normal text-textFaint">({pct(u.value, live.length).toFixed(0)}%)</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Categories, products, vendors ─────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Panel icon={IndianRupee} title="By expense category" hint="Where the money is going" tone="--brand-violet">
          <BarList rows={categories} total={totalValue} color="--brand-violet" />
        </Panel>
        <Panel icon={Sparkles} title="Top products" hint="By value requested, across every line" tone="--brand-pink">
          <div className="space-y-3">
            {products.map((p, i) => (
              <div key={p.name}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-secondary text-[10px] font-extrabold text-textSecondary">{i + 1}</span>
                    <span className="truncate font-semibold text-textPrimary">{p.name}</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-textPrimary">{money(p.value)}</span>
                </div>
                <div className="mt-1 ml-7 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct(p.value, productMax)}%`, background: rgb('--brand-pink') }} />
                  </div>
                  <span className="text-[10px] text-textFaint tabular-nums">{p.qty.toLocaleString('en-IN')} units</span>
                </div>
              </div>
            ))}
            {!products.length && <p className="text-xs text-textFaint">No requests in this view.</p>}
          </div>
        </Panel>
        <Panel icon={Store} title="Top vendors" hint="By value of purchase orders placed" tone="--accent-savings">
          <div className="space-y-3">
            {vendors.map(v => (
              <div key={v.name} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-extrabold text-white"
                      style={{ background: `linear-gradient(135deg, ${rgb('--accent-savings')}, ${rgb('--accent-analytics')})` }}>
                  {v.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-textPrimary">{v.name}</span>
                    <span className="font-bold tabular-nums text-textPrimary">{money(v.value)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct(v.value, vendorMax)}%`, background: rgb('--accent-savings') }} />
                    </div>
                    <span className="text-[10px] text-textFaint">{v.count} order{v.count === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </div>
            ))}
            {!vendors.length && <p className="text-xs text-textFaint">No purchase orders in this view yet.</p>}
          </div>
        </Panel>
      </div>

      {/* ── Operations ────────────────────────────────────────────────── */}
        <Panel icon={Gavel} title="Sourcing & operations" hint="Auctions, contracts, subscriptions and deliveries — company-wide" tone="--accent-analytics">
          {offline ? <p className="text-xs text-textFaint">Sign in against the server to see live auctions, contracts and deliveries.</p> : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <OpsTile icon={Gavel} tone="--accent-expenses" title="Reverse auctions"
                       value={`${auctionLive} live · ${auctionScheduled} scheduled`}
                       detail={auctionToApprove ? `${auctionToApprove} closed, waiting for your award approval` : `${auctionAwarded.length} awarded · ${money(auctionSavings)} saved`}
                       alert={auctionToApprove > 0} onClick={() => onNav('auctions')} />
              <OpsTile icon={FileSignature} tone="--accent-budget" title="Rate contracts"
                       value={`${runningContracts.length} running`}
                       detail={expiringContracts.length ? `${expiringContracts.map(c => c.id).join(', ')} end${expiringContracts.length === 1 ? 's' : ''} within 30 days` : `${sum(runningContracts, c => c.purchaseOrderCount)} purchase orders raised under them`}
                       alert={expiringContracts.length > 0} onClick={() => onNav('masters')} />
              <OpsTile icon={Repeat} tone="--brand-violet" title="Subscriptions"
                       value={`${money(sum(subs, s => s.monthlyCost))} / month`}
                       detail={subs.length ? `${subs.length} active · ${money(sum(subs, s => s.annualCost))} a year · next order ${shortDate(subs.map(s => s.nextOrderDate).filter(Boolean).sort()[0])}` : 'No active subscriptions'}
                       onClick={() => onNav('subscriptions')} />
              <OpsTile icon={Truck} tone="--accent-approvals" title="Backorders"
                       value={`${openBackorders.length} open`}
                       detail={openBackorders.length ? `${sum(openBackorders, b => b.qtyPending)} units · ${money(sum(openBackorders, b => b.amountPending))} still to arrive${openBackorders.some(b => b.overdue) ? ' · overdue' : ''}` : 'Every order received in full'}
                       alert={openBackorders.some(b => b.overdue)} onClick={() => onNav('backorders')} />
            </div>
          )}
        </Panel>

      {/* ── Budgets + activity ────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Panel icon={Landmark} title="Budget utilisation" hint="Running budgets in Odoo — committed by approvals, ordered by purchase orders" tone="--accent-approvals" className="lg:col-span-3"
               right={budgets.length ? <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${budgetsOver ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos'}`}>{budgetsOver ? `${budgetsOver} of ${budgets.length} over budget` : 'All within budget'}</span> : undefined}>
          {offline ? <p className="text-xs text-textFaint">Sign in against the server to see budgets.</p> : (
            <div className="space-y-4">
              {budgets.map(b => {
                const over = b.available < 0;
                const ordered = pct(b.ordered, Math.max(b.allocated, b.consumed));
                const committed = pct(b.consumed - b.ordered, Math.max(b.allocated, b.consumed));
                const limit = pct(b.allocated, Math.max(b.allocated, b.consumed));
                return (
                  <div key={b.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xs font-bold text-textPrimary">{b.name}
                        <span className="ml-2 font-normal text-textFaint">{[b.department, b.branch, b.category].filter(Boolean).join(' · ')}</span></p>
                      <p className="text-xs tabular-nums">
                        <b className={over ? 'text-neg' : 'text-textPrimary'}>{b.usedPercent.toFixed(0)}%</b>
                        <span className="text-textFaint"> · {money(b.consumed)} of {money(b.allocated)}</span>
                      </p>
                    </div>
                    <div className="relative mt-1.5 h-3 overflow-hidden rounded-full bg-secondary">
                      <div className="absolute inset-y-0 left-0 transition-all duration-700" style={{ width: `${ordered}%`, background: rgb('--brand-violet') }} />
                      <div className="absolute inset-y-0 transition-all duration-700" style={{ left: `${ordered}%`, width: `${committed}%`, background: rgb(over ? '--accent-expenses' : '--accent-approvals', 0.75) }} />
                      {over && <div className="absolute inset-y-0 w-0.5 bg-textPrimary" style={{ left: `${limit}%` }} title="Allocated amount" />}
                    </div>
                    <p className={`mt-1 text-[10px] ${over ? 'text-neg font-semibold' : 'text-textFaint'}`}>
                      {over ? `${money(-b.available)} over the allocation` : `${money(b.available)} still available`} · {money(b.ordered)} ordered · {money(b.consumed - b.ordered)} committed
                    </p>
                  </div>
                );
              })}
              {!budgets.length && <p className="text-xs text-textFaint">No running budgets — they are set up in Odoo under SmartSpend → Budgets.</p>}
              {budgets.length > 0 && (
                <div className="flex gap-4 pt-1 text-[10px] font-semibold text-textSecondary">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: rgb('--brand-violet') }} />Ordered</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: rgb('--accent-approvals', 0.75) }} />Committed</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-0.5 bg-textPrimary" />Allocation (when exceeded)</span>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel icon={Activity} title="Recent activity" hint="The latest steps across every request" tone="--brand-pink" className="lg:col-span-2">
          <ol className="relative space-y-3 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-borderTheme">
            {activity.map((a, i) => (
              <li key={`${a.id}-${i}`} className="relative pl-6">
                <span className="absolute left-0 top-1 h-[15px] w-[15px] rounded-full border-[3px] border-surface" style={{ background: rgb(activityTone(a.title)) }} />
                <button onClick={() => onOpenRequest(a.id, a.status)} className="text-left">
                  <p className="text-xs font-semibold text-textPrimary leading-snug">{a.title}</p>
                  <p className="text-[10px] text-textFaint"><span className="font-mono">{a.id}</span> · {a.date}</p>
                </button>
              </li>
            ))}
            {!activity.length && <li className="pl-6 text-xs text-textFaint">No activity in this view.</li>}
          </ol>
        </Panel>
      </div>

      <p className="pb-2 text-center text-[11px] text-textFaint">
        Figures are request values (line quantity × price) from Odoo; companies follow the Company master in Master Data.
      </p>
    </div>
  );
}

function BarList({ rows, total, color }: { rows: { name: string; count: number; value: number }[]; total: number; color: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="space-y-3">
      {rows.slice(0, 7).map(r => (
        <div key={r.name}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-semibold text-textPrimary">{r.name}</span>
            <span className="shrink-0 tabular-nums"><b className="text-textPrimary">{money(r.value)}</b> <span className="text-textFaint">· {pct(r.value, total).toFixed(0)}%</span></span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct(r.value, max)}%`, background: rgb(color) }} />
            </div>
            <span className="w-12 text-right text-[10px] text-textFaint">{r.count} req</span>
          </div>
        </div>
      ))}
      {!rows.length && <p className="text-xs text-textFaint">No requests in this view.</p>}
    </div>
  );
}

function OpsTile({ icon: Icon, tone, title, value, detail, alert, onClick }: {
  icon: LucideIcon; tone: string; title: string; value: string; detail: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
            className="group relative rounded-xl border border-borderTheme p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md">
      {alert && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-neg animate-pulse" />}
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: rgb(tone, 0.12), color: rgb(tone) }}><Icon className="h-3.5 w-3.5" /></span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">{title}</span>
      </div>
      <p className="mt-2 font-outfit text-lg font-extrabold text-textPrimary">{value}</p>
      <p className={`text-[11px] ${alert ? 'text-neg font-semibold' : 'text-textSecondary'}`}>{detail}</p>
    </button>
  );
}
