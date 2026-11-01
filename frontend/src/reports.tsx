/**
 * The procurement manager's reports, branch-wise.
 *
 *  - Turn Around Time: how long a PR takes from submission to its last
 *    approval signature, with the time spent at each approval level.
 *  - PR Closing Time: how long a PR takes from submission until it is paid,
 *    split into approval, ordering, delivery and payment where the timeline
 *    records both ends of the stage.
 *
 * Everything is measured from live data: the request's submission time, the
 * approval chain's decision times and the request timeline. Requests still
 * open are listed with how long they have been waiting so far.
 */
import { Fragment, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2, ChevronDown, ChevronRight, Download, FileBarChart, Hourglass, MapPin, Timer, TrendingDown, TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  C, Card, HBars, PERIODS, SmallStat, duration, historyTime, money, periodStart, plural, submitted, sum,
} from './managerDashboard';
import type { DashCompany, DashRequest, Period } from './managerDashboard';

type ReportKey = 'tat' | 'closing';

const APPROVED = ['Sourcing', 'Approved', 'PO Confirmed', 'Paid'];
const PENDING = ['Pending Approval', 'Needs Clarification'];
const NOT_OPEN = ['Draft', 'Rejected', 'Cancelled', 'Paid'];
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

export function ManagerReports({ requests, companies, onOpenRequest }: {
  requests: DashRequest[];
  companies: DashCompany[];
  /** Open one request (tracking, or the approval queue while it waits). */
  onOpenRequest: (id: string, status: string) => void;
}) {
  const [report, setReport] = useState<ReportKey>('tat');
  const [period, setPeriod] = useState<Period>('all');
  const [company, setCompany] = useState('');
  const [branch, setBranch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();

  const companyOf = (b: string) => companies.find(c => c.branches.some(x => x.trim().toLowerCase() === (b || '').trim().toLowerCase()));
  const companyName = (b: string) => companyOf(b)?.name ?? 'Unassigned';
  const branchOf = (r: DashRequest) => r.location || 'Unassigned';

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    companies.forEach(c => { if (!company || c.name === company) c.branches.forEach(b => set.add(b)); });
    requests.forEach(r => { if (r.location && (!company || companyName(r.location) === company)) set.add(r.location); });
    return [...set].sort();
  }, [companies, requests, company]);

  // The requests in the chosen period (by submission), company and branch.
  const scoped = useMemo(() => {
    const from = periodStart(period, now);
    return requests.filter(r => {
      if (r.status === 'Draft') return false;
      const t = submitted(r);
      if (from !== null && (t === null || t < from)) return false;
      if (company && companyName(r.location) !== company) return false;
      if (branch && r.location !== branch) return false;
      return true;
    });
  }, [requests, period, company, branch, companies]);

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

  // --- Branch-wise ---------------------------------------------------------------
  const branches = useMemo(() => {
    const names = new Set<string>([...measured.map(m => branchOf(m.r)), ...stillOpen.map(branchOf)]);
    return [...names].map(name => {
      const rows = measured.filter(m => branchOf(m.r) === name).sort((a, b) => b.hours - a.hours);
      const hrs = rows.map(m => m.hours);
      const waiting = stillOpen.filter(r => branchOf(r) === name);
      const parts: Record<string, number | null> = {};
      partKeys.forEach(k => {
        const xs = rows.map(m => m.parts[k]).filter((x): x is number => x !== null && x !== undefined);
        parts[k] = xs.length ? avg(xs) : null;
      });
      return {
        name, company: companyOf(name)?.short ?? '—', rows, count: rows.length,
        value: sum(rows, m => m.r.totalCost),
        avg: hrs.length ? avg(hrs) : null, median: hrs.length ? median(hrs) : null,
        fastest: hrs.length ? Math.min(...hrs) : null, slowest: hrs.length ? Math.max(...hrs) : null,
        parts, waiting, waitingAvg: waiting.length ? avg(waiting.map(ageOf)) : null,
      };
    }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.waiting.length - a.waiting.length);
  }, [measured, stillOpen, partKeys.join(','), companies]);

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

  const exportCsv = () => {
    const head = ['Branch', 'Company', 'PR', 'Product', 'Value (INR)', 'Status', 'Submitted', report === 'tat' ? 'Approved' : 'Paid',
      `${title} (hours)`, ...partKeys.map(k => `${partLabel(k)} (hours)`)];
    const lines = branches.flatMap(b => b.rows.map(m => [
      b.name, b.company, m.r.id, m.r.productName, Math.round(m.r.totalCost || 0), m.r.status, when(m.start), when(m.end),
      m.hours.toFixed(2), ...partKeys.map(k => (m.parts[k] ?? null) === null ? '' : (m.parts[k] as number).toFixed(2)),
    ]));
    download(`${report === 'tat' ? 'turn-around-time' : 'pr-closing-time'}-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines]);
  };

  const selectCls = 'rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-sm font-semibold text-textPrimary normal-case tracking-normal focus:outline-none focus:border-brand';
  const tabCls = (on: boolean) => `flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all ${on
    ? 'bg-brand text-onbrand shadow-md' : 'bg-secondary text-textSecondary hover:text-textPrimary'}`;
  const fmtHours = (h: number) => (h > 0 ? show(h) : '—');
  const tabs: { key: ReportKey; label: string; icon: LucideIcon; note: string }[] = [
    { key: 'tat', label: 'Turn Around Time', icon: Timer, note: 'Submitted → fully approved' },
    { key: 'closing', label: 'PR Closing Time', icon: Wallet, note: 'Submitted → paid' },
  ];

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
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-textFaint">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live from Odoo · branch-wise · <b className="text-textSecondary">{scopeLabel}</b>, {PERIODS.find(p => p.key === period)?.label.toLowerCase()} (by submission date)
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
          <button type="button" onClick={exportCsv} disabled={!measured.length}
                  className="ml-auto flex items-center gap-2 rounded-xl border border-borderTheme px-4 py-2 text-sm font-bold text-textSecondary hover:border-brand hover:text-brand disabled:opacity-40">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* ── Headline numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <SmallStat icon={Timer} label={`Average ${title.toLowerCase()}`} value={avg(all)} format={fmtHours} color={C.indigo}
                   note={<>{plural(all.length, 'PR')} {doneWord} · median {show(all.length ? median(all) : null)}</>} />
        <SmallStat icon={TrendingDown} label="Fastest branch" value={fastestBranch?.avg ?? 0} format={fmtHours} color={C.green}
                   note={fastestBranch ? <>{fastestBranch.name} · {plural(fastestBranch.count, 'PR')}</> : 'Nothing measured yet'} />
        <SmallStat icon={TrendingUp} label="Slowest branch" value={slowestBranch?.avg ?? 0} format={fmtHours} color={C.red}
                   note={slowestBranch ? <>{slowestBranch.name} · {plural(slowestBranch.count, 'PR')}</> : 'Nothing measured yet'} />
        <SmallStat icon={Hourglass} label={openWord} value={stillOpen.length} format={n => Math.round(n).toLocaleString('en-IN')} color={C.amber}
                   note={stillOpen.length ? <>Waiting {show(avg(stillOpen.map(ageOf)))} on average so far</> : 'Nothing open'} />
      </div>

      {/* ── Chart + stage split ───────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={MapPin} color={C.indigo} title={`Average ${title} by Branch`} subtitle={`Measured ${measure}`} className="lg:col-span-3">
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

      {/* ── Branch-wise table ─────────────────────────────────────────────── */}
      <Card icon={FileBarChart} color={C.violet} title={`${title} — Branch-wise`}
            subtitle={`Measured ${measure}. Click a branch to see its PRs.`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                <th className="py-2 pr-3">Branch</th>
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
                const isOpen = open === b.name;
                return (
                  <Fragment key={b.name}>
                    <tr onClick={() => setOpen(isOpen ? null : b.name)}
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
                                      <tr key={m.r.id} onClick={(e) => { e.stopPropagation(); onOpenRequest(m.r.id, m.r.status); }}
                                          className="cursor-pointer border-t border-borderTheme/60 hover:bg-surface">
                                        <td className="py-1.5 pr-2">
                                          <span className="font-mono font-bold text-brand">{m.r.id}</span>
                                          <span className="block truncate text-textSecondary max-w-[220px]">{m.r.productName} · {money(m.r.totalCost || 0)}</span>
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
                                      <button type="button" onClick={(e) => { e.stopPropagation(); onOpenRequest(r.id, r.status); }}
                                              className="flex w-full items-center justify-between gap-3 rounded-xl border border-borderTheme bg-surface px-3 py-2 text-left text-xs hover:border-brand">
                                        <span className="min-w-0">
                                          <span className="font-mono font-bold text-brand">{r.id}</span>
                                          <span className="ml-2 text-textSecondary">{r.productName}</span>
                                          <span className="block text-textFaint">{r.status} · {money(r.totalCost || 0)}</span>
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
                  <td className="py-3 pr-3 text-textPrimary">All branches</td>
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
    </div>
  );
}
