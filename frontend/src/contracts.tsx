/**
 * Rate contracts on the Master Data console (`/api/smartspend/contracts?all=1`).
 *
 * Every agreement Odoo holds — running, draft, expired or cancelled — with its
 * vendor, validity, terms and the rate agreed for each item, and how many
 * requests and purchase orders have used it. Read-only here: contracts are
 * kept in Odoo (SmartSpend → Rate Contracts).
 */
import { useEffect, useState } from 'react';
import { FileSignature, ShieldCheck } from 'lucide-react';
import { MasterDetailPanel, inr } from './masterDetail';

export interface ContractRow {
  id: string; vendor: string; category: string;
  validFrom: string; validUntil: string;
  leadTime: string; warranty: string; paymentTerms: string;
  state: string; stateLabel: string; running: boolean;
  requestCount: number; purchaseOrderCount: number; notes: string;
  lines: { productName: string; minQty: number; price: number; uom?: string }[];
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const day = (iso: string) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—';

/** Days until a running contract ends — to flag the ones about to lapse. */
const daysLeft = (iso: string) => {
  if (!iso) return null;
  const end = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((end - today.getTime()) / 86400000);
};

function StatusPill({ c }: { c: ContractRow }) {
  const left = c.running ? daysLeft(c.validUntil) : null;
  if (c.running && left !== null && left <= 30) {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gold/10 text-gold border border-gold/25">Ends in {left} day{left === 1 ? '' : 's'}</span>;
  }
  if (c.running) {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-pos/10 text-pos border border-pos/25"><ShieldCheck className="h-3 w-3" />Running</span>;
  }
  const tone = c.state === 'draft' ? 'bg-secondary text-textSecondary border-borderTheme'
    : c.state === 'active' ? 'bg-brand/10 text-brand border-brand/25' // active, but outside its dates
    : 'bg-neg/10 text-neg border-neg/25';
  return <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone}`}>
    {c.state === 'active' ? 'Not in force' : c.stateLabel}
  </span>;
}

export function ContractsMaster({ fetcher, offline, search, onCount, onVendor }: {
  fetcher: Fetcher; offline: boolean; search: string; onCount?: (n: number) => void;
  /** Open a vendor's own detail panel, when the console knows them. */
  onVendor?: (name: string) => void;
}) {
  const [rows, setRows] = useState<ContractRow[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (offline) return;
    let stale = false;
    (async () => {
      try {
        const res = await fetcher('/api/smartspend/contracts?all=1', { method: 'GET' });
        const body = await res.json().catch(() => ([]));
        if (stale) return;
        if (!res.ok) { setError((body && body.error) || 'Rate contracts could not be loaded.'); return; }
        setRows(Array.isArray(body) ? body : []);
        setError('');
        onCount?.(Array.isArray(body) ? body.length : 0);
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : 'Rate contracts could not be loaded.');
      }
    })();
    return () => { stale = true; };
  }, [offline]);

  if (offline) {
    return <div className="rounded-2xl bg-surface border border-borderTheme p-6 text-xs text-textFaint">
      Rate contracts are kept in Odoo — sign in against the server to see them.
    </div>;
  }
  if (!rows) {
    return <div className={`rounded-2xl bg-surface border border-borderTheme p-6 text-xs ${error ? 'text-neg' : 'text-textFaint'}`}>
      {error || 'Loading rate contracts…'}
    </div>;
  }

  const q = search.toLowerCase();
  const shown = rows.filter(c => `${c.id} ${c.vendor} ${c.category} ${c.stateLabel} ${c.lines.map(l => l.productName).join(' ')}`
    .toLowerCase().includes(q));
  const current = rows.find(c => c.id === open);

  return (
    <>
      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-secondary">
                {['Contract', 'Vendor', 'Category', 'Valid', 'Items', 'Lead time', 'Payment terms', 'Used on', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-textFaint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} onClick={() => setOpen(c.id)} title="Open details"
                    className="border-t border-borderTheme hover:bg-secondary/60 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-[11px] font-mono font-bold text-textPrimary whitespace-nowrap">{c.id}</td>
                  <td className="px-4 py-3 text-xs font-bold text-textPrimary">{c.vendor}</td>
                  <td className="px-4 py-3 text-xs text-textSecondary">{c.category || '—'}</td>
                  <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{day(c.validFrom)} – {day(c.validUntil)}</td>
                  <td className="px-4 py-3 text-xs text-textSecondary">
                    <span className="font-bold text-textPrimary">{c.lines.length}</span>
                    {c.lines.length > 0 && <span className="text-textFaint"> · {c.lines.slice(0, 2).map(l => l.productName).join(', ')}{c.lines.length > 2 ? '…' : ''}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{c.leadTime || '—'}</td>
                  <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{c.paymentTerms || '—'}</td>
                  <td className="px-4 py-3 text-xs text-textSecondary whitespace-nowrap">{c.requestCount} req · {c.purchaseOrderCount} PO</td>
                  <td className="px-4 py-3"><StatusPill c={c} /></td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-textFaint">
                  {rows.length ? 'No contract matches the search.' : 'No rate contracts yet — they are created in Odoo under SmartSpend → Rate Contracts.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {current && (
        <MasterDetailPanel
          icon={FileSignature} kind="Rate contract" title={current.id}
          subtitle={`${current.vendor}${current.category ? ` · ${current.category}` : ''}`}
          onClose={() => setOpen(null)}
          badges={<StatusPill c={current} />}
          stats={[
            { label: 'Items', value: String(current.lines.length), hint: 'at agreed rates' },
            { label: 'Requests', value: String(current.requestCount), hint: 'matched to it' },
            { label: 'Purchase orders', value: String(current.purchaseOrderCount), hint: 'raised under it' },
          ]}
          facts={[
            { label: 'Vendor', value: onVendor
              ? <button onClick={() => onVendor(current.vendor)} className="font-semibold text-brand hover:underline">{current.vendor}</button>
              : current.vendor },
            { label: 'Category', value: current.category || '—' },
            { label: 'Valid from', value: day(current.validFrom) },
            { label: 'Valid until', value: day(current.validUntil) },
            { label: 'Lead time', value: current.leadTime || '—' },
            { label: 'Warranty', value: current.warranty || '—' },
            { label: 'Payment terms', value: current.paymentTerms || '—' },
            { label: 'Status', value: current.running ? 'Running — applied to new requests automatically' : current.stateLabel },
          ]}
          sections={[
            {
              title: 'Contracted rates',
              hint: 'A request for one of these items is priced at this rate and can skip sourcing.',
              content: current.lines.length ? (
                <div className="rounded-xl border border-borderTheme overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead><tr className="bg-secondary text-[10px] uppercase tracking-wider text-textFaint">
                      <th className="px-3 py-2 font-bold">Product</th>
                      <th className="px-3 py-2 font-bold text-right">Min. qty</th>
                      <th className="px-3 py-2 font-bold text-right">Rate</th>
                    </tr></thead>
                    <tbody>
                      {current.lines.map(l => (
                        <tr key={l.productName} className="border-t border-borderTheme">
                          <td className="px-3 py-2 font-semibold text-textPrimary">{l.productName}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-textSecondary">{l.minQty.toLocaleString('en-IN')}{l.uom ? ` ${l.uom}` : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold text-textPrimary">{inr(l.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-textFaint">No rates on this contract yet.</p>,
            },
            ...(current.notes ? [{ title: 'Terms & notes', content: <p className="text-xs text-textSecondary whitespace-pre-line">{current.notes}</p> }] : []),
          ]}
        />
      )}
    </>
  );
}
