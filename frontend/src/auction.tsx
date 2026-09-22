/**
 * Live reverse auctions — the buyer's auction room and the supplier's bidding
 * console.
 *
 * Everything on these screens comes from the server: the ranking, the clock,
 * the time extensions and what a vendor is allowed to know are all
 * decided there (see controllers/auction.py). The screens poll while they are
 * open and animate the difference between one answer and the next — nothing
 * here invents a bid, a rank or a price.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Gavel, Trophy, Crown, Hourglass, Flame, TrendingDown, PhoneCall, RotateCcw, Ban,
  EyeOff, Eye, Radio, Rocket, Lock, Users, Activity, ShieldCheck, Send, Check, X,
  Play, Clock, AlertTriangle, CheckCircle2, ChevronRight, ChevronLeft, Minus, Info,
  Sparkles, Timer, Zap, PartyPopper, Swords, BellRing, Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shapes the API returns
// ---------------------------------------------------------------------------
export interface AuctionLine {
  id: number; productName: string; qty: number; uom: string;
  ceilingPrice: number; ceilingSubtotal: number;
}
export interface AuctionParticipant {
  id: number; vendorId: number; vendor: string; hasLogin: boolean; login: string;
  state: string; stateLabel: string; total: number; rank: number; bidCount: number;
  lastBidAt: string; respondedAt: string; note: string;
}
export interface AuctionBid {
  id: number; vendorId: number; vendor: string; total: number; at: string; rankAfter: number;
  onBehalf: boolean; placedBy: string; extendedBy: number; secondsLeft: number;
}
export interface Auction {
  id: string; requestId?: string; title: string; itemCount: number; location: string; neededBy: string;
  state: 'draft' | 'scheduled' | 'live' | 'closed' | 'awarded' | 'cancelled'; stateLabel: string;
  startAt: string; endAt: string; originalEndAt: string; closedAt: string; serverNow: string;
  durationMinutes: number; extensionWindow: number; extensionMinutes: number; extensionCount: number;
  /** How bidding opened: 'ready' (every vendor ready), 'buyer' (opened early) or 'schedule'. */
  openedBy?: string;
  minDecrement: number; visibility: 'rank' | 'leader'; rebidMinutes: number; terms: string;
  ceiling: number; lines: AuctionLine[]; buyer?: string;
  // the buyer's view
  bestTotal?: number; leader?: string; savings?: number; savingsPct?: number; bidCount?: number;
  acceptedCount?: number; winner?: string; awardedTotal?: number; awardedAt?: string; awardedBy?: string;
  cancelReason?: string; rebidUntil?: string;
  participants?: AuctionParticipant[]; bids?: AuctionBid[];
  // a vendor's view
  competitors?: number; leaderTotal?: number | null; nextMaxBid?: number;
  me?: {
    participantId: number; vendor: string; state: string; stateLabel: string; total: number;
    rank: number; bidCount: number; lastBidAt: string; prices: Record<string, number>;
  };
  myBids?: { total: number; at: string; rankAfter: number; extendedBy: number }[];
  outcome?: string;
}

/** The slice of a portal request the launcher needs. */
export interface AuctionableRequest {
  id: string; productName: string; productQty: number; totalCost: number; status: string;
  location: string; vendor: string; selectedSourcingMethod: string;
  lineItems?: { productName: string; productQty: number; targetPrice: number }[];
  vendorBids: { vendorName: string }[];
}

export type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const inr = (n: number | null | undefined) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const inrShort = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(Math.round(n));
const ts = (s?: string) => (s ? Date.parse(s) : NaN);
const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
const hhmm = (s?: string) => {
  const t = ts(s);
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};
const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** One call, answered as data or as the server's own words for why not. */
async function call<T>(api: ApiFn, path: string, init?: RequestInit):
  Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await api(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (body && body.error) || `The server refused this (HTTP ${res.status}).` };
    return { ok: true, data: body as T };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof TypeError ? 'Could not reach the server. Is it running?'
        : e instanceof Error ? e.message : 'Could not reach the server.',
    };
  }
}

/** Calls `fn` now and every `ms` while `ms` is set; always the latest `fn`. */
function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    if (ms == null) return;
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Wall-clock time as the server sees it, ticking. */
function useServerNow(offsetMs: number, tick = 250) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    const t = setInterval(() => setNow(Date.now() + offsetMs), tick);
    return () => clearInterval(t);
  }, [offsetMs, tick]);
  return now;
}

/** A number that glides to its new value instead of jumping. */
function Glide({ value, format = inr }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current, b = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * eased);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value]);
  return <>{format(Math.round(shown * 100) / 100)}</>;
}

const SERIES = ['#A78BFA', '#F472B6', '#2DD4BF', '#FBBF24', '#60A5FA', '#FB7185', '#A3E635'];
const STAGE: React.CSSProperties = {
  background:
    'radial-gradient(900px 340px at 8% -20%, rgba(139,92,246,0.55), transparent 60%),' +
    'radial-gradient(760px 320px at 105% 125%, rgba(236,72,153,0.42), transparent 60%),' +
    'linear-gradient(135deg, #140F2A 0%, #211943 52%, #2A1640 100%)',
};

const STATE_STYLE: Record<string, { label: string; cls: string; icon: LucideIcon }> = {
  draft: { label: 'Draft', cls: 'bg-secondary text-textSecondary border-borderTheme', icon: Info },
  scheduled: { label: 'Scheduled', cls: 'bg-info/10 text-info border-info/25', icon: Hourglass },
  live: { label: 'Live', cls: 'bg-neg/10 text-neg border-neg/30', icon: Radio },
  closed: { label: 'To award', cls: 'bg-gold/10 text-gold border-gold/30', icon: Gavel },
  awarded: { label: 'Awarded', cls: 'bg-pos/10 text-pos border-pos/30', icon: Trophy },
  cancelled: { label: 'Cancelled', cls: 'bg-secondary text-textFaint border-borderTheme', icon: Ban },
};

function StatePill({ state, big = false }: { state: string; big?: boolean }) {
  const s = STATE_STYLE[state] ?? STATE_STYLE.draft;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wider ${s.cls} ${big ? 'px-3 py-1 text-[11px]' : 'px-2 py-0.5 text-[9px]'}`}>
      {state === 'live' ? <span className="auction-live-dot" /> : <Icon className={big ? 'h-3.5 w-3.5' : 'h-3 w-3'} />}
      {s.label}
    </span>
  );
}

function RankBadge({ rank, size = 'md' }: { rank: number; size?: 'sm' | 'md' | 'xl' }) {
  const dims = size === 'xl' ? 'h-28 w-28 text-5xl' : size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-[11px]';
  if (!rank) {
    return <span className={`grid place-items-center rounded-2xl border border-dashed border-white/25 text-white/50 font-black ${dims}`}>—</span>;
  }
  const style = rank === 1 ? 'auction-rank-gold' : rank === 2 ? 'auction-rank-silver' : rank === 3 ? 'auction-rank-bronze' : 'auction-rank-plain';
  return (
    <span className={`relative grid place-items-center rounded-2xl font-black ${style} ${dims}`}>
      {rank === 1 && size !== 'sm' && (
        <Crown className={`absolute ${size === 'xl' ? '-top-6 h-9 w-9' : '-top-2.5 h-4 w-4'} text-amber-300 drop-shadow`} />
      )}
      L{rank}
    </span>
  );
}

/** The clock: a ring that empties as time runs out, and turns hot in the extension window. */
function CountdownRing({ auction, now, size = 196 }: { auction: Auction; now: number; size?: number }) {
  const gid = useId().replace(/:/g, '');
  const start = ts(auction.startAt), end = ts(auction.endAt);
  const live = auction.state === 'live', scheduled = auction.state === 'scheduled';
  const target = live ? end : scheduled ? start : NaN;
  const remaining = Number.isNaN(target) ? 0 : Math.max(0, target - now);
  const span = live ? Math.max(end - start, 1) : 30 * 60 * 1000;
  const frac = live || scheduled ? Math.min(1, remaining / span) : 0;
  const softClose = live && auction.extensionWindow > 0 && remaining < auction.extensionWindow * 60000;
  const critical = live && remaining < 15000;
  const r = (size - 18) / 2, c = 2 * Math.PI * r;
  const tone = critical ? ['#FB7185', '#F43F5E'] : softClose ? ['#FBBF24', '#F97316'] : ['#A78BFA', '#F472B6'];
  const label = live ? (softClose ? 'extension window' : 'until close') : scheduled ? 'until bidding opens'
    : auction.state === 'closed' ? 'bidding closed' : auction.state === 'awarded' ? 'awarded' : auction.stateLabel.toLowerCase();
  return (
    <div className={`relative shrink-0 ${critical ? 'auction-shake' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`ring-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone[0]} />
            <stop offset="100%" stopColor={tone[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="10" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#ring-${gid})`} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.3s linear', filter: `drop-shadow(0 0 10px ${tone[1]}88)` }}
        />
        {scheduled && (
          <circle cx={size / 2} cy={size / 2} r={r - 14} fill="none" stroke="rgba(255,255,255,0.18)"
                  strokeWidth="2" strokeDasharray="4 8" className="auction-spin-slow" style={{ transformOrigin: 'center' }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {live || scheduled ? (
          <span className={`font-outfit font-black tabular-nums tracking-tight text-white ${size > 150 ? 'text-5xl' : 'text-3xl'} ${softClose ? 'auction-glow-amber' : ''}`}>
            {clock(remaining)}
          </span>
        ) : auction.state === 'awarded' ? (
          <Trophy className="h-14 w-14 text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.7)]" />
        ) : auction.state === 'cancelled' ? (
          <Ban className="h-12 w-12 text-white/50" />
        ) : (
          <Gavel className="h-12 w-12 text-white/80" />
        )}
        <span className={`mt-1 text-[10px] font-bold uppercase tracking-[0.18em] ${softClose ? 'text-amber-300' : 'text-white/55'}`}>
          {label}
        </span>
        {live && auction.extensionCount > 0 && (
          <span className="mt-1 text-[10px] font-semibold text-amber-200/90">
            time extended ×{auction.extensionCount}
          </span>
        )}
      </div>
    </div>
  );
}

/** Every vendor's price over time, stepping down, with the best-so-far glowing on top. */
function PriceDescentChart({ auction, now }: { auction: Auction; now: number }) {
  const gid = useId().replace(/:/g, '');
  const bids = useMemo(() => [...(auction.bids ?? [])].sort((a, b) => ts(a.at) - ts(b.at)), [auction.bids]);
  const W = 720, H = 290, L = 70, R = 18, T = 20, B = 32;
  const start = ts(auction.startAt);
  const lastBidAt = bids.length ? ts(bids[bids.length - 1].at) : start;
  const xMax = auction.state === 'live' ? Math.max(now, lastBidAt, start + 60000)
    : Math.max(ts(auction.closedAt) || ts(auction.endAt) || lastBidAt, lastBidAt, start + 60000);
  const x0 = Math.min(start, bids.length ? ts(bids[0].at) : start);
  const minBid = bids.length ? Math.min(...bids.map(b => b.total)) : auction.ceiling * 0.92;
  const yTop = auction.ceiling * 1.012;
  const yBot = Math.max(0, minBid - (auction.ceiling - minBid) * 0.18 - auction.ceiling * 0.004);
  const x = (t: number) => L + ((t - x0) / Math.max(xMax - x0, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - yBot) / Math.max(yTop - yBot, 1)) * (H - T - B);

  const vendorIds = [...new Set((auction.participants ?? []).map(p => p.vendorId))].sort((a, b) => a - b);
  const colorOf = (vendorId: number) => SERIES[Math.max(0, vendorIds.indexOf(vendorId)) % SERIES.length];

  const stepPath = (points: { t: number; v: number }[], extendTo: number) => {
    if (!points.length) return '';
    let d = `M${x(points[0].t).toFixed(1)},${y(points[0].v).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` H${x(points[i].t).toFixed(1)} V${y(points[i].v).toFixed(1)}`;
    }
    return d + ` H${x(extendTo).toFixed(1)}`;
  };
  const byVendor = vendorIds.map(id => ({
    id, color: colorOf(id),
    name: (auction.participants ?? []).find(p => p.vendorId === id)?.vendor ?? '',
    points: bids.filter(b => b.vendorId === id).map(b => ({ t: ts(b.at), v: b.total })),
  })).filter(s => s.points.length);
  const envelope: { t: number; v: number }[] = [];
  bids.forEach(b => {
    const best = envelope.length ? envelope[envelope.length - 1].v : Infinity;
    if (b.total < best) envelope.push({ t: ts(b.at), v: b.total });
  });
  const ticks = [0, 1, 2, 3].map(i => yBot + ((yTop - yBot) * i) / 3);
  const latest = bids[bids.length - 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label="Bid totals over time for each vendor, with the best bid so far highlighted">
        <defs>
          <linearGradient id={`env-${gid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="100%" stopColor="#FBBF24" />
          </linearGradient>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(251,191,36,0.25)" />
            <stop offset="100%" stopColor="rgba(251,191,36,0)" />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.45)">{inrShort(v)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(auction.ceiling)} y2={y(auction.ceiling)}
              stroke="rgba(255,255,255,0.45)" strokeDasharray="6 5" />
        <text x={L + 6} y={y(auction.ceiling) - 6} textAnchor="start" fontSize="10" fontWeight="700" fill="rgba(255,255,255,0.7)">
          OPENING {inr(auction.ceiling)}
        </text>
        {bids.filter(b => b.extendedBy > 0).map(b => (
          <g key={`ext-${b.id}`}>
            <line x1={x(ts(b.at))} x2={x(ts(b.at))} y1={T} y2={H - B} stroke="rgba(251,191,36,0.55)" strokeDasharray="3 4" />
            <text x={x(ts(b.at)) + (x(ts(b.at)) > W - R - 40 ? -4 : 4)} y={T + 10} fontSize="9" fontWeight="800" fill="#FBBF24"
                  textAnchor={x(ts(b.at)) > W - R - 40 ? 'end' : 'start'}>+{b.extendedBy}m extension</text>
          </g>
        ))}
        {envelope.length > 0 && (
          <path d={`${stepPath(envelope, xMax)} V${H - B} H${x(envelope[0].t)} Z`} fill={`url(#fill-${gid})`} />
        )}
        {byVendor.map(s => (
          <path key={s.id} d={stepPath(s.points, xMax)} fill="none" stroke={s.color} strokeWidth="2"
                strokeOpacity="0.85" strokeLinejoin="round" />
        ))}
        {envelope.length > 0 && (
          <path d={stepPath(envelope, xMax)} fill="none" stroke={`url(#env-${gid})`} strokeWidth="3.5"
                strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(251,191,36,0.75))' }} />
        )}
        {bids.map(b => (
          <circle key={b.id} cx={x(ts(b.at))} cy={y(b.total)} r="3.4" fill={colorOf(b.vendorId)}
                  stroke="#1b1537" strokeWidth="1.5" />
        ))}
        {latest && auction.state === 'live' && (
          <circle cx={x(ts(latest.at))} cy={y(latest.total)} r="6" fill="none" stroke={colorOf(latest.vendorId)} strokeWidth="2">
            <animate attributeName="r" from="5" to="16" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.9" to="0" dur="1.6s" repeatCount="indefinite" />
          </circle>
        )}
        {auction.state === 'live' && (
          <line x1={x(now)} x2={x(now)} y1={T} y2={H - B} stroke="rgba(255,255,255,0.25)" />
        )}
        <text x={L} y={H - 10} fontSize="10" fill="rgba(255,255,255,0.45)">{hhmm(new Date(x0).toISOString())}</text>
        <text x={W - R} y={H - 10} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.45)">
          {auction.state === 'live' ? 'now' : hhmm(new Date(xMax).toISOString())}
        </text>
        {!bids.length && (
          <text x={(L + W - R) / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.55)">
            {auction.state === 'scheduled' ? 'The price curve draws itself once bidding opens.' : 'Waiting for the first bid…'}
          </text>
        )}
      </svg>
      {byVendor.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pt-1 text-[11px] text-white/70">
          {byVendor.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-amber-200">
            <span className="h-0.5 w-4 rounded bg-amber-300" /> best so far
          </span>
        </div>
      )}
    </div>
  );
}

/** Ranked vendors. Rows glide to their new place when the order changes. */
function Leaderboard({ auction, now }: { auction: Auction; now: number }) {
  const ROW = 64;
  const bidding = (auction.participants ?? []).filter(p => ['live', 'closed', 'won', 'lost', 'accepted'].includes(p.state));
  const ordered = [...bidding].sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.vendor.localeCompare(b.vendor));
  const out = (auction.participants ?? []).filter(p => ['declined', 'cancelled', 'invited'].includes(p.state));
  const best = auction.bestTotal || 0;
  const vendorIds = [...new Set((auction.participants ?? []).map(p => p.vendorId))].sort((a, b) => a - b);
  const colorOf = (vendorId: number) => SERIES[Math.max(0, vendorIds.indexOf(vendorId)) % SERIES.length];
  return (
    <div>
      <div className="relative" style={{ height: Math.max(ordered.length, 1) * ROW }}>
        {!ordered.length && (
          <p className="text-xs text-white/50 py-6 text-center">Nobody has accepted yet.</p>
        )}
        {ordered.map((p, index) => {
          const gap = p.total && best ? p.total - best : 0;
          const below = p.total ? ((auction.ceiling - p.total) / auction.ceiling) * 100 : 0;
          return (
            <div key={p.id} className="absolute inset-x-0 px-1" style={{
              top: index * ROW, height: ROW - 8,
              transition: reducedMotion() ? undefined : 'top 0.65s cubic-bezier(0.22, 1, 0.36, 1)',
            }}>
              <div className={`relative h-full flex items-center gap-3 rounded-xl px-3 border overflow-hidden ${
                p.rank === 1 ? 'border-amber-300/50 bg-amber-300/10' : 'border-white/10 bg-white/[0.04]'}`}>
                <span key={`${p.id}-${p.total}`} className="auction-flash absolute inset-0 pointer-events-none" />
                <RankBadge rank={p.rank} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(p.vendorId) }} />
                    <span className="truncate text-sm font-bold text-white">{p.vendor}</span>
                    {p.state === 'won' && <Trophy className="h-3.5 w-3.5 text-amber-300 shrink-0" />}
                  </div>
                  <div className="text-[10px] text-white/50 truncate">
                    {p.bidCount ? `${p.bidCount} bid${p.bidCount > 1 ? 's' : ''} · last ${ago(ts(p.lastBidAt), now)}`
                      : p.state === 'accepted' ? 'accepted · waiting for bidding' : 'no bid yet'}
                    {!p.hasLogin && ' · no portal login'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-outfit font-extrabold tabular-nums text-white text-base">
                    {p.total ? <Glide value={p.total} /> : '—'}
                  </div>
                  <div className={`text-[10px] font-bold tabular-nums ${p.rank === 1 ? 'text-amber-200' : 'text-white/45'}`}>
                    {p.total ? (p.rank === 1 ? `▼ ${below.toFixed(1)}% · leading` : `+${inr(gap)} to L1`) : ''}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {out.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {out.map(p => (
            <span key={p.id} title={p.note || p.stateLabel}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/55">
              {p.state === 'declined' ? <X className="h-3 w-3" /> : p.state === 'invited' ? <Hourglass className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {p.vendor} · {p.stateLabel.toLowerCase()}{p.note ? ` — ${p.note}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface FeedItem { key: string; at: number; icon: LucideIcon; tone: string; text: React.ReactNode; sub?: string }

/** What just happened, newest first — the auction's play-by-play. */
function ActivityFeed({ auction, now }: { auction: Auction; now: number }) {
  const items = useMemo(() => {
    const out: FeedItem[] = [];
    const bids = [...(auction.bids ?? [])].sort((a, b) => ts(a.at) - ts(b.at));
    const lastByVendor: Record<number, number> = {};
    let best = Infinity;
    bids.forEach(b => {
      const prev = lastByVendor[b.vendorId];
      const tookLead = b.total < best;
      best = Math.min(best, b.total);
      const drop = prev ? ((prev - b.total) / prev) * 100 : ((auction.ceiling - b.total) / auction.ceiling) * 100;
      out.push({
        key: `b${b.id}`, at: ts(b.at), icon: tookLead ? Crown : TrendingDown,
        tone: tookLead ? 'text-amber-300' : 'text-violet-300',
        text: <><b className="text-white">{b.vendor}</b> bid <b className="text-white tabular-nums">{inr(b.total)}</b>{tookLead ? <span className="text-amber-300"> · took L1</span> : <span className="text-white/60"> · L{b.rankAfter}</span>}</>,
        sub: `${prev ? `▼ ${drop.toFixed(1)}% on their last` : `▼ ${drop.toFixed(1)}% on opening`}${b.onBehalf ? ` · surrogate bid keyed in by ${b.placedBy}` : ''}`,
      });
      if (b.extendedBy) {
        out.push({
          key: `x${b.id}`, at: ts(b.at) + 1, icon: Timer, tone: 'text-amber-300',
          text: <><b className="text-amber-200">Time extended</b> — a bid with {b.secondsLeft}s left added <b className="text-white">+{b.extendedBy} min</b> to the clock</>,
        });
      }
      lastByVendor[b.vendorId] = b.total;
    });
    if (auction.state !== 'scheduled' && auction.state !== 'draft' && ts(auction.startAt)) {
      out.push({
        key: 'open', at: ts(auction.startAt), icon: Play, tone: 'text-emerald-300',
        text: <><b className="text-white">{auction.openedBy === 'ready' ? 'Bidding opened automatically' : auction.openedBy === 'buyer' ? 'Bidding opened early' : 'Bidding opened'}</b> to {auction.acceptedCount ?? 0} vendors</>,
        sub: auction.openedBy === 'ready' ? 'every invited vendor was ready' : auction.openedBy === 'buyer' ? 'by the buyer' : 'at the scheduled time',
      });
    }
    if (auction.closedAt) {
      out.push({ key: 'close', at: ts(auction.closedAt), icon: Gavel, tone: 'text-white', text: <><b className="text-white">Bidding closed</b>{auction.leader ? <> · L1 {auction.leader}</> : ''}</> });
    }
    if (auction.awardedAt) {
      out.push({ key: 'award', at: ts(auction.awardedAt), icon: Trophy, tone: 'text-amber-300', text: <><b className="text-amber-200">Awarded</b> to {auction.winner} at {inr(auction.awardedTotal)}</>, sub: auction.awardedBy ? `by ${auction.awardedBy}` : '' });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 40);
  }, [auction]);
  if (!items.length) {
    return <p className="text-xs text-white/50 py-8 text-center">The play-by-play appears here as the bids come in.</p>;
  }
  return (
    <ul className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1 auction-scroll">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <li key={item.key} className="auction-slide-in flex items-start gap-2.5 rounded-lg bg-white/[0.04] border border-white/5 px-3 py-2">
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${item.tone}`} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/80 leading-snug">{item.text}</p>
              {item.sub && <p className="text-[10px] text-white/45 mt-0.5">{item.sub}</p>}
            </div>
            <span className="text-[10px] text-white/40 whitespace-nowrap">{ago(item.at, now)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Falling paper, for the moment an auction is won. */
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.9, dur: 2.2 + Math.random() * 1.8,
    color: ['#A78BFA', '#F472B6', '#FBBF24', '#2DD4BF', '#60A5FA'][i % 5],
    rot: Math.random() * 360, w: 6 + Math.random() * 6,
  })), []);
  if (reducedMotion()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className="auction-confetti" style={{
          left: `${p.left}%`, background: p.color, width: p.w, height: p.w * 0.45,
          animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)`,
        }} />
      ))}
    </div>
  );
}

/** Spread a target total across the items in proportion to their current prices. */
function scalePrices(lines: AuctionLine[], prices: Record<string, number>, target: number): Record<string, number> {
  const current = lines.reduce((s, l) => s + l.qty * (prices[l.id] ?? l.ceilingPrice), 0);
  if (!current || target <= 0) return prices;
  const k = target / current;
  const next: Record<string, number> = {};
  // Whole rupees: nobody quotes ₹65,237.43 a laptop.
  lines.forEach(l => { next[l.id] = Math.max(1, Math.floor((prices[l.id] ?? l.ceilingPrice) * k)); });
  // Rounding down keeps the total at or under the target; put the slack back
  // on the biggest item so the bid lands as close to it as whole rupees allow.
  const total = lines.reduce((s, l) => s + l.qty * next[l.id], 0);
  const biggest = [...lines].sort((a, b) => b.qty * (next[b.id]) - a.qty * (next[a.id]))[0];
  if (biggest) {
    const add = Math.floor((target - total) / biggest.qty);
    if (add > 0) next[biggest.id] += add;
  }
  return next;
}

function ErrorNote({ text, onClose }: { text: string; onClose?: () => void }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-neg/30 bg-neg/10 px-3 py-2.5 text-xs text-neg">
      <AlertCircleIcon />
      <span className="flex-1">{text}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}
const AlertCircleIcon = () => <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />;

function OfflineNote() {
  return (
    <div className="p-10 text-center bg-surface border border-borderTheme rounded-2xl shadow-sm">
      <Radio className="h-9 w-9 mx-auto text-textFaint mb-3" />
      <p className="text-sm font-bold text-textPrimary">Live auctions run on the server</p>
      <p className="text-xs text-textSecondary mt-1 max-w-md mx-auto">
        You are signed in to the offline sample, where nothing is saved. Connect to the backend to launch
        an auction and have vendors bid against each other live.
      </p>
    </div>
  );
}

// ===========================================================================
// Buyer: launch panel
// ===========================================================================
interface VendorOption {
  id: number; name: string; city: string; onContract: boolean;
  /** The supplier's portal sign-in, when it has one; empty means the buyer bids for it. */
  login?: string; contact?: string;
}

const DEFAULT_TERMS =
  'Prices are for the full quantity, delivered to the requesting site, inclusive of freight and exclusive of GST. ' +
  'The lowest total at the close is L1. The buyer may award to L1 or cancel the event; placing a bid is a binding ' +
  'offer valid for 30 days.';

function Segmented<T extends number | string>({ value, options, onChange, fmt }: {
  value: T; options: T[]; onChange: (v: T) => void; fmt: (v: T) => string;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-borderTheme bg-secondary p-1 gap-1">
      {options.map(o => (
        <button key={String(o)} type="button" onClick={() => onChange(o)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${value === o ? 'bg-brand text-onbrand shadow-sm' : 'text-textSecondary hover:text-textPrimary'}`}>
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}

function LaunchPanel({ api, requests, initialRequestId, onClose, onLaunched }: {
  api: ApiFn; requests: AuctionableRequest[]; initialRequestId: string | null;
  onClose: () => void; onLaunched: (auction: Auction, request: AuctionableRequest | null) => void;
}) {
  const eligible = requests.filter(r => ['Approved', 'Sourcing'].includes(r.status) && r.totalCost > 0);
  const [requestId, setRequestId] = useState<string>(
    initialRequestId && eligible.some(r => r.id === initialRequestId) ? initialRequestId : (eligible[0]?.id ?? ''));
  const req = eligible.find(r => r.id === requestId) ?? null;
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [startIn, setStartIn] = useState<number>(2);
  const [duration, setDuration] = useState<number>(5);
  const [windowMin, setWindowMin] = useState<number>(1);
  const [extendBy, setExtendBy] = useState<number>(2);
  const [decrement, setDecrement] = useState<number>(0);
  const [visibility, setVisibility] = useState<'rank' | 'leader'>('rank');
  const [rebid, setRebid] = useState<number>(15);
  const [terms, setTerms] = useState<string>(DEFAULT_TERMS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      // Which suppliers can sign in to bid; an older backend only has the plain list.
      let res = await call<VendorOption[]>(api, '/api/smartspend/auction-vendors', { method: 'GET' });
      if (!res.ok) res = await call<VendorOption[]>(api, '/api/smartspend/vendors', { method: 'GET' });
      if (res.ok) setVendors(res.data);
      else setError(res.error);
    })();
  }, []);

  // A fresh pick of request resets what depends on it: the vendors already
  // quoting on it, and a decrement of half a percent of its value.
  useEffect(() => {
    if (!req) return;
    const quoting = new Set([...req.vendorBids.map(b => b.vendorName), req.vendor].map(n => (n || '').toLowerCase()));
    const suggested = vendors.filter(v => quoting.has(v.name.toLowerCase())).map(v => v.id);
    // Too few already quoting to make an auction: bring in the suppliers who
    // can sign in and bid for themselves.
    for (const v of vendors) {
      if (suggested.length >= 3) break;
      if (v.login && !suggested.includes(v.id)) suggested.push(v.id);
    }
    setPicked(suggested);
    const step = req.totalCost * 0.005;
    setDecrement(step >= 100 ? Math.round(step / 100) * 100 : Math.round(step));
  }, [requestId, vendors.length]);

  const opensAt = new Date(Date.now() + startIn * 60000);
  const closesAt = new Date(opensAt.getTime() + duration * 60000);
  const lines = req?.lineItems?.length ? req.lineItems
    : req ? [{ productName: req.productName, productQty: req.productQty, targetPrice: req.productQty ? req.totalCost / req.productQty : req.totalCost }] : [];

  const launch = async () => {
    if (!req) return;
    setBusy(true); setError('');
    const res = await call<{ auction: Auction; request: AuctionableRequest }>(api, '/api/smartspend/auctions/launch', {
      method: 'POST',
      body: JSON.stringify({
        requestId: req.id, vendorIds: picked, startInMinutes: startIn, durationMinutes: duration,
        extensionWindow: windowMin, extensionMinutes: extendBy, minDecrement: decrement,
        visibility, rebidMinutes: rebid, terms,
      }),
    });
    setBusy(false);
    if (res.ok) onLaunched(res.data.auction, res.data.request ?? null);
    else setError(res.error);
  };

  // Portalled to <body>: the scene around this animates `transform`, and a
  // transformed ancestor pins a fixed overlay inside itself instead of the page.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#140F2A]/60 backdrop-blur-sm p-4 animate-fadeIn"
         role="dialog" aria-modal="true" aria-label="Launch a reverse auction">
      <div className="w-full max-w-4xl my-6 rounded-3xl bg-surface border border-borderTheme shadow-2xl overflow-hidden">
        <div className="relative px-6 py-5 text-white" style={STAGE}>
          <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 border border-white/15">
              <Rocket className="h-5 w-5 text-pink-200" />
            </div>
            <div>
              <h3 className="font-outfit text-xl font-extrabold">Launch a live reverse auction</h3>
              <p className="text-xs text-white/65">Vendors accept the terms, then bid the price down against the clock. The lowest total at the close is L1.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
            {[
              { icon: Send, t: 'Invite', d: 'Vendors get the terms and accept' },
              { icon: Swords, t: 'Compete', d: 'Each bid re-ranks everyone live' },
              { icon: Trophy, t: 'Award', d: 'L1 lands on the request, PO follows' },
            ].map(s => (
              <div key={s.t} className="flex items-center gap-2 rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2">
                <s.icon className="h-4 w-4 text-violet-200 shrink-0" />
                <div><b className="block text-white">{s.t}</b><span className="text-white/55">{s.d}</span></div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-6">
          <ErrorNote text={error} onClose={() => setError('')} />
          {!eligible.length ? (
            <p className="text-sm text-textSecondary">
              Nothing is ready to auction. A request needs to be <b>Approved</b> or in <b>Sourcing</b>, with a target price on every item.
            </p>
          ) : (
            <>
              <section className="grid md:grid-cols-[1.4fr_1fr] gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Request</label>
                  <select value={requestId} onChange={e => setRequestId(e.target.value)}
                          className="w-full rounded-xl border border-borderTheme bg-secondary px-3 py-2.5 text-sm font-semibold text-textPrimary focus:outline-none focus:ring-2 focus:ring-brand/25">
                    {eligible.map(r => (
                      <option key={r.id} value={r.id}>{r.id} · {r.productName} · {inr(r.totalCost)}</option>
                    ))}
                  </select>
                  <div className="rounded-xl border border-borderTheme overflow-hidden">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-secondary/70 text-[10px] uppercase tracking-wider text-textFaint">
                        <th className="px-3 py-2 text-left font-bold">Item</th>
                        <th className="px-3 py-2 text-right font-bold">Qty</th>
                        <th className="px-3 py-2 text-right font-bold">Opening / unit</th>
                      </tr></thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={i} className="border-t border-borderTheme">
                            <td className="px-3 py-2 font-semibold text-textPrimary">{l.productName}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.productQty}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{inr(l.targetPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-2xl p-4 text-white flex flex-col justify-between" style={STAGE}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">Opening price</span>
                  <span className="font-outfit text-4xl font-black tabular-nums">{inr(req?.totalCost)}</span>
                  <span className="text-[11px] text-white/60">The request at its target prices. No bid may be above it — every rupee below is saved.</span>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Invite vendors · at least two</label>
                  <span className="text-[11px] text-textSecondary">{picked.length} selected</span>
                </div>
                {([
                  { key: 'login', title: 'Can sign in and bid themselves', note: 'Each accepts the terms and bids from their own supplier portal.', list: vendors.filter(v => v.login) },
                  { key: 'none', title: 'No portal login', note: 'You accept and key in their bids for them (phoned-in bids).', list: vendors.filter(v => !v.login) },
                ] as const).map(group => group.list.length > 0 && (
                  <div key={group.key} className="space-y-1.5">
                    {vendors.some(v => v.login) && (
                      <p className="text-[10px] text-textFaint"><b className="text-textSecondary">{group.title}</b> — {group.note}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {group.list.map(v => {
                        const on = picked.includes(v.id);
                        return (
                          <button key={v.id} type="button" title={v.login ? `Signs in as ${v.login}` : 'No portal login'}
                                  onClick={() => setPicked(prev => on ? prev.filter(id => id !== v.id) : [...prev, v.id])}
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${on
                                    ? 'border-brand bg-brand text-onbrand shadow-sm' : 'border-borderTheme bg-surface text-textSecondary hover:border-line2 hover:text-textPrimary'}`}>
                            {on ? <Check className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5 opacity-60" />}
                            {v.name}
                            {v.contact && <span className={`text-[10px] font-medium ${on ? 'text-onbrand/75' : 'text-textFaint'}`}>· {v.contact}</span>}
                            {v.onContract && <span className={`text-[9px] font-bold uppercase ${on ? 'text-onbrand/70' : 'text-pos'}`}>contract</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!vendors.length && <span className="text-xs text-textFaint">Loading suppliers…</span>}
              </section>

              <section className="grid sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Bidding opens in</label>
                  <Segmented value={startIn} options={[1, 2, 5, 10, 30]} onChange={setStartIn} fmt={v => `${v} min`} />
                  <p className="text-[11px] text-textFaint">Opens by itself the moment every vendor has answered and two have accepted — at the latest after this.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Runs for</label>
                  <Segmented value={duration} options={[3, 5, 10, 15, 30, 60]} onChange={setDuration} fmt={v => `${v} min`} />
                </div>
              </section>

              <section className="grid sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-borderTheme p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-textPrimary"><Timer className="h-4 w-4 text-gold" /> Time extension</div>
                  <label className="flex items-center justify-between gap-2 text-[11px] text-textSecondary">
                    <span>Extension Applied in last (minutes)</span>
                    <input type="number" min={0} value={windowMin} onChange={e => setWindowMin(Math.max(0, Number(e.target.value)))}
                           aria-label="Extension Applied in last (minutes)"
                           className="w-14 rounded-md border border-borderTheme bg-secondary px-1.5 py-0.5 text-xs font-bold text-textPrimary" />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-[11px] text-textSecondary">
                    <span>Extension Duration (minutes)</span>
                    <input type="number" min={0} value={extendBy} onChange={e => setExtendBy(Math.max(0, Number(e.target.value)))}
                           aria-label="Extension Duration (minutes)"
                           className="w-14 rounded-md border border-borderTheme bg-secondary px-1.5 py-0.5 text-xs font-bold text-textPrimary" />
                  </label>
                  <p className="text-[10px] text-textFaint leading-snug">
                    {windowMin > 0 ? `A bid in the last ${windowMin} min adds ${extendBy} min — and again each time another bid lands in the last ${windowMin} min.` : 'Off: the auction closes on time whatever happens.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-borderTheme p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-textPrimary"><TrendingDown className="h-4 w-4 text-pos" /> Minimum step</div>
                  <p className="text-[11px] text-textSecondary leading-snug">Each new bid must beat the vendor's own last by at least</p>
                  <div className="flex items-center gap-1 text-xs font-bold text-textPrimary">₹
                    <input type="number" min={0} value={decrement} onChange={e => setDecrement(Math.max(0, Number(e.target.value)))}
                           className="w-28 rounded-md border border-borderTheme bg-secondary px-2 py-1 text-xs font-bold text-textPrimary" />
                  </div>
                </div>
                <div className="rounded-2xl border border-borderTheme p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-textPrimary"><RotateCcw className="h-4 w-4 text-info" /> Bid again</div>
                  <p className="text-[11px] text-textSecondary leading-snug">Within 15 min of closing you may reopen it for a round of
                    <input type="number" min={1} value={rebid} onChange={e => setRebid(Math.max(1, Number(e.target.value)))}
                           className="mx-1 w-12 rounded-md border border-borderTheme bg-secondary px-1.5 py-0.5 text-xs font-bold text-textPrimary" />
                    min.</p>
                </div>
              </section>

              <section className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">What vendors see</label>
                <div className="grid sm:grid-cols-2 gap-3">
                  {([
                    { key: 'rank', icon: EyeOff, t: 'Rank only (sealed)', d: 'Each vendor sees only where they stand — L1, L2… Rival names and prices stay hidden.' },
                    { key: 'leader', icon: Eye, t: 'Rank + leading price', d: 'Vendors also see the lowest bid on the table, but never who placed it. Drives prices down faster.' },
                  ] as const).map(o => (
                    <button key={o.key} type="button" onClick={() => setVisibility(o.key)}
                            className={`text-left rounded-2xl border p-4 transition-all ${visibility === o.key ? 'border-brand ring-2 ring-brand/20 bg-brand/[0.04]' : 'border-borderTheme hover:border-line2'}`}>
                      <div className="flex items-center gap-2 text-xs font-bold text-textPrimary">
                        <o.icon className="h-4 w-4" /> {o.t}
                        {visibility === o.key && <CheckCircle2 className="h-4 w-4 text-pos ml-auto" />}
                      </div>
                      <p className="mt-1 text-[11px] text-textSecondary">{o.d}</p>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Terms vendors accept</label>
                <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3}
                          className="w-full rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-xs text-textPrimary focus:outline-none focus:ring-2 focus:ring-brand/25" />
              </section>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-borderTheme">
                <p className="text-[11px] text-textSecondary">
                  Invitations go to <b>{picked.length}</b> vendor{picked.length === 1 ? '' : 's'} now. Bidding opens as soon as
                  every vendor is ready — at the latest <b>{opensAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</b>{' '}
                  (then closing <b>{closesAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</b>) — and runs {duration} min
                  {windowMin > 0 ? ', plus any time extensions' : ''}.
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-borderTheme text-xs font-bold text-textSecondary hover:bg-secondary">Cancel</button>
                  <button onClick={launch} disabled={busy || picked.length < 2 || !req}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-onbrand text-xs font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110">
                    <Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send invitations'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ===========================================================================
// Buyer: the auction room
// ===========================================================================
function SurrogateBid({ api, auction, onDone }: { api: ApiFn; auction: Auction; onDone: (a: Auction) => void }) {
  const bidders = (auction.participants ?? []).filter(p => p.state === 'live');
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<number>(bidders[0]?.id ?? 0);
  const [total, setTotal] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!bidders.length) return null;
  const submit = async () => {
    const target = Number(total);
    if (!target) { setError('Enter the total the vendor quoted.'); return; }
    const base: Record<string, number> = {};
    auction.lines.forEach(l => { base[l.id] = l.ceilingPrice; });
    const prices = scalePrices(auction.lines, base, target);
    setBusy(true); setError('');
    const res = await call<{ auction: Auction }>(api, `/api/smartspend/auctions/${auction.id}/bid`, {
      method: 'POST', body: JSON.stringify({ participantId: who, prices, note: 'Quoted by phone / email' }),
    });
    setBusy(false);
    if (res.ok) { onDone(res.data.auction); setTotal(''); setOpen(false); } else setError(res.error);
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-left">
        <PhoneCall className="h-4 w-4 text-violet-200" />
        <span className="text-xs font-bold text-white flex-1">Record a phoned-in bid</span>
        <ChevronRight className={`h-4 w-4 text-white/50 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2 animate-fadeIn">
          <p className="text-[11px] text-white/55">For a vendor who quotes by phone or email. Logged in the audit trail under your name, spread across the items pro rata.</p>
          <div className="flex flex-wrap gap-2">
            <select value={who} onChange={e => setWho(Number(e.target.value))}
                    className="rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white">
              {bidders.map(p => <option key={p.id} value={p.id} className="text-black">{p.vendor}</option>)}
            </select>
            <input type="number" placeholder="Total quoted (₹)" value={total} onChange={e => setTotal(e.target.value)}
                   className="w-40 rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white placeholder:text-white/40" />
            <button onClick={submit} disabled={busy}
                    className="rounded-lg bg-white text-[#1b1537] px-3 py-1.5 text-xs font-bold disabled:opacity-50">
              {busy ? 'Recording…' : 'Record bid'}
            </button>
          </div>
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

function AuctionRoom({ api, reference, onBack, onRequestUpdated, onRaisePurchaseOrder }: {
  api: ApiFn; reference: string; onBack: () => void; onRequestUpdated: (r: AuctionableRequest) => void;
  /** Raise (or open) the purchase order for the awarded request; false when refused. */
  onRaisePurchaseOrder?: (requestId: string) => Promise<boolean>;
}) {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [poBusy, setPoBusy] = useState(false);
  const [burst, setBurst] = useState<string | null>(null);
  const prevExt = useRef<number | null>(null);
  const prevState = useRef<string | null>(null);
  const now = useServerNow(offset);

  const flash = (text: string) => { setBurst(text); setTimeout(() => setBurst(null), 2800); };
  const absorb = (a: Auction) => {
    setOffset(ts(a.serverNow) - Date.now());
    if (prevExt.current !== null && a.extensionCount > prevExt.current) {
      flash(`TIME EXTENDED · +${a.extensionMinutes}:00`);
    }
    prevExt.current = a.extensionCount;
    if (prevState.current === 'scheduled' && a.state === 'live') {
      flash(a.openedBy === 'ready' ? 'EVERY VENDOR READY · BIDDING IS OPEN' : 'BIDDING IS OPEN');
    }
    prevState.current = a.state;
    setAuction(a);
  };
  const load = async () => {
    const res = await call<{ auction: Auction }>(api, `/api/smartspend/auctions/${reference}`, { method: 'GET' });
    if (res.ok) { absorb(res.data.auction); setError(''); } else setError(res.error);
  };
  const state = auction?.state;
  useInterval(load, state === 'live' ? 1500 : state === 'scheduled' || !state ? 3000 : state === 'closed' ? 5000 : null);

  const act = async (action: 'start' | 'award' | 'bid_again' | 'cancel', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action); setError('');
    const res = await call<{ auction: Auction; request: AuctionableRequest }>(api, `/api/smartspend/auctions/${reference}/action`, {
      method: 'POST', body: JSON.stringify({ action }),
    });
    setBusy('');
    if (!res.ok) { setError(res.error); return; }
    absorb(res.data.auction);
    if (res.data.request) onRequestUpdated(res.data.request);
    if (action === 'award') setCelebrate(true);
  };
  // The award has already written the winner and the winning prices onto the
  // request; the purchase order is raised from exactly that, then the buyer is
  // taken to Track Request for the release and acknowledgment steps.
  const raisePurchaseOrder = async () => {
    if (!onRaisePurchaseOrder || !auction?.requestId) return;
    setPoBusy(true); setError('');
    const ok = await onRaisePurchaseOrder(auction.requestId);
    setPoBusy(false);
    if (!ok) setError('The purchase order could not be raised — see the message at the top of the screen.');
  };
  const respondFor = async (participantId: number, accept: boolean) => {
    setBusy(`respond-${participantId}`); setError('');
    const res = await call<{ auction: Auction }>(api, `/api/smartspend/auctions/${reference}/respond`, {
      method: 'POST', body: JSON.stringify({ participantId, accept, note: accept ? 'Accepted by phone' : 'Declined by phone' }),
    });
    setBusy('');
    if (res.ok) absorb(res.data.auction); else setError(res.error);
  };

  if (!auction) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-textSecondary hover:text-textPrimary"><ChevronLeft className="h-4 w-4" /> All auctions</button>
        <ErrorNote text={error} />
        {!error && <div className="h-72 rounded-3xl animate-pulse" style={STAGE} />}
      </div>
    );
  }

  const live = auction.state === 'live';
  const accepted = (auction.participants ?? []).filter(p => p.state === 'accepted').length;
  const best = auction.bestTotal || 0;
  const savedPct = auction.savingsPct || 0;
  const rebidLeft = auction.rebidUntil ? ts(auction.rebidUntil) - now : 0;

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-textSecondary hover:text-textPrimary">
          <ChevronLeft className="h-4 w-4" /> All auctions
        </button>
        <span className="text-textFaint">/</span>
        <span className="font-mono text-xs font-bold text-textPrimary">{auction.id}</span>
        <span className="text-[11px] text-textFaint">for {auction.requestId}</span>
        <StatePill state={auction.state} big />
        <div className="ml-auto flex flex-wrap gap-2">
          {auction.state === 'scheduled' && (
            <button onClick={() => act('start', 'Open bidding now? Vendors who have not accepted are dropped.')} disabled={!!busy || accepted < 2}
                    title={accepted < 2 ? 'Needs two accepted vendors' : undefined}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-onbrand shadow disabled:opacity-40 disabled:cursor-not-allowed">
              <Play className="h-4 w-4" /> {busy === 'start' ? 'Opening…' : 'Open bidding now'}
            </button>
          )}
          {auction.state === 'closed' && (
            <>
              <button onClick={() => act('award', `Award ${auction.id} to ${auction.leader} at ${inr(best)}? The request is repriced at their bid.`)} disabled={!!busy || !auction.leader}
                      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-[#2a1a00] shadow-lg disabled:opacity-40 auction-gold-btn">
                <Trophy className="h-4 w-4" /> {busy === 'award' ? 'Awarding…' : 'Award to L1'}
              </button>
              {rebidLeft > 0 && (
                <button onClick={() => act('bid_again', `Reopen bidding for another ${auction.rebidMinutes}-minute round?`)} disabled={!!busy}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-borderTheme bg-surface px-3 py-2 text-xs font-bold text-textPrimary hover:bg-secondary">
                  <RotateCcw className="h-4 w-4" /> Bid again <span className="text-textFaint font-semibold">({clock(rebidLeft)} left)</span>
                </button>
              )}
            </>
          )}
          {auction.state === 'awarded' && onRaisePurchaseOrder && (
            <button onClick={raisePurchaseOrder} disabled={poBusy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-onbrand shadow disabled:opacity-50">
              <Send className="h-4 w-4" /> {poBusy ? 'Raising…' : 'Generate Purchase Order'}
            </button>
          )}
          {!['awarded', 'cancelled'].includes(auction.state) && (
            <button onClick={() => act('cancel', `Cancel ${auction.id}? Every vendor's invitation is withdrawn.`)} disabled={!!busy}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-borderTheme bg-surface px-3 py-2 text-xs font-bold text-textSecondary hover:text-neg hover:border-neg/40">
              <Ban className="h-4 w-4" /> Cancel
            </button>
          )}
        </div>
      </div>
      <ErrorNote text={error} onClose={() => setError('')} />

      {/* ---- The stage ---- */}
      <div className="relative rounded-3xl p-6 md:p-8 text-white overflow-hidden shadow-2xl" style={STAGE}>
        {celebrate && <Confetti />}
        {burst !== null && (
          <div className="auction-burst pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-[#2a1a00] shadow-[0_0_40px_rgba(251,191,36,0.8)]">
            {burst}
          </div>
        )}
        <div className="flex flex-col lg:flex-row lg:items-center gap-8">
          <CountdownRing auction={auction} now={now} />
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">{auction.title}{auction.itemCount > 1 ? ` + ${auction.itemCount - 1} more` : ''}</p>
              {auction.state === 'awarded' ? (
                <h2 className="font-outfit text-3xl md:text-4xl font-black leading-tight">
                  <span className="text-amber-300">{auction.winner}</span> wins at <Glide value={auction.awardedTotal || 0} />
                </h2>
              ) : auction.state === 'scheduled' ? (
                <h2 className="font-outfit text-3xl md:text-4xl font-black leading-tight">Invitations out · opening {inr(auction.ceiling)}</h2>
              ) : auction.state === 'cancelled' ? (
                <h2 className="font-outfit text-3xl font-black leading-tight text-white/80">Cancelled{auction.cancelReason ? <span className="block text-sm font-semibold text-white/55 mt-1">{auction.cancelReason}</span> : null}</h2>
              ) : (
                <div className="flex items-end gap-4 flex-wrap">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Best bid</span>
                    <div className="font-outfit text-5xl md:text-6xl font-black tabular-nums leading-none bg-gradient-to-r from-white via-violet-100 to-pink-200 bg-clip-text text-transparent">
                      {best ? <Glide value={best} /> : '—'}
                    </div>
                  </div>
                  {auction.leader && (
                    <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-amber-300/15 border border-amber-300/40 px-3 py-1 text-xs font-bold text-amber-200">
                      <Crown className="h-3.5 w-3.5" /> L1 · {auction.leader}
                    </div>
                  )}
                </div>
              )}
            </div>
            {auction.state !== 'scheduled' && auction.state !== 'cancelled' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-white/60">
                  <span>Opening {inr(auction.ceiling)}</span>
                  <span className="font-bold text-emerald-300">
                    {best ? <>saved <Glide value={auction.savings || 0} /> · {savedPct.toFixed(1)}%</> : 'no bids yet'}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-violet-300"
                       style={{ width: `${Math.min(100, savedPct * 4)}%`, transition: 'width 0.8s cubic-bezier(0.22,1,0.36,1)' }} />
                </div>
              </div>
            )}
            {auction.state === 'scheduled' && (
              <p className="text-sm text-white/70">
                <b className="text-white">{accepted}</b> of {auction.participants?.length ?? 0} vendors accepted.
                {' '}It opens by itself the moment every invited vendor has answered and at least two are in — at the latest {hhmm(auction.startAt)}.
                {accepted < 2 ? ' With fewer than two by then, it is cancelled.' : ' Or open it now.'}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 lg:w-40">
            {[
              { icon: Zap, label: 'Bids', value: auction.bidCount ?? 0 },
              { icon: Users, label: 'Bidders', value: auction.acceptedCount ?? 0 },
              { icon: Flame, label: 'Extensions', value: auction.extensionCount },
            ].map(s => (
              <div key={s.label} className="rounded-2xl bg-white/[0.06] border border-white/10 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50"><s.icon className="h-3 w-3" />{s.label}</div>
                <div className="font-outfit text-2xl font-black tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Curve + leaderboard ---- */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
        <div className="rounded-3xl p-5 text-white shadow-xl" style={STAGE}>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-violet-200" />
            <h3 className="font-outfit font-extrabold">Price descent</h3>
            {live && <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300"><span className="auction-live-dot" /> live</span>}
          </div>
          <PriceDescentChart auction={auction} now={now} />
        </div>
        <div className="rounded-3xl p-5 text-white shadow-xl space-y-3" style={STAGE}>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-300" />
            <h3 className="font-outfit font-extrabold">Leaderboard</h3>
            <span className="ml-auto text-[10px] text-white/45">{auction.visibility === 'rank' ? 'vendors see rank only' : 'vendors see the leading price'}</span>
          </div>
          <Leaderboard auction={auction} now={now} />
          {auction.state === 'scheduled' && (auction.participants ?? []).some(p => p.state === 'invited') && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
              <p className="text-[11px] font-bold text-white/70">Waiting on an answer</p>
              {(auction.participants ?? []).filter(p => p.state === 'invited').map(p => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <Hourglass className="h-3.5 w-3.5 text-white/50" />
                  <span className="flex-1 truncate">{p.vendor}{p.hasLogin ? <span className="text-white/40"> · {p.login}</span> : <span className="text-white/40"> · no portal login</span>}</span>
                  <button onClick={() => respondFor(p.id, true)} disabled={!!busy}
                          title="The vendor accepted by phone or email"
                          className="rounded-md bg-emerald-400/90 px-2 py-0.5 text-[10px] font-bold text-[#062a1f]">Accept for them</button>
                  <button onClick={() => respondFor(p.id, false)} disabled={!!busy}
                          className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/70">Decline</button>
                </div>
              ))}
            </div>
          )}
          {live && <SurrogateBid api={api} auction={auction} onDone={absorb} />}
        </div>
      </div>

      {/* ---- Play-by-play + rules ---- */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
        <div className="rounded-3xl p-5 text-white shadow-xl" style={STAGE}>
          <div className="flex items-center gap-2 mb-3">
            <BellRing className="h-4 w-4 text-pink-200" />
            <h3 className="font-outfit font-extrabold">Live activity</h3>
          </div>
          <ActivityFeed auction={auction} now={now} />
        </div>
        <div className="rounded-3xl bg-surface border border-borderTheme p-5 shadow-sm space-y-3">
          <h3 className="font-outfit font-extrabold text-textPrimary flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-pos" /> Rules of this event</h3>
          <ul className="space-y-2 text-xs text-textSecondary">
            <li className="flex gap-2"><Clock className="h-4 w-4 text-textFaint shrink-0" />{auction.state === 'scheduled' ? 'Opens when every vendor is ready, at the latest ' : 'Opened '}{hhmm(auction.startAt)}, closes {hhmm(auction.endAt)}{auction.originalEndAt && auction.originalEndAt !== auction.endAt ? <> (was {hhmm(auction.originalEndAt)})</> : null}</li>
            <li className="flex gap-2"><Timer className="h-4 w-4 text-textFaint shrink-0" />{auction.extensionWindow ? <>Extension Applied in last {auction.extensionWindow} min · Extension Duration +{auction.extensionMinutes} min — again for every bid in that window</> : 'No time extension'}</li>
            <li className="flex gap-2"><TrendingDown className="h-4 w-4 text-textFaint shrink-0" />{auction.minDecrement ? <>Each rebid ≥ {inr(auction.minDecrement)} below the vendor's last</> : 'Each rebid must simply be lower'}</li>
            <li className="flex gap-2">{auction.visibility === 'rank' ? <EyeOff className="h-4 w-4 text-textFaint shrink-0" /> : <Eye className="h-4 w-4 text-textFaint shrink-0" />}{auction.visibility === 'rank' ? 'Sealed: vendors see their rank only' : 'Vendors see the leading price, never the name'}</li>
            <li className="flex gap-2"><Lock className="h-4 w-4 text-textFaint shrink-0" />Every bid is logged and cannot be edited</li>
          </ul>
          <div className="rounded-xl border border-borderTheme overflow-hidden">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-secondary/70 text-[9px] uppercase tracking-wider text-textFaint">
                <th className="px-2.5 py-1.5 text-left font-bold">Item</th>
                <th className="px-2.5 py-1.5 text-right font-bold">Qty</th>
                <th className="px-2.5 py-1.5 text-right font-bold">Opening</th>
              </tr></thead>
              <tbody>{auction.lines.map(l => (
                <tr key={l.id} className="border-t border-borderTheme">
                  <td className="px-2.5 py-1.5 font-semibold text-textPrimary">{l.productName}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{l.qty}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{inr(l.ceilingSubtotal)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>

      {celebrate && auction.state === 'awarded' && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#140F2A]/55 backdrop-blur-sm p-4 animate-fadeIn" onClick={() => setCelebrate(false)}>
          <div className="relative w-full max-w-md rounded-3xl p-8 text-center text-white shadow-2xl overflow-hidden" style={STAGE} onClick={e => e.stopPropagation()}>
            <Confetti />
            <div className="relative">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl auction-rank-gold mb-4"><Trophy className="h-10 w-10" /></div>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/55">Awarded</p>
              <h3 className="font-outfit text-3xl font-black mt-1">{auction.winner}</h3>
              <p className="font-outfit text-4xl font-black tabular-nums mt-2 bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">{inr(auction.awardedTotal)}</p>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 border border-emerald-300/40 px-3 py-1 text-xs font-bold text-emerald-200">
                <PartyPopper className="h-3.5 w-3.5" /> saved {inr(auction.savings)} · {savedPct.toFixed(1)}% below opening
              </p>
              <p className="mt-4 text-xs text-white/65">{auction.requestId} now names {auction.winner} at the winning prices. Next: raise the purchase order to {auction.winner}.</p>
              <div className="mt-5 flex justify-center gap-2">
                {onRaisePurchaseOrder && (
                  <button onClick={() => { setCelebrate(false); void raisePurchaseOrder(); }} disabled={poBusy}
                          className="rounded-xl bg-white px-5 py-2 text-xs font-black text-[#1b1537] disabled:opacity-50">
                    Generate Purchase Order
                  </button>
                )}
                <button onClick={() => setCelebrate(false)} className="rounded-xl border border-white/30 px-5 py-2 text-xs font-bold text-white">Done</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ===========================================================================
// Buyer: the desk
// ===========================================================================
export function AuctionDesk({ api, offline, requests, launchFor, onLaunchHandled, openAuction, onOpenHandled, onRequestUpdated, onRaisePurchaseOrder }: {
  api: ApiFn; offline: boolean; requests: AuctionableRequest[];
  launchFor: string | null; onLaunchHandled: () => void;
  openAuction: string | null; onOpenHandled: () => void;
  onRequestUpdated: (r: AuctionableRequest) => void;
  onRaisePurchaseOrder?: (requestId: string) => Promise<boolean>;
}) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(openAuction);
  const [launching, setLaunching] = useState<boolean>(!!launchFor);
  const [offset, setOffset] = useState(0);
  const now = useServerNow(offset, 1000);

  useEffect(() => { if (launchFor) setLaunching(true); }, [launchFor]);
  // Taken once: coming back to the desk later lands on the list, not on
  // whichever auction the sourcing queue opened last time.
  useEffect(() => { if (openAuction) { setSelected(openAuction); onOpenHandled(); } }, [openAuction]);

  const load = async () => {
    if (offline) return;
    const res = await call<Auction[]>(api, '/api/smartspend/auctions', { method: 'GET' });
    setLoaded(true);
    if (res.ok) {
      setAuctions(res.data); setError('');
      if (res.data[0]) setOffset(ts(res.data[0].serverNow) - Date.now());
    } else setError(res.error);
  };
  useInterval(load, offline || selected ? null : 4000);

  if (offline) return <OfflineNote />;
  if (selected) {
    return <AuctionRoom api={api} reference={selected} onBack={() => { setSelected(null); void load(); }}
                        onRequestUpdated={onRequestUpdated} onRaisePurchaseOrder={onRaisePurchaseOrder} />;
  }

  const live = auctions.filter(a => a.state === 'live');
  const upcoming = auctions.filter(a => a.state === 'scheduled');
  const toAward = auctions.filter(a => a.state === 'closed');
  const done = auctions.filter(a => ['awarded', 'cancelled'].includes(a.state));
  const saved = auctions.filter(a => a.state === 'awarded').reduce((s, a) => s + (a.savings || 0), 0);
  const eligible = requests.filter(r => ['Approved', 'Sourcing'].includes(r.status) && r.totalCost > 0);

  // Plain render functions, not components: this screen re-renders every
  // second for the clocks, and a component declared in here would be a new
  // type each time — every card remounted on every tick.
  const renderCard = (a: Auction) => {
    const target = a.state === 'live' ? ts(a.endAt) : a.state === 'scheduled' ? ts(a.startAt) : NaN;
    return (
      <button key={a.id} onClick={() => setSelected(a.id)}
              className={`group text-left rounded-3xl border p-5 transition-all hover:-translate-y-0.5 hover:shadow-xl ${a.state === 'live'
                ? 'text-white border-transparent shadow-lg' : 'bg-surface border-borderTheme shadow-sm'}`}
              style={a.state === 'live' ? STAGE : undefined}>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[11px] font-bold ${a.state === 'live' ? 'text-white/70' : 'text-textFaint'}`}>{a.id}</span>
          <StatePill state={a.state} />
          {!Number.isNaN(target) && (
            <span className={`ml-auto font-outfit text-lg font-black tabular-nums ${a.state === 'live' ? 'text-white' : 'text-textPrimary'}`}>{clock(target - now)}</span>
          )}
        </div>
        <h4 className={`mt-2 font-outfit text-lg font-extrabold truncate ${a.state === 'live' ? 'text-white' : 'text-textPrimary'}`}>{a.title}</h4>
        <p className={`text-[11px] ${a.state === 'live' ? 'text-white/55' : 'text-textFaint'}`}>{a.requestId} · {a.itemCount} item{a.itemCount > 1 ? 's' : ''} · {a.location}</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <span className={`text-[9px] font-bold uppercase tracking-wider ${a.state === 'live' ? 'text-white/50' : 'text-textFaint'}`}>{a.state === 'awarded' ? 'Awarded' : 'Best bid'}</span>
            <div className={`font-outfit text-2xl font-black tabular-nums ${a.state === 'live' ? 'text-white' : 'text-textPrimary'}`}>
              {a.state === 'awarded' ? inr(a.awardedTotal) : a.bestTotal ? inr(a.bestTotal) : '—'}
            </div>
            <span className={`text-[10px] ${a.state === 'live' ? 'text-white/50' : 'text-textFaint'}`}>from {inr(a.ceiling)}</span>
          </div>
          <div className="text-right">
            {(a.savingsPct || 0) > 0 && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black ${a.state === 'live' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-pos/10 text-pos'}`}>
                <TrendingDown className="h-3 w-3" /> {(a.savingsPct || 0).toFixed(1)}%
              </span>
            )}
            <div className={`mt-1 text-[11px] ${a.state === 'live' ? 'text-white/60' : 'text-textSecondary'}`}>
              {a.winner ? <><Trophy className="inline h-3 w-3 text-gold" /> {a.winner}</> : a.leader ? <><Crown className="inline h-3 w-3 text-gold" /> {a.leader}</> : `${a.acceptedCount ?? 0}/${a.participants?.length ?? 0} accepted`}
            </div>
            <div className={`text-[10px] ${a.state === 'live' ? 'text-white/45' : 'text-textFaint'}`}>{a.bidCount ?? 0} bids</div>
          </div>
        </div>
        <div className={`mt-3 flex items-center gap-1 text-[11px] font-bold ${a.state === 'live' ? 'text-pink-200' : 'text-brand'}`}>
          {a.state === 'live' ? 'Enter the auction room' : a.state === 'closed' ? 'Review and award' : 'Open'} <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </button>
    );
  };

  const renderSection = (title: string, Icon: LucideIcon, items: Auction[], tone: string) =>
    items.length ? (
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-outfit font-extrabold text-textPrimary"><Icon className={`h-4 w-4 ${tone}`} /> {title} <span className="text-textFaint font-semibold">({items.length})</span></h3>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{items.map(renderCard)}</div>
      </section>
    ) : null;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative rounded-3xl p-6 md:p-8 text-white overflow-hidden shadow-2xl" style={STAGE}>
        <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]">
              <Gavel className="h-3.5 w-3.5" /> Reverse auction desk
            </div>
            <h2 className="mt-3 font-outfit text-3xl md:text-4xl font-black leading-tight">Let vendors bid the price down — live.</h2>
            <p className="mt-2 text-sm text-white/65 max-w-xl">Invite suppliers, open the clock, and watch the price fall as every bid re-ranks the field. Late bids extend the close, vendors never see a rival's name, and the winner lands straight on the request.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 md:w-[360px]">
            {[
              { label: 'Live now', value: String(live.length), icon: Radio },
              { label: 'To award', value: String(toAward.length), icon: Gavel },
              { label: 'Saved', value: inrShort(saved), icon: Sparkles },
            ].map(s => (
              <div key={s.label} className="rounded-2xl bg-white/[0.07] border border-white/10 p-3">
                <s.icon className="h-4 w-4 text-violet-200" />
                <div className="mt-1 font-outfit text-2xl font-black tabular-nums">{s.value}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-3">
          <button onClick={() => setLaunching(true)} disabled={!eligible.length}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-black text-[#1b1537] shadow-lg hover:scale-[1.02] transition-transform disabled:opacity-50">
            <Rocket className="h-4 w-4" /> Launch an auction
          </button>
          <span className="text-[11px] text-white/55">{eligible.length} approved request{eligible.length === 1 ? '' : 's'} ready to take to market</span>
        </div>
      </div>

      <ErrorNote text={error} onClose={() => setError('')} />

      {loaded && !auctions.length && !error && (
        <div className="p-12 text-center bg-surface border border-borderTheme rounded-3xl shadow-sm">
          <Target className="h-9 w-9 mx-auto text-textFaint mb-3" />
          <p className="text-sm font-bold text-textPrimary">No auctions yet</p>
          <p className="text-xs text-textSecondary mt-1">Launch one from an approved request — it takes about ten seconds.</p>
        </div>
      )}
      {renderSection('Live now', Radio, live, 'text-neg')}
      {renderSection('Closed — waiting for your award', Gavel, toAward, 'text-gold')}
      {renderSection('Scheduled', Hourglass, upcoming, 'text-info')}
      {renderSection('Finished', Trophy, done, 'text-pos')}

      {launching && (
        <LaunchPanel api={api} requests={requests} initialRequestId={launchFor}
                     onClose={() => { setLaunching(false); onLaunchHandled(); }}
                     onLaunched={(a, r) => {
                       setLaunching(false); onLaunchHandled();
                       if (r) onRequestUpdated(r);
                       setSelected(a.id);
                     }} />
      )}
    </div>
  );
}

// ===========================================================================
// Vendor: invitations and the bidding console
// ===========================================================================
function VendorConsole({ api, reference, onBack }: { api: ApiFn; reference: string; onBack: () => void }) {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ text: string; tone: 'good' | 'bad' | 'info' } | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const prevState = useRef<string | null>(null);
  const prevRank = useRef<number | null>(null);
  const prevExt = useRef<number | null>(null);
  // The total the price boxes were last filled from. A bid placed from
  // another window (or keyed in by the buyer) refills them; a poll that
  // brings nothing new leaves whatever the vendor is typing alone.
  const seededTotal = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);
  const now = useServerNow(offset);

  const say = (text: string, tone: 'good' | 'bad' | 'info') => {
    setToast({ text, tone });
    setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 4200);
  };
  const absorb = (a: Auction, mine = false) => {
    setOffset(ts(a.serverNow) - Date.now());
    const rank = a.me?.rank ?? 0;
    if (prevRank.current !== null && rank && prevRank.current && rank !== prevRank.current && !mine) {
      if (rank > prevRank.current) say(`You've been outbid — you're now L${rank}.`, 'bad');
      else say(`You moved up to L${rank}.`, 'good');
    }
    prevRank.current = rank || prevRank.current;
    if (prevExt.current !== null && a.extensionCount > prevExt.current) {
      setBurst(`TIME EXTENDED · +${a.extensionMinutes}:00`); setTimeout(() => setBurst(null), 2800);
    }
    prevExt.current = a.extensionCount;
    if (prevState.current === 'scheduled' && a.state === 'live' && a.me?.state === 'live') {
      say(a.openedBy === 'ready' ? 'Every vendor is ready — bidding is open. Place your bid!' : 'Bidding is open — place your bid!', 'good');
    }
    prevState.current = a.state;
    const myTotal = a.me?.total ?? 0;
    if (seededTotal.current === null || mine || myTotal !== seededTotal.current) {
      const base: Record<string, number> = {};
      a.lines.forEach(l => { base[l.id] = a.me?.prices?.[String(l.id)] ?? l.ceilingPrice; });
      setPrices(base);
      setTouched(false);
      seededTotal.current = myTotal;
    }
    setAuction(a);
  };
  const load = async () => {
    const res = await call<{ auction: Auction }>(api, `/api/smartspend/auctions/${reference}`, { method: 'GET' });
    if (res.ok) { absorb(res.data.auction); setError(''); } else setError(res.error);
  };
  const st = auction?.state;
  useInterval(load, st === 'live' ? 1500 : !st || st === 'scheduled' ? 3000 : st === 'closed' ? 5000 : null);

  const respond = async (accept: boolean) => {
    setBusy(true); setError('');
    const res = await call<{ auction: Auction }>(api, `/api/smartspend/auctions/${reference}/respond`, {
      method: 'POST', body: JSON.stringify({ accept, note: accept ? '' : declineNote }),
    });
    setBusy(false);
    if (res.ok) {
      const a = res.data.auction;
      absorb(a);
      say(!accept ? 'Invitation declined.'
        : a.state === 'live' ? 'Every vendor is ready — bidding is open. Place your bid!'
          : `You're in. Bidding opens as soon as every vendor is ready — at the latest ${hhmm(a.startAt)}.`,
        accept ? 'good' : 'info');
    }
    else setError(res.error);
  };

  if (!auction) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-textSecondary hover:text-textPrimary"><ChevronLeft className="h-4 w-4" /> All invitations</button>
        <ErrorNote text={error} />
        {!error && <div className="h-72 rounded-3xl animate-pulse" style={STAGE} />}
      </div>
    );
  }

  const me = auction.me!;
  const lines = auction.lines;
  const draftTotal = Math.round(lines.reduce((s, l) => s + l.qty * (prices[l.id] || 0), 0) * 100) / 100;
  const nextMax = auction.nextMaxBid ?? auction.ceiling;
  const tooHigh = draftTotal > nextMax + 0.001;
  const lastTotal = me.total || auction.ceiling;
  const dropPct = lastTotal ? ((lastTotal - draftTotal) / lastTotal) * 100 : 0;
  const leader = auction.leaderTotal;
  const bidding = auction.state === 'live' && me.state === 'live';
  const remaining = ts(auction.endAt) - now;
  const softClose = auction.state === 'live' && auction.extensionWindow > 0 && remaining < auction.extensionWindow * 60000;

  const nudge = (pct: number) => {
    const base = Math.min(me.total || auction.ceiling, nextMax);
    const target = Math.floor(Math.min(nextMax, base * (1 - pct / 100)));
    setTouched(true);
    setPrices(p => scalePrices(lines, p, target));
  };
  const beatLeader = () => {
    if (!leader) return;
    const target = Math.floor(Math.min(nextMax, leader - Math.max(auction.minDecrement || 0, 1)));
    setTouched(true);
    setPrices(p => scalePrices(lines, p, target));
  };
  const placeBid = async () => {
    if (tooHigh) { setError(`Your bid has to be ${inr(nextMax)} or less.`); return; }
    if (dropPct > 15 && !window.confirm(`That is ${dropPct.toFixed(1)}% below ${me.total ? 'your last bid' : 'the opening price'}. Place a bid of ${inr(draftTotal)}?`)) return;
    setBusy(true); setError('');
    const res = await call<{ auction: Auction }>(api, `/api/smartspend/auctions/${reference}/bid`, {
      method: 'POST', body: JSON.stringify({ prices }),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    const a = res.data.auction;
    absorb(a, true);
    const r = a.me?.rank ?? 0;
    say(r === 1 ? `Bid placed — you're leading at ${inr(a.me?.total)}!` : `Bid placed at ${inr(a.me?.total)} — you're L${r}.`, r === 1 ? 'good' : 'info');
  };

  const rank = me.rank;
  const rankLine = !bidding && auction.state === 'scheduled' ? null
    : rank === 1 ? "You're leading"
      : rank ? (leader != null ? `${inr((me.total || 0) - leader)} behind the leader` : 'Undercut to climb')
        : 'Place your first bid to get ranked';

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-textSecondary hover:text-textPrimary"><ChevronLeft className="h-4 w-4" /> All invitations</button>
        <span className="text-textFaint">/</span>
        <span className="font-mono text-xs font-bold text-textPrimary">{auction.id}</span>
        <StatePill state={auction.state} big />
        <span className="ml-auto text-[11px] text-textSecondary">Buyer: {auction.buyer} · deliver to {auction.location}{auction.neededBy ? ` by ${auction.neededBy}` : ''}</span>
      </div>
      <ErrorNote text={error} onClose={() => setError('')} />

      {toast && createPortal(
        <div className={`fixed right-6 top-6 z-50 auction-slide-in flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold shadow-2xl ${toast.tone === 'good'
          ? 'bg-emerald-500 text-white' : toast.tone === 'bad' ? 'bg-rose-500 text-white' : 'bg-[#1b1537] text-white'}`}>
          {toast.tone === 'good' ? <Crown className="h-4 w-4" /> : toast.tone === 'bad' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          {toast.text}
        </div>,
        document.body,
      )}

      {/* ---- The stage ---- */}
      <div className="relative rounded-3xl p-6 md:p-8 text-white overflow-hidden shadow-2xl" style={STAGE}>
        {me.state === 'won' && <Confetti />}
        {burst !== null && (
          <div className="auction-burst pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-[#2a1a00] shadow-[0_0_40px_rgba(251,191,36,0.8)]">
            {burst}
          </div>
        )}
        <div className="flex flex-col md:flex-row md:items-center gap-8">
          <CountdownRing auction={auction} now={now} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">{auction.title}{auction.itemCount > 1 ? ` + ${auction.itemCount - 1} more` : ''} · {me.vendor}</p>
            {me.state === 'won' ? (
              <h2 className="font-outfit text-4xl font-black mt-1">You won! <span className="text-amber-300">{inr(me.total)}</span></h2>
            ) : me.state === 'lost' ? (
              <h2 className="font-outfit text-3xl font-black mt-1 text-white/85">Awarded to another vendor</h2>
            ) : me.state === 'invited' ? (
              <h2 className="font-outfit text-3xl md:text-4xl font-black mt-1">You're invited to bid</h2>
            ) : me.state === 'accepted' ? (
              <h2 className="font-outfit text-3xl md:text-4xl font-black mt-1">You're in — get ready</h2>
            ) : me.state === 'declined' || me.state === 'cancelled' ? (
              <h2 className="font-outfit text-3xl font-black mt-1 text-white/75">{me.state === 'declined' ? 'You declined this invitation' : 'This invitation was withdrawn'}</h2>
            ) : (
              <h2 className="font-outfit text-3xl md:text-4xl font-black mt-1">{rankLine}</h2>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">Opening price</div>
                <div className="font-outfit text-xl font-black tabular-nums">{inr(auction.ceiling)}</div>
              </div>
              {me.total > 0 && (
                <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">Your bid</div>
                  <div className="font-outfit text-xl font-black tabular-nums"><Glide value={me.total} /></div>
                </div>
              )}
              {leader != null && leader > 0 && (
                <div className="rounded-2xl bg-amber-300/10 border border-amber-300/30 px-4 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200/80">Leading price</div>
                  <div className="font-outfit text-xl font-black tabular-nums text-amber-200"><Glide value={leader} /></div>
                </div>
              )}
              <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">Competing</div>
                <div className="font-outfit text-xl font-black tabular-nums flex items-center gap-1.5"><Users className="h-4 w-4 text-white/60" />{auction.competitors ?? 0} other{(auction.competitors ?? 0) === 1 ? '' : 's'}</div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-white/50 flex items-center gap-1.5"><EyeOff className="h-3.5 w-3.5" /> Rival names are never shown. {auction.visibility === 'rank' ? 'You see your rank only.' : 'You see the leading price, not who bid it.'}</p>
          </div>
          {(bidding || ['closed', 'won', 'lost'].includes(me.state)) && (
            <div className="flex flex-col items-center gap-2">
              <span key={rank} className="auction-pop"><RankBadge rank={rank} size="xl" /></span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">your rank</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Invitation ---- */}
      {me.state === 'invited' && auction.state === 'scheduled' && (
        <div className="rounded-3xl bg-surface border border-borderTheme p-6 shadow-sm space-y-4">
          <h3 className="font-outfit text-lg font-extrabold text-textPrimary flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-pos" /> Terms of the event</h3>
          <p className="text-xs text-textSecondary whitespace-pre-line rounded-xl bg-secondary/60 border border-borderTheme p-3">{auction.terms || 'No special terms.'}</p>
          <ul className="grid sm:grid-cols-3 gap-2 text-[11px] text-textSecondary">
            <li className="rounded-xl border border-borderTheme p-3"><Clock className="h-4 w-4 text-textFaint mb-1" />Opens as soon as every vendor is ready — at the latest {hhmm(auction.startAt)} — and runs {auction.durationMinutes} min</li>
            <li className="rounded-xl border border-borderTheme p-3"><Timer className="h-4 w-4 text-textFaint mb-1" />{auction.extensionWindow ? `Time extension: any bid in the last ${auction.extensionWindow} min adds ${auction.extensionMinutes} min — each time it happens` : 'No time extension — it closes on the clock'}</li>
            <li className="rounded-xl border border-borderTheme p-3"><TrendingDown className="h-4 w-4 text-textFaint mb-1" />{auction.minDecrement ? `Each rebid at least ${inr(auction.minDecrement)} lower` : 'Each rebid must be lower'}</li>
          </ul>
          <label className="flex items-center gap-2 text-xs font-semibold text-textPrimary cursor-pointer">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="h-4 w-4 accent-[#6356A8]" />
            I have read the terms and will honour any bid I place.
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => respond(true)} disabled={!agree || busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-onbrand shadow disabled:opacity-40">
              <Check className="h-4 w-4" /> Accept &amp; join
            </button>
            <button onClick={() => setShowDecline(!showDecline)} className="rounded-xl border border-borderTheme px-4 py-2.5 text-xs font-bold text-textSecondary hover:bg-secondary">Decline</button>
          </div>
          {showDecline && (
            <div className="flex flex-wrap gap-2 animate-fadeIn">
              <input value={declineNote} onChange={e => setDeclineNote(e.target.value)} placeholder="Reason (optional) — e.g. stock not available"
                     className="flex-1 min-w-[240px] rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-xs" />
              <button onClick={() => respond(false)} disabled={busy} className="rounded-xl bg-neg px-4 py-2 text-xs font-bold text-white">Confirm decline</button>
            </div>
          )}
        </div>
      )}

      {/* ---- Bid composer ---- */}
      {(bidding || (me.state === 'accepted' && auction.state === 'scheduled')) && (
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5">
          <div className={`rounded-3xl bg-surface border p-6 shadow-sm space-y-4 ${softClose ? 'border-gold/60 ring-4 ring-gold/10' : 'border-borderTheme'}`}>
            <div className="flex items-center gap-2">
              <Gavel className="h-5 w-5 text-brand" />
              <h3 className="font-outfit text-lg font-extrabold text-textPrimary">Your bid</h3>
              {softClose && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gold/15 border border-gold/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-gold"><Timer className="h-3 w-3" /> extension window — a bid now adds {auction.extensionMinutes} min</span>}
            </div>
            {!bidding && <p className="text-xs text-textSecondary rounded-xl bg-info/5 border border-info/20 px-3 py-2">Bidding opens the moment every invited vendor is ready — at the latest <b>{hhmm(auction.startAt)}</b>. You can prepare your prices now.</p>}
            <div className="rounded-2xl border border-borderTheme overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="bg-secondary/70 text-[10px] uppercase tracking-wider text-textFaint">
                  <th className="px-3 py-2 text-left font-bold">Item</th>
                  <th className="px-3 py-2 text-right font-bold">Qty</th>
                  <th className="px-3 py-2 text-right font-bold">Opening / unit</th>
                  <th className="px-3 py-2 text-right font-bold">Your unit price</th>
                  <th className="px-3 py-2 text-right font-bold">Subtotal</th>
                </tr></thead>
                <tbody>{lines.map(l => (
                  <tr key={l.id} className="border-t border-borderTheme">
                    <td className="px-3 py-2 font-semibold text-textPrimary">{l.productName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.qty} {l.uom}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-textFaint">{inr(l.ceilingPrice)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1 rounded-lg border border-borderTheme bg-secondary px-2 focus-within:ring-2 focus-within:ring-brand/25">
                        <span className="text-textFaint">₹</span>
                        <input type="number" min={0} step="0.01" value={prices[l.id] ?? ''}
                               onChange={e => { setTouched(true); setPrices(p => ({ ...p, [l.id]: Number(e.target.value) })); }}
                               className="w-28 bg-transparent py-1.5 text-right font-bold tabular-nums text-textPrimary focus:outline-none" />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{inr(l.qty * (prices[l.id] || 0))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint mr-1">Quick</span>
              {[0.5, 1, 2, 5].map(p => (
                <button key={p} onClick={() => nudge(p)} className="rounded-lg border border-borderTheme bg-surface px-2.5 py-1 text-[11px] font-bold text-textPrimary hover:border-brand hover:text-brand">−{p}%</button>
              ))}
              <button onClick={() => { setTouched(true); setPrices(p => scalePrices(lines, p, Math.floor(nextMax))); }}
                      className="rounded-lg border border-borderTheme bg-surface px-2.5 py-1 text-[11px] font-bold text-textPrimary hover:border-brand hover:text-brand">Minimum step</button>
              {leader != null && leader > 0 && rank !== 1 && (
                <button onClick={beatLeader} className="inline-flex items-center gap-1 rounded-lg bg-amber-400/15 border border-amber-400/40 px-2.5 py-1 text-[11px] font-black text-gold hover:bg-amber-400/25">
                  <Crown className="h-3 w-3" /> Beat the leader
                </button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl p-4 text-white" style={STAGE}>
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Bid total</div>
                <div className={`font-outfit text-4xl font-black tabular-nums ${tooHigh && touched ? 'text-rose-300' : ''}`}>{inr(draftTotal)}</div>
                <div className="text-[11px] text-white/60">
                  {tooHigh && touched ? <span className="text-rose-300 font-bold">Must be {inr(nextMax)} or less</span>
                    : tooHigh ? <>{me.total ? 'Your last bid' : 'The opening price'} · the next has to be <b className="text-white">{inr(nextMax)}</b> or less — pick a quick step or edit a price</>
                      : <>▼ {dropPct.toFixed(2)}% on {me.total ? 'your last bid' : 'the opening price'} · max allowed {inr(nextMax)}</>}
                </div>
              </div>
              <button onClick={placeBid} disabled={!bidding || busy || tooHigh || draftTotal <= 0}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-black text-[#1b1537] shadow-xl transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100">
                <Gavel className="h-5 w-5" /> {busy ? 'Placing…' : 'Place bid'}
              </button>
            </div>
          </div>
          <div className="rounded-3xl p-5 text-white shadow-xl space-y-3" style={STAGE}>
            <h3 className="font-outfit font-extrabold flex items-center gap-2"><Activity className="h-4 w-4 text-violet-200" /> Your bids</h3>
            {(auction.myBids ?? []).length ? (
              <ul className="space-y-1.5 max-h-[360px] overflow-y-auto auction-scroll pr-1">
                {[...(auction.myBids ?? [])].reverse().map((b, i) => (
                  <li key={`${b.at}-${i}`} className="auction-slide-in flex items-center gap-3 rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2">
                    <RankBadge rank={b.rankAfter} size="sm" />
                    <div className="flex-1">
                      <div className="font-bold tabular-nums">{inr(b.total)}</div>
                      <div className="text-[10px] text-white/45">{ago(ts(b.at), now)}{b.extendedBy ? ` · extended the close +${b.extendedBy}m` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-white/50 py-8 text-center">Your bids and the rank each one earned will list here.</p>}
          </div>
        </div>
      )}

      {me.state === 'closed' && (
        <div className="rounded-3xl bg-surface border border-borderTheme p-6 shadow-sm text-sm text-textSecondary flex items-center gap-3">
          <Hourglass className="h-5 w-5 text-gold" /> Bidding has closed. Your final bid was <b className="text-textPrimary">{inr(me.total)}</b>{rank ? <> — ranked <b className="text-textPrimary">L{rank}</b></> : null}. The buyer is reviewing the result.
        </div>
      )}
      {me.state === 'won' && (
        <div className="rounded-3xl bg-pos/10 border border-pos/30 p-6 text-sm text-textPrimary flex items-center gap-3">
          <Trophy className="h-6 w-6 text-gold" /> <span><b>Congratulations.</b> {auction.id} was awarded to you at <b>{inr(me.total)}</b>. The purchase order follows — it will appear under Purchase Orders.</span>
        </div>
      )}
      {me.state === 'lost' && (
        <div className="rounded-3xl bg-surface border border-borderTheme p-6 text-sm text-textSecondary flex items-center gap-3">
          <Info className="h-5 w-5 text-textFaint" /> The buyer awarded {auction.id} to another vendor. Thank you for bidding — your best was {inr(me.total)}.
        </div>
      )}
    </div>
  );
}

export function VendorAuctions({ api, offline }: { api: ApiFn; offline: boolean }) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const now = useServerNow(offset, 1000);
  const load = async () => {
    if (offline) return;
    const res = await call<Auction[]>(api, '/api/smartspend/auctions', { method: 'GET' });
    setLoaded(true);
    if (res.ok) { setAuctions(res.data); setError(''); if (res.data[0]) setOffset(ts(res.data[0].serverNow) - Date.now()); }
    else setError(res.error);
  };
  useInterval(load, offline || selected ? null : 4000);

  if (offline) return <OfflineNote />;
  if (selected) return <VendorConsole api={api} reference={selected} onBack={() => { setSelected(null); void load(); }} />;

  const needsAnswer = auctions.filter(a => a.me?.state === 'invited' && a.state === 'scheduled');
  const liveNow = auctions.filter(a => a.state === 'live' && a.me?.state === 'live');
  return (
    <div className="space-y-5">
      <div className="relative rounded-3xl p-6 text-white overflow-hidden shadow-xl" style={STAGE}>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]"><Gavel className="h-3.5 w-3.5" /> Live auctions</div>
            <h2 className="mt-2 font-outfit text-2xl md:text-3xl font-black">Win business in real time.</h2>
            <p className="text-xs text-white/65 mt-1 max-w-lg">Accept an invitation, then undercut the field before the clock runs out. You always see your own rank; rival names are never shown.</p>
          </div>
          <div className="flex gap-2">
            <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3 text-center"><div className="font-outfit text-2xl font-black">{liveNow.length}</div><div className="text-[10px] font-bold uppercase tracking-wider text-white/50">Live</div></div>
            <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3 text-center"><div className="font-outfit text-2xl font-black">{needsAnswer.length}</div><div className="text-[10px] font-bold uppercase tracking-wider text-white/50">To answer</div></div>
          </div>
        </div>
      </div>
      <ErrorNote text={error} onClose={() => setError('')} />
      {loaded && !auctions.length && !error && (
        <div className="p-12 text-center bg-surface border border-borderTheme rounded-3xl shadow-sm">
          <Gavel className="h-9 w-9 mx-auto text-textFaint mb-3" />
          <p className="text-sm font-bold text-textPrimary">No auction invitations yet</p>
          <p className="text-xs text-textSecondary mt-1">When a buyer invites you to a reverse auction it appears here.</p>
        </div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {auctions.map(a => {
          const me = a.me!;
          const target = a.state === 'live' ? ts(a.endAt) : a.state === 'scheduled' ? ts(a.startAt) : NaN;
          const hot = a.state === 'live' && me.state === 'live';
          const cta = me.state === 'invited' && a.state === 'scheduled' ? 'Review the invitation'
            : hot ? 'Bid now' : me.state === 'accepted' ? 'Get ready' : 'View';
          return (
            <button key={a.id} onClick={() => setSelected(a.id)}
                    className={`group text-left rounded-3xl border p-5 transition-all hover:-translate-y-0.5 hover:shadow-xl ${hot ? 'text-white border-transparent shadow-lg' : 'bg-surface border-borderTheme shadow-sm'}`}
                    style={hot ? STAGE : undefined}>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[11px] font-bold ${hot ? 'text-white/70' : 'text-textFaint'}`}>{a.id}</span>
                <StatePill state={a.state} />
                {!Number.isNaN(target) && <span className={`ml-auto font-outfit text-lg font-black tabular-nums ${hot ? 'text-white' : 'text-textPrimary'}`}>{clock(target - now)}</span>}
              </div>
              <h4 className={`mt-2 font-outfit text-lg font-extrabold truncate ${hot ? 'text-white' : 'text-textPrimary'}`}>{a.title}</h4>
              <p className={`text-[11px] ${hot ? 'text-white/55' : 'text-textFaint'}`}>{a.itemCount} item{a.itemCount > 1 ? 's' : ''} · opening {inr(a.ceiling)}</p>
              <div className="mt-3 flex items-center gap-3">
                {(hot || ['closed', 'won', 'lost'].includes(me.state)) && <RankBadge rank={me.rank} size="md" />}
                <div className="flex-1">
                  <div className={`text-[11px] font-bold ${hot ? 'text-white/80' : 'text-textSecondary'}`}>{me.stateLabel}</div>
                  {me.total > 0 && <div className={`text-xs tabular-nums ${hot ? 'text-white/60' : 'text-textFaint'}`}>your bid {inr(me.total)}</div>}
                </div>
                {me.state === 'won' && <Trophy className="h-5 w-5 text-gold" />}
              </div>
              <div className={`mt-3 flex items-center gap-1 text-[11px] font-bold ${hot ? 'text-pink-200' : 'text-brand'}`}>
                {cta} <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
