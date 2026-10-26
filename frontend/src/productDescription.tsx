/**
 * A product's description on the Master Data console (its Purchase Description
 * in Odoo, `/api/smartspend/products/description`). The requester's chat finds
 * products by it, so a requester who describes what they need in their own
 * words is offered the product that fits.
 *
 * An SCM buyer (or a procurement manager) edits it; everyone else reads it.
 */
import { useEffect, useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export function ProductDescription({ productId, description, canEdit, fetcher, onSaved }: {
  /** The Odoo product; a built-in catalogue row not in Odoo has none. */
  productId?: number;
  description: string;
  canEdit: boolean;
  fetcher: Fetcher;
  onSaved: (description: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(description); setEditing(false); setError(''); }, [productId, description]);

  const save = async () => {
    if (!productId) return;
    setBusy(true); setError('');
    try {
      const res = await fetcher('/api/smartspend/products/description', {
        method: 'POST', body: JSON.stringify({ id: productId, description: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'The description was not saved.');
      onSaved(data.description ?? draft.trim());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The description was not saved.');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft} onChange={e => setDraft(e.target.value)} rows={4} autoFocus
          placeholder="What it is, brand, specification, what it is used for — e.g. “Hero 26-inch geared cycle for site staff to commute”."
          className="w-full rounded-xl border border-borderTheme bg-surface px-3 py-2 text-xs text-textPrimary focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        {error && <p className="text-[11px] text-neg">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy}
            className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
            <Check className="h-3 w-3" />{busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setDraft(description); setEditing(false); setError(''); }} disabled={busy}
            className="inline-flex items-center gap-1 rounded-full border border-borderTheme px-3 py-1.5 text-[11px] font-semibold text-textSecondary">
            <X className="h-3 w-3" />Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-textSecondary whitespace-pre-line">
        {description || <span className="text-textFaint">No description yet.</span>}
      </p>
      {canEdit && productId ? (
        <button onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-full border border-borderTheme px-3 py-1.5 text-[11px] font-semibold text-textSecondary hover:text-brand">
          <Pencil className="h-3 w-3" />{description ? 'Edit description' : 'Add description'}
        </button>
      ) : canEdit ? (
        <p className="text-[11px] text-textFaint">This catalogue item is not in Odoo yet, so it has no description to edit.</p>
      ) : null}
    </div>
  );
}
