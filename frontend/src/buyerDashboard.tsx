/**
 * The SCM buyer's dashboard — the sourcing desk at a glance.
 *
 * A buyer picks a request up once it is approved and owns it until the order
 * is placed, confirmed by the vendor and delivered. So this reads the buyer's
 * stage only: requests from "Approved" onwards (what is left to source, what
 * was ordered, from whom, how it was sourced and what it saved), the reverse
 * auctions this buyer runs, the rate contracts, product creation requests
 * waiting on the buyer, subscriptions and deliveries still to arrive. All of
 * it live from Odoo; the same look and colours as the manager's dashboard.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Briefcase, Building2, CalendarClock, CheckCircle2, ClipboardCheck, FileSignature, Gavel,
  Hourglass, MapPin, Package, PieChart, PiggyBank, Repeat, Search, Send, Store, Timer, TrendingUp, Truck,
} from 'lucide-react';
import {
  ActivityRow, BigStat, C, Card, ColumnChart, CountPill, DAY, DonutWithLegend, HBars, Legend, PERIODS, SERIES,
  SmallStat, ageDays, duration, historyTime, money, pct, periodStart, plural, shortDate, submitted, sum, whole,
} from './managerDashboard';
import type { DashCompany, DashRequest, Period } from './managerDashboard';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export interface BuyerDashRequest extends DashRequest {
  selectedSourcingMethod?: string;
  poReleased?: boolean;
  poAcknowledged?: boolean;
  contract?: string;
}

const TO_SOURCE = ['Approved', 'Sourcing'];
const ORDERED = ['PO Confirmed', 'Paid'];
const MINE = [...TO_SOURCE, ...ORDERED];

/** The buyer's own words for each sourcing method. */
const METHOD_LABEL: Record<string, string> = { 'Negotiation': 'Direct negotiation', 'Multi RFQ': 'Multi-vendor RFQ', 'Bidding': 'Reverse auction' };
const METHOD_COLOR: Record<string, string> = { 'Negotiation': C.indigo, 'Multi RFQ': C.cyan, 'Bidding': C.pink };

/** Hours from the last approval to the first purchase order, when both are on the timeline. */
const sourcingHours = (r: DashRequest) => {
  const from = submitted(r);
  const approvals = r.history.filter(h => /^Approved/.test(h.title)).map(h => historyTime(h.date, from)).filter((t): t is number => t !== null);
  const orders = r.history.filter(h => /^PO Created/.test(h.title)).map(h => historyTime(h.date, from)).filter((t): t is number => t !== null);
  if (!approvals.length || !orders.length) return null;
  const hours = (Math.min(...orders) - Math.max(...approvals)) / 3600000;
  return hours >= 0 ? hours : null;
};

/** Days since the request was approved — how long it has sat in the queue. */
const daysSinceApproval = (r: DashRequest, now: number) => {
  const from = submitted(r);
  const approvals = r.history.filter(h => /^Approved/.test(h.title)).map(h => historyTime(h.date, from)).filter((t): t is number => t !== null);
  return approvals.length ? Math.max(0, Math.floor((now - Math.max(...approvals)) / DAY)) : ageDays(r, now);
};

interface Auction {
  id: string; requestId: string; title: string; state: string; stateLabel: string; location: string; buyer?: string;
  ceiling?: number; bestTotal?: number; awardedTotal?: number; savings?: number; savingsPct?: number;
  bidCount?: number; acceptedCount?: number; participants?: unknown[]; approval?: unknown; startAt?: string; endAt?: string;
}

interface Feeds {
  auctions: Auction[];
  contracts: { id: string; vendor: string; category: string; running: boolean; validUntil: string; requestCount: number; purchaseOrderCount: number; lines: unknown[] }[];
  subscriptions: { id: string; state: string; monthlyCost: number; nextOrderDate: string }[];
  backorders: { id: number; state: string; qtyPending: number; amountPending: number; overdue: boolean }[];
  productRequests: { id: number; state: string }[];
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
      const [auctions, contracts, subscriptions, backorders, productRequests] = await Promise.all([
        get('/api/smartspend/auctions'), get('/api/smartspend/contracts?all=1'), get('/api/smartspend/subscriptions'),
        get('/api/smartspend/backorders'), get('/api/smartspend/product-requests'),
      ]);
      if (stale) return;
      setFeeds({
        auctions: Array.isArray(auctions) ? auctions : [],
        contracts: Array.isArray(contracts) ? contracts : [],
        subscriptions: subscriptions?.subscriptions ?? [],
        backorders: backorders?.backorders ?? [],
        productRequests: productRequests?.requests ?? [],
      });
    })();
    return () => { stale = true; };
  }, [offline]);
  return feeds;
}

const AUCTION_TONE: Record<string, string> = {
  live: C.red, scheduled: C.amber, draft: C.slate, closed: C.violet, awarded: C.green, cancelled: C.slate,
};

/** Counts as one bar, each part labelled inside. */
function SegmentBar({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(id); }, []);
  const total = sum(parts, p => p.n);
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

export function BuyerDashboard({ requests, companies, userName, fetcher, offline, onOpenRequest, onNav }: {
  requests: BuyerDashRequest[];
  companies: DashCompany[];
  userName: string;
  fetcher: Fetcher;
  offline: boolean;
  /** Open a request: the sourcing desk while it is still to source, tracking once ordered. */
  onOpenRequest: (id: string, status: string) => void;
  /** Go to another buyer screen by its nav key. */
  onNav: (key: string) => void;
}) {
  const [period, setPeriod] = useState<Period>('all');
  const [company, setCompany] = useState('');
  const [branch, setBranch] = useState('');
  const [grain, setGrain] = useState<'week' | 'month'>('week');
  const [split, setSplit] = useState<'method' | 'contract'>('method');
  const feeds = useFeeds(fetcher, offline);
  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();

  const companyOf = (b: string) => companies.find(c => c.branches.some(x => x.trim().toLowerCase() === (b || '').trim().toLowerCase()));
  const companyName = (b: string) => companyOf(b)?.name ?? 'Unassigned';

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    companies.forEach(c => { if (!company || c.name === company) c.branches.forEach(b => set.add(b)); });
    requests.forEach(r => { if (r.location && MINE.includes(r.status) && (!company || companyName(r.location) === company)) set.add(r.location); });
    return [...set].sort();
  }, [companies, requests, company]);

  // The buyer's requests — approved onwards — in the chosen period, company and branch.
  const rows = useMemo(() => {
    const from = periodStart(period, now);
    return requests.filter(r => {
      if (!MINE.includes(r.status)) return false;
      if (from !== null) { const t = submitted(r); if (t === null || t < from) return false; }
      if (company && companyName(r.location) !== company) return false;
      if (branch && r.location !== branch) return false;
      return true;
    });
  }, [requests, period, company, branch, companies]);

  const value = (list: DashRequest[]) => sum(list, r => r.totalCost);
  const toSource = rows.filter(r => TO_SOURCE.includes(r.status));
  const ordered = rows.filter(r => ORDERED.includes(r.status));
  const paid = rows.filter(r => r.status === 'Paid');
  const toRelease = ordered.filter(r => r.status === 'PO Confirmed' && !r.poReleased);
  const withVendor = ordered.filter(r => r.status === 'PO Confirmed' && r.poReleased && !r.poAcknowledged);
  const confirmed = ordered.filter(r => r.poAcknowledged);
  const poCount = sum(ordered, r => (r.purchaseOrders?.length || 1));
  const cycle = ordered.map(sourcingHours).filter((h): h is number => h !== null);
  const avgCycle = cycle.length ? sum(cycle, h => h) / cycle.length : 0;
  const onContract = rows.filter(r => r.contract);

  // --- Auctions this buyer runs (an auction with no buyer recorded counts too)
  const me = (userName || '').trim().toLowerCase();
  const auctions = (feeds.auctions ?? []).filter(a => {
    if (a.buyer && me && a.buyer.trim().toLowerCase() !== me) return false;
    const req = requests.find(r => r.id === a.requestId);
    if (company && (!req || companyName(req.location) !== company) && companyName(a.location) !== company) return false;
    if (branch && a.location !== branch) return false;
    return true;
  });
  const auctionLive = auctions.filter(a => a.state === 'live');
  const auctionScheduled = auctions.filter(a => a.state === 'scheduled' || a.state === 'draft');
  const auctionWaitingManager = auctions.filter(a => a.state === 'closed' && !a.approval);
  const auctionToAward = auctions.filter(a => a.state === 'closed' && !!a.approval);
  const awarded = auctions.filter(a => a.state === 'awarded');
  const auctionSavings = sum(awarded, a => a.savings ?? 0);
  const savings = sum(rows, r => r.savings) + auctionSavings;
  const recentAuctions = [...auctions].sort((a, b) => {
    const rank = (x: Auction) => ({ live: 0, closed: 1, scheduled: 2, draft: 3, awarded: 4 } as Record<string, number>)[x.state] ?? 5;
    return rank(a) - rank(b) || String(b.startAt ?? '').localeCompare(String(a.startAt ?? ''));
  }).slice(0, 5);

  // --- Company and branch ---------------------------------------------------
  const tally = (subset: BuyerDashRequest[]) => ({
    total: subset.length,
    value: value(subset),
    toSource: subset.filter(r => TO_SOURCE.includes(r.status)).length,
    ordered: subset.filter(r => r.status === 'PO Confirmed').length,
    paid: subset.filter(r => r.status === 'Paid').length,
    orderedValue: value(subset.filter(r => ORDERED.includes(r.status))),
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

  // --- Over time: approved for sourcing vs ordered ---------------------------
  const trend = useMemo(() => {
    const times = rows.map(submitted).filter((t): t is number => t !== null);
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
      const inside = rows.filter(r => { const t = submitted(r); return t !== null && t >= b.start && t < b.end; });
      return {
        label: b.label,
        title: grain === 'week' ? `Week of ${b.label}` : b.label,
        values: [value(inside), value(inside.filter(r => ORDERED.includes(r.status)))],
        note: `${plural(inside.length, 'request')} · ${inside.filter(r => ORDERED.includes(r.status)).length} ordered`,
      };
    });
  }, [rows, grain, now]);

  // --- Breakdowns -------------------------------------------------------------
  const methods = ['Negotiation', 'Multi RFQ', 'Bidding'].map(m => ({
    label: METHOD_LABEL[m], color: METHOD_COLOR[m],
    value: rows.filter(r => (r.selectedSourcingMethod || 'Negotiation') === m).length,
  }));
  const coverage = [
    { label: 'Rate contract price', value: onContract.length, color: C.green },
    { label: 'Sourced from the market', value: rows.length - onContract.length, color: C.amber },
  ];
  const vendorMap = new Map<string, { value: number; count: number }>();
  ordered.filter(r => r.vendor).forEach(r => {
    const e = vendorMap.get(r.vendor) ?? { value: 0, count: 0 };
    e.value += r.totalCost || 0; e.count++; vendorMap.set(r.vendor, e);
  });
  const vendors = [...vendorMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value).slice(0, 5);

  // --- The queue ----------------------------------------------------------------
  const queue = [...toSource].sort((a, b) => daysSinceApproval(b, nowMs) - daysSinceApproval(a, nowMs) || b.totalCost - a.totalCost).slice(0, 6);
  const followUps = [...toRelease, ...withVendor].slice(0, 4);

  // --- Other feeds --------------------------------------------------------------
  const runningContracts = (feeds.contracts ?? []).filter(c => c.running);
  const contractRows = [...runningContracts].sort((a, b) => String(a.validUntil).localeCompare(String(b.validUntil))).slice(0, 4);
  const subs = (feeds.subscriptions ?? []).filter(s => s.state === 'active');
  const openBackorders = (feeds.backorders ?? []).filter(b => b.state !== 'done' && b.state !== 'cancel');
  const newProducts = (feeds.productRequests ?? []).filter(p => p.state === 'pending').length;

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (userName || '').replace(/^Demo\s+/i, '').trim();
  const scopeLabel = branch || companies.find(c => c.name === company)?.short || 'All companies';
  const selectCls = 'rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-sm font-semibold text-textPrimary normal-case tracking-normal focus:outline-none focus:border-brand';
  const toggleCls = (on: boolean) => `rounded-lg px-3 py-1 transition-colors ${on ? 'bg-surface text-brand shadow-sm' : 'text-textFaint hover:text-textPrimary'}`;
  const daysLeft = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00`) - nowMs) / DAY);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* ── Title + filters ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-borderTheme bg-surface px-6 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-md"
                style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.indigo})` }}>
            <Briefcase className="h-7 w-7" />
          </span>
          <div>
            <p className="text-sm font-semibold text-textSecondary">{greeting}{name ? `, ${name}` : ''}</p>
            <h2 className="font-outfit text-3xl font-extrabold text-textPrimary leading-tight">Sourcing Dashboard</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-textFaint">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live from Odoo · approved requests onwards · <b className="text-textSecondary">{scopeLabel}</b>, {PERIODS.find(p => p.key === period)?.label.toLowerCase()}
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
        <BigStat icon={Briefcase} label="To Source" count={toSource.length} value={value(toSource)} from={C.amber} to={C.orange}
                 note={toSource.length ? <>Approved and waiting for you · click to source</> : 'Queue is empty — all caught up'}
                 onClick={() => onNav('requests')} />
        <BigStat icon={Gavel} label="Live Auctions" count={auctionLive.length + auctionScheduled.length} value={sum([...auctionLive, ...auctionScheduled], a => a.ceiling ?? 0)}
                 from={C.pink} to={C.red}
                 note={<>{auctionLive.length} bidding now · {auctionScheduled.length} scheduled{auctionToAward.length ? ` · ${auctionToAward.length} ready to award` : ''}</>}
                 onClick={() => onNav('auctions')} />
        <BigStat icon={ClipboardCheck} label="Orders Placed" count={ordered.length} value={value(ordered)} from={C.indigo} to={C.violet}
                 note={<>{plural(poCount, 'purchase order')} raised</>} onClick={() => onNav('tracking')} />
        <BigStat icon={PiggyBank} label="Money Saved" count={awarded.length + rows.filter(r => r.savings > 0).length} value={savings} from="#059669" to={C.teal}
                 countSuffix={(awarded.length + rows.filter(r => r.savings > 0).length) === 1 ? 'deal' : 'deals'}
                 note={<>{money(sum(rows, r => r.savings))} negotiated · {money(auctionSavings)} in auctions</>} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <SmallStat icon={Send} label="Waiting for vendor" value={withVendor.length} format={whole} color={C.sky}
                   note={<>{toRelease.length} order{toRelease.length === 1 ? '' : 's'} still to be released by the manager</>} onClick={() => onNav('tracking')} />
        <SmallStat icon={CheckCircle2} label="Confirmed by vendor" value={confirmed.length} format={whole} color={C.green}
                   note={<>{paid.length} of them paid and closed</>} />
        <SmallStat icon={Timer} label="Avg. sourcing time" value={avgCycle} format={n => cycle.length ? duration(n) : '—'} color={C.violet}
                   note="From approval to purchase order" />
        <SmallStat icon={Package} label="New products to review" value={newProducts} format={whole} color={C.orange}
                   note="Product creation requests waiting on you" onClick={() => onNav('newProducts')} />
      </div>

      {/* ── Queue + how it is sourced ─────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Hourglass} color={C.amber} title="Your Sourcing Queue" subtitle="Approved requests waiting for a vendor — longest waiting first. Click one to source it." className="lg:col-span-3"
              right={toSource.length ? <button onClick={() => onNav('requests')} className="flex items-center gap-1 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100">
                See all {toSource.length} <ArrowRight className="h-3.5 w-3.5" /></button> : undefined}>
          {queue.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                    <th className="py-2 pr-3">Request</th><th className="py-2 px-2">Method</th>
                    <th className="py-2 px-2 text-right">Amount</th><th className="py-2 pl-2 text-right">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(r => {
                    const age = daysSinceApproval(r, nowMs);
                    const tone = age > 7 ? C.red : age > 3 ? C.amber : C.green;
                    const m = r.selectedSourcingMethod || 'Negotiation';
                    return (
                      <tr key={r.id} onClick={() => onOpenRequest(r.id, r.status)} className="cursor-pointer border-b border-borderTheme/70 hover:bg-secondary/70">
                        <td className="py-3 pr-3">
                          <p className="text-sm font-bold text-textPrimary">{r.productName}</p>
                          <p className="text-[11px] text-textFaint"><span className="font-mono">{r.id}</span> · {r.location || '—'}{r.contract ? ` · contract ${r.contract}` : ''}</p>
                        </td>
                        <td className="py-3 px-2">
                          <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${METHOD_COLOR[m] ?? C.slate}1A`, color: METHOD_COLOR[m] ?? C.slate }}>
                            {METHOD_LABEL[m] ?? m}
                          </span>
                        </td>
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
              <CheckCircle2 className="h-5 w-5" /> All caught up — nothing is waiting to be sourced.
            </div>
          )}
        </Card>

        <Card icon={PieChart} color={C.violet} title={split === 'method' ? 'How Requests Are Sourced' : 'Contract Coverage'}
              subtitle={split === 'method' ? 'Requests by sourcing method' : 'Requests priced from a rate contract vs. sourced from the market'} className="lg:col-span-2"
              right={<div className="flex rounded-xl bg-secondary p-1 text-xs font-bold">
                {(['method', 'contract'] as const).map(s => (
                  <button key={s} onClick={() => setSplit(s)} className={toggleCls(split === s)}>{s === 'method' ? 'Method' : 'Contract'}</button>))}
              </div>}>
          <DonutWithLegend parts={split === 'method' ? methods : coverage} centerValue={whole(rows.length)} centerLabel="Requests" />
        </Card>
      </div>

      {/* ── Auctions + vendors ────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Gavel} color={C.pink} title="Your Reverse Auctions" subtitle="Live and recent events — starting price, best bid and what was saved" className="lg:col-span-3"
              right={<button onClick={() => onNav('auctions')} className="flex items-center gap-1 rounded-xl bg-pink-50 px-3 py-1.5 text-xs font-bold text-pink-700 hover:bg-pink-100">
                Open Live Auctions <ArrowRight className="h-3.5 w-3.5" /></button>}>
          {offline ? <p className="text-sm text-textFaint">Sign in against the server to see auctions.</p> : (
            <>
              <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Bidding now', n: auctionLive.length, color: C.red },
                  { label: 'Scheduled', n: auctionScheduled.length, color: C.amber },
                  { label: 'With manager', n: auctionWaitingManager.length, color: C.violet },
                  { label: 'Awarded', n: awarded.length, color: C.green },
                ].map(s => (
                  <div key={s.label} className="rounded-2xl p-3" style={{ background: `${s.color}12` }}>
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
                    <p className="font-outfit text-2xl font-extrabold text-textPrimary">{s.n}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {recentAuctions.map(a => {
                  const tone = AUCTION_TONE[a.state] ?? C.slate;
                  const best = a.awardedTotal || a.bestTotal || 0;
                  const saved = a.savings ?? (a.ceiling && best ? a.ceiling - best : 0);
                  return (
                    <button key={a.id} type="button" onClick={() => onNav('auctions')}
                            className="flex w-full items-center gap-3 rounded-2xl border border-borderTheme p-3 text-left transition-all hover:border-brand/40 hover:bg-secondary/60">
                      <span className="h-10 w-1.5 rounded-full" style={{ background: tone }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-textPrimary">{a.title}</p>
                        <p className="text-[11px] text-textFaint"><span className="font-mono">{a.id}</span> · {a.location || '—'} · {plural(a.bidCount ?? 0, 'bid')}</p>
                      </div>
                      <div className="hidden sm:block text-right">
                        <p className="text-[11px] text-textFaint">Start {money(a.ceiling ?? 0)}</p>
                        <p className="text-sm font-extrabold text-textPrimary">{best ? `Best ${money(best)}` : 'No bids yet'}</p>
                      </div>
                      <div className="w-24 text-right">
                        <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${tone}1A`, color: tone }}>{a.stateLabel}</span>
                        {saved > 0 && <p className="mt-0.5 text-[11px] font-bold text-emerald-600">saved {money(saved)}</p>}
                      </div>
                    </button>
                  );
                })}
                {!recentAuctions.length && <p className="text-sm text-textFaint">No auctions yet — launch one from Live Auctions.</p>}
              </div>
            </>
          )}
        </Card>

        <Card icon={Store} color={C.teal} title="Top Vendors" subtitle="Value of the orders you placed with each vendor" className="lg:col-span-2">
          <HBars rows={vendors.map((v, i) => ({ name: v.name, value: v.value, note: plural(v.count, 'order'), color: SERIES[i % SERIES.length] }))} />
          <button onClick={() => onNav('discovery')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-borderTheme py-3 text-sm font-bold text-brand hover:bg-brand/5">
            <Search className="h-4 w-4" /> Find new vendors
          </button>
        </Card>
      </div>

      {/* ── Company-wise + branch-wise ───────────────────────────────── */}
      <Card icon={Building2} color={C.indigo} title="Company-wise Sourcing" subtitle="Each company's approved requests — still to source, ordered and paid. Click a company to filter."
            right={<Legend items={[{ label: 'To source', color: C.amber }, { label: 'Ordered', color: C.indigo }, { label: 'Paid', color: C.teal }]} />}>
        <div className="grid md:grid-cols-3 gap-4">
          {companyRows.map(c => (
            <button key={c.name} type="button" onClick={() => { setCompany(company === c.name ? '' : c.name); setBranch(''); }}
                    className={`rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${company === c.name ? 'border-brand ring-2 ring-brand/20' : 'border-borderTheme'}`}>
              <p className="text-base font-extrabold text-textPrimary">{c.short}</p>
              <p className="truncate text-xs text-textFaint">{c.branches.join(', ') || '—'}</p>
              <p className="mt-2 font-outfit text-2xl font-extrabold text-textPrimary">{money(c.value)}</p>
              <p className="mb-3 text-xs text-textSecondary">{plural(c.total, 'request')} · {money(c.orderedValue)} ordered</p>
              <SegmentBar parts={[{ label: 'To source', n: c.toSource, color: C.amber }, { label: 'Ordered', n: c.ordered, color: C.indigo }, { label: 'Paid', n: c.paid, color: C.teal }]} />
            </button>
          ))}
        </div>
      </Card>

      <Card icon={MapPin} color={C.pink} title="Branch-wise Sourcing" subtitle="Approved value and ordered value for each branch. Click a branch to focus the dashboard on it."
            right={<Legend items={[{ label: 'Approved for sourcing', color: C.amber }, { label: 'Ordered', color: C.indigo }]} />}>
        <div className="grid xl:grid-cols-2 gap-8">
          <ColumnChart groups={branchRows.map(b => ({ label: b.name, values: [b.value, b.orderedValue], note: `${b.company} · ${plural(b.total, 'request')}` }))}
                       series={[{ label: 'Approved for sourcing', color: C.amber }, { label: 'Ordered', color: C.indigo }]} />
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 px-2 text-center">To source</th>
                  <th className="py-2 px-2 text-center">Ordered</th>
                  <th className="py-2 px-2 text-center">Paid</th>
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
                    <td className="py-3 px-2 text-center"><CountPill n={b.toSource} color={C.amber} /></td>
                    <td className="py-3 px-2 text-center"><CountPill n={b.ordered} color={C.indigo} /></td>
                    <td className="py-3 px-2 text-center"><CountPill n={b.paid} color={C.teal} /></td>
                    <td className="py-3 pl-2 text-right text-sm font-extrabold text-textPrimary whitespace-nowrap">{money(b.value)}</td>
                  </tr>
                ))}
                {!branchRows.length && <tr><td colSpan={5} className="py-8 text-center text-sm text-textFaint">No requests for this selection.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* ── Over time + contracts ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={TrendingUp} color={C.green} title="Sourcing Over Time" subtitle="Value approved for sourcing and value ordered, by the date requests were submitted" className="lg:col-span-3"
              right={<div className="flex flex-wrap items-center gap-4">
                <Legend items={[{ label: 'Approved', color: C.amber }, { label: 'Ordered', color: C.indigo }]} />
                <div className="flex rounded-xl bg-secondary p-1 text-xs font-bold">
                  {(['week', 'month'] as const).map(g => (
                    <button key={g} onClick={() => setGrain(g)} className={toggleCls(grain === g)}>{g === 'week' ? 'Weekly' : 'Monthly'}</button>))}
                </div>
              </div>}>
          <ColumnChart groups={trend} series={[{ label: 'Approved', color: C.amber }, { label: 'Ordered', color: C.indigo }]} />
        </Card>

        <Card icon={FileSignature} color={C.indigo} title="Rate Contracts" subtitle="Running contracts — ending soonest first" className="lg:col-span-2"
              right={<button onClick={() => onNav('masters')} className="text-xs font-bold text-brand hover:underline">Master Data</button>}>
          {offline ? <p className="text-sm text-textFaint">Sign in against the server to see contracts.</p> : (
            <div className="space-y-2.5">
              {contractRows.map(c => {
                const left = daysLeft(c.validUntil);
                const tone = left <= 30 ? C.red : left <= 90 ? C.amber : C.green;
                return (
                  <div key={c.id} className="rounded-2xl border border-borderTheme p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-textPrimary">{c.vendor}</p>
                        <p className="text-[11px] text-textFaint"><span className="font-mono">{c.id}</span> · {c.category || '—'} · {plural(c.lines.length, 'item')}</p>
                      </div>
                      <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${tone}1A`, color: tone }}>
                        {left >= 0 ? `${left} days left` : 'Ended'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-textSecondary">Used on {plural(c.requestCount, 'request')} · {plural(c.purchaseOrderCount, 'order')} · until {shortDate(c.validUntil)}</p>
                  </div>
                );
              })}
              {!contractRows.length && <p className="text-sm text-textFaint">No running rate contracts.</p>}
            </div>
          )}
        </Card>
      </div>

      {/* ── Follow-ups + other activity ───────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Send} color={C.sky} title="Orders to Follow Up" subtitle="Purchase orders not yet confirmed — waiting for the manager's release or the vendor" className="lg:col-span-3">
          <div className="space-y-2">
            {followUps.map(r => {
              const atVendor = !!r.poReleased;
              const tone = atVendor ? C.sky : C.violet;
              return (
                <button key={r.id} type="button" onClick={() => onOpenRequest(r.id, r.status)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-borderTheme p-3 text-left transition-all hover:border-brand/40 hover:bg-secondary/60">
                  <span className="h-10 w-1.5 rounded-full" style={{ background: tone }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-textPrimary">{r.productName}</p>
                    <p className="text-[11px] text-textFaint"><span className="font-mono">{r.id}</span> · {(r.purchaseOrders ?? []).join(', ') || 'PO'} · {r.vendor || 'vendor'}</p>
                  </div>
                  <span className="text-sm font-extrabold text-textPrimary whitespace-nowrap">{money(r.totalCost)}</span>
                  <span className="w-36 text-right">
                    <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${tone}1A`, color: tone }}>
                      {atVendor ? 'Waiting for vendor' : 'Waiting for release'}
                    </span>
                  </span>
                </button>
              );
            })}
            {!followUps.length && (
              <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-8 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="h-5 w-5" /> Every order is confirmed by its vendor.
              </div>
            )}
            {toRelease.length + withVendor.length > followUps.length && (
              <p className="pt-1 text-center text-xs text-textFaint">+ {toRelease.length + withVendor.length - followUps.length} more in Track Request</p>
            )}
          </div>
        </Card>

        <Card icon={CalendarClock} color={C.violet} title="Other Activity" subtitle="Click any line to open it" className="lg:col-span-2">
          {offline ? <p className="text-sm text-textFaint">Sign in against the server to see this.</p> : (
            <div className="space-y-2.5">
              <ActivityRow icon={Gavel} color={C.green} label="Auctions ready to award" value={String(auctionToAward.length)}
                           note={auctionWaitingManager.length ? `${auctionWaitingManager.length} waiting for the manager's approval` : 'None waiting for the manager'}
                           alert={auctionToAward.length > 0} onClick={() => onNav('auctions')} />
              <ActivityRow icon={Package} color={C.orange} label="New products to review" value={String(newProducts)}
                           note={newProducts ? 'Requesters asked for items not in the catalogue' : 'Nothing waiting'}
                           alert={newProducts > 0} onClick={() => onNav('newProducts')} />
              <ActivityRow icon={Repeat} color={C.violet} label="Subscriptions per month" value={money(sum(subs, s => s.monthlyCost))}
                           note={subs.length ? `${plural(subs.length, 'active subscription')} · next order ${shortDate(subs.map(s => s.nextOrderDate).filter(Boolean).sort()[0])}` : 'No active subscriptions'}
                           onClick={() => onNav('subscriptions')} />
              <ActivityRow icon={Truck} color={C.amber} label="Deliveries still to arrive" value={String(openBackorders.length)}
                           note={openBackorders.length ? `${money(sum(openBackorders, b => b.amountPending))} of goods pending` : 'Every order received in full'}
                           alert={openBackorders.some(b => b.overdue)} onClick={() => onNav('backorders')} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
