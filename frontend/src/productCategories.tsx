/**
 * Product categories on the Master Data console, and the vendors who serve each
 * (`/api/smartspend/product-categories`).
 *
 * The list is Odoo's: a new category, or a change to one, is saved there. When
 * a buyer invites vendors to a reverse auction, the suppliers assigned to the
 * request's product category — or to a parent of it — are suggested and
 * pre-ticked.
 *
 * Only an SCM buyer edits; everyone else on the buying side reads it.
 */
import { useEffect, useState } from 'react';
import { Pencil, Tags, X } from 'lucide-react';
import { DetailChips, MasterDetailPanel } from './masterDetail';

export interface ProductCategoryRow {
  id: number; name: string; completeName: string;
  parentId: number | false; parentName: string;
  vendorIds: number[]; vendors: string[];
  expenseCategoryIds: number[]; expenseCategories: string[];
  productCount: number;
}

interface Option { id: number; name: string; }

interface Feed {
  canEdit: boolean;
  categories: ProductCategoryRow[];
  vendors: Option[];
  expenseCategories: Option[];
}

interface Draft {
  id: number | null; name: string; parentId: number | '';
  vendorIds: number[]; expenseCategoryIds: number[];
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const field = 'w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand';
const label = 'text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5';

/** The same chip list for vendors and expense categories: tick what applies. */
function ChipPicker({ options, value, onChange, empty }: {
  options: Option[]; value: number[]; onChange: (ids: number[]) => void; empty: string;
}) {
  if (!options.length) return <p className="text-[11px] text-textFaint">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button"
                  onClick={() => onChange(on ? value.filter(id => id !== o.id) : [...value, o.id])}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                    on ? 'bg-brand text-onbrand border-transparent'
                       : 'bg-secondary text-textSecondary border-borderTheme hover:text-textPrimary'}`}>
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

export function ProductCategoriesMaster({ fetcher, offline, search, onCount }: {
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
      const res = await fetcher('/api/smartspend/product-categories', { method: 'GET' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(body?.error || 'Product categories could not be loaded.'); return; }
      setFeed(body);
      setLoadError('');
      onCount?.(body.categories?.length ?? 0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Product categories could not be loaded.');
    }
  };

  useEffect(() => { if (!offline) load(); }, [offline]);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetcher('/api/smartspend/product-categories/save', {
        method: 'POST',
        body: JSON.stringify({
          id: draft.id, name: draft.name.trim(), parentId: draft.parentId || false,
          vendorIds: draft.vendorIds, expenseCategoryIds: draft.expenseCategoryIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveError(body?.error || 'The product category was not saved.'); return; }
      setDraft(null);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The product category was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const open = (row?: ProductCategoryRow) => {
    setSaveError('');
    setDraft(row
      ? { id: row.id, name: row.name, parentId: row.parentId || '', vendorIds: row.vendorIds, expenseCategoryIds: row.expenseCategoryIds }
      : { id: null, name: '', parentId: '', vendorIds: [], expenseCategoryIds: [] });
  };

  if (offline) {
    return (
      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6 text-xs text-textFaint">
        Product categories live in Odoo — sign in against the server to see and edit them.
      </div>
    );
  }
  if (loadError && !feed) {
    return (
      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6 text-xs text-neg">{loadError}</div>
    );
  }
  if (!feed) {
    return (
      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-6 text-xs text-textFaint">Loading product categories…</div>
    );
  }

  const q = search.toLowerCase();
  const rows = feed.categories.filter(c =>
    `${c.completeName} ${c.vendors.join(' ')} ${c.expenseCategories.join(' ')}`.toLowerCase().includes(q));
  // A category cannot sit under itself or under one of its own children.
  const parentOptions = feed.categories.filter(c =>
    !draft?.id || (c.id !== draft.id && !c.completeName.startsWith(
      `${feed.categories.find(x => x.id === draft.id)?.completeName ?? ''} / `)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[11px] text-textFaint flex-1 min-w-[240px]">
          Vendors assigned here are suggested, and pre-ticked, when a buyer invites vendors to bid on
          a request in that product category or one of its sub-categories.
        </p>
        {feed.canEdit && (
          <button onClick={() => open()}
                  className="px-3 py-2 rounded-xl bg-brand text-onbrand text-xs font-bold hover:brightness-110 transition-all">
            New product category
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[720px]">
            <thead>
              <tr className="bg-secondary/60 text-[10px] uppercase tracking-wider text-textFaint">
                <th className="px-4 py-2.5 font-bold">Product category</th>
                <th className="px-4 py-2.5 font-bold">Expense categories</th>
                <th className="px-4 py-2.5 font-bold">Vendors</th>
                {feed.canEdit && <th className="px-4 py-2.5 font-bold text-right">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} onClick={() => setDetailId(c.id)} title="Open details"
                    className="border-t border-borderTheme hover:bg-secondary/60 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <p className="text-xs font-bold text-textPrimary">{c.name}</p>
                    {c.parentName && <p className="text-[10px] text-textFaint mt-0.5">under {c.parentName}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-textSecondary">{c.expenseCategories.join(', ') || '—'}</td>
                  <td className="px-4 py-3">
                    {c.vendors.length ? (
                      <div className="flex flex-wrap gap-1">
                        {c.vendors.map(v => (
                          <span key={v} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/25">{v}</span>
                        ))}
                      </div>
                    ) : <span className="text-xs text-textFaint">No vendors yet</span>}
                  </td>
                  {feed.canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={e => { e.stopPropagation(); open(c); }} title={`Edit ${c.name}`}
                              className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={4} className="px-4 py-6 text-xs text-textFaint text-center">No product category matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailId !== null && (() => {
        const c = feed.categories.find(x => x.id === detailId);
        if (!c) return null;
        const children = feed.categories.filter(x => x.parentId === c.id);
        // Vendors a request in this category is offered: its own, and its parents'.
        const inherited = feed.categories
          .filter(x => x.id !== c.id && c.completeName.startsWith(`${x.completeName} / `))
          .flatMap(x => x.vendors.map(v => `${v} (from ${x.name})`));
        const byName = (name: string) => feed.categories.find(x => x.name === name || x.completeName === name);
        return (
          <MasterDetailPanel
            icon={Tags} kind="Product category" title={c.name}
            subtitle={c.parentName ? `under ${c.parentName}` : 'Top-level category'}
            onClose={() => setDetailId(null)}
            stats={[
              { label: 'Vendors', value: String(c.vendors.length), hint: 'suggested on bids' },
              { label: 'Sub-categories', value: String(children.length) },
              { label: 'Products', value: String(c.productCount), hint: 'in Odoo' },
            ]}
            facts={[
              { label: 'Name', value: c.name },
              { label: 'Full path', value: c.completeName },
              { label: 'Parent', value: c.parentId
                  ? <button onClick={() => setDetailId(c.parentId as number)} className="text-brand hover:underline">{c.parentName}</button>
                  : 'None' },
              { label: 'Expense categories', value: c.expenseCategories.join(', ') || 'None linked' },
            ]}
            sections={[
              { title: 'Assigned vendors', hint: 'Suggested, and pre-ticked, when a buyer invites vendors to bid on a request in this category.',
                content: <DetailChips items={c.vendors} empty="No vendors assigned yet." /> },
              ...(inherited.length ? [{ title: 'Also suggested, from parent categories', content: <DetailChips items={inherited} empty="" /> }] : []),
              { title: 'Sub-categories', content: <DetailChips items={children.map(x => x.name)} empty="No sub-categories."
                                                                 onPick={n => { const x = byName(n); if (x) setDetailId(x.id); }} /> },
              { title: 'Expense categories it covers', hint: "Requests in these get this category's vendors suggested.",
                content: <DetailChips items={c.expenseCategories} empty="Not linked to an expense category yet." /> },
            ]}
            actions={feed.canEdit ? (
              <button onClick={() => { setDetailId(null); open(c); }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 transition-all">
                <Pencil className="h-3.5 w-3.5" />Edit product category
              </button>
            ) : undefined}
          />
        );
      })()}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
          <div className="w-full max-w-lg rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
              <h3 className="font-outfit font-extrabold text-lg text-textPrimary inline-flex items-center gap-2">
                <Tags className="h-4 w-4 text-brand" />
                {draft.id ? 'Edit product category' : 'New product category'}
              </h3>
              <button onClick={() => setDraft(null)}
                      className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className={label}>Category name</label>
                <input type="text" value={draft.name} autoFocus
                       onChange={e => setDraft({ ...draft, name: e.target.value })} className={field} />
              </div>
              <div>
                <label className={label}>Parent category</label>
                <select value={draft.parentId}
                        onChange={e => setDraft({ ...draft, parentId: e.target.value ? Number(e.target.value) : '' })}
                        className={field}>
                  <option value="">None</option>
                  {parentOptions.map(c => <option key={c.id} value={c.id}>{c.completeName}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Vendors</label>
                <ChipPicker options={feed.vendors} value={draft.vendorIds} empty="No suppliers in Odoo yet."
                            onChange={ids => setDraft({ ...draft, vendorIds: ids })} />
              </div>
              <div>
                <label className={label}>Expense categories it covers</label>
                <ChipPicker options={feed.expenseCategories} value={draft.expenseCategoryIds} empty="No expense categories yet."
                            onChange={ids => setDraft({ ...draft, expenseCategoryIds: ids })} />
                <p className="text-[10px] text-textFaint mt-1.5">
                  Requests in these expense categories get this category's vendors suggested.
                  An expense category belongs to one product category at a time.
                </p>
              </div>
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
                {saving ? 'Saving…' : 'Save product category'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
