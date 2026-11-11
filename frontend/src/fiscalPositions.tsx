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
import { Pencil, Scale, Trash2, X } from 'lucide-react';
import { DetailChips, MasterDetailPanel } from './masterDetail';

export interface FiscalPositionRow {
  id: number; name: string; active: boolean; sequence: number; companyId: number | false; companyName: string;
  countryId: number | false; countryName: string; countryGroupId: number | false; countryGroupName: string;
  stateIds: number[]; states: string[]; zipFrom: string; zipTo: string;
  autoApply: boolean; vatRequired: boolean; foreignVat: string; note: string;
  taxMap: { tax: string; replaces: string[] }[];
  accountMap: { fromId: number; from: string; toId: number; to: string }[];
  vendorCount: number;
}

interface Feed {
  canEdit: boolean;
  positions: FiscalPositionRow[];
  countries: { id: number; name: string; code: string }[];
  states: { id: number; name: string; countryId: number }[];
  countryGroups: { id: number; name: string }[];
  companies: { id: number; name: string }[];
  accounts: { id: number; name: string }[];
}

/** The fields of Odoo's own fiscal position form. */
interface Draft {
  id: number | null; name: string; companyId: number | ''; countryId: number | ''; stateIds: number[];
  zipFrom: string; zipTo: string; autoApply: boolean; vatRequired: boolean; active: boolean; note: string;
  foreignVat: string; countryGroupId: number | '';
  accountMap: { fromId: number | ''; toId: number | '' }[];
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const field = 'w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand';

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
          active: draft.active, note: draft.note, companyId: draft.companyId || false,
          foreignVat: draft.foreignVat, countryGroupId: draft.countryGroupId || false,
          accountMap: draft.accountMap.filter(l => l.fromId && l.toId),
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
    // A new one starts as Odoo's does: not detected automatically, no country.
    setDraft(row
      ? {
        id: row.id, name: row.name, companyId: row.companyId || '', countryId: row.countryId || '', stateIds: row.stateIds,
        zipFrom: row.zipFrom, zipTo: row.zipTo, autoApply: row.autoApply, vatRequired: row.vatRequired, active: row.active,
        note: row.note, foreignVat: row.foreignVat, countryGroupId: row.countryGroupId || '',
        accountMap: row.accountMap.map(a => ({ fromId: a.fromId, toId: a.toId })),
      }
      : {
        id: null, name: '', companyId: feed?.companies[0]?.id ?? '', countryId: '', stateIds: [], zipFrom: '', zipTo: '',
        autoApply: false, vatRequired: false, active: true, note: '', foreignVat: '', countryGroupId: '', accountMap: [],
      });
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
              { label: 'Fiscal Position', value: p.name },
              { label: 'Company', value: p.companyName || 'All companies' },
              { label: 'Country', value: p.countryName || p.countryGroupName || 'Any' },
              { label: 'Country Group', value: p.countryGroupName || '—' },
              { label: 'Federal States', value: p.states.join(', ') || 'All states' },
              { label: 'Zip Range', value: p.zipFrom || p.zipTo ? `${p.zipFrom || '…'} – ${p.zipTo || '…'}` : 'Any' },
              { label: 'Detect Automatically', value: p.autoApply ? 'Yes — from the vendor\'s address' : 'No — set by hand' },
              { label: 'VAT required', value: p.vatRequired ? 'Yes' : 'No' },
              { label: 'Foreign Tax ID', value: p.foreignVat || '—', mono: !!p.foreignVat },
            ]}
            sections={[
              {
                title: 'Taxes', hint: 'Kept in Odoo, with the taxes (Accounting → Configuration → Taxes).',
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
                title: 'Account Mapping',
                content: <DetailChips items={p.accountMap.map(a => `${a.from} → ${a.to}`)} empty="" />,
              }] : []),
              ...(p.note ? [{ title: 'Legal Notes', content: <p className="text-xs text-textSecondary whitespace-pre-line">{p.note}</p> }] : []),
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
      {draft && (() => {
        // Odoo's own visibility rules for the form's fields.
        const countryStates = draft.countryId ? feed.states.filter(st => st.countryId === draft.countryId) : [];
        const showStates = (draft.autoApply || !!draft.foreignVat.trim()) && !!draft.countryId && countryStates.length > 0;
        const showZip = draft.autoApply && !!draft.countryId;
        const countryRequired = !!draft.foreignVat.trim();
        const editing = draft.id ? feed.positions.find(x => x.id === draft.id) : undefined;
        const missing = !draft.name.trim() ? 'Fiscal Position is required' : countryRequired && !draft.countryId ? 'Country is required with a Foreign Tax ID' : '';
        const row = 'grid grid-cols-[150px_1fr] items-center gap-3';
        const lbl = 'text-xs font-bold text-textPrimary';
        const setLine = (i: number, k: 'fromId' | 'toId', v: number | '') =>
          setDraft({ ...draft, accountMap: draft.accountMap.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
        return createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
          <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
            {!draft.active && (
              <div className="pointer-events-none absolute right-[-44px] top-[22px] w-44 rotate-45 bg-neg py-1 text-center text-[11px] font-bold text-white">Archived</div>
            )}
            <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
              <h3 className="font-outfit font-extrabold text-lg text-textPrimary inline-flex items-center gap-2">
                <Scale className="h-4 w-4 text-brand" />
                {draft.id ? 'Edit Fiscal Position' : 'New Fiscal Position'}
              </h3>
              <button onClick={() => setDraft(null)}
                      className="mr-8 p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                {/* Left: name and company */}
                <div className="space-y-3">
                  <div className={row}>
                    <label className={lbl}>Fiscal Position</label>
                    <input type="text" value={draft.name} autoFocus placeholder="e.g. Inter-State (IGST)"
                           onChange={e => setDraft({ ...draft, name: e.target.value })} className={field} />
                  </div>
                  {feed.companies.length > 1 && (
                    <div className={row}>
                      <label className={lbl}>Company</label>
                      <select value={draft.companyId} onChange={e => setDraft({ ...draft, companyId: e.target.value ? Number(e.target.value) : '' })} className={field}>
                        {feed.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                {/* Right: how and where it applies */}
                <div className="space-y-3">
                  <div className={row}>
                    <label className={lbl}>Detect Automatically</label>
                    <input type="checkbox" checked={draft.autoApply} className="h-4 w-4 accent-[var(--brand,#4F46E5)]"
                           onChange={e => setDraft({ ...draft, autoApply: e.target.checked })} />
                  </div>
                  {draft.autoApply && (
                    <div className={row}>
                      <label className={lbl}>VAT required</label>
                      <input type="checkbox" checked={draft.vatRequired} className="h-4 w-4"
                             onChange={e => setDraft({ ...draft, vatRequired: e.target.checked })} />
                    </div>
                  )}
                  <div className={row}>
                    <label className={lbl}>Foreign Tax ID</label>
                    <input type="text" value={draft.foreignVat} onChange={e => setDraft({ ...draft, foreignVat: e.target.value })} className={field} />
                  </div>
                  {draft.autoApply && (
                    <div className={row}>
                      <label className={lbl}>Country Group</label>
                      <select value={draft.countryGroupId} onChange={e => setDraft({ ...draft, countryGroupId: e.target.value ? Number(e.target.value) : '' })} className={field}>
                        <option value=""></option>
                        {feed.countryGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className={row}>
                    <label className={lbl}>Country{countryRequired && <span className="text-neg"> *</span>}</label>
                    <select value={draft.countryId}
                            onChange={e => setDraft({ ...draft, countryId: e.target.value ? Number(e.target.value) : '', stateIds: [] })}
                            className={field}>
                      <option value=""></option>
                      {feed.countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {showStates && (
                    <div className="grid grid-cols-[150px_1fr] items-start gap-3">
                      <label className={`${lbl} pt-2`}>Federal States</label>
                      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-borderTheme p-2">
                        {countryStates.map(st => {
                          const on = draft.stateIds.includes(st.id);
                          return (
                            <button key={st.id} type="button"
                                    onClick={() => setDraft({ ...draft, stateIds: on ? draft.stateIds.filter(id => id !== st.id) : [...draft.stateIds, st.id] })}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                                      on ? 'bg-brand text-onbrand border-transparent' : 'bg-secondary text-textSecondary border-borderTheme hover:text-textPrimary'}`}>
                              {st.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {showZip && (
                    <div className={row}>
                      <label className={lbl}>Zip Range</label>
                      <div className="flex items-center gap-2 text-xs text-textSecondary">
                        From <input type="text" value={draft.zipFrom} onChange={e => setDraft({ ...draft, zipFrom: e.target.value })} className={field} />
                        To <input type="text" value={draft.zipTo} onChange={e => setDraft({ ...draft, zipTo: e.target.value })} className={field} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Notebook: account mapping (editable) and the taxes (Odoo's "Taxes" button) */}
              <div>
                <p className="mb-2 border-b border-borderTheme pb-1.5 text-xs font-bold text-textPrimary">Account Mapping</p>
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-textFaint">
                    <th className="py-1.5 pr-2 font-bold">Account on Product</th>
                    <th className="py-1.5 px-2 font-bold">Account to Use Instead</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {draft.accountMap.map((l, i) => (
                      <tr key={i} className="border-t border-borderTheme">
                        <td className="py-1.5 pr-2">
                          <select value={l.fromId} onChange={e => setLine(i, 'fromId', e.target.value ? Number(e.target.value) : '')} className={field}>
                            <option value=""></option>
                            {feed.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <select value={l.toId} onChange={e => setLine(i, 'toId', e.target.value ? Number(e.target.value) : '')} className={field}>
                            <option value=""></option>
                            {feed.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 text-right">
                          <button type="button" title="Remove line" onClick={() => setDraft({ ...draft, accountMap: draft.accountMap.filter((_, j) => j !== i) })}
                                  className="p-1.5 rounded-lg text-textFaint hover:text-neg hover:bg-secondary"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={() => setDraft({ ...draft, accountMap: [...draft.accountMap, { fromId: '', toId: '' }] })}
                        className="mt-1.5 text-xs font-bold text-brand hover:underline">Add a line</button>
              </div>

              {editing && (
                <div>
                  <p className="mb-2 border-b border-borderTheme pb-1.5 text-xs font-bold text-textPrimary">Taxes</p>
                  {editing.taxMap.length ? (
                    <ul className="space-y-1 text-xs text-textSecondary">
                      {editing.taxMap.map((t, i) => (
                        <li key={i}><b className="text-textPrimary">{t.tax}</b>{t.replaces.length ? <> replaces {t.replaces.join(', ')}</> : ''}</li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-textFaint">No taxes on this fiscal position.</p>}
                  <p className="mt-1 text-[10px] text-textFaint">Set on each tax in Odoo (Accounting → Configuration → Taxes), as in Odoo 19.</p>
                </div>
              )}

              <div>
                <textarea value={draft.note} rows={2} placeholder="Legal Notes..." onChange={e => setDraft({ ...draft, note: e.target.value })} className={field} />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-textPrimary">
                <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4" />
                Active <span className="font-normal text-textFaint">(unticked = archived)</span>
              </label>
              {saveError && (
                <p className="text-[11px] text-neg bg-neg/10 border border-neg/25 rounded-lg px-3 py-2">{saveError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
              <button onClick={() => setDraft(null)}
                      className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
                Discard
              </button>
              <button onClick={save} disabled={saving || !!missing} title={missing || undefined}
                      className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
        );
      })()}
    </div>
  );
}
