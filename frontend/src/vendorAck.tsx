/**
 * The vendor's order acknowledgment — confirmed with the delivery date they
 * commit to. Opened by every "Confirm order" button (and by the buyer's
 * "Simulate Vendor Acknowledgment"); Odoo refuses an acknowledgment without
 * the date, and stores it as the expected arrival on the purchase order.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CalendarCheck, Truck, X } from 'lucide-react';

export interface AckTarget {
  id: string; order: string; items: string; location: string;
  /** The request's "needed by" date, as the portal shows it ("Oct 14, 2026"). */
  neededBy?: string; value: string;
}

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
  onCancel: () => void; onConfirm: (date: string) => Promise<boolean>;
}) {
  const needed = parse(target.neededBy);
  const [date, setDate] = useState(() => (needed && needed >= today() ? iso(needed) : ''));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const chosen = parse(date);
  const past = !!chosen && chosen < today();
  const gap = chosen && needed ? Math.round((chosen.getTime() - needed.getTime()) / 86400000) : null;
  const ready = !!chosen && !past && agreed;

  const confirm = async () => {
    setTried(true);
    if (!ready) return;
    setBusy(true);
    const ok = await onConfirm(date);
    setBusy(false);
    if (ok) onCancel();
  };

  // On <body>, so no animated ancestor crops the overlay.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface border border-borderTheme shadow-xl">
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

        <div className="px-6 py-5 space-y-4">
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
            <label className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">
              Expected delivery date <span className="text-neg">*</span>
            </label>
            <input type="date" value={date} min={iso(today())} onChange={e => setDate(e.target.value)}
                   aria-required="true"
                   className={`w-full bg-secondary border rounded-lg p-2 text-sm font-semibold text-textPrimary focus:outline-none ${
                     tried && (!chosen || past) ? 'border-neg' : 'border-borderTheme focus:border-textPrimary'}`} />
            {tried && !chosen && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-neg"><AlertCircle className="h-3 w-3" />Choose the date you will deliver by.</p>
            )}
            {past && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-neg"><AlertCircle className="h-3 w-3" />The date cannot be in the past.</p>
            )}
            {chosen && !past && gap !== null && (
              <p className={`mt-1.5 text-[11px] font-bold ${gap > 0 ? 'text-gold' : 'text-pos'}`}>
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
              {chosen && !past ? <> by <b className="text-textPrimary">{showDate(date)}</b></> : ' by the date above'}.
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
