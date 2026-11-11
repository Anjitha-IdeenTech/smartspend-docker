/**
 * The procurement manager's reports, branch-wise.
 *
 *  - Turn Around Time: how long a PR takes from submission to its last
 *    approval signature, with the time spent at each approval level.
 *  - PR Closing Time: how long a PR takes from submission until it is paid,
 *    split into approval, ordering, delivery and payment where the timeline
 *    records both ends of the stage.
 *  - Budget: what each of Odoo's running budgets was allocated against what
 *    requests have committed (in flight) and ordered, with the spend split
 *    branch-wise and by requester.
 *
 * Everything is measured from live data: the request's submission time, the
 * approval chain's decision times and the request timeline. Requests still
 * open are listed with how long they have been waiting so far.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileBarChart, FlaskConical, Hourglass, MapPin, Timer, TrendingDown, TrendingUp,
  Landmark, PieChart, UserRound, Users, Wallet,
} from 'lucide-react';
import {
  C, Card, DonutWithLegend, HBars, PERIODS, SmallStat, duration, historyTime, money, pct, periodStart, plural, shortDate, submitted, sum,
} from './managerDashboard';
import type { DashCompany, DashRequest, Period } from './managerDashboard';

type ReportKey = 'tat' | 'closing' | 'budget';
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
type GroupKey = 'all' | 'branch' | 'user';
type GroupKind = 'branch' | 'user';

const APPROVED = ['Sourcing', 'Approved', 'PO Confirmed', 'Paid'];
const PENDING = ['Pending Approval', 'Needs Clarification'];
const NOT_OPEN = ['Draft', 'Rejected', 'Cancelled', 'Paid'];
// What a budget counts, as Odoo does: requests in flight are committed, those
// that reached a purchase order are ordered.
const COMMITTED = ['Pending Approval', 'Needs Clarification', 'Sourcing', 'Approved'];
const ORDERED = ['PO Confirmed', 'Paid'];

/** A budget as /api/smartspend/budgets lists it (sample ones are flagged). */
interface BudgetRow {
  id: number; name: string; department: string; branch: string; category: string;
  periodStart: string; periodEnd: string; allocated: number; sample?: boolean;
}
const HOUR = 3600000;

/**
 * Hours between two times, or null when either is missing or out of order.
 * Timeline and decision times come to the minute only, so an end up to a
 * minute before its start is the same minute: no time at all.
 */
const span = (from: number | null, to: number | null) => {
  if (from === null || to === null) return null;
  if (to >= from) return (to - from) / HOUR;
  return from - to < 60000 ? 0 : null;
};

/**
 * Who raised the request: Odoo writes "Raised by <name>" (or "Raised by
 * <name> (created by <author>)" when raised on someone's behalf) on the
 * "Request Submitted" timeline entry.
 */
const requesterOf = (r: DashRequest) => {
  for (const h of r.history) {
    const m = /^Raised by (.+?)(?: \(created by .*\))?$/.exec((h.desc || '').trim());
    if (m) return m[1].trim();
  }
  return 'Not recorded';
};

// ---------------------------------------------------------------------------
// Sample data — demo only. Never sent to Odoo; shown only while the
// "Sample data" switch is on, and labelled as such on screen.
// ---------------------------------------------------------------------------

const SAMPLE_USERS: { name: string; department: string; speed: number }[] = [
  { name: 'Divya Menon', department: 'IT', speed: 0.6 },
  { name: 'Rahul Varma', department: 'Finance', speed: 1.4 },
  { name: 'Anitha George', department: 'Operations', speed: 0.9 },
  { name: 'Sanjay Kumar', department: 'Administration', speed: 1.8 },
  { name: 'Fathima Rasheed', department: 'HR', speed: 0.75 },
  { name: 'Nikhil Joseph', department: 'IT', speed: 1.1 },
  { name: 'Lakshmi Iyer', department: 'Marketing', speed: 1.25 },
  { name: 'Arun Thomas', department: 'Facilities', speed: 0.85 },
  { name: 'Vivek Sharma', department: 'Sales', speed: 1.05 },
  { name: 'Pooja Reddy', department: 'Finance', speed: 0.7 },
  { name: 'Karthik Subramanian', department: 'Engineering', speed: 1.6 },
  { name: 'Mohammed Irfan', department: 'Operations', speed: 0.95 },
  { name: 'Ritu Agarwal', department: 'HR', speed: 1.15 },
  { name: 'Joseph Mathew', department: 'Facilities', speed: 1.35 },
  { name: 'Swati Kulkarni', department: 'Marketing', speed: 0.8 },
  { name: 'Harish Bhat', department: 'Engineering', speed: 1.2 },
];
const SAMPLE_ITEMS: { name: string; category: string; cost: number }[] = [
  { name: 'Dell Latitude Laptops', category: 'IT Hardware', cost: 420000 },
  { name: 'Ergonomic Office Chairs', category: 'Furniture', cost: 96000 },
  { name: 'Microsoft 365 Licences', category: 'Software', cost: 164000 },
  { name: '27" Monitors', category: 'IT Hardware', cost: 132000 },
  { name: 'Conference Room Display', category: 'IT Hardware', cost: 185000 },
  { name: 'Workstation Desks', category: 'Furniture', cost: 150000 },
  { name: 'Wireless Headsets', category: 'IT Hardware', cost: 41000 },
  { name: 'Antivirus Renewal', category: 'Software', cost: 58000 },
  { name: 'Docking Stations', category: 'IT Hardware', cost: 68000 },
  { name: 'Printer Toner Stock', category: 'Office Supplies', cost: 24000 },
];
const SAMPLE_VENDORS = ['Primus Technologies', 'Apex Systems', 'SecureNet', 'Featherlite'];
const SAMPLE_LEVELS = ['Reporting Manager', 'Department Head', 'Finance Head'];
const SAMPLE_BRANCHES = ['Kochi', 'Bengaluru', 'Chennai', 'Mumbai'];

/** Small seeded generator, so the sample reads the same on every visit. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** A time in the timeline's own format ("October 19, 05:22"). */
const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function buildSample(companies: DashCompany[], nowMs: number): DashRequest[] {
  const rnd = seeded(20261109);
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const minute = (t: number) => Math.floor(t / 60000) * 60000;
  const live = companies.flatMap(c => c.branches);
  const branches = live.length ? live : SAMPLE_BRANCHES;
  const out: DashRequest[] = [];
  let seq = 101;
  SAMPLE_USERS.forEach((u, ui) => {
    const location = branches[ui % branches.length];
    const count = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const item = pick(SAMPLE_ITEMS);
      const roll = rnd();
      const status = roll < 0.45 ? 'Paid' : roll < 0.58 ? 'PO Confirmed' : roll < 0.66 ? 'Approved' : roll < 0.72 ? 'Sourcing'
        : roll < 0.86 ? 'Pending Approval' : roll < 0.93 ? 'Needs Clarification' : 'Rejected';
      const nLevels = item.cost >= 150000 ? 3 : 2;
      const levelHours = Array.from({ length: nLevels }, () => between(1.5, 26) * u.speed);
      const ordering = between(10, 80) * u.speed, delivery = between(48, 220), payment = between(20, 150) * u.speed;
      const done = ['Sourcing', 'Approved', 'PO Confirmed', 'Paid'].includes(status);
      const pendingAt = done ? nLevels : Math.floor(rnd() * nLevels);
      // Work back from today so every recorded time is in the past.
      let total = sum(levelHours.slice(0, pendingAt), h => h);
      if (status === 'PO Confirmed') total += ordering;
      if (status === 'Paid') total += ordering + delivery + payment;
      const waiting = done ? 0 : between(3, 96);
      const start = minute(nowMs - (total + waiting) * HOUR - (status === 'Pending Approval' || status === 'Needs Clarification' ? 0 : between(1, 150) * 24 * HOUR));
      const history: DashRequest['history'] = [{ title: 'Request Submitted', date: stamp(start), desc: `Raised by ${u.name}` }];
      const approvalChain: NonNullable<DashRequest['approvalChain']> = [];
      let t = start;
      SAMPLE_LEVELS.slice(0, nLevels).forEach((designation, li) => {
        if (li < pendingAt) {
          t = minute(t + levelHours[li] * HOUR);
          approvalChain.push({ order: li + 1, designation, state: 'approved', decidedOn: stamp(t) });
          history.push({ title: `Approved · ${designation}`, date: stamp(t) });
        } else {
          approvalChain.push({ order: li + 1, designation, state: status === 'Rejected' && li === pendingAt ? 'rejected' : 'pending' });
        }
      });
      if (status === 'Rejected') history.push({ title: 'Rejected', date: stamp(minute(t + between(2, 20) * HOUR)) });
      if (status === 'PO Confirmed' || status === 'Paid') {
        t = minute(t + ordering * HOUR); history.push({ title: 'Vendor Acknowledged', date: stamp(t) });
      }
      if (status === 'Paid') {
        t = minute(t + delivery * HOUR); history.push({ title: 'Goods Received', date: stamp(t) });
        t = minute(t + payment * HOUR); history.push({ title: 'Payment Cleared', date: stamp(t) });
      }
      out.push({
        id: `SAMPLE-${seq++}`, productName: item.name, totalCost: Math.round(item.cost * (0.6 + rnd() * 0.8) / 100) * 100,
        location, department: u.department, expenseCategory: item.category, status, urgency: pick(['High', 'Medium', 'Low']),
        createdDate: new Date(start).toLocaleDateString('en-IN'), submittedAt: new Date(start).toISOString(),
        vendor: done ? pick(SAMPLE_VENDORS) : 'Pending Sourcing', savings: 0, history, approvalChain,
        budgetName: sampleBudgetName(u.department, nowMs),
      });
    }
  });
  // Over budget: the PRs, oldest first, that take their budget past its allocation.
  sampleBudgets(out, nowMs).forEach(b => {
    let used = 0;
    out.filter(r => r.budgetName === b.name && (COMMITTED.includes(r.status) || ORDERED.includes(r.status)))
      .sort((x, y) => (submitted(x) ?? 0) - (submitted(y) ?? 0))
      .forEach(r => { used += r.totalCost; r.budgetBreach = used > b.allocated; });
  });
  return out;
}

/** How generously each sample department is budgeted, against what its PRs use. */
const SAMPLE_HEADROOM: Record<string, number> = {
  IT: 1.25, Finance: 1.6, Operations: 0.9, Administration: 1.1, HR: 1.8,
  Marketing: 0.96, Facilities: 1.35, Sales: 1.5, Engineering: 1.05,
};
// Named apart from Odoo's own budgets, so a live one is never counted twice.
const sampleBudgetName = (department: string, nowMs: number) => `${department} — ${new Date(nowMs).getFullYear()} (sample)`;

/** One sample budget per sample department, for this calendar year. */
function sampleBudgets(prs: DashRequest[], nowMs: number): BudgetRow[] {
  const year = new Date(nowMs).getFullYear();
  const departments = [...new Set(SAMPLE_USERS.map(u => u.department))];
  return departments.map((department, i) => {
    const name = sampleBudgetName(department, nowMs);
    const used = sum(prs.filter(r => r.budgetName === name && (COMMITTED.includes(r.status) || ORDERED.includes(r.status))), r => r.totalCost);
    return {
      id: -(i + 1), name, department, branch: '', category: '', sample: true,
      periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
      allocated: Math.max(100000, Math.round(used * (SAMPLE_HEADROOM[department] ?? 1.2) / 50000) * 50000),
    };
  });
}

/** When the first timeline entry matching `re` happened. */
const firstEvent = (r: DashRequest, re: RegExp, from: number | null) => {
  const times = r.history.filter(h => re.test(h.title)).map(h => historyTime(h.date, from)).filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
};

/**
 * When the request was fully approved, and how long each level took. The
 * approval chain's decision times are used; a request without a recorded
 * chain falls back to its "Approved" timeline entries.
 */
const approvalOf = (r: DashRequest) => {
  const from = submitted(r);
  const steps = (r.approvalChain ?? [])
    .filter(s => s.state === 'approved' && s.decidedOn)
    .map(s => ({ order: s.order, designation: s.designation, t: historyTime(s.decidedOn as string, from) }))
    .filter((s): s is { order: number; designation: string; t: number } => s.t !== null)
    .sort((a, b) => a.order - b.order || a.t - b.t);
  if (steps.length) {
    let prev = from;
    const levels = steps.map((s, i) => {
      const hours = span(prev, s.t);
      prev = s.t;
      return { level: i + 1, designation: s.designation, hours };
    });
    return { at: Math.max(...steps.map(s => s.t)), levels };
  }
  const signed = r.history.filter(h => /^Approved( ·|$)/.test(h.title)).map(h => historyTime(h.date, from)).filter((t): t is number => t !== null);
  return { at: signed.length ? Math.max(...signed) : null, levels: [] as { level: number; designation: string; hours: number | null }[] };
};

/** The stages of a paid request's life, each measured only when both ends are on record. */
const CLOSING_STAGES: { key: string; label: string; hint: string; color: string }[] = [
  { key: 'approval', label: 'Approval', hint: 'Submitted → fully approved', color: C.amber },
  { key: 'ordering', label: 'Ordering', hint: 'Approved → vendor confirmed the PO', color: C.indigo },
  { key: 'delivery', label: 'Delivery', hint: 'Vendor confirmed → goods received', color: C.cyan },
  { key: 'payment', label: 'Payment', hint: 'Goods received → payment cleared', color: C.green },
];

interface Row {
  r: DashRequest;
  /** Submission → approved (TAT) or → paid (closing). */
  hours: number;
  start: number;
  end: number;
  /** Per approval level (TAT) or per stage (closing), in hours. */
  parts: Record<string, number | null>;
  levels?: { level: number; designation: string; hours: number | null }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]) => (xs.length ? sum(xs, x => x) / xs.length : 0);
const show = (h: number | null | undefined) => (h === null || h === undefined || !Number.isFinite(h) ? '—'
  : h < 1 / 60 ? '< 1 min' : duration(h));
const when = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const download = (name: string, lines: (string | number)[][]) => {
  const blob = new Blob([lines.map(l => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export function ManagerReports({ requests, companies, onOpenRequest, fetcher, offline }: {
  requests: DashRequest[];
  companies: DashCompany[];
  /** Reads Odoo's running budgets for the budget report. */
  fetcher?: Fetcher;
  offline?: boolean;
  /** Open one request (tracking, or the approval queue while it waits). */
  onOpenRequest: (id: string, status: string) => void;
}) {
  const [report, setReport] = useState<ReportKey>('tat');
  const [period, setPeriod] = useState<Period>('all');
  const [company, setCompany] = useState('');
  const [branch, setBranch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // 'all' shows the branch-wise and the user-wise table together.
  const [groupBy, setGroupBy] = useState<GroupKey>('all');
  // On unless switched off in this browser (remembered).
  const [sample, setSampleState] = useState(() => {
    try { return localStorage.getItem('smartspend.reports.sample.v2') !== '0'; } catch { return true; }
  });
  const setSample = (on: boolean) => {
    setSampleState(on); setOpen(null);
    try { localStorage.setItem('smartspend.reports.sample.v2', on ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();
  const byUser = groupBy === 'user';

  // Live requests, plus the labelled demo sample while the switch is on.
  const samplePRs = useMemo(() => (sample ? buildSample(companies, nowMs) : []), [sample, companies, nowMs]);
  const source = useMemo(() => [...requests, ...samplePRs], [requests, samplePRs]);

  // Odoo's running budgets, plus the sample ones while the switch is on.
  const [liveBudgets, setLiveBudgets] = useState<BudgetRow[] | null>(null);
  useEffect(() => {
    if (offline || !fetcher) { setLiveBudgets([]); return; }
    let stale = false;
    fetcher('/api/smartspend/budgets', { method: 'GET' })
      .then(res => (res.ok ? res.json() : []))
      .then(rows => { if (!stale) setLiveBudgets(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!stale) setLiveBudgets([]); });
    return () => { stale = true; };
  }, [offline]);
  const budgets = useMemo(() => [...(liveBudgets ?? []), ...(sample ? sampleBudgets(samplePRs, nowMs) : [])],
    [liveBudgets, sample, samplePRs, nowMs]);
  // Sample PRs do not exist in Odoo, so there is nothing to open.
  const isSample = (id: string) => id.startsWith('SAMPLE-');
  const openRequest = (id: string, status: string) => { if (!isSample(id)) onOpenRequest(id, status); };

  const companyOf = (b: string) => companies.find(c => c.branches.some(x => x.trim().toLowerCase() === (b || '').trim().toLowerCase()));
  const companyName = (b: string) => companyOf(b)?.name ?? 'Unassigned';
  const branchOf = (r: DashRequest) => r.location || 'Unassigned';
  const groupOf = (kind: GroupKind, r: DashRequest) => (kind === 'user' ? requesterOf(r) : branchOf(r));

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    companies.forEach(c => { if (!company || c.name === company) c.branches.forEach(b => set.add(b)); });
    source.forEach(r => { if (r.location && (!company || companyName(r.location) === company)) set.add(r.location); });
    return [...set].sort();
  }, [companies, source, company]);

  // The requests in the chosen period (by submission), company and branch.
  const scoped = useMemo(() => {
    const from = periodStart(period, now);
    return source.filter(r => {
      if (r.status === 'Draft') return false;
      const t = submitted(r);
      if (from !== null && (t === null || t < from)) return false;
      if (company && companyName(r.location) !== company) return false;
      if (branch && r.location !== branch) return false;
      return true;
    });
  }, [source, period, company, branch, companies]);

  // --- Measured rows ---------------------------------------------------------
  const measured: Row[] = useMemo(() => scoped.flatMap(r => {
    const start = submitted(r);
    if (start === null) return [];
    const appr = approvalOf(r);
    if (report === 'tat') {
      if (!APPROVED.includes(r.status) || appr.at === null) return [];
      const hours = span(start, appr.at);
      if (hours === null) return [];
      const parts: Record<string, number | null> = {};
      appr.levels.forEach(l => { parts[`L${l.level}`] = l.hours; });
      return [{ r, hours, start, end: appr.at, parts, levels: appr.levels }];
    }
    if (r.status !== 'Paid') return [];
    const paidAt = firstEvent(r, /^Payment Cleared/, start)
      ?? Math.max(...r.history.map(h => historyTime(h.date, start) ?? -Infinity));
    const hours = span(start, Number.isFinite(paidAt) ? paidAt : null);
    if (hours === null) return [];
    const acked = firstEvent(r, /^Vendor Acknowledged/, start);
    const received = firstEvent(r, /^Goods Received/, start);
    const paid = firstEvent(r, /^Payment Cleared/, start);
    return [{
      r, hours, start, end: paidAt, levels: appr.levels,
      parts: {
        approval: span(start, appr.at), ordering: span(appr.at, acked),
        delivery: span(acked, received), payment: span(received, paid),
      },
    }];
  }), [scoped, report]);

  // Still open: waiting on approval (TAT) or not yet paid (closing).
  const stillOpen = useMemo(() => scoped.filter(r => report === 'tat' ? PENDING.includes(r.status) : !NOT_OPEN.includes(r.status)),
    [scoped, report]);
  const ageOf = (r: DashRequest) => { const t = submitted(r); return t === null ? 0 : Math.max(0, (nowMs - t) / HOUR); };

  // Approval levels seen in this selection, for the TAT columns.
  const levelKeys = useMemo(() => {
    const n = Math.max(0, ...measured.map(m => m.levels?.length ?? 0));
    return Array.from({ length: n }, (_, i) => `L${i + 1}`);
  }, [measured]);
  const partKeys = report === 'tat' ? levelKeys : CLOSING_STAGES.map(s => s.key);
  const partLabel = (k: string) => report === 'tat' ? `Level ${k.slice(1)}` : CLOSING_STAGES.find(s => s.key === k)!.label;

  // --- Branch-wise or user-wise (by requester) ----------------------------------
  /** The line under a group's name: the branch's company, or the requester's branch. */
  const subLabel = (kind: GroupKind, name: string, reqs: DashRequest[]) => {
    if (kind === 'branch') return companyOf(name)?.short ?? '—';
    const counts = new Map<string, number>();
    reqs.forEach(r => counts.set(branchOf(r), (counts.get(branchOf(r)) ?? 0) + 1));
    const home = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!home) return '—';
    const co = companyOf(home)?.short;
    return `${home}${co ? ` · ${co}` : ''}${counts.size > 1 ? ` +${counts.size - 1}` : ''}`;
  };
  const buildGroups = (kind: GroupKind) => {
    const names = new Set<string>([...measured.map(m => groupOf(kind, m.r)), ...stillOpen.map(r => groupOf(kind, r))]);
    return [...names].map(name => {
      const rows = measured.filter(m => groupOf(kind, m.r) === name).sort((a, b) => b.hours - a.hours);
      const hrs = rows.map(m => m.hours);
      const waiting = stillOpen.filter(r => groupOf(kind, r) === name);
      const parts: Record<string, number | null> = {};
      partKeys.forEach(k => {
        const xs = rows.map(m => m.parts[k]).filter((x): x is number => x !== null && x !== undefined);
        parts[k] = xs.length ? avg(xs) : null;
      });
      return {
        name, company: subLabel(kind, name, [...rows.map(m => m.r), ...waiting]), rows, count: rows.length,
        value: sum(rows, m => m.r.totalCost),
        avg: hrs.length ? avg(hrs) : null, median: hrs.length ? median(hrs) : null,
        fastest: hrs.length ? Math.min(...hrs) : null, slowest: hrs.length ? Math.max(...hrs) : null,
        parts, waiting, waitingAvg: waiting.length ? avg(waiting.map(ageOf)) : null,
      };
    }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.waiting.length - a.waiting.length);
  };
  const branchGroups = useMemo(() => buildGroups('branch'), [measured, stillOpen, partKeys.join(','), companies]);
  const userGroups = useMemo(() => buildGroups('user'), [measured, stillOpen, partKeys.join(','), companies]);
  // The headline cards and the chart follow the chosen grouping ('all' → by branch).
  const branches = byUser ? userGroups : branchGroups;

  const all = measured.map(m => m.hours);
  const ranked = branches.filter(b => b.avg !== null);
  const fastestBranch = [...ranked].sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0))[0];
  const slowestBranch = ranked[0];
  const overallParts = partKeys.map(k => {
    const xs = measured.map(m => m.parts[k]).filter((x): x is number => x !== null && x !== undefined);
    return { key: k, avg: xs.length ? avg(xs) : null, n: xs.length };
  });

  const title = report === 'tat' ? 'Turn Around Time' : 'PR Closing Time';
  const measure = report === 'tat' ? 'submitted → fully approved' : 'submitted → paid';
  const doneWord = report === 'tat' ? 'approved' : 'closed';
  const openWord = report === 'tat' ? 'Waiting for approval' : 'Still open';
  const scopeLabel = branch || companies.find(c => c.name === company)?.short || 'All companies';
  const groupWord = byUser ? 'Requester' : 'Branch';
  const groupWise = byUser ? 'User-wise' : 'Branch-wise';

  const exportCsv = () => {
    const head = [groupWord, byUser ? 'Branch' : 'Company', ...(byUser ? [] : ['Requester']), 'PR', 'Product', 'Value (INR)', 'Status', 'Submitted',
      report === 'tat' ? 'Approved' : 'Paid', `${title} (hours)`, ...partKeys.map(k => `${partLabel(k)} (hours)`)];
    const lines = branches.flatMap(b => b.rows.map(m => [
      b.name, byUser ? branchOf(m.r) : b.company, ...(byUser ? [] : [requesterOf(m.r)]),
      m.r.id, m.r.productName, Math.round(m.r.totalCost || 0), m.r.status, when(m.start), when(m.end),
      m.hours.toFixed(2), ...partKeys.map(k => (m.parts[k] ?? null) === null ? '' : (m.parts[k] as number).toFixed(2)),
    ]));
    download(`${report === 'tat' ? 'turn-around-time' : 'pr-closing-time'}-${byUser ? 'user' : 'branch'}-wise${sample ? '-SAMPLE' : ''}-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines]);
  };

  const selectCls = 'rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-sm font-semibold text-textPrimary normal-case tracking-normal focus:outline-none focus:border-brand';
  const tabCls = (on: boolean) => `flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all ${on
    ? 'bg-brand text-onbrand shadow-md' : 'bg-secondary text-textSecondary hover:text-textPrimary'}`;
  const fmtHours = (h: number) => (h > 0 ? show(h) : '—');
  const tabs: { key: ReportKey; label: string; icon: LucideIcon; note: string }[] = [
    { key: 'tat', label: 'Turn Around Time', icon: Timer, note: 'Submitted → fully approved' },
    { key: 'closing', label: 'PR Closing Time', icon: Wallet, note: 'Submitted → paid' },
    { key: 'budget', label: 'Budget', icon: Landmark, note: 'Allocated vs used' },
  ];

  /** One grouped table: branch-wise, or user-wise (by requester). */
  const groupTable = (kind: GroupKind) => {
    const byUser = kind === 'user';
    const groupWord = byUser ? 'Requester' : 'Branch';
    const groupWise = byUser ? 'User-wise' : 'Branch-wise';
    const branches = byUser ? userGroups : branchGroups;
    return (
      <Card key={kind} icon={byUser ? Users : FileBarChart} color={C.violet} title={`${title} — ${groupWise}`}
            subtitle={`Measured ${measure}. Click a ${byUser ? 'requester' : 'branch'} to see ${byUser ? 'their' : 'its'} PRs.${sample ? ' Includes sample data — demo only.' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead>
              <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                <th className="py-2 pr-3">{groupWord}</th>
                <th className="py-2 px-2 text-right">PRs {doneWord}</th>
                <th className="py-2 px-2 text-right">Value</th>
                <th className="py-2 px-2 text-right">Average</th>
                <th className="py-2 px-2 text-right">Median</th>
                <th className="py-2 px-2 text-right">Fastest</th>
                <th className="py-2 px-2 text-right">Slowest</th>
                {partKeys.map(k => <th key={k} className="py-2 px-2 text-right">{partLabel(k)}</th>)}
                <th className="py-2 pl-2 text-right">{openWord}</th>
              </tr>
            </thead>
            <tbody>
              {branches.map(b => {
                const isOpen = open === `${kind}:${b.name}`;
                return (
                  <Fragment key={b.name}>
                    <tr onClick={() => setOpen(isOpen ? null : `${kind}:${b.name}`)}
                        className={`cursor-pointer border-b border-borderTheme/70 hover:bg-secondary/70 ${isOpen ? 'bg-secondary/60' : ''}`}>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-1.5 font-bold text-textPrimary">
                          {isOpen ? <ChevronDown className="h-4 w-4 text-brand" /> : <ChevronRight className="h-4 w-4 text-textFaint" />}
                          {b.name}
                        </span>
                        <span className="ml-5 block whitespace-nowrap text-xs text-textFaint">{b.company}</span>
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums font-semibold">{b.count}</td>
                      <td className="whitespace-nowrap py-3 px-2 text-right tabular-nums">{b.count ? money(b.value) : '—'}</td>
                      <td className="py-3 px-2 text-right tabular-nums font-extrabold text-textPrimary">{show(b.avg)}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{show(b.median)}</td>
                      <td className="py-3 px-2 text-right tabular-nums text-emerald-600">{show(b.fastest)}</td>
                      <td className="py-3 px-2 text-right tabular-nums text-red-500">{show(b.slowest)}</td>
                      {partKeys.map(k => <td key={k} className="py-3 px-2 text-right tabular-nums">{show(b.parts[k])}</td>)}
                      <td className="py-3 pl-2 text-right tabular-nums">
                        {b.waiting.length ? <><b className="text-amber-600">{b.waiting.length}</b> <span className="text-xs text-textFaint">· {show(b.waitingAvg)} avg</span></> : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-borderTheme/70 bg-secondary/30">
                        <td colSpan={8 + partKeys.length} className="px-3 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-textFaint">PRs {doneWord} — slowest first</p>
                              {b.rows.length ? (
                                <table className="w-full text-xs">
                                  <thead><tr className="text-textFaint">
                                    <th className="py-1 pr-2 text-left">PR</th><th className="py-1 px-2 text-left">Submitted</th>
                                    <th className="py-1 px-2 text-left">{report === 'tat' ? 'Approved' : 'Paid'}</th>
                                    <th className="py-1 pl-2 text-right">{title}</th>
                                  </tr></thead>
                                  <tbody>
                                    {b.rows.map(m => (
                                      <tr key={m.r.id} onClick={(e) => { e.stopPropagation(); openRequest(m.r.id, m.r.status); }}
                                          className={`${isSample(m.r.id) ? '' : 'cursor-pointer '}border-t border-borderTheme/60 hover:bg-surface`}>
                                        <td className="py-1.5 pr-2">
                                          <span className="font-mono font-bold text-brand">{m.r.id}</span>
                                          <span className="block truncate text-textSecondary max-w-[220px]">{m.r.productName} · {money(m.r.totalCost || 0)}</span>
                                          <span className="block truncate text-textFaint max-w-[220px]">{byUser ? branchOf(m.r) : `by ${requesterOf(m.r)}`}</span>
                                        </td>
                                        <td className="py-1.5 px-2 text-textSecondary">{when(m.start)}</td>
                                        <td className="py-1.5 px-2 text-textSecondary">{when(m.end)}</td>
                                        <td className="py-1.5 pl-2 text-right font-extrabold tabular-nums text-textPrimary">
                                          {show(m.hours)}
                                          {report === 'tat' && (m.levels?.length ?? 0) > 1 && (
                                            <span className="mt-0.5 flex flex-wrap justify-end gap-x-2 font-medium text-textFaint">
                                              {m.levels!.map(l => <span key={l.level} className="whitespace-nowrap">L{l.level} {show(l.hours)}</span>)}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : <p className="text-xs text-textFaint">None {doneWord} in this selection.</p>}
                            </div>
                            <div>
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-textFaint">{openWord} — oldest first</p>
                              {b.waiting.length ? (
                                <ul className="space-y-1.5">
                                  {[...b.waiting].sort((x, y) => ageOf(y) - ageOf(x)).map(r => (
                                    <li key={r.id}>
                                      <button type="button" onClick={(e) => { e.stopPropagation(); openRequest(r.id, r.status); }}
                                              className="flex w-full items-center justify-between gap-3 rounded-xl border border-borderTheme bg-surface px-3 py-2 text-left text-xs hover:border-brand">
                                        <span className="min-w-0">
                                          <span className="font-mono font-bold text-brand">{r.id}</span>
                                          <span className="ml-2 text-textSecondary">{r.productName}</span>
                                          <span className="block text-textFaint">{r.status} · {money(r.totalCost || 0)} · {byUser ? branchOf(r) : `by ${requesterOf(r)}`}</span>
                                        </span>
                                        <span className="shrink-0 font-extrabold tabular-nums text-amber-600">{show(ageOf(r))}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : <p className="text-xs text-textFaint">Nothing open.</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!branches.length && (
                <tr><td colSpan={8 + partKeys.length} className="py-8 text-center text-sm text-textFaint">Nothing to report for this selection.</td></tr>
              )}
            </tbody>
            {branches.length > 1 && (
              <tfoot>
                <tr className="whitespace-nowrap border-t-2 border-borderTheme font-bold">
                  <td className="py-3 pr-3 text-textPrimary">{byUser ? 'All requesters' : 'All branches'}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{all.length}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{money(sum(measured, m => m.r.totalCost))}</td>
                  <td className="py-3 px-2 text-right tabular-nums font-extrabold">{show(all.length ? avg(all) : null)}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{show(all.length ? median(all) : null)}</td>
                  <td className="py-3 px-2 text-right tabular-nums text-emerald-600">{show(all.length ? Math.min(...all) : null)}</td>
                  <td className="py-3 px-2 text-right tabular-nums text-red-500">{show(all.length ? Math.max(...all) : null)}</td>
                  {overallParts.map(p => <td key={p.key} className="py-3 px-2 text-right tabular-nums">{show(p.avg)}</td>)}
                  <td className="py-3 pl-2 text-right tabular-nums">{stillOpen.length || '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    );
  };

  // --- Budget ----------------------------------------------------------------
  /** Requests in the selection that use budget: committed (in flight) or ordered. */
  const spending = useMemo(() => scoped.filter(r => COMMITTED.includes(r.status) || ORDERED.includes(r.status)), [scoped]);
  const budgetPRs = useMemo(() => spending.filter(r => r.budgetName), [spending]);
  const isOrdered = (r: DashRequest) => ORDERED.includes(r.status);
  const budgetLines = useMemo(() => {
    const filtered = !!(company || branch || period !== 'all');
    return budgets.map(b => {
      const prs = budgetPRs.filter(r => r.budgetName === b.name).sort((x, y) => y.totalCost - x.totalCost);
      const committed = sum(prs.filter(r => !isOrdered(r)), r => r.totalCost);
      const ordered = sum(prs.filter(isOrdered), r => r.totalCost);
      const consumed = committed + ordered;
      return { ...b, prs, committed, ordered, consumed, available: b.allocated - consumed, used: pct(consumed, b.allocated), filtered };
    })
      // A budget with nothing in a filtered selection is left out, unless it is scoped to that branch.
      .filter(b => b.prs.length || !b.filtered || (branch && b.branch === branch))
      .sort((a, b) => b.used - a.used);
  }, [budgets, budgetPRs, company, branch, period]);

  const exportBudgetCsv = () => {
    const head = ['Budget', 'Department', 'Period', 'Allocated (INR)', 'PR', 'Product', 'Requester', 'Branch', 'Status', 'Counted as', 'Value (INR)', 'Over budget'];
    const lines = budgetLines.flatMap(b => b.prs.map(r => [
      b.name, b.department || 'Any', `${b.periodStart} to ${b.periodEnd}`, Math.round(b.allocated),
      r.id, r.productName, requesterOf(r), branchOf(r), r.status, isOrdered(r) ? 'Ordered' : 'Committed', Math.round(r.totalCost || 0), r.budgetBreach ? 'Yes' : 'No',
    ]));
    download(`budget-report${sample ? '-SAMPLE' : ''}-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines]);
  };

  /** Branch-wise or user-wise: what each one's requests take from the budgets. */
  const budgetGroups = (kind: GroupKind) => {
    const names = new Set(spending.map(r => groupOf(kind, r)));
    const total = sum(budgetPRs, r => r.totalCost);
    return [...names].map(name => {
      const mine = spending.filter(r => groupOf(kind, r) === name);
      const charged = mine.filter(r => r.budgetName).sort((x, y) => y.totalCost - x.totalCost);
      const committed = sum(charged.filter(r => !isOrdered(r)), r => r.totalCost);
      const ordered = sum(charged.filter(isOrdered), r => r.totalCost);
      return {
        name, sub: subLabel(kind, name, mine), prs: charged, committed, ordered, consumed: committed + ordered,
        share: pct(committed + ordered, total), budgets: new Set(charged.map(r => r.budgetName)).size,
        over: charged.filter(r => r.budgetBreach).length,
        unbudgeted: mine.filter(r => !r.budgetName),
      };
    }).sort((a, b) => b.consumed - a.consumed);
  };

  const prList = (prs: DashRequest[], showBudget: boolean, byUser: boolean) => prs.length ? (
    <table className="w-full text-xs">
      <thead><tr className="text-textFaint">
        <th className="py-1 pr-2 text-left">PR</th>
        {showBudget && <th className="py-1 px-2 text-left">Budget</th>}
        <th className="py-1 px-2 text-left">{byUser ? 'Branch' : 'Requester'}</th>
        <th className="py-1 px-2 text-left">Status</th>
        <th className="py-1 pl-2 text-right">Value</th>
      </tr></thead>
      <tbody>
        {prs.map(r => (
          <tr key={r.id} onClick={(e) => { e.stopPropagation(); openRequest(r.id, r.status); }}
              className={`${isSample(r.id) ? '' : 'cursor-pointer '}border-t border-borderTheme/60 hover:bg-surface`}>
            <td className="py-1.5 pr-2">
              <span className="font-mono font-bold text-brand">{r.id}</span>
              <span className="block truncate text-textSecondary max-w-[260px]">{r.productName}</span>
            </td>
            {showBudget && <td className="py-1.5 px-2 text-textSecondary">{r.budgetName}</td>}
            <td className="py-1.5 px-2 text-textSecondary">{byUser ? branchOf(r) : requesterOf(r)}</td>
            <td className="py-1.5 px-2 text-textSecondary">{r.status} <span className="text-textFaint">· {isOrdered(r) ? 'ordered' : 'committed'}</span></td>
            <td className="py-1.5 pl-2 text-right font-extrabold tabular-nums text-textPrimary">
              {money(r.totalCost || 0)}
              {r.budgetBreach && <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">over budget</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : <p className="text-xs text-textFaint">No requests charged in this selection.</p>;

  const usedBar = (used: number) => {
    const tone = used > 100 ? C.red : used >= 80 ? C.amber : C.green;
    return (
      <span className="flex items-center justify-end gap-2">
        <span className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, used)}%`, background: tone }} />
        </span>
        <b className="w-12 text-right tabular-nums" style={{ color: tone }}>{used.toFixed(0)}%</b>
      </span>
    );
  };

  const budgetGroupTable = (kind: GroupKind) => {
    const byUser = kind === 'user';
    const rows = budgetGroups(kind);
    const word = byUser ? 'Requester' : 'Branch';
    return (
      <Card key={kind} icon={byUser ? Users : FileBarChart} color={C.violet} title={`Budget Used — ${byUser ? 'User-wise' : 'Branch-wise'}`}
            subtitle={`What each ${byUser ? 'requester' : 'branch'}'s requests have committed and ordered against the budgets. Click one to see the PRs.${sample ? ' Includes sample data — demo only.' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead>
              <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                <th className="py-2 pr-3">{word}</th>
                <th className="py-2 px-2 text-right">PRs</th>
                <th className="py-2 px-2 text-right">Committed</th>
                <th className="py-2 px-2 text-right">Ordered</th>
                <th className="py-2 px-2 text-right">Budget used</th>
                <th className="py-2 px-2 text-right">Share</th>
                <th className="py-2 px-2 text-right">Budgets</th>
                <th className="py-2 px-2 text-right">Over-budget PRs</th>
                <th className="py-2 pl-2 text-right">Not on a budget</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(g => {
                const key = `budget-${kind}:${g.name}`;
                const isOpen = open === key;
                return (
                  <Fragment key={g.name}>
                    <tr onClick={() => setOpen(isOpen ? null : key)}
                        className={`cursor-pointer border-b border-borderTheme/70 hover:bg-secondary/70 ${isOpen ? 'bg-secondary/60' : ''}`}>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-1.5 font-bold text-textPrimary">
                          {isOpen ? <ChevronDown className="h-4 w-4 text-brand" /> : <ChevronRight className="h-4 w-4 text-textFaint" />}
                          {g.name}
                        </span>
                        <span className="ml-5 block text-xs text-textFaint">{g.sub}</span>
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums font-semibold">{g.prs.length}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{g.committed ? money(g.committed) : '—'}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{g.ordered ? money(g.ordered) : '—'}</td>
                      <td className="py-3 px-2 text-right tabular-nums font-extrabold text-textPrimary">{g.consumed ? money(g.consumed) : '—'}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{g.consumed ? `${g.share.toFixed(1)}%` : '—'}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{g.budgets || '—'}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{g.over ? <b className="text-red-500">{g.over}</b> : '—'}</td>
                      <td className="py-3 pl-2 text-right tabular-nums">
                        {g.unbudgeted.length ? <>{money(sum(g.unbudgeted, r => r.totalCost))} <span className="text-xs text-textFaint">· {plural(g.unbudgeted.length, 'PR')}</span></> : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-borderTheme/70 bg-secondary/30">
                        <td colSpan={9} className="px-3 py-4">
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-textFaint">PRs charged to a budget — largest first</p>
                          {prList(g.prs, true, byUser)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-sm text-textFaint">Nothing to report for this selection.</td></tr>}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-borderTheme font-bold">
                  <td className="py-3 pr-3 text-textPrimary">{byUser ? 'All requesters' : 'All branches'}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{budgetPRs.length}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{money(sum(budgetPRs.filter(r => !isOrdered(r)), r => r.totalCost))}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{money(sum(budgetPRs.filter(isOrdered), r => r.totalCost))}</td>
                  <td className="py-3 px-2 text-right tabular-nums font-extrabold">{money(sum(budgetPRs, r => r.totalCost))}</td>
                  <td className="py-3 px-2 text-right tabular-nums">100%</td>
                  <td className="py-3 px-2 text-right tabular-nums">{new Set(budgetPRs.map(r => r.budgetName)).size}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{budgetPRs.filter(r => r.budgetBreach).length || '—'}</td>
                  <td className="py-3 pl-2 text-right tabular-nums">{spending.some(r => !r.budgetName) ? money(sum(spending.filter(r => !r.budgetName), r => r.totalCost)) : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    );
  };

  const budgetReport = () => {
    const allocated = sum(budgetLines, b => b.allocated);
    const committed = sum(budgetLines, b => b.committed);
    const ordered = sum(budgetLines, b => b.ordered);
    const consumed = committed + ordered;
    const left = allocated - consumed;
    const overBudgets = budgetLines.filter(b => b.available < 0);
    const overPRs = budgetPRs.filter(r => r.budgetBreach);
    const groups = budgetGroups(byUser ? 'user' : 'branch');
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <SmallStat icon={Landmark} label="Allocated" value={allocated} format={money} color={C.indigo}
                     note={<>{plural(budgetLines.length, 'budget')}{liveBudgets === null ? ' · loading…' : ''}</>} />
          <SmallStat icon={Wallet} label="Budget used" value={consumed} format={money} color={C.violet}
                     note={<>{pct(consumed, allocated).toFixed(0)}% · committed {money(committed)} · ordered {money(ordered)}</>} />
          <SmallStat icon={left < 0 ? TrendingDown : TrendingUp} label={left < 0 ? 'Over budget by' : 'Available'} value={Math.abs(left)} format={money}
                     color={left < 0 ? C.red : C.green} note={<>Across the budgets shown</>} />
          <SmallStat icon={AlertTriangle} label="Over-budget PRs" value={overPRs.length} format={n => Math.round(n).toLocaleString('en-IN')} color={C.red}
                     note={overBudgets.length ? <>{plural(overBudgets.length, 'budget')} past {overBudgets.length === 1 ? 'its' : 'their'} allocation</> : 'Every budget within its allocation'} />
        </div>

        <Card icon={Landmark} color={C.sky} title="Budget vs Actual"
              subtitle={`Allocated for the budget's whole period; used = requests committed (in flight) and ordered in this selection. Click a budget to see its PRs.${sample ? ' Includes sample data — demo only.' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                  <th className="py-2 pr-3">Budget</th>
                  <th className="py-2 px-2">Period</th>
                  <th className="py-2 px-2 text-right">Allocated</th>
                  <th className="py-2 px-2 text-right">Committed</th>
                  <th className="py-2 px-2 text-right">Ordered</th>
                  <th className="py-2 px-2 text-right">Used</th>
                  <th className="py-2 px-2 text-right">Available</th>
                  <th className="py-2 pl-2 text-right">Used %</th>
                </tr>
              </thead>
              <tbody>
                {budgetLines.map(b => {
                  const key = `budget:${b.id}`;
                  const isOpen = open === key;
                  const scope = [b.department, b.branch, b.category].filter(Boolean).join(' · ') || 'Company-wide';
                  return (
                    <Fragment key={b.id}>
                      <tr onClick={() => setOpen(isOpen ? null : key)}
                          className={`cursor-pointer border-b border-borderTheme/70 hover:bg-secondary/70 ${isOpen ? 'bg-secondary/60' : ''}`}>
                        <td className="py-3 pr-3">
                          <span className="flex items-center gap-1.5 font-bold text-textPrimary">
                            {isOpen ? <ChevronDown className="h-4 w-4 text-brand" /> : <ChevronRight className="h-4 w-4 text-textFaint" />}
                            {b.name}
                          </span>
                          <span className="ml-5 block text-xs text-textFaint">{scope} · {plural(b.prs.length, 'PR')}</span>
                        </td>
                        <td className="py-3 px-2 text-xs text-textSecondary">{shortDate(b.periodStart)} – {shortDate(b.periodEnd)}</td>
                        <td className="py-3 px-2 text-right tabular-nums font-semibold">{money(b.allocated)}</td>
                        <td className="py-3 px-2 text-right tabular-nums">{b.committed ? money(b.committed) : '—'}</td>
                        <td className="py-3 px-2 text-right tabular-nums">{b.ordered ? money(b.ordered) : '—'}</td>
                        <td className="py-3 px-2 text-right tabular-nums font-extrabold text-textPrimary">{b.consumed ? money(b.consumed) : '—'}</td>
                        <td className={`py-3 px-2 text-right tabular-nums font-bold ${b.available < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                          {b.available < 0 ? `−${money(-b.available)}` : money(b.available)}
                        </td>
                        <td className="py-3 pl-2">{usedBar(b.used)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-borderTheme/70 bg-secondary/30">
                          <td colSpan={8} className="px-3 py-4">
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-textFaint">PRs charged to this budget — largest first</p>
                            {prList(b.prs, false, false)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!budgetLines.length && (
                  <tr><td colSpan={8} className="py-8 text-center text-sm text-textFaint">
                    {liveBudgets === null ? 'Loading budgets…' : 'No running budgets for this selection — they are set up in Odoo under SmartSpend → Budgets.'}
                  </td></tr>
                )}
              </tbody>
              {budgetLines.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-borderTheme font-bold">
                    <td className="py-3 pr-3 text-textPrimary" colSpan={2}>All budgets</td>
                    <td className="py-3 px-2 text-right tabular-nums">{money(allocated)}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{money(committed)}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{money(ordered)}</td>
                    <td className="py-3 px-2 text-right tabular-nums font-extrabold">{money(consumed)}</td>
                    <td className={`py-3 px-2 text-right tabular-nums ${left < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{left < 0 ? `−${money(-left)}` : money(left)}</td>
                    <td className="py-3 pl-2">{usedBar(pct(consumed, allocated))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <div className="grid lg:grid-cols-5 gap-6">
          <Card icon={byUser ? UserRound : MapPin} color={C.indigo} title={`Budget Used by ${byUser ? 'Requester' : 'Branch'}`}
                subtitle="Committed and ordered against the budgets" className="lg:col-span-3">
            <HBars rows={groups.filter(g => g.consumed).map((g, i) => ({
              name: `${g.name} · ${g.sub}`, value: g.consumed, note: plural(g.prs.length, 'PR'), color: [C.indigo, C.violet, C.sky, C.teal][i % 4],
            }))} />
          </Card>
          <Card icon={PieChart} color={C.green} title="Where the Budget Stands" subtitle="Across the budgets shown" className="lg:col-span-2">
            <DonutWithLegend format={money} centerValue={`${pct(consumed, allocated).toFixed(0)}%`} centerLabel="used" parts={[
              { label: 'Ordered', value: ordered, color: C.indigo },
              { label: 'Committed (in flight)', value: committed, color: C.amber },
              { label: left < 0 ? 'Over budget' : 'Available', value: Math.abs(left), color: left < 0 ? C.red : C.green },
            ]} />
          </Card>
        </div>

        {(groupBy === 'all' ? (['branch', 'user'] as const) : [groupBy]).map(kind => budgetGroupTable(kind))}
      </>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* ── Title, report picker and filters ─────────────────────────────── */}
      <div className="rounded-3xl border border-borderTheme bg-surface px-6 py-5 shadow-sm space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-md"
                  style={{ background: `linear-gradient(135deg, ${C.indigo}, ${C.cyan})` }}>
              <FileBarChart className="h-7 w-7" />
            </span>
            <div>
              <h2 className="font-outfit text-3xl font-extrabold text-textPrimary leading-tight">Reports</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-textFaint">
                {sample ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                    <FlaskConical className="h-3 w-3" /> Live from Odoo + sample data (demo only)
                  </span>
                ) : (
                  <><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live from Odoo</>
                )}
                · {groupBy === 'all' ? 'branch-wise & user-wise' : groupWise.toLowerCase()} · <b className="text-textSecondary">{scopeLabel}</b>, {PERIODS.find(p => p.key === period)?.label.toLowerCase()} (by submission date)
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
        <div className="flex flex-wrap items-center gap-3 border-t border-borderTheme pt-4">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => { setReport(t.key); setOpen(null); }} className={tabCls(report === t.key)}>
              <t.icon className="h-4 w-4" />
              <span>{t.label}</span>
              <span className={`text-[11px] font-semibold ${report === t.key ? 'text-onbrand/80' : 'text-textFaint'}`}>{t.note}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center rounded-2xl bg-secondary p-1" role="group" aria-label="Group by">
            {([['all', 'All', FileBarChart], ['branch', 'Branch-wise', MapPin], ['user', 'User-wise', Users]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => { setGroupBy(k); setOpen(null); }}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold transition-all ${groupBy === k
                        ? 'bg-surface text-textPrimary shadow-sm' : 'text-textSecondary hover:text-textPrimary'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSample(!sample)} aria-pressed={sample}
                  title="Show dummy users and PRs for the demo. Nothing is written to Odoo."
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-all ${sample
                    ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-borderTheme text-textSecondary hover:border-amber-400 hover:text-amber-700'}`}>
            <FlaskConical className="h-4 w-4" /> Sample data
            <span className={`relative h-4 w-7 rounded-full transition-colors ${sample ? 'bg-amber-500' : 'bg-borderTheme'}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${sample ? 'left-3.5' : 'left-0.5'}`} />
            </span>
          </button>
          <button type="button" onClick={report === 'budget' ? exportBudgetCsv : exportCsv} disabled={report === 'budget' ? !budgetPRs.length : !measured.length}
                  className="flex items-center gap-2 rounded-xl border border-borderTheme px-4 py-2 text-sm font-bold text-textSecondary hover:border-brand hover:text-brand disabled:opacity-40">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {report === 'budget' ? budgetReport() : <>
      {/* ── Headline numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <SmallStat icon={Timer} label={`Average ${title.toLowerCase()}`} value={avg(all)} format={fmtHours} color={C.indigo}
                   note={<>{plural(all.length, 'PR')} {doneWord} · median {show(all.length ? median(all) : null)}</>} />
        <SmallStat icon={TrendingDown} label={`Fastest ${groupWord.toLowerCase()}`} value={fastestBranch?.avg ?? 0} format={fmtHours} color={C.green}
                   note={fastestBranch ? <>{fastestBranch.name} · {plural(fastestBranch.count, 'PR')}</> : 'Nothing measured yet'} />
        <SmallStat icon={TrendingUp} label={`Slowest ${groupWord.toLowerCase()}`} value={slowestBranch?.avg ?? 0} format={fmtHours} color={C.red}
                   note={slowestBranch ? <>{slowestBranch.name} · {plural(slowestBranch.count, 'PR')}</> : 'Nothing measured yet'} />
        <SmallStat icon={Hourglass} label={openWord} value={stillOpen.length} format={n => Math.round(n).toLocaleString('en-IN')} color={C.amber}
                   note={stillOpen.length ? <>Waiting {show(avg(stillOpen.map(ageOf)))} on average so far</> : 'Nothing open'} />
      </div>

      {/* ── Chart + stage split ───────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={byUser ? UserRound : MapPin} color={C.indigo} title={`Average ${title} by ${groupWord}`} subtitle={`Measured ${measure}`} className="lg:col-span-3">
          <HBars format={h => show(h)} rows={ranked.map((b, i) => ({
            name: `${b.name} · ${b.company}`, value: b.avg ?? 0, note: plural(b.count, 'PR'),
            color: b === slowestBranch && ranked.length > 1 ? C.red : b === fastestBranch && ranked.length > 1 ? C.green : [C.indigo, C.violet, C.sky, C.teal][i % 4],
          }))} />
        </Card>
        <Card icon={CheckCircle2} color={C.green} title={report === 'tat' ? 'Time at Each Approval Level' : 'Where the Time Goes'}
              subtitle={report === 'tat' ? 'Average from the previous signature (or submission) to this level\'s decision'
                : 'Average per stage, over the PRs whose timeline records both ends'} className="lg:col-span-2">
          {overallParts.length ? (
            <HBars format={h => show(h)} rows={overallParts.filter(p => p.avg !== null).map((p, i) => ({
              name: partLabel(p.key),
              value: p.avg ?? 0, note: plural(p.n, 'PR'),
              color: report === 'tat' ? [C.amber, C.orange, C.pink, C.violet][i % 4] : CLOSING_STAGES.find(s => s.key === p.key)!.color,
            }))} />
          ) : <p className="text-sm text-textFaint">No approval levels recorded for this selection.</p>}
          {report === 'closing' && (
            <ul className="mt-4 space-y-0.5 border-t border-borderTheme pt-3 text-[11px] text-textFaint">
              {CLOSING_STAGES.map(s => <li key={s.key}><b className="text-textSecondary">{s.label}:</b> {s.hint}</li>)}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Grouped tables: both by default, or the one picked ─────────────── */}
      {(groupBy === 'all' ? (['branch', 'user'] as const) : [groupBy]).map(kind => groupTable(kind))}
      </>}
    </div>
  );
}
