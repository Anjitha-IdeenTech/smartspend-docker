/**
 * The printable paperwork: request, order, receipt, invoice, rate contract.
 *
 * All five come back from `/api/smartspend/document` in one shape, so they are
 * drawn by one sheet and look like one family of documents — the thing a client
 * notices first when they print two of them and put them side by side.
 *
 * The sheet is an A4 page, not a screen: fixed width, print colours forced on
 * so the letterhead survives "Save as PDF", and everything else on the page
 * hidden while printing (see the `@media print` block in index.css). The Print
 * button is the browser's own dialogue, which is also how a PDF is saved — no
 * extra library, and what the client sees on screen is exactly what comes out.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, FileText, Loader2, AlertCircle } from 'lucide-react';

export type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

/** Which of the five. The server names them the same way. */
export type DocKind = 'request' | 'po' | 'grn' | 'invoice' | 'contract';

interface DocLine {
  product: string;
  description?: string;
  qty?: number | string;
  uom?: string;
  rate?: number | string;
  amount?: number | string;
}
interface DocParty { role: string; name: string; lines?: string[] }
interface DocFact { label: string; value: string }
interface DocColumn { key: keyof DocLine | 'no'; label: string; align?: 'left' | 'right' }
interface DocTotal { label: string; value: string; strong?: boolean }
interface DocTrail { title: string; date: string; desc?: string }
interface DocSignature { role: string; name: string }

export interface SmartDocument {
  kind: DocKind;
  docType: string;
  accent: 'brand' | 'gold' | 'pos' | 'neg';
  reference: string;
  status?: string;
  stamp?: string;
  issuedOn?: string;
  company: { name: string; addressLines?: string[]; website?: string };
  parties?: DocParty[];
  facts?: DocFact[];
  columns?: DocColumn[];
  lines?: DocLine[];
  totals?: DocTotal[];
  amountInWords?: string;
  terms?: string[];
  trail?: DocTrail[];
  signatures?: DocSignature[];
  note?: string;
  printedBy?: string;
}

/** What each document is printed in. Tailwind needs the whole class name. */
const ACCENTS: Record<string, { ink: string; soft: string; band: string; chip: string }> = {
  brand: { ink: 'text-brand', soft: 'bg-brand/8', band: 'from-brand to-info', chip: 'bg-brand' },
  gold: { ink: 'text-gold', soft: 'bg-gold/10', band: 'from-gold to-brand', chip: 'bg-gold' },
  pos: { ink: 'text-pos', soft: 'bg-pos/10', band: 'from-pos to-info', chip: 'bg-pos' },
  neg: { ink: 'text-neg', soft: 'bg-neg/10', band: 'from-neg to-gold', chip: 'bg-neg' },
};

const DEFAULT_COLUMNS: DocColumn[] = [
  { key: 'product', label: 'Item' },
  { key: 'qty', label: 'Qty', align: 'right' },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'amount', label: 'Amount', align: 'right' },
];

const qty = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(value);
};

/** The document itself — the only thing that reaches the printer. */
export function DocumentSheet({ doc }: { doc: SmartDocument }) {
  const accent = ACCENTS[doc.accent] || ACCENTS.brand;
  const columns = doc.columns?.length ? doc.columns : DEFAULT_COLUMNS;
  const grand = doc.totals?.find(t => t.strong) || doc.totals?.[doc.totals.length - 1];

  return (
    <article id="ss-sheet" className="doc-sheet bg-white text-[#14141B] shadow-2xl">
      {/* The letterhead is the document's face: one deep band carrying who
          issued it and what it is, so the five documents are recognisable
          across a desk and tell each other apart by colour alone. */}
      <header className={`relative overflow-hidden bg-gradient-to-br ${accent.band} text-white px-12 pt-9 pb-8`}>
        <div className="relative flex items-start justify-between gap-8">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/25 grid place-items-center
                              font-black text-xl backdrop-blur-sm">
                {(doc.company.name || 'S').charAt(0)}
              </div>
              <div>
                <p className="font-outfit text-[20px] font-extrabold leading-tight">{doc.company.name}</p>
                {doc.company.website && (
                  <p className="text-[10px] text-white/70 tracking-wide">{doc.company.website}</p>
                )}
              </div>
            </div>
            <div className="mt-3.5 text-[10.5px] leading-[1.7] text-white/80 max-w-[260px]">
              {(doc.company.addressLines || []).map((line, i) => <p key={i}>{line}</p>)}
            </div>
          </div>

          <div className="text-right">
            <p className="font-outfit text-[27px] font-extrabold uppercase tracking-[0.13em] leading-none">
              {doc.docType}
            </p>
            <p className="mt-3 inline-block rounded-lg bg-white/15 border border-white/25 px-3 py-1.5
                          font-mono text-[14px] font-bold tracking-tight">
              {doc.reference}
            </p>
            <div className="mt-2.5 flex items-center justify-end gap-2 text-[10px]">
              {doc.issuedOn && <span className="text-white/75">{doc.issuedOn}</span>}
              {doc.status && (
                <span className="px-2.5 py-1 rounded-full bg-white text-[#14141B] font-bold uppercase tracking-wider">
                  {doc.status}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* The document's own name across the page, faint enough to sign over. */}
      <span aria-hidden className="doc-watermark">{doc.docType}</span>

      {/* Who it is between. */}
      {!!doc.parties?.length && (
        <section className="px-12 pt-7 grid grid-cols-2 gap-4">
          {doc.parties.map((party, i) => (
            <div key={i} className="rounded-2xl border border-[#E7E7EF] bg-[#FAFAFE] px-5 py-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A8A9B]">{party.role}</p>
              <p className="mt-1.5 font-outfit text-[14px] font-bold leading-snug">{party.name}</p>
              <div className="mt-1 text-[10.5px] leading-[1.6] text-[#5A5A6B]">
                {(party.lines || []).map((line, j) => <p key={j}>{line}</p>)}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* The facts anyone checks first. */}
      {!!doc.facts?.length && (
        <section className="px-12 pt-5">
          <div className="grid grid-cols-4 gap-x-6 gap-y-3.5 rounded-2xl bg-[#F6F6FC] px-5 py-4">
            {doc.facts.filter(f => f.value).map((fact, i) => (
              <div key={i}>
                <p className="text-[8.5px] font-bold uppercase tracking-[0.14em] text-[#8A8A9B]">{fact.label}</p>
                <p className="mt-0.5 text-[11.5px] font-semibold leading-snug">{fact.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* What it is for. */}
      {!!doc.lines?.length && (
        <section className="px-12 pt-6">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#14141B] text-white">
                <th className="text-left font-bold text-[9px] uppercase tracking-[0.14em] px-3 py-2.5 rounded-l-lg w-8">#</th>
                {columns.map(col => (
                  <th key={String(col.key)}
                      className={`font-bold text-[9px] uppercase tracking-[0.14em] px-3 py-2.5 ${
                        col.align === 'right' ? 'text-right' : 'text-left'} ${
                        col === columns[columns.length - 1] ? 'rounded-r-lg' : ''}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line, i) => (
                <tr key={i} className={i % 2 ? 'bg-[#FAFAFE]' : ''}>
                  <td className="px-3 py-2.5 text-[10px] text-[#8A8A9B] align-top">{i + 1}</td>
                  {columns.map(col => {
                    const raw = line[col.key as keyof DocLine];
                    const value = col.key === 'qty'
                      ? `${qty(raw as number)}${line.uom ? ` ${line.uom}` : ''}`
                      : col.key === 'rate' && typeof raw === 'number' ? qty(raw) : (raw ?? '');
                    return (
                      <td key={String(col.key)}
                          className={`px-3 py-2.5 align-top text-[11.5px] border-b border-[#EFEFF6] ${
                            col.align === 'right' ? 'text-right tabular-nums font-semibold' : ''}`}>
                        {col.key === 'product' ? (
                          <>
                            <span className="font-semibold">{line.product}</span>
                            {line.description && (
                              <span className="block text-[10px] text-[#8A8A9B] mt-0.5">{line.description}</span>
                            )}
                          </>
                        ) : String(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* What it comes to. */}
      {!!doc.totals?.length && (
        <section className="px-12 pt-5 flex justify-end">
          <div className="w-[300px]">
            {doc.totals.filter(t => !t.strong).map((total, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-[11.5px] text-[#5A5A6B]">
                <span>{total.label}</span>
                <span className="font-semibold tabular-nums text-[#14141B]">{total.value}</span>
              </div>
            ))}
            {grand?.strong && (
              <div className="mt-2 flex items-center justify-between rounded-xl bg-[#14141B] text-white px-4 py-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{grand.label}</span>
                <span className="font-outfit text-[17px] font-extrabold tabular-nums">{grand.value}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {doc.amountInWords && (
        <section className="px-12 pt-4">
          <div className={`rounded-xl ${accent.soft} px-5 py-3`}>
            <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-[#8A8A9B]">Amount in words</span>
            <p className={`mt-0.5 text-[11.5px] font-semibold italic ${accent.ink}`}>{doc.amountInWords}</p>
          </div>
        </section>
      )}

      {/* How it got here — only the request carries an approval trail. */}
      {!!doc.trail?.length && (
        <section className="px-12 pt-6">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A8A9B]">Approvals</p>
          <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2">
            {doc.trail.map((entry, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full ${accent.chip} shrink-0`} />
                <div>
                  <p className="text-[11px] font-semibold leading-tight">{entry.title}</p>
                  <p className="text-[10px] text-[#8A8A9B]">
                    {[entry.desc, entry.date].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!doc.terms?.length && (
        <section className="px-12 pt-6">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A8A9B]">Terms &amp; notes</p>
          <ul className="mt-1.5 space-y-1">
            {doc.terms.map((term, i) => (
              <li key={i} className="text-[10.5px] leading-relaxed text-[#5A5A6B]">— {term}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Signatures, then the footer rule. */}
      {!!doc.signatures?.length && (
        <section className="px-12 pt-10 grid grid-cols-2 gap-10">
          {doc.signatures.map((sign, i) => (
            <div key={i}>
              <div className="h-px w-full bg-[#C9C9D8]" />
              <p className="mt-1.5 text-[10px] font-bold">{sign.name || ' '}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-[#8A8A9B]">{sign.role}</p>
            </div>
          ))}
        </section>
      )}

      <footer className="mt-auto px-12 pb-8 pt-8">
        {doc.note && <p className="text-[9.5px] italic text-[#8A8A9B] mb-2">{doc.note}</p>}
        <div className="h-px w-full bg-[#E7E7EF]" />
        <div className="pt-2.5 flex items-center justify-between text-[9px] text-[#8A8A9B]">
          <span>{doc.reference} · {doc.docType}</span>
          <span>{doc.printedBy ? `Printed by ${doc.printedBy}` : ''}</span>
          <span>SmartSpend</span>
        </div>
      </footer>

      {/* A stamp, when the document has earned one. */}
      {doc.stamp && (
        <div className="doc-stamp" aria-hidden>
          <span className={accent.ink}>{doc.stamp}</span>
        </div>
      )}
    </article>
  );
}

/** The sheet on screen, with the toolbar that is not printed. */
function DocumentOverlay({ api, kind, id, onClose }: {
  api: ApiFn; kind: DocKind; id: string; onClose: () => void;
}) {
  const [doc, setDoc] = useState<SmartDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api('/api/smartspend/document', {
        method: 'POST', body: JSON.stringify({ kind, id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `The server refused this (HTTP ${res.status}).`);
      setDoc(body as SmartDocument);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server.');
    }
  }, [api, kind, id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div id="ss-print" className="fixed inset-0 z-[120] overflow-auto bg-[#14141B]/70 backdrop-blur-sm">
      <div className="doc-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3
                      bg-[#14141B]/85 backdrop-blur text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileText className="w-4 h-4 shrink-0" />
          <span className="font-outfit font-bold truncate">
            {doc ? `${doc.docType} · ${doc.reference}` : 'Preparing the document…'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => window.print()} disabled={!doc}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-[#14141B]
                             font-bold text-sm disabled:opacity-40 hover:bg-white/90 transition">
            <Printer className="w-4 h-4" /> Print / Save as PDF
          </button>
          <button onClick={onClose} aria-label="Close"
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex justify-center py-8 px-4">
        {error ? (
          <div className="doc-toolbar max-w-md rounded-2xl bg-white px-6 py-5 text-center">
            <AlertCircle className="w-6 h-6 mx-auto text-neg" />
            <p className="mt-2 font-bold text-textPrimary">This document is not there yet</p>
            <p className="mt-1 text-sm text-textSecondary">{error}</p>
            <button onClick={onClose}
                    className="mt-4 px-4 py-2 rounded-xl bg-brand text-onbrand font-bold text-sm">Close</button>
          </div>
        ) : doc ? (
          <DocumentSheet doc={doc} />
        ) : (
          <div className="doc-toolbar flex items-center gap-2 text-white/80 py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> Reading the record…
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The button itself. Drop it anywhere the screen already knows a reference:
 * `<PrintButton api={api} kind="po" id={request.id} />`.
 */
export function PrintButton({ api, kind, id, label, title, variant = 'soft', className = '' }: {
  api: ApiFn; kind: DocKind; id: string; label?: string; title?: string;
  variant?: 'soft' | 'ghost' | 'solid'; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const styles = {
    soft: 'bg-brand/10 text-brand hover:bg-brand/15 border border-brand/20',
    ghost: 'text-textSecondary hover:text-brand hover:bg-brand/8 border border-transparent',
    solid: 'bg-brand text-onbrand hover:opacity-90 border border-transparent',
  }[variant];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={title || `Print ${label || 'document'}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition ${styles} ${className}`}>
        <Printer className="w-3.5 h-3.5" />
        {label && <span>{label}</span>}
      </button>
      {open && id && <DocumentOverlay api={api} kind={kind} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every document a request can have, as one row of buttons. */
export function PrintRow({ api, id, kinds, className = '' }: {
  api: ApiFn; id: string; kinds?: { kind: DocKind; label: string }[]; className?: string;
}) {
  const set = kinds || [
    { kind: 'request' as DocKind, label: 'Request' },
    { kind: 'po' as DocKind, label: 'Order' },
    { kind: 'grn' as DocKind, label: 'Receipt' },
    { kind: 'invoice' as DocKind, label: 'Invoice' },
  ];
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint mr-0.5">Print</span>
      {set.map(entry => (
        <PrintButton key={entry.kind} api={api} kind={entry.kind} id={id}
                     label={entry.label} variant="ghost" />
      ))}
    </div>
  );
}
