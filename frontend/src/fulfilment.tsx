/**
 * Shipping method (goods receipt) and payment method (vendor invoice) — both
 * required choices, kept on the request in Odoo (`/api/smartspend/fulfilment`)
 * and printed on the GRN and invoice documents.
 */
import { AlertCircle } from 'lucide-react';

export interface MethodOption { value: string; label: string }

/** The choices Odoo offers; used as-is when the server cannot be reached. */
export const FALLBACK_METHODS: { shippingMethod: MethodOption[]; paymentMethod: MethodOption[] } = {
  shippingMethod: [
    { value: 'road', label: 'Road Transport' },
    { value: 'courier', label: 'Courier' },
    { value: 'air', label: 'Air Freight' },
    { value: 'rail', label: 'Rail Freight' },
    { value: 'sea', label: 'Sea Freight' },
    { value: 'vendor', label: 'Vendor Delivery' },
    { value: 'pickup', label: 'Self Pickup' },
  ],
  paymentMethod: [
    { value: 'neft', label: 'Bank Transfer (NEFT)' },
    { value: 'rtgs', label: 'Bank Transfer (RTGS)' },
    { value: 'imps', label: 'IMPS' },
    { value: 'upi', label: 'UPI Corporate Pay' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'dd', label: 'Demand Draft' },
    { value: 'card', label: 'Corporate Card' },
    { value: 'lc', label: 'Letter of Credit' },
  ],
};

export const methodLabel = (options: MethodOption[], value: string) =>
  options.find(o => o.value === value)?.label ?? value;

/** A required dropdown: marked with an asterisk, and red once a save was tried without it. */
export function MethodSelect({ label, value, options, onChange, missing, disabled }: {
  label: string; value: string; options: MethodOption[];
  onChange: (value: string) => void; missing?: boolean; disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-textSecondary font-bold uppercase tracking-wider block mb-1">
        {label} <span className="text-neg">*</span>
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        aria-required="true"
        aria-invalid={missing && !value}
        className={`w-full bg-secondary border rounded-lg p-2 text-sm font-semibold text-textPrimary focus:outline-none disabled:opacity-70 ${
          missing && !value ? 'border-neg focus:border-neg' : 'border-borderTheme focus:border-textPrimary'}`}
      >
        <option value="">Select {label.toLowerCase()}…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {missing && !value && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-neg">
          <AlertCircle className="h-3 w-3" />{label} is required.
        </p>
      )}
    </div>
  );
}
