/**
 * The vendor's order acknowledgment — confirmed with the delivery schedule
 * they commit to: one delivery, or several, each a date with the quantity of
 * every item coming that day. Opened by every "Confirm order" button (and by
 * the buyer's "Simulate Vendor Acknowledgment"); Odoo refuses a schedule that
 * does not add up to the order, and the last date becomes the committed one.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CalendarCheck, Check, Plus, Trash2, Truck, X } from 'lucide-react';

export interface AckTarget {
  id: string; order: string; items: string; location: string;
  /** The request's "needed by" date, as the portal shows it ("Oct 14, 2026"). */
  neededBy?: string; value: string;
  /** What was ordered, to split across the deliveries. */
  lines: { productName: string; qty: number }[];
}

/** One delivery: a date, and how many of each item comes that day. */
export interface Delivery { date: string; items: { productName: string; quantity: number }[] }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parse = (label?: string) => {
  if (!label) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(label) ? `${label}T00:00:00` : label);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};
export const showDate = (value: string) => {
  const d = parse(value);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : value;
};

export function VendorAckDialog({ target, asBuyer, error, onCancel, onConfirm }: {
  target: AckTarget; asBuyer?: boolean; error?: string;
  onCancel: () => void; onConfirm: (schedule: Delivery[]) => Promise<boolean>;
}) {
  const needed = parse(target.neededBy);
  const lines = target.lines.filter(l => l.productName && l.qty > 0);
  // Start with one delivery of everything, on the date it is needed by.
  const [parts, setParts] = useState<{ date: string; qty: Record<string, string> }[]>(() => [{
    date: needed && needed >= today() ? iso(needed) : '',
    qty: Object.fromEntries(lines.map(l => [l.productName, String(l.qty)])),
  }]);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const num = (v?: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const scheduled = (name: string) => parts.reduce((t, p) => t + num(p.qty[name]), 0);
  const dates = parts.map(p => parse(p.date));
  const partProblem = (i: number) => {
    const d = dates[i];
    if (!d) return 'Choose a date.';
    if (d < today()) return 'The date cannot be in the past.';
    if (dates.some((x, j) => j !== i && x && x.getTime() === d.getTime())) return 'Another delivery has the same date.';
    if (!lines.some(l => num(parts[i].qty[l.productName]) > 0)) return 'Nothing is in this delivery.';
    return '';
  };
  const balanced = lines.every(l => Math.abs(scheduled(l.productName) - l.qty) < 0.005);
  const last = dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
  const ready = parts.every((_, i) => !partProblem(i)) && balanced && agreed;
  const gap = last && needed ? Math.round((last.getTime() - needed.getTime()) / 86400000) : null;

  const setDate = (i: number, date: string) => setParts(prev => prev.map((p, j) => (j === i ? { ...p, date } : p)));
  const setQty = (i: number, name: string, value: string) =>
    setParts(prev => prev.map((p, j) => (j === i ? { ...p, qty: { ...p.qty, [name]: value } } : p)));
  // A new delivery takes whatever is not scheduled yet.
  const addPart = () => setParts(prev => [...prev, {
    date: '',
    qty: Object.fromEntries(lines.map(l => {
      const left = l.qty - prev.reduce((t, p) => t + num(p.qty[l.productName]), 0);
      return [l.productName, left > 0 ? String(left) : '0'];
    })),
  }]);
  const removePart = (i: number) => setParts(prev => prev.filter((_, j) => j !== i));

  const confirm = async () => {
    setTried(true);
    if (!ready) return;
    setBusy(true);
    const schedule: Delivery[] = parts.map(p => ({
      date: p.date,
      items: lines.map(l => ({ productName: l.productName, quantity: num(p.qty[l.productName]) })).filter(x => x.quantity > 0),
    }));
    const ok = await onConfirm(schedule);
    setBusy(false);
    if (ok) onCancel();
  };

  // On <body>, so no animated ancestor crops the overlay.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md max-h-[92vh] flex flex-col rounded-2xl bg-surface border border-borderTheme shadow-xl">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-borderTheme">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-savings/10 text-accent-savings">
            <CalendarCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-outfit font-extrabold text-lg text-textPrimary leading-tight">Confirm order {target.order}</h3>
            <p className="text-[11px] text-textSecondary mt-0.5 truncate">{target.items} · {target.value}</p>
          </div>
          <button onClick={onCancel} disabled={busy} title="Cancel"
                  className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {asBuyer && (
            <p className="text-[11px] text-textFaint bg-secondary/60 border border-borderTheme rounded-lg px-3 py-2">
              Recording the vendor's acknowledgment on their behalf.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-secondary/60 border border-borderTheme px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Deliver to</p>
              <p className="font-semibold text-textPrimary mt-0.5 inline-flex items-center gap-1"><Truck className="h-3 w-3" />{target.location || '—'}</p>
            </div>
            <div className="rounded-xl bg-secondary/60 border border-borderTheme px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Needed by</p>
              <p className="font-semibold text-textPrimary mt-0.5">{needed ? showDate(target.neededBy as string) : '—'}</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-textSecondary font-bold uppercase tracking-wider mb-1">
              Expected delivery {parts.length > 1 ? 'schedule' : 'date'} <span className="text-neg">*</span>
            </p>
            <p className="text-[11px] text-textFaint mb-2">Delivering in parts? Add a delivery for each date and say how much comes that day.</p>
            <div className="space-y-2.5">
              {parts.map((p, i) => {
                const problem = tried ? partProblem(i) : (dates[i] && dates[i]! < today() ? 'The date cannot be in the past.' : '');
                return (
                  <div key={i} className={`rounded-xl border px-3 py-2.5 ${problem ? 'border-neg bg-neg/5' : 'border-borderTheme bg-secondary/40'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint w-16 shrink-0">Delivery {i + 1}</span>
                      <input type="date" value={p.date} min={iso(today())} onChange={e => setDate(i, e.target.value)}
                             aria-required="true" aria-label={`Delivery ${i + 1} date`}
                             className="flex-1 bg-surface border border-borderTheme rounded-lg px-2 py-1.5 text-sm font-semibold text-textPrimary focus:outline-none focus:border-textPrimary" />
                      {parts.length > 1 && (
                        <button type="button" onClick={() => removePart(i)} title="Remove this delivery"
                                className="p-1.5 rounded-lg text-textFaint hover:text-neg hover:bg-neg/10"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                    {(parts.length > 1 || lines.length > 1) && (
                      <div className="mt-2 space-y-1">
                        {lines.map(l => (
                          <div key={l.productName} className="flex items-center gap-2 text-[11px]">
                            <span className="flex-1 truncate text-textSecondary" title={l.productName}>{l.productName}</span>
                            <input type="number" min={0} step="any" value={p.qty[l.productName] ?? ''} aria-label={`${l.productName} in delivery ${i + 1}`}
                                   onChange={e => setQty(i, l.productName, e.target.value)}
                                   className="w-20 bg-surface border border-borderTheme rounded-md px-2 py-1 text-right font-semibold text-textPrimary tabular-nums focus:outline-none focus:border-textPrimary" />
                          </div>
                        ))}
                      </div>
                    )}
                    {problem && <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-neg"><AlertCircle className="h-3 w-3" />{problem}</p>}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addPart}
                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-borderTheme px-3 py-1.5 text-[11px] font-semibold text-textSecondary hover:text-textPrimary hover:bg-secondary">
              <Plus className="h-3 w-3" />Add another delivery
            </button>

            {(parts.length > 1 || lines.length > 1) && (
              <div className="mt-2.5 rounded-xl bg-secondary/60 border border-borderTheme px-3 py-2 space-y-0.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Scheduled vs ordered</p>
                {lines.map(l => {
                  const got = scheduled(l.productName);
                  const ok = Math.abs(got - l.qty) < 0.005;
                  return (
                    <p key={l.productName} className={`flex items-center gap-1.5 text-[11px] ${ok ? 'text-pos' : 'text-gold'}`}>
                      {ok ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      <span className="truncate flex-1 text-textSecondary">{l.productName}</span>
                      <b className="tabular-nums">{got.toLocaleString('en-IN')} / {l.qty.toLocaleString('en-IN')}</b>
                      {!ok && <span>{got < l.qty ? `${(l.qty - got).toLocaleString('en-IN')} still to schedule` : `${(got - l.qty).toLocaleString('en-IN')} too many`}</span>}
                    </p>
                  );
                })}
              </div>
            )}
            {tried && !balanced && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-neg"><AlertCircle className="h-3 w-3" />The deliveries have to add up to what was ordered.</p>
            )}
            {last && last >= today() && gap !== null && (
              <p className={`mt-1.5 text-[11px] font-bold ${gap > 0 ? 'text-gold' : 'text-pos'}`}>
                {parts.length > 1 ? 'Last delivery: ' : ''}
                {gap > 0 ? `${gap} day${gap === 1 ? '' : 's'} after the date it is needed by`
                  : gap === 0 ? 'On the date it is needed by' : `${-gap} day${gap === -1 ? '' : 's'} ahead of the date it is needed by`}
              </p>
            )}
          </div>

          <label className={`flex items-start gap-2.5 cursor-pointer select-none rounded-xl border px-3 py-2.5 ${
            tried && !agreed ? 'border-neg bg-neg/5' : 'border-borderTheme'}`}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                   className="mt-0.5 h-4 w-4 rounded border-borderTheme" />
            <span className="text-xs text-textSecondary leading-relaxed">
              I acknowledge this purchase order at the agreed pricing and commit to deliver
              {parts.length > 1 ? <> in <b className="text-textPrimary">{parts.length} deliveries</b> on the dates above</>
                : last && last >= today() ? <> by <b className="text-textPrimary">{showDate(parts[0].date)}</b></> : ' by the date above'}.
            </span>
          </label>

          {error && (
            <p className="text-xs text-neg bg-neg/10 border border-neg/25 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
          <button onClick={onCancel} disabled={busy}
                  className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
            Cancel
          </button>
          <button onClick={confirm} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-accent-savings text-surface text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all">
            {busy ? 'Confirming…' : 'Acknowledge & confirm'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
