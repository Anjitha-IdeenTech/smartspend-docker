/**
 * Fiscal positions on the Master Data console (`/api/smartspend/fiscal-positions`).
 *
 * Odoo's own fiscal positions: the rules that replace a vendor's taxes and
 * accounts depending on where the supply comes from (e.g. intra-state CGST +
 * SGST against inter-state IGST, or imports). A procurement manager creates
 * and edits them here; the tax and account mappings are shown read-only, as
 * they are kept in Odoo with the taxes themselves.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Scale, X } from 'lucide-react';
import { DetailChips, MasterDetailPanel } from './masterDetail';

export interface FiscalPositionRow {
  id: number; name: string; active: boolean; sequence: number; companyName: string;
  countryId: number | false; countryName: string; countryGroupName: string;
  stateIds: number[]; states: string[]; zipFrom: string; zipTo: string;
  autoApply: boolean; vatRequired: boolean; foreignVat: string; note: string;
  taxMap: { tax: string; replaces: string[] }[];
  accountMap: { from: string; to: string }[];
  vendorCount: number;
}

interface Feed {
  canEdit: boolean;
  positions: FiscalPositionRow[];
  countries: { id: number; name: string; code: string }[];
  states: { id: number; name: string; countryId: number }[];
}

interface Draft {
  id: number | null; name: string; countryId: number | ''; stateIds: number[];
  zipFrom: string; zipTo: string; autoApply: boolean; vatRequired: boolean; active: boolean; note: string;
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const field = 'w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand';
const label = 'text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5';

/** Where a fiscal position applies, in one line. */
const whereOf = (p: FiscalPositionRow) => {
  const place = p.countryName || p.countryGroupName || 'Any country';
  const states = p.states.length ? ` · ${p.states.length > 2 ? `${p.states.slice(0, 2).join(', ')} +${p.states.length - 2}` : p.states.join(', ')}` : '';
  const zip = p.zipFrom || p.zipTo ? ` · PIN ${p.zipFrom || '…'}–${p.zipTo || '…'}` : '';
  return `${place}${states}${zip}`;
};

function Pill({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return on
    ? <span className="inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full bg-pos/10 text-pos border border-pos/25 whitespace-nowrap">{yes}</span>
    : <span className="inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary text-textFaint border border-borderTheme whitespace-nowrap">{no}</span>;
}

function Toggle({ value, onChange, text, hint }: { value: boolean; onChange: (v: boolean) => void; text: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex w-full items-start gap-3 text-left">
      <span className={`mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? 'bg-brand' : 'bg-borderTheme'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span>
        <span className="block text-xs font-bold text-textPrimary">{text}</span>
        <span className="block text-[10px] text-textFaint">{hint}</span>
      </span>
    </button>
  );
}

export function FiscalPositionsMaster({ fetcher, offline, search, onCount }: {
  fetcher: Fetcher; offline: boolean; search: string; onCount?: (n: number) => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetcher('/api/smartspend/fiscal-positions', { method: 'GET' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(body?.error || 'Fiscal positions could not be loaded.'); return; }
      setFeed(body);
      setLoadError('');
      onCount?.(body.positions?.length ?? 0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Fiscal positions could not be loaded.');
    }
  };

  useEffect(() => { if (!offline) load(); }, [offline]);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetcher('/api/smartspend/fiscal-positions/save', {
        method: 'POST',
        body: JSON.stringify({
          id: draft.id, name: draft.name.trim(), countryId: draft.countryId || false, stateIds: draft.stateIds,
          zipFrom: draft.zipFrom, zipTo: draft.zipTo, autoApply: draft.autoApply, vatRequired: draft.vatRequired,
          active: draft.active, note: draft.note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveError(body?.error || 'The fiscal position was not saved.'); return; }
      setDraft(null);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The fiscal position was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const open = (row?: FiscalPositionRow) => {
    setSaveError('');
    const india = feed?.countries.find(c => c.code === 'IN')?.id;
    setDraft(row
      ? {
        id: row.id, name: row.name, countryId: row.countryId || '', stateIds: row.stateIds, zipFrom: row.zipFrom,
        zipTo: row.zipTo, autoApply: row.autoApply, vatRequired: row.vatRequired, active: row.active, note: row.note,
      }
      : { id: null, name: '', countryId: india ?? '', stateIds: [], zipFrom: '', zipTo: '', autoApply: true, vatRequired: false, active: true, note: '' });
  };

  if (offline) {
    return (
      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6 text-xs text-textFaint">
        Fiscal positions live in Odoo — sign in against the server to see and edit them.
      </div>
    );
  }
  if (loadError && !feed) {
    return <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6 text-xs text-neg">{loadError}</div>;
  }
  if (!feed) {
    return <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6 text-xs text-textFaint">Loading fiscal positions…</div>;
  }

  const q = search.toLowerCase();
  const rows = feed.positions.filter(p =>
    `${p.name} ${whereOf(p)} ${p.taxMap.map(t => `${t.tax} ${t.replaces.join(' ')}`).join(' ')}`.toLowerCase().includes(q));
  const draftStates = draft && draft.countryId ? feed.states.filter(s => s.countryId === draft.countryId) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[11px] text-textFaint flex-1 min-w-[240px]">
          A fiscal position swaps a vendor's taxes and accounts by where the supply comes from — for example
          intra-state (CGST + SGST) against inter-state (IGST) or imports. With auto-apply on, Odoo picks it from
          the vendor's address.
        </p>
        {feed.canEdit && (
          <button onClick={() => open()}
                  className="px-3 py-2 rounded-xl bg-brand text-onbrand text-xs font-bold hover:brightness-110 transition-all">
            New fiscal position
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[820px]">
            <thead>
              <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                <th className="px-4 py-2.5 font-bold">Fiscal position</th>
                <th className="px-4 py-2.5 font-bold">Applies to</th>
                <th className="px-4 py-2.5 font-bold">Tax mapping</th>
                <th className="px-4 py-2.5 font-bold">Vendors</th>
                <th className="px-4 py-2.5 font-bold">Auto-apply</th>
                <th className="px-4 py-2.5 font-bold">Status</th>
                {feed.canEdit && <th className="px-4 py-2.5 font-bold text-right">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} onClick={() => setDetailId(p.id)} title="Open details"
                    className="border-t border-borderTheme hover:bg-secondary/60 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <p className="text-xs font-bold text-textPrimary">{p.name}</p>
                    {p.companyName && <p className="text-[10px] text-textFaint mt-0.5">{p.companyName}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-textSecondary">{whereOf(p)}</td>
                  <td className="px-4 py-3 text-xs text-textSecondary">
                    {p.taxMap.length ? `${p.taxMap.length} tax${p.taxMap.length === 1 ? '' : 'es'}` : <span className="text-textFaint">None</span>}
                    {p.accountMap.length > 0 && <span className="text-textFaint"> · {p.accountMap.length} account{p.accountMap.length === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-textSecondary tabular-nums">{p.vendorCount}</td>
                  <td className="px-4 py-3"><Pill on={p.autoApply} yes="Automatic" no="Manual" /></td>
                  <td className="px-4 py-3"><Pill on={p.active} yes="Active" no="Archived" /></td>
                  {feed.canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={e => { e.stopPropagation(); open(p); }} title={`Edit ${p.name}`}
                              className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="px-4 py-6 text-xs text-textFaint text-center">
                  {feed.positions.length ? 'No fiscal position matches.' : 'No fiscal positions yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailId !== null && (() => {
        const p = feed.positions.find(x => x.id === detailId);
        if (!p) return null;
        return (
          <MasterDetailPanel
            icon={Scale} kind="Fiscal position" title={p.name}
            subtitle={whereOf(p)}
            onClose={() => setDetailId(null)}
            badges={<><Pill on={p.active} yes="Active" no="Archived" /> <Pill on={p.autoApply} yes="Auto-applied" no="Applied manually" /></>}
            stats={[
              { label: 'Taxes mapped', value: String(p.taxMap.length) },
              { label: 'Accounts mapped', value: String(p.accountMap.length) },
              { label: 'Vendors', value: String(p.vendorCount), hint: 'set on the vendor' },
            ]}
            facts={[
              { label: 'Name', value: p.name },
              { label: 'Company', value: p.companyName || 'All companies' },
              { label: 'Country', value: p.countryName || p.countryGroupName || 'Any' },
              { label: 'States', value: p.states.join(', ') || 'All states' },
              { label: 'PIN code range', value: p.zipFrom || p.zipTo ? `${p.zipFrom || '…'} – ${p.zipTo || '…'}` : 'Any' },
              { label: 'Detect automatically', value: p.autoApply ? 'Yes — from the vendor\'s address' : 'No — set by hand' },
              { label: 'GSTIN / VAT required', value: p.vatRequired ? 'Yes' : 'No' },
              ...(p.foreignVat ? [{ label: 'Foreign tax ID', value: p.foreignVat, mono: true }] : []),
            ]}
            sections={[
              {
                title: 'Tax mapping', hint: 'Kept in Odoo, with the taxes (Accounting → Configuration → Taxes).',
                content: p.taxMap.length ? (
                  <div className="rounded-xl border border-borderTheme overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="bg-secondary text-[10px] uppercase tracking-wider text-textFaint">
                        <th className="px-3 py-2 font-bold">Vendor's tax</th><th className="px-3 py-2 font-bold">Becomes</th>
                      </tr></thead>
                      <tbody>
                        {p.taxMap.map(t => (
                          <tr key={t.tax} className="border-t border-borderTheme">
                            <td className="px-3 py-2 text-textSecondary">{t.replaces.join(', ') || '— (added)'}</td>
                            <td className="px-3 py-2 font-semibold text-textPrimary">{t.tax}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-textFaint">No taxes mapped — the vendor's own taxes apply.</p>,
              },
              ...(p.accountMap.length ? [{
                title: 'Account mapping',
                content: <DetailChips items={p.accountMap.map(a => `${a.from} → ${a.to}`)} empty="" />,
              }] : []),
              ...(p.note ? [{ title: 'Notes', content: <p className="text-xs text-textSecondary whitespace-pre-line">{p.note}</p> }] : []),
            ]}
            actions={feed.canEdit ? (
              <button onClick={() => { setDetailId(null); open(p); }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 transition-all">
                <Pencil className="h-3.5 w-3.5" />Edit fiscal position
              </button>
            ) : undefined}
          />
        );
      })()}

      {/* On <body>, as the detail panel is: an animated ancestor would crop a fixed overlay. */}
      {draft && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
          <div className="w-full max-w-lg rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
              <h3 className="font-outfit font-extrabold text-lg text-textPrimary inline-flex items-center gap-2">
                <Scale className="h-4 w-4 text-brand" />
                {draft.id ? 'Edit fiscal position' : 'New fiscal position'}
              </h3>
              <button onClick={() => setDraft(null)}
                      className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className={label}>Name</label>
                <input type="text" value={draft.name} autoFocus placeholder="e.g. Inter-State (IGST)"
                       onChange={e => setDraft({ ...draft, name: e.target.value })} className={field} />
              </div>
              <div>
                <label className={label}>Country</label>
                <select value={draft.countryId}
                        onChange={e => setDraft({ ...draft, countryId: e.target.value ? Number(e.target.value) : '', stateIds: [] })}
                        className={field}>
                  <option value="">Any country</option>
                  {feed.countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {draftStates.length > 0 && (
                <div>
                  <label className={label}>States <span className="normal-case font-semibold">(none ticked = all states)</span></label>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-borderTheme p-2">
                    {draftStates.map(s => {
                      const on = draft.stateIds.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                                onClick={() => setDraft({ ...draft, stateIds: on ? draft.stateIds.filter(id => id !== s.id) : [...draft.stateIds, s.id] })}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                                  on ? 'bg-brand text-onbrand border-transparent' : 'bg-secondary text-textSecondary border-borderTheme hover:text-textPrimary'}`}>
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>PIN code from</label>
                  <input type="text" value={draft.zipFrom} onChange={e => setDraft({ ...draft, zipFrom: e.target.value })} className={field} />
                </div>
                <div>
                  <label className={label}>PIN code to</label>
                  <input type="text" value={draft.zipTo} onChange={e => setDraft({ ...draft, zipTo: e.target.value })} className={field} />
                </div>
              </div>
              <div className="space-y-3 rounded-lg border border-borderTheme p-3">
                <Toggle value={draft.autoApply} onChange={v => setDraft({ ...draft, autoApply: v })}
                        text="Detect automatically" hint="Odoo applies it to vendors whose address matches." />
                <Toggle value={draft.vatRequired} onChange={v => setDraft({ ...draft, vatRequired: v })}
                        text="GSTIN / VAT required" hint="Only applies to vendors with a tax ID." />
                <Toggle value={draft.active} onChange={v => setDraft({ ...draft, active: v })}
                        text="Active" hint="Archived positions are kept but no longer applied." />
              </div>
              <div>
                <label className={label}>Notes</label>
                <textarea value={draft.note} rows={2} onChange={e => setDraft({ ...draft, note: e.target.value })} className={field} />
              </div>
              <p className="text-[10px] text-textFaint">Tax and account mappings are kept in Odoo, with the taxes.</p>
              {saveError && (
                <p className="text-[11px] text-neg bg-neg/10 border border-neg/25 rounded-lg px-3 py-2">{saveError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
              <button onClick={() => setDraft(null)}
                      className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !draft.name.trim()}
                      title={!draft.name.trim() ? 'A name is required' : undefined}
                      className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all">
                {saving ? 'Saving…' : 'Save fiscal position'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
