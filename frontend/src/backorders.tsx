/**
 * Backorders — Odoo's concept on the portal (`/api/smartspend/receipts`,
 * `/api/smartspend/backorders`).
 *
 * A delivery that arrives short asks, as Odoo does, whether the rest stays open
 * as a backorder or is closed. Open backorders are followed up on the board:
 * each order's shipments as a chain, what is still owed and its value, how
 * long it has been open, and whether it is past the vendor's committed date.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, PackageCheck, PackageOpen, Truck, X, XCircle,
} from 'lucide-react';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export interface ReceiptLine { id: number | null; poLineId: number; product: string; demand: number; done: number; price: number }
export interface Receipt {
  id: number | null; name: string; state: 'waiting' | 'done' | 'cancel'; isBackorder: boolean; backorderOf: string;
  noBackorder?: boolean; scheduledDate: string; doneAt?: string; createdAt?: string; shippingMethod?: string;
  lines: ReceiptLine[]; qtyPending?: number; amountPending?: number;
}
export interface OrderLine { poLineId: number; product: string; ordered: number; received: number; price: number }
export interface ReceiptInfo {
  requestId: string; order: string; vendor?: string; lines: OrderLine[];
  open: Receipt | null; receipts: Receipt[]; canReceive?: boolean;
}
export interface Shortage { product: string; demand: number; done: number; missing: number }

interface BoardRow extends Receipt {
  requestId: string; order: string; vendor: string; daysOpen: number; overdue: boolean;
  orderLines: OrderLine[];
  chain: { name: string; state: string; isBackorder: boolean; noBackorder: boolean; qty: number; at: string }[];
}

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const day = (iso: string) => iso ? new Date(iso.length > 10 ? iso.replace(' ', 'T') + 'Z' : `${iso}T00:00:00`)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

// ---------------------------------------------------------------------------
// "Create Backorder?" — the question Odoo asks on a short delivery.
// ---------------------------------------------------------------------------
export function BackorderDialog({ order, shortages, busy, onChoose, onCancel }: {
  order: string; shortages: Shortage[]; busy: boolean;
  onChoose: (choice: 'create' | 'none') => void; onCancel: () => void;
}) {
  const missing = shortages.reduce((s, x) => s + x.missing, 0);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-borderTheme shadow-2xl">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-borderTheme">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><PackageOpen className="h-5 w-5" /></span>
          <div className="flex-1">
            <h3 className="font-outfit font-extrabold text-lg text-textPrimary">Create Backorder?</h3>
            <p className="text-[11px] text-textSecondary mt-0.5">You have processed less products than the initial demand on {order}.</p>
          </div>
          <button onClick={onCancel} disabled={busy} className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl border border-borderTheme overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                <th className="text-left font-bold px-3 py-2">Product</th><th className="text-right font-bold px-3 py-2">Expected</th>
                <th className="text-right font-bold px-3 py-2">Received</th><th className="text-right font-bold px-3 py-2 text-gold">Missing</th>
              </tr></thead>
              <tbody>{shortages.map(s => (
                <tr key={s.product} className="border-t border-borderTheme/60">
                  <td className="px-3 py-2 font-semibold text-textPrimary">{s.product}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-textSecondary">{s.demand}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-textSecondary">{s.done}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-gold">{s.missing}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-xl border border-brand/30 bg-brand/5 p-3">
              <p className="font-bold text-textPrimary inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-brand" />Create Backorder</p>
              <p className="text-textSecondary mt-1">The missing {missing} unit{missing === 1 ? '' : 's'} stay open as a new receipt, waiting for the next delivery.</p>
            </div>
            <div className="rounded-xl border border-borderTheme p-3">
              <p className="font-bold text-textPrimary inline-flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-textFaint" />No Backorder</p>
              <p className="text-textSecondary mt-1">The rest is not coming. The order closes at what arrived and is billed for that.</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary">Discard</button>
          <button onClick={() => onChoose('none')} disabled={busy} className="px-4 py-2 rounded-lg border border-borderTheme bg-surface text-xs font-bold text-textPrimary hover:bg-secondary">No Backorder</button>
          <button onClick={() => onChoose('create')} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50">
            <Truck className="h-4 w-4" />{busy ? 'Validating…' : 'Create Backorder'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The deliveries an order has had, left to right: received, open, closed. */
export function ShipmentChain({ chain }: { chain: BoardRow['chain'] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chain.map((c, i) => (
        <span key={c.name} className="inline-flex items-center gap-1.5">
          {i > 0 && <ArrowRight className="h-3 w-3 text-textFaint" />}
          <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${
            c.state === 'done' ? 'border-pos/30 bg-pos/10 text-pos'
              : c.state === 'waiting' ? 'border-gold/40 bg-gold/10 text-gold' : 'border-borderTheme bg-secondary text-textFaint line-through'}`}
                title={c.state === 'done' ? `Received ${day(c.at)}` : c.state === 'waiting' ? 'Waiting for delivery' : 'Closed — not delivered'}>
            {c.state === 'done' ? <CheckCircle2 className="h-3 w-3" /> : c.state === 'waiting' ? <Clock className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {c.name.replace(/^GRN-\d{4}-/, 'GRN ')} · {c.qty}
          </span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Backorders board.
// ---------------------------------------------------------------------------
export function BackordersBoard({ fetcher, offline, onReceive, vendor = false }: {
  fetcher: Fetcher; offline: boolean; onReceive?: (requestId: string) => void; vendor?: boolean;
}) {
  const [data, setData] = useState<{ today: string; canReceive: boolean; backorders: BoardRow[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState('');

  const load = async () => {
    try {
      const res = await fetcher('/api/smartspend/backorders', { method: 'GET' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'Backorders could not be loaded.'); return; }
      setData(body); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Backorders could not be loaded.'); }
  };
  useEffect(() => { if (!offline) void load(); }, [offline]);

  const close = async (row: BoardRow) => {
    if (!window.confirm(`Close backorder ${row.name}? ${row.qtyPending} unit(s) from ${row.vendor} will not be delivered, and ${row.order} is billed for what arrived.`)) return;
    setBusy(row.id);
    try {
      const res = await fetcher(`/api/smartspend/receipts/${row.id}/no-backorder`, { method: 'POST', body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'The backorder was not closed.'); return; }
      setToast(`${row.name} closed — the rest of ${row.order} will not be delivered.`);
      window.setTimeout(() => setToast(''), 5000);
      await load();
    } finally { setBusy(null); }
  };

  if (offline) return <div className="rounded-2xl bg-surface border border-borderTheme p-6 text-xs text-textFaint">Backorders live in Odoo — sign in against the server to follow them.</div>;
  if (!data) return <div className={`rounded-2xl bg-surface border border-borderTheme p-6 text-xs ${error ? 'text-neg' : 'text-textFaint'}`}>{error || 'Loading backorders…'}</div>;

  const open = data.backorders.filter(b => b.state === 'waiting');
  const settled = data.backorders.filter(b => b.state !== 'waiting');
  const units = open.reduce((s, b) => s + (b.qtyPending || 0), 0);
  const value = open.reduce((s, b) => s + (b.amountPending || 0), 0);
  const overdue = open.filter(b => b.overdue).length;

  return (
    <div className="space-y-5">
      {!vendor && (
        <div className="relative overflow-hidden rounded-3xl p-6 text-white shadow-xl"
             style={{ background: 'radial-gradient(900px 300px at 0% 0%, rgba(245,158,11,.45), transparent 60%), radial-gradient(700px 300px at 100% 100%, rgba(139,92,246,.4), transparent 60%), #17122e' }}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-5">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]"><PackageOpen className="h-3.5 w-3.5" />Backorders</div>
              <h2 className="mt-2 font-outfit text-3xl font-black">Short deliveries, followed to the last unit.</h2>
              <p className="text-xs text-white/65 mt-1 max-w-lg">When a delivery arrives short, the rest becomes a backorder — just like Odoo. Receive it when it lands, or close it if it is not coming.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { k: 'Open', v: String(open.length), s: 'backorders' },
                { k: 'Units owed', v: String(units), s: 'still to arrive' },
                { k: 'Value owed', v: inr(value), s: 'before tax' },
                { k: 'Overdue', v: String(overdue), s: 'past committed date' },
              ].map(t => (
                <div key={t.k} className={`rounded-2xl border px-4 py-3 min-w-[110px] ${t.k === 'Overdue' && overdue ? 'bg-rose-500/20 border-rose-300/30' : 'bg-white/[0.07] border-white/10'}`}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-white/50">{t.k}</p>
                  <p className="font-outfit text-xl font-black tabular-nums">{t.v}</p>
                  <p className="text-[10px] text-white/55">{t.s}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(toast || error) && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold ${error ? 'border-neg/25 bg-neg/10 text-neg' : 'border-pos/30 bg-pos/10 text-pos'}`}>
          {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{error || toast}
        </div>
      )}

      {vendor && open.length > 0 && (
        <p className="text-xs font-bold text-textPrimary inline-flex items-center gap-1.5"><PackageOpen className="h-4 w-4 text-gold" />Still to deliver — {open.length} backorder{open.length === 1 ? '' : 's'}, {units} unit{units === 1 ? '' : 's'}</p>
      )}

      {!open.length && !vendor && (
        <div className="rounded-3xl border border-dashed border-borderTheme bg-surface/60 p-10 text-center">
          <PackageCheck className="h-9 w-9 mx-auto text-pos" />
          <p className="text-sm font-bold text-textPrimary mt-2">No open backorders</p>
          <p className="text-xs text-textFaint mt-1">Every order received so far arrived in full, or its rest was closed.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {open.map(row => (
          <div key={row.id} className={`rounded-2xl bg-surface border shadow-sm overflow-hidden ${row.overdue ? 'border-neg/40' : 'border-borderTheme'}`}>
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-textPrimary">{row.name}</span>
                <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold">Backorder of {row.backorderOf}</span>
                <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${row.overdue ? 'bg-neg/10 text-neg' : 'bg-secondary text-textSecondary'}`}>
                  <Clock className="h-3 w-3" />{row.overdue ? `Overdue · expected ${day(row.scheduledDate)}` : row.scheduledDate ? `Expected ${day(row.scheduledDate)}` : `Open ${row.daysOpen} day${row.daysOpen === 1 ? '' : 's'}`}
                </span>
              </div>
              <div>
                <p className="font-outfit text-base font-extrabold text-textPrimary">{row.order}{!vendor && <> · {row.vendor}</>}</p>
                {row.requestId && !vendor && <p className="text-[11px] text-textFaint">for {row.requestId} · open {row.daysOpen} day{row.daysOpen === 1 ? '' : 's'}</p>}
              </div>
              {/* Per product: how much of the order arrived, and how much is still owed. */}
              <div className="space-y-2">
                {row.lines.map(line => {
                  const ordered = row.orderLines.find(o => o.poLineId === line.poLineId)?.ordered || line.demand;
                  const received = row.orderLines.find(o => o.poLineId === line.poLineId)?.received || 0;
                  const pctIn = Math.min(100, (received / ordered) * 100);
                  const pctOwed = Math.min(100 - pctIn, (line.demand / ordered) * 100);
                  return (
                    <div key={line.poLineId}>
                      <div className="flex justify-between text-[11px]">
                        <span className="font-semibold text-textPrimary truncate">{line.product}</span>
                        <span className="text-textSecondary tabular-nums"><b className="text-pos">{received}</b> in · <b className="text-gold">{line.demand}</b> owed · of {ordered}</span>
                      </div>
                      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="bg-pos" style={{ width: `${pctIn}%` }} />
                        <div className="bg-gold/70 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.35)_4px,rgba(255,255,255,.35)_8px)]" style={{ width: `${pctOwed}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <ShipmentChain chain={row.chain} />
                <span className="text-xs font-extrabold text-textPrimary tabular-nums whitespace-nowrap">{inr(row.amountPending || 0)} owed</span>
              </div>
            </div>
            {data.canReceive && !vendor && (
              <div className="flex items-center gap-2 border-t border-borderTheme bg-secondary/40 px-5 py-2.5">
                {onReceive && row.requestId && (
                  <button onClick={() => onReceive(row.requestId)} className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-onbrand"><Truck className="h-3.5 w-3.5" />Receive now</button>
                )}
                <button onClick={() => close(row)} disabled={busy === row.id} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-neg hover:bg-neg/10 disabled:opacity-50">
                  {busy === row.id ? 'Closing…' : 'No backorder'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!vendor && settled.length > 0 && (
        <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-5">
          <p className="text-xs font-extrabold text-textPrimary mb-3">Settled in the last 60 days</p>
          <div className="space-y-2">
            {settled.map(row => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-mono font-bold text-textPrimary">{row.name}</span>
                <span className="text-textSecondary">{row.order} · {row.vendor}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.state === 'done' ? 'bg-pos/10 text-pos' : 'bg-secondary text-textFaint'}`}>{row.state === 'done' ? 'Received' : 'Closed — not delivered'}</span>
                <span className="ml-auto"><ShipmentChain chain={row.chain} /></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
