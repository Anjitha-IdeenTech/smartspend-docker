/**
 * The detail panel of a Master Data record.
 *
 * The console's tabs list their records as rows; clicking one opens this panel
 * from the right with the whole record — its fields, the figures that follow
 * from it (requests raised against it, their value) and the records it ties to.
 * One panel for every master: what differs is the content handed in, not the
 * frame, so a new master needs a builder rather than another dialog.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, X } from 'lucide-react';

export interface DetailFact { label: string; value: React.ReactNode; mono?: boolean }
export interface DetailStat { label: string; value: string; hint?: string }
export interface DetailSection { title: string; hint?: string; content: React.ReactNode }

/** A request as the panel lists it. */
export interface DetailRequest {
  id: string; productName: string; status: string; totalCost: number;
  createdDate: string; color: string;
}

export const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

export function MasterDetailPanel({ icon: Icon, kind, title, subtitle, badges, stats, facts, sections, actions, onClose }: {
  icon: LucideIcon; kind: string; title: string; subtitle?: string;
  badges?: React.ReactNode; stats?: DetailStat[]; facts: DetailFact[];
  sections?: DetailSection[]; actions?: React.ReactNode; onClose: () => void;
}) {
  // Escape closes it, as it does every other overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Rendered on <body>: an animated ancestor would otherwise become the box
  // "fixed" is measured against, and the panel would be cropped to it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <aside onClick={e => e.stopPropagation()}
             className="h-full w-full max-w-xl bg-surface border-l border-borderTheme shadow-2xl flex flex-col">
        <div className="px-6 pt-5 pb-4 border-b border-borderTheme">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand border border-borderTheme">
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint">{kind}</p>
              <h3 className="font-outfit font-extrabold text-xl text-textPrimary leading-tight">{title}</h3>
              {subtitle && <p className="text-xs text-textSecondary mt-0.5">{subtitle}</p>}
              {badges && <div className="flex flex-wrap items-center gap-1.5 mt-2">{badges}</div>}
            </div>
            <button onClick={onClose} title="Close"
                    className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {stats && stats.length > 0 && (
            <div className={`grid gap-3 ${stats.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {stats.map(s => (
                <div key={s.label} className="rounded-xl bg-secondary/60 border border-borderTheme px-3 py-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-textFaint">{s.label}</p>
                  <p className="font-outfit text-lg font-extrabold text-textPrimary tabular-nums leading-tight mt-0.5">{s.value}</p>
                  {s.hint && <p className="text-[10px] text-textFaint mt-0.5">{s.hint}</p>}
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[11px] font-extrabold text-textPrimary mb-2">Details</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-borderTheme p-4">
              {facts.map(f => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-textFaint">{f.label}</dt>
                  <dd className={`text-xs font-semibold text-textPrimary mt-0.5 break-words ${f.mono ? 'font-mono' : ''}`}>{f.value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          {sections?.map(s => (
            <div key={s.title}>
              <p className="text-[11px] font-extrabold text-textPrimary">{s.title}</p>
              {s.hint && <p className="text-[10px] text-textFaint mb-2">{s.hint}</p>}
              <div className={s.hint ? '' : 'mt-2'}>{s.content}</div>
            </div>
          ))}
        </div>

        {actions && (
          <div className="px-6 py-4 border-t border-borderTheme flex justify-end gap-2">{actions}</div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

/** Chips for related records; clicking one opens that record instead. */
export function DetailChips({ items, empty, onPick }: {
  items: string[]; empty: string; onPick?: (item: string) => void;
}) {
  if (!items.length) return <p className="text-xs text-textFaint">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => onPick ? (
        <button key={item} onClick={() => onPick(item)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary border border-borderTheme text-[11px] font-bold text-textSecondary hover:text-brand hover:border-brand/40 transition-all">
          {item}<ChevronRight className="h-3 w-3" />
        </button>
      ) : (
        <span key={item} className="px-2.5 py-1 rounded-full bg-secondary border border-borderTheme text-[11px] font-bold text-textSecondary">{item}</span>
      ))}
    </div>
  );
}

/** The latest requests tied to a record, each one a link to its tracking page. */
export function DetailRequests({ requests, onOpen, empty = 'No requests yet.' }: {
  requests: DetailRequest[]; onOpen: (id: string) => void; empty?: string;
}) {
  if (!requests.length) return <p className="text-xs text-textFaint">{empty}</p>;
  return (
    <div className="rounded-xl border border-borderTheme divide-y divide-borderTheme overflow-hidden">
      {requests.map(r => (
        <button key={r.id} onClick={() => onOpen(r.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors">
          <span className="text-[10px] font-mono text-textFaint w-24 shrink-0">{r.id}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-textPrimary truncate">{r.productName}</span>
            <span className="text-[10px] text-textFaint">{r.createdDate}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold shrink-0" style={{ color: r.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />{r.status}
          </span>
          <span className="text-xs font-bold text-textPrimary tabular-nums w-24 text-right shrink-0">{inr(r.totalCost)}</span>
          <ChevronRight className="h-3.5 w-3.5 text-textFaint shrink-0" />
        </button>
      ))}
    </div>
  );
}
