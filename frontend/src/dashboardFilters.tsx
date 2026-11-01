/**
 * The second row of dashboard filters: expense type, expense category,
 * product and an amount (price) range. Shared by the manager and buyer
 * dashboards; it sits under their period / company / branch filters and
 * narrows every panel the same way.
 *
 * Options come from the requests the dashboard is given, so they only ever
 * offer what is really there. Picking an expense type narrows the categories,
 * and a category narrows the products ("product wise" within a category).
 * A picked product also narrows each request's amount to that product's lines,
 * and the amount range then applies to that amount.
 */
import { useMemo } from 'react';
import { IndianRupee, Layers, Package, SlidersHorizontal, Tag } from 'lucide-react';
import type { DashRequest } from './managerDashboard';
import { money } from './managerDashboard';

export interface MoreFilters {
  expenseType: string;
  category: string;
  product: string;
  /** Rupee bounds as typed; empty means no bound. */
  min: string;
  max: string;
}

export const NO_MORE_FILTERS: MoreFilters = { expenseType: '', category: '', product: '', min: '', max: '' };

export const moreFiltersActive = (f: MoreFilters) => Object.values(f).some(v => v !== '');

/** CapEx or OpEx from Odoo's label ("Capital Expenditure (CapEx)"); blank when unknown. */
export const expenseTypeOf = (r: DashRequest) => {
  const t = r.expenseType || '';
  return /capex|capital/i.test(t) ? 'CapEx' : /opex|operat/i.test(t) ? 'OpEx' : '';
};

/** The products a request is for: its line items, or its headline product. */
export const productsOf = (r: DashRequest) => {
  const names = (r.lineItems ?? []).map(l => (l.productName || '').trim()).filter(Boolean);
  return names.length ? names : (r.productName ? [r.productName.trim()] : []);
};

/**
 * With a product picked, a request counts only for that product: its amount
 * becomes the product's lines (quantity × price) rather than the whole
 * request, so a laptop order that also had backpacks adds just the backpacks.
 */
export const narrowToProduct = <T extends DashRequest>(r: T, product: string): T => {
  if (!product) return r;
  const lines = (r.lineItems ?? []).filter(l => (l.productName || '').trim() === product);
  if (!lines.length) return r;
  const amount = lines.reduce((s, l) => s + (Number(l.productQty) || 0) * (Number(l.targetPrice) || 0), 0);
  return { ...r, productName: product, lineItems: lines, totalCost: amount > 0 ? amount : r.totalCost };
};

const bound = (s: string) => {
  const n = Number(String(s).replace(/[,\s₹]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

export const matchesMoreFilters = (r: DashRequest, f: MoreFilters) => {
  if (f.expenseType && expenseTypeOf(r) !== f.expenseType) return false;
  if (f.category && (r.expenseCategory || '') !== f.category) return false;
  if (f.product && !productsOf(r).includes(f.product)) return false;
  const lo = bound(f.min), hi = bound(f.max);
  if (lo !== null && (r.totalCost || 0) < lo) return false;
  if (hi !== null && (r.totalCost || 0) > hi) return false;
  return true;
};

/** Quick amount bands; each just fills the from / to boxes. */
const BANDS: { label: string; min: string; max: string }[] = [
  { label: 'Under ₹1 L', min: '', max: '100000' },
  { label: '₹1 L – ₹10 L', min: '100000', max: '1000000' },
  { label: '₹10 L – ₹1 Cr', min: '1000000', max: '10000000' },
  { label: 'Over ₹1 Cr', min: '10000000', max: '' },
];

export function MoreFiltersBar({ requests, value, onChange }: {
  /** The requests this dashboard covers — the options are drawn from them. */
  requests: DashRequest[];
  value: MoreFilters;
  onChange: (next: MoreFilters) => void;
}) {
  const types = useMemo(() => [...new Set(requests.map(expenseTypeOf).filter(Boolean))].sort(), [requests]);
  const categories = useMemo(() => [...new Set(requests
    .filter(r => !value.expenseType || expenseTypeOf(r) === value.expenseType)
    .map(r => r.expenseCategory).filter(Boolean))].sort(), [requests, value.expenseType]);
  const products = useMemo(() => {
    const count = new Map<string, number>();
    requests
      .filter(r => (!value.expenseType || expenseTypeOf(r) === value.expenseType) && (!value.category || r.expenseCategory === value.category))
      .forEach(r => new Set(productsOf(r)).forEach(p => count.set(p, (count.get(p) ?? 0) + 1)));
    return [...count.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [requests, value.expenseType, value.category]);

  const lo = bound(value.min), hi = bound(value.max);
  const badRange = lo !== null && hi !== null && lo > hi;
  const selectCls = 'rounded-xl border border-borderTheme bg-secondary px-3 py-2 text-sm font-semibold text-textPrimary normal-case tracking-normal focus:outline-none focus:border-brand';
  const inputCls = `${selectCls} w-32`;
  const labelCls = 'text-[11px] font-bold uppercase tracking-wider text-textFaint';
  const set = (patch: Partial<MoreFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="w-full border-t border-borderTheme pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <span className="mb-2 flex items-center gap-1.5 text-xs font-bold text-textSecondary">
          <SlidersHorizontal className="h-4 w-4 text-brand" /> More filters
        </span>
        <label className={labelCls}>
          <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Expense type</span>
          <select value={value.expenseType} onChange={e => set({ expenseType: e.target.value, category: '', product: '' })}
                  className={`${selectCls} mt-1 block`}>
            <option value="">CapEx &amp; OpEx</option>
            {types.map(t => <option key={t} value={t}>{t === 'CapEx' ? 'CapEx — Capital' : 'OpEx — Operating'}</option>)}
          </select>
        </label>
        <label className={labelCls}>
          <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Expense category</span>
          <select value={value.category} onChange={e => set({ category: e.target.value, product: '' })}
                  className={`${selectCls} mt-1 block max-w-[220px]`}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className={labelCls}>
          <span className="flex items-center gap-1"><Package className="h-3 w-3" /> Product</span>
          <select value={value.product} onChange={e => set({ product: e.target.value })}
                  className={`${selectCls} mt-1 block max-w-[300px]`}>
            <option value="">{value.category ? 'All products in category' : 'All products'}</option>
            {products.map(([p, n]) => <option key={p} value={p}>{p} ({n})</option>)}
          </select>
        </label>
        <div className={labelCls}>
          <span className="flex items-center gap-1"><IndianRupee className="h-3 w-3" /> Amount range (₹)</span>
          <div className="mt-1 flex items-center gap-2">
            <input inputMode="numeric" placeholder="Min" value={value.min} onChange={e => set({ min: e.target.value })}
                   className={`${inputCls} ${badRange ? 'border-red-400' : ''}`} aria-label="Minimum amount" />
            <span className="text-textFaint normal-case">to</span>
            <input inputMode="numeric" placeholder="Max" value={value.max} onChange={e => set({ max: e.target.value })}
                   className={`${inputCls} ${badRange ? 'border-red-400' : ''}`} aria-label="Maximum amount" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-textFaint">Quick range</span>
        {BANDS.map(b => {
          const on = value.min === b.min && value.max === b.max;
          return (
            <button key={b.label} type="button" onClick={() => set(on ? { min: '', max: '' } : { min: b.min, max: b.max })}
                    className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${on
                      ? 'border-brand bg-brand/10 text-brand' : 'border-borderTheme text-textSecondary hover:border-brand hover:text-brand'}`}>
              {b.label}
            </button>
          );
        })}
        {(lo !== null || hi !== null) && !badRange && (
          <span className="text-xs text-textFaint">
            Requests {lo !== null && hi !== null ? `from ${money(lo)} to ${money(hi)}` : lo !== null ? `of ${money(lo)} or more` : `up to ${money(hi!)}`}
          </span>
        )}
        {badRange && <span className="text-xs font-semibold text-red-500">Min is more than max — nothing can match</span>}
      </div>
    </div>
  );
}
