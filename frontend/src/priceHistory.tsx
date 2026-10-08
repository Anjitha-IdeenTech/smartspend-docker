/**
 * Price history under a request line — what the company actually paid for the
 * product on earlier confirmed purchase orders (`/api/smartspend/price-history`).
 *
 * Shows nothing until there is history to show: an unknown product, a backend
 * that is not there (the hosted walkthrough) or a refused call all leave the
 * line exactly as it was.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, History, TrendingDown, TrendingUp } from 'lucide-react';

export interface PriceHistoryRow {
  date: string; vendor: string; po: string; product: string;
  qty: number; unitPrice: number; currency: string;
}

export interface PriceHistory {
  product: string; rows: PriceHistoryRow[]; count: number;
  last: number; min: number; max: number; avg: number;
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const day = (iso: string) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—';

export function PriceHistoryStrip({ product, unitPrice, fetcher }: {
  product: string; unitPrice: number; fetcher: Fetcher;
}) {
  const [data, setData] = useState<PriceHistory | null>(null);
  const [open, setOpen] = useState(false);

  // Asked again only once typing pauses, and a stale answer never lands.
  useEffect(() => {
    const typed = product.trim();
    if (typed.length < 3) { setData(null); return; }
    let stale = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetcher(`/api/smartspend/price-history?product=${encodeURIComponent(typed)}`, { method: 'GET' });
        const body = res.ok ? await res.json() : null;
        if (!stale) setData(body && Array.isArray(body.rows) && body.rows.length ? body : null);
      } catch {
        if (!stale) setData(null);
      }
    }, 450);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [product]);

  if (!data) return null;
  const diff = unitPrice > 0 && data.last > 0 ? ((unitPrice - data.last) / data.last) * 100 : null;
  const latest = data.rows[0];

  return (
    <div className="rounded-lg border border-borderTheme bg-secondary/40 px-3 py-2 text-[11px] text-textSecondary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wider text-[10px] text-textFaint">
          <History className="h-3.5 w-3.5 text-brand" />Price history
        </span>
        <span>
          Last paid <b className="text-textPrimary">{inr(data.last)}</b>
          {latest && <> · {latest.vendor} · {day(latest.date)}</>}
        </span>
        <span>
          Range <b className="text-textPrimary">{inr(data.min)}</b>–<b className="text-textPrimary">{inr(data.max)}</b>
          {' '}· avg {inr(data.avg)} · {data.count} PO line{data.count === 1 ? '' : 's'}
        </span>
        {diff !== null && Math.abs(diff) >= 0.05 && (
          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-bold ${diff > 0 ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos'}`}
                title="Your unit price against the last price paid">
            {diff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {diff > 0 ? '+' : ''}{diff.toFixed(1)}% vs last
          </span>
        )}
        <button type="button" onClick={() => setOpen(o => !o)}
                className="ml-auto inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">
          {open ? <>Hide <ChevronUp className="h-3.5 w-3.5" /></> : <>View <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
      </div>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <p className="mb-1 text-[10px] text-textFaint">{data.product} — confirmed purchase orders, newest first</p>
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-textFaint">
                <th className="py-1 pr-3 font-bold">Date</th>
                <th className="py-1 pr-3 font-bold">Vendor</th>
                <th className="py-1 pr-3 font-bold">PO</th>
                <th className="py-1 pr-3 font-bold text-right">Qty</th>
                <th className="py-1 font-bold text-right">Unit price</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.po}-${i}`} className="border-t border-borderTheme">
                  <td className="py-1 pr-3 whitespace-nowrap">{day(r.date)}</td>
                  <td className="py-1 pr-3">{r.vendor}</td>
                  <td className="py-1 pr-3 font-mono">{r.po}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.qty.toLocaleString('en-IN')}</td>
                  <td className={`py-1 text-right tabular-nums font-semibold ${r.unitPrice === data.min ? 'text-pos' : 'text-textPrimary'}`}>{inr(r.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.count > data.rows.length && (
            <p className="mt-1 text-[10px] text-textFaint">Showing the latest {data.rows.length} of {data.count}.</p>
          )}
        </div>
      )}
    </div>
  );
}
