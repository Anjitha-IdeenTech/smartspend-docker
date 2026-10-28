/**
 * The supplier's dashboard — their business with the buying company at a glance.
 *
 * Reads only what the supplier is allowed to see, all live from Odoo: the
 * purchase orders placed with them (Odoo's record rules already limit the
 * request feed to their own; on a split award, to their own share), the
 * reverse auctions they were invited to (their own standing, never a rival's),
 * the delivery dates they committed to and what is still to deliver. The same
 * look and colours as the manager's and buyer's dashboards.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BadgeCheck, Building2, CalendarClock, CheckCircle2, Clock, Gavel, Handshake, MapPin, Package,
  PieChart, Send, Trophy, TrendingUp, Truck, Wallet,
} from 'lucide-react';
import {
  BigStat, C, Card, ColumnChart, DAY, DonutWithLegend, HBars, Legend, SERIES, SmallStat, money, pct,
  plural, shortDate, submitted, sum, whole,
} from './managerDashboard';
import type { DashCompany, DashRequest } from './managerDashboard';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export interface VendorDashOrder extends DashRequest {
  poReleased?: boolean;
  poAcknowledged?: boolean;
  deliveryDate?: string;
}

export type VendorTabKey = 'orders' | 'receipts' | 'approvals' | 'auctions';

interface VendorAuction {
  id: string; title: string; state: string; stateLabel: string; location: string; startAt?: string; endAt?: string;
  ceiling?: number; competitors?: number;
  me: { state: string; stateLabel: string; total: number; rank: number; bidCount: number };
}

/** Goods received in full: a receipt is on the timeline and no backorder is still open. */
const receivedIn = (r: VendorDashOrder, openBackorderIds: Set<string>) =>
  r.history.some(h => /^Goods Received/.test(h.title)) && !openBackorderIds.has(r.id);

/** Where an order stands, from the supplier's side. */
const stageOf = (r: VendorDashOrder, openBackorderIds: Set<string>) =>
  r.status === 'Paid' ? 'paid'
    : r.poAcknowledged ? (receivedIn(r, openBackorderIds) ? 'delivered' : 'confirmed')
      : r.poReleased ? 'confirm' : 'preparing';
const STAGE: Record<string, { label: string; color: string }> = {
  preparing: { label: 'Being released by buyer', color: C.slate },
  confirm: { label: 'Waiting for your confirmation', color: C.amber },
  confirmed: { label: 'Confirmed — to deliver', color: C.indigo },
  delivered: { label: 'Delivered — awaiting payment', color: C.cyan },
  paid: { label: 'Paid', color: C.green },
};

function useFeeds(fetcher: Fetcher, offline: boolean) {
  const [auctions, setAuctions] = useState<VendorAuction[]>([]);
  const [commitments, setCommitments] = useState<Record<string, string>>({});
  const [schedules, setSchedules] = useState<Record<string, { date: string }[]>>({});
  const [backorders, setBackorders] = useState<{ state: string; qtyPending: number; amountPending: number; requestId: string; scheduledDate: string; overdue: boolean }[]>([]);
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
      const [a, c, s, b] = await Promise.all([
        get('/api/smartspend/auctions'), get('/api/smartspend/delivery-commitments'),
        get('/api/smartspend/delivery-schedules'), get('/api/smartspend/backorders'),
      ]);
      if (stale) return;
      setAuctions(Array.isArray(a) ? a.filter(x => x && x.me) : []);
      setCommitments(c && typeof c === 'object' && !Array.isArray(c) ? c : {});
      setSchedules(s && typeof s === 'object' && !Array.isArray(s) ? s : {});
      setBackorders(b?.backorders ?? []);
    })();
    return () => { stale = true; };
  }, [offline]);
  return { auctions, commitments, schedules, backorders };
}

export function VendorDashboard({ orders, companyName, userName, companies, fetcher, offline, onTab }: {
  /** The orders placed with this supplier (the portal's vendor order list). */
  orders: VendorDashOrder[];
  companyName: string;
  userName: string;
  companies: DashCompany[];
  fetcher: Fetcher;
  offline: boolean;
  /** Open one of the supplier portal's tabs. */
  onTab: (key: VendorTabKey) => void;
}) {
  const [grain, setGrain] = useState<'week' | 'month'>('week');
  const { auctions, commitments, schedules, backorders } = useFeeds(fetcher, offline);
  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  const value = (list: VendorDashOrder[]) => sum(list, r => r.totalCost);
  const stillToDeliver = backorders.filter(b => b.state !== 'done' && b.state !== 'cancel');
  const openBackorderIds = new Set(stillToDeliver.map(b => b.requestId));
  const stage = (r: VendorDashOrder) => stageOf(r, openBackorderIds);
  const by = (key: string) => orders.filter(r => stage(r) === key);
  const preparing = by('preparing'), toConfirm = by('confirm'), confirmed = by('confirmed'), delivered = by('delivered'), paid = by('paid');
  const unpaid = [...confirmed, ...delivered];
  const poCount = sum(orders, r => (r.purchaseOrders?.length || 1));

  // --- Auctions: the supplier's own results ----------------------------------
  const won = auctions.filter(a => a.me.state === 'won');
  const lost = auctions.filter(a => a.me.state === 'lost');
  const openInvites = auctions.filter(a => (a.state === 'scheduled' && a.me.state === 'invited') || (a.state === 'live' && ['accepted', 'live'].includes(a.me.state)));
  const winRate = pct(won.length, won.length + lost.length);
  const recentAuctions = [...auctions].sort((a, b) => {
    const rank = (x: VendorAuction) => ({ live: 0, scheduled: 1, closed: 2, awarded: 3 } as Record<string, number>)[x.state] ?? 4;
    return rank(a) - rank(b) || String(b.startAt ?? '').localeCompare(String(a.startAt ?? ''));
  }).slice(0, 5);

  // --- Deliveries: committed dates on confirmed, unpaid orders ---------------
  const deliveryDay = (r: VendorDashOrder) => {
    const parts = schedules[r.id];
    const iso = parts?.length ? parts.map(p => p.date).sort()[0] : commitments[r.id];
    if (iso) return { t: Date.parse(`${iso}T00:00:00`), label: shortDate(iso), parts: parts?.length ?? 1 };
    const t = r.deliveryDate ? Date.parse(r.deliveryDate) : NaN;
    return Number.isFinite(t) ? { t, label: r.deliveryDate as string, parts: 1 } : null;
  };
  const upcoming = confirmed.map(r => ({ r, d: deliveryDay(r) })).sort((a, b) => (a.d?.t ?? Infinity) - (b.d?.t ?? Infinity)).slice(0, 5);

  // --- Where the business comes from --------------------------------------------
  const companyOf = (b: string) => companies.find(c => c.branches.some(x => x.trim().toLowerCase() === (b || '').trim().toLowerCase()));
  const group = (key: (r: VendorDashOrder) => string) => {
    const m = new Map<string, { value: number; count: number }>();
    orders.forEach(r => {
      const k = key(r) || 'Unassigned';
      const e = m.get(k) ?? { value: 0, count: 0 };
      e.value += r.totalCost || 0; e.count++; m.set(k, e);
    });
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value);
  };
  const byCompany = group(r => companyOf(r.location)?.short ?? 'Other');
  const byBranch = group(r => r.location).slice(0, 6);
  const products = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    orders.forEach(r => (r.lineItems?.length ? r.lineItems : [{ productName: r.productName, productQty: 1, targetPrice: r.totalCost }]).forEach(l => {
      const e = m.get(l.productName) ?? { qty: 0, value: 0 };
      e.qty += l.productQty || 0; e.value += (l.productQty || 0) * (l.targetPrice || 0); m.set(l.productName, e);
    }));
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).filter(p => p.name).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [orders]);

  // --- Over time ------------------------------------------------------------------
  const trend = useMemo(() => {
    const times = orders.map(submitted).filter((t): t is number => t !== null);
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
      const inside = orders.filter(r => { const t = submitted(r); return t !== null && t >= b.start && t < b.end; });
      return {
        label: b.label, title: grain === 'week' ? `Week of ${b.label}` : b.label,
        values: [value(inside), value(inside.filter(r => r.status === 'Paid'))],
        note: plural(inside.length, 'order'),
      };
    });
  }, [orders, grain, now]);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const toggleCls = (on: boolean) => `rounded-lg px-3 py-1 transition-colors ${on ? 'bg-surface text-brand shadow-sm' : 'text-textFaint hover:text-textPrimary'}`;
  const recentOrders = [...orders].sort((a, b) => {
    const order = { confirm: 0, confirmed: 1, delivered: 2, preparing: 3, paid: 4 } as Record<string, number>;
    return order[stage(a)] - order[stage(b)] || (submitted(b) ?? 0) - (submitted(a) ?? 0);
  }).slice(0, 6);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* ── Title ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-borderTheme bg-surface px-6 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-md"
                style={{ background: `linear-gradient(135deg, ${C.teal}, ${C.indigo})` }}>
            <Handshake className="h-7 w-7" />
          </span>
          <div>
            <p className="text-sm font-semibold text-textSecondary">{greeting}{userName ? `, ${userName}` : ''}</p>
            <h2 className="font-outfit text-3xl font-extrabold text-textPrimary leading-tight">{companyName || 'Supplier'} Dashboard</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-textFaint">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live from Odoo · your orders, auctions, deliveries and payments
            </p>
          </div>
        </div>
        {toConfirm.length > 0 && (
          <button onClick={() => onTab('approvals')}
                  className="flex items-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-amber-600">
            <Send className="h-4 w-4" /> Confirm {plural(toConfirm.length, 'order')} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── The four numbers that matter ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <BigStat icon={Package} label="Orders Received" count={orders.length} value={value(orders)} from={C.indigo} to={C.violet}
                 note={<>{plural(poCount, 'purchase order')} from the buying company</>} onClick={() => onTab('orders')} />
        <BigStat icon={Clock} label="Waiting for You" count={toConfirm.length} value={value(toConfirm)} from={C.amber} to={C.orange}
                 note={toConfirm.length ? 'Released to you — confirm with a delivery date' : 'Nothing to confirm — all caught up'}
                 onClick={() => onTab('approvals')} />
        <BigStat icon={Wallet} label="Paid" count={paid.length} value={value(paid)} from="#059669" to={C.teal}
                 note={<>{money(value(unpaid))} still to be paid · {delivered.length} delivered, awaiting payment</>} onClick={() => onTab('receipts')} />
        <BigStat icon={Trophy} label="Auctions Won" count={won.length} value={sum(won, a => a.me.total)} from={C.pink} to={C.red}
                 note={won.length + lost.length ? <>{winRate.toFixed(0)}% win rate · {openInvites.length} open now</> : `${openInvites.length} open invitations`}
                 onClick={() => onTab('auctions')} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <SmallStat icon={BadgeCheck} label="Confirmed — to deliver" value={confirmed.length} format={whole} color={C.indigo}
                   note={<>{money(value(confirmed))} of goods to send</>} onClick={() => onTab('orders')} />
        <SmallStat icon={Clock} label="Being released" value={preparing.length} format={whole} color={C.slate}
                   note="Raised by the buyer, not yet released to you" />
        <SmallStat icon={Truck} label="Still to deliver" value={stillToDeliver.length} format={whole} color={C.orange}
                   note={stillToDeliver.length ? <>{money(sum(stillToDeliver, b => b.amountPending))} of goods outstanding</> : 'Everything delivered in full'}
                   onClick={() => onTab('receipts')} />
        <SmallStat icon={Gavel} label="Auction invitations" value={auctions.length} format={whole} color={C.pink}
                   note={<>{won.length} won · {lost.length} lost</>} onClick={() => onTab('auctions')} />
      </div>

      {/* ── Orders + stages ───────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Package} color={C.indigo} title="Your Orders" subtitle="What needs you first, then the most recent. Click to open your orders." className="lg:col-span-3"
              right={<button onClick={() => onTab('orders')} className="flex items-center gap-1 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                See all {orders.length} <ArrowRight className="h-3.5 w-3.5" /></button>}>
          {recentOrders.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-borderTheme text-[11px] font-bold uppercase tracking-wider text-textFaint">
                    <th className="py-2 pr-3">Order</th><th className="py-2 px-2">Deliver to</th>
                    <th className="py-2 px-2 text-right">Value</th><th className="py-2 pl-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map(r => {
                    const st = STAGE[stage(r)];
                    return (
                      <tr key={r.id} onClick={() => onTab(stage(r) === 'confirm' ? 'approvals' : 'orders')} className="cursor-pointer border-b border-borderTheme/70 hover:bg-secondary/70">
                        <td className="py-3 pr-3">
                          <p className="text-sm font-bold text-textPrimary">{r.productName}</p>
                          <p className="text-[11px] text-textFaint font-mono">{(r.purchaseOrders ?? []).join(', ') || r.id}</p>
                        </td>
                        <td className="py-3 px-2 text-sm text-textSecondary whitespace-nowrap">{r.location || '—'}</td>
                        <td className="py-3 px-2 text-right text-sm font-extrabold text-textPrimary whitespace-nowrap">{money(r.totalCost)}</td>
                        <td className="py-3 pl-2 text-right">
                          <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${st.color}1F`, color: st.color }}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="py-8 text-center text-sm text-textFaint">No orders placed with you yet.</p>}
        </Card>

        <Card icon={PieChart} color={C.violet} title="Where Your Orders Stand" subtitle="Every order by its current stage" className="lg:col-span-2">
          <DonutWithLegend parts={Object.entries(STAGE).map(([k, s]) => ({ label: s.label, color: s.color, value: by(k).length }))}
                           centerValue={whole(orders.length)} centerLabel="Orders" />
        </Card>
      </div>

      {/* ── Deliveries + auctions ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={CalendarClock} color={C.orange} title="Upcoming Deliveries" subtitle="Confirmed orders not yet received — by the delivery date you committed to" className="lg:col-span-2">
          <div className="space-y-2.5">
            {upcoming.map(({ r, d }) => {
              const days = d ? Math.round((d.t - today.getTime()) / DAY) : null;
              const tone = days === null ? C.slate : days < 0 ? C.red : days <= 3 ? C.amber : C.green;
              return (
                <button key={r.id} type="button" onClick={() => onTab('orders')}
                        className="flex w-full items-center gap-3 rounded-2xl border border-borderTheme p-3 text-left transition-all hover:border-brand/40 hover:bg-secondary/60">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-center leading-none" style={{ background: `${tone}1A`, color: tone }}>
                    <Truck className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-textPrimary">{r.productName}</p>
                    <p className="text-[11px] text-textFaint">{r.location || '—'} · {d ? d.label : 'no date given'}{d && d.parts > 1 ? ` · first of ${d.parts} deliveries` : ''}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${tone}1F`, color: tone }}>
                    {days === null ? '—' : days < 0 ? `${Math.abs(days)} days late` : days === 0 ? 'Today' : `in ${plural(days, 'day')}`}
                  </span>
                </button>
              );
            })}
            {!upcoming.length && (
              <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-8 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="h-5 w-5" /> Nothing left to deliver — every confirmed order is received.
              </div>
            )}
          </div>
        </Card>

        <Card icon={Gavel} color={C.pink} title="Your Auction Results" subtitle="Your rank and your best bid in each reverse auction you were invited to" className="lg:col-span-3"
              right={<button onClick={() => onTab('auctions')} className="flex items-center gap-1 rounded-xl bg-pink-50 px-3 py-1.5 text-xs font-bold text-pink-700 hover:bg-pink-100">
                Open Live Auctions <ArrowRight className="h-3.5 w-3.5" /></button>}>
          {offline ? <p className="text-sm text-textFaint">Sign in against the server to see your auctions.</p> : (
            <>
              <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Open now', n: openInvites.length, color: C.amber },
                  { label: 'Won', n: won.length, color: C.green },
                  { label: 'Lost', n: lost.length, color: C.red },
                  { label: 'Win rate', n: -1, color: C.indigo },
                ].map(s => (
                  <div key={s.label} className="rounded-2xl p-3" style={{ background: `${s.color}12` }}>
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
                    <p className="font-outfit text-2xl font-extrabold text-textPrimary">{s.n < 0 ? (won.length + lost.length ? `${winRate.toFixed(0)}%` : '—') : s.n}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {recentAuctions.map(a => {
                  const outcome = a.me.state === 'won' ? { label: 'Won', color: C.green }
                    : a.me.state === 'lost' ? { label: 'Not selected', color: C.red }
                      : a.state === 'live' ? { label: 'Bidding now', color: C.amber }
                        : a.state === 'scheduled' ? { label: a.me.stateLabel, color: C.amber }
                          : { label: 'Awaiting result', color: C.violet };
                  return (
                    <button key={a.id} type="button" onClick={() => onTab('auctions')}
                            className="flex w-full items-center gap-3 rounded-2xl border border-borderTheme p-3 text-left transition-all hover:border-brand/40 hover:bg-secondary/60">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-outfit text-sm font-extrabold"
                            style={{ background: a.me.rank === 1 ? `${C.green}1F` : `${C.slate}1F`, color: a.me.rank === 1 ? C.green : C.slate }}>
                        {a.me.rank ? `L${a.me.rank}` : '—'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-textPrimary">{a.title}</p>
                        <p className="text-[11px] text-textFaint"><span className="font-mono">{a.id}</span> · {a.location || '—'} · {plural(a.me.bidCount, 'bid')}</p>
                      </div>
                      <div className="hidden sm:block text-right">
                        <p className="text-[11px] text-textFaint">Your best bid</p>
                        <p className="text-sm font-extrabold text-textPrimary">{a.me.total ? money(a.me.total) : '—'}</p>
                      </div>
                      <span className="w-28 text-right">
                        <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${outcome.color}1A`, color: outcome.color }}>{outcome.label}</span>
                      </span>
                    </button>
                  );
                })}
                {!recentAuctions.length && <p className="text-sm text-textFaint">You have not been invited to an auction yet.</p>}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Business over time + products ─────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={TrendingUp} color={C.green} title="Business Over Time" subtitle="Value of orders received, and how much of it has been paid" className="lg:col-span-3"
              right={<div className="flex flex-wrap items-center gap-4">
                <Legend items={[{ label: 'Ordered', color: C.indigo }, { label: 'Paid', color: C.green }]} />
                <div className="flex rounded-xl bg-secondary p-1 text-xs font-bold">
                  {(['week', 'month'] as const).map(g => (
                    <button key={g} onClick={() => setGrain(g)} className={toggleCls(grain === g)}>{g === 'week' ? 'Weekly' : 'Monthly'}</button>))}
                </div>
              </div>}>
          <ColumnChart groups={trend} series={[{ label: 'Ordered', color: C.indigo }, { label: 'Paid', color: C.green }]} />
        </Card>

        <Card icon={Package} color={C.teal} title="Top Products You Supply" subtitle="By order value" className="lg:col-span-2">
          <HBars rows={products.map((p, i) => ({ name: p.name, value: p.value, note: `${p.qty.toLocaleString('en-IN')} units`, color: SERIES[i % SERIES.length] }))} />
        </Card>
      </div>

      {/* ── Customers ─────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Card icon={Building2} color={C.indigo} title="Company-wise Orders" subtitle="Which of the buyer's companies your orders come from" className="lg:col-span-2">
          <DonutWithLegend parts={byCompany.map((c, i) => ({ label: c.name, value: c.value, color: SERIES[i % SERIES.length] }))}
                           centerValue={money(value(orders))} centerLabel="Total" format={money} />
        </Card>
        <Card icon={MapPin} color={C.pink} title="Branch-wise Orders" subtitle="Where you deliver — value of orders for each branch" className="lg:col-span-3">
          <ColumnChart groups={byBranch.map(b => ({ label: b.name, values: [b.value], note: `${companyOf(b.name)?.short ?? '—'} · ${plural(b.count, 'order')}` }))}
                       series={[{ label: 'Order value', color: C.pink }]} height={220} />
        </Card>
      </div>
    </div>
  );
}
