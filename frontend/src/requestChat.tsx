/**
 * The New Request screen as a conversation.
 *
 * The requester says what they need in their own words; the assistant shows
 * the request it has drafted so far and asks, one at a time, for whatever it
 * still needs — the branch, the department, the date — with the answers one
 * tap away. Nothing is invented: every message is read by the server's own
 * requisition parser (/parse-preview, which saves nothing), prices are the
 * catalogue's indicative rates and say so, and the draft request is only
 * created when the requester chooses Review & submit — through the same path
 * the old single input box used.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Paperclip, Mic, Send, X, Check, Plus, Minus, RotateCcw, CalendarDays,
  MapPin, Building2, Tag, ArrowRight, Pencil,
} from 'lucide-react';

export interface ChatModel { name: string; purpose: string; price: number }
export interface ChatLine {
  productName: string; productQty: number; targetPrice: number;
  /** Set when the message named a family ("laptops"): the models to choose from. */
  options?: ChatModel[]; family?: string;
}

/** What /parse-preview answers for one message. */
export interface ChatPreview {
  lineItems: ChatLine[];
  location: string; department: string; expenseCategory: string;
  found: { products: boolean; quantity: boolean; location: boolean; department: boolean };
}

/** What the conversation hands over when the requester submits. */
export interface ChatDraft {
  lines: ChatLine[];
  branch: string; department: string; neededBy: string;
  /** Everything the requester typed, for the record. */
  transcript: string;
}

type Ask = 'branch' | 'department' | 'neededBy' | 'qty' | 'model' | null;

interface Chip { label: string; onPick: () => void; tone?: 'primary' | 'plain'; hint?: string; note?: string }
interface Msg { id: number; role: 'bot' | 'me'; text: React.ReactNode; chips?: Chip[]; draft?: boolean }

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** The portal's date label: "Oct 15, 2026" — what the request form holds. */
const formLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const addDays = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

/** A needed-by date named in plain words, or null. Never a date in the past. */
function readDate(text: string): Date | null {
  const t = text.toLowerCase();
  const today = addDays(0);
  let m = t.match(/\bin\s+(\d{1,3}|a|an|one|two|three|four|five|six)\s+(day|week|month)s?\b/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1]];
    return addDays(n * (m[2] === 'day' ? 1 : m[2] === 'week' ? 7 : 30));
  }
  if (/\btomorrow\b/.test(t)) return addDays(1);
  if (/\bnext week\b/.test(t)) return addDays(7);
  if (/\bnext month\b/.test(t)) return addDays(30);
  if (/\bend of (the )?month\b/.test(t)) { const d = new Date(today.getFullYear(), today.getMonth() + 1, 0); return d; }
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  let d: Date | null = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!d) {
    m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)
      || t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) {
      const day = Number(/^\d/.test(m[1]) ? m[1] : m[2]);
      const month = MONTHS.indexOf((/^\d/.test(m[1]) ? m[2] : m[1]).slice(0, 3));
      d = new Date(today.getFullYear(), month, day);
      if (d < today) d = new Date(today.getFullYear() + 1, month, day);
    }
  }
  return d && !Number.isNaN(d.getTime()) && d >= today ? d : null;
}

/** A master record the text names: full name first, then its distinctive first word. */
function pick(text: string, options: string[]): string[] {
  const t = ` ${text.toLowerCase()} `;
  const full = options.filter(o => t.includes(o.toLowerCase()));
  if (full.length) return full;
  const generic = new Set(['office', 'head', 'branch', 'the', 'and', '&']);
  return options.filter(o => {
    const word = o.toLowerCase().split(/[\s&]+/).find(w => w.length > 2 && !generic.has(w));
    return !!word && new RegExp(`\\b${word.replace(/[^a-z0-9]/g, '')}\\b`).test(t);
  });
}

export function RequestChat({
  userName, branches, departments, preview, onSubmit, busy, offline,
  attachments, onAttach, onRemoveAttachment, onVoice, suggestFor,
}: {
  userName: string; branches: string[]; departments: string[];
  preview: (text: string, items: ChatLine[]) => Promise<ChatPreview | null>;
  onSubmit: (draft: ChatDraft | null, rawText?: string) => void;
  busy: boolean; offline: boolean;
  attachments: { name: string }[]; onAttach: () => void; onRemoveAttachment: (name: string) => void;
  onVoice: () => void;
  suggestFor: (text: string) => { category: string; items: string[] } | undefined;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');
  const [neededBy, setNeededBy] = useState<Date | null>(null);
  const [category, setCategory] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [qtyFor, setQtyFor] = useState('');
  const [modelFor, setModelFor] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const transcript = useRef<string[]>([]);
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  // Always the latest state for the handlers the chips close over.
  const live = useRef({ lines, branch, department, neededBy });
  live.current = { lines, branch, department, neededBy };

  const first = (userName || '').trim().split(/\s+/)[0];
  const hello = first && !/^demo$/i.test(first) ? `Hi ${first}!` : 'Hi there!';

  const say = (role: Msg['role'], text: React.ReactNode, extra: Partial<Msg> = {}) =>
    setMsgs(prev => [...prev, { id: ++seq.current, role, text, ...extra }]);

  const greet = () => {
    seq.current = 0;
    transcript.current = [];
    setLines([]); setBranch(''); setDepartment(''); setNeededBy(null); setCategory(''); setAsk(null); setQtyFor('');
    setMsgs([{
      id: ++seq.current, role: 'bot',
      text: <>{hello} 👋 I'm your procurement assistant. Tell me what you need — the item and how many, which branch it's for, and by when. I'll draft the request and ask for anything that's missing.</>,
      chips: [
        { label: '💻 20 Dell Latitude laptops for the Bangalore office', onPick: () => send('I need 20 Dell Latitude laptops for the Bangalore office') },
        { label: '🪑 10 ergonomic chairs for the Mumbai office', onPick: () => send('Requesting 10 ergonomic conference chairs for the Mumbai office') },
      ],
    }]);
  };
  useEffect(() => { greet(); }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  /** Fold one message's lines into the draft: new items join, named quantities update. */
  const mergeLines = (incoming: ChatLine[], quantityStated: boolean) => {
    const next = [...live.current.lines];
    let unsized = '';
    for (const line of incoming) {
      const at = next.findIndex(l => l.productName.toLowerCase() === line.productName.toLowerCase());
      if (at >= 0) {
        if (quantityStated) next[at] = { ...next[at], productQty: line.productQty };
      } else {
        next.push(line);
        if (!quantityStated && !unsized) unsized = line.productName;
      }
    }
    setLines(next);
    live.current.lines = next;
    return unsized;
  };

  /** What to ask next, given the draft as it now stands. */
  const nextStep = (unsized = '') => {
    const s = live.current;
    const summary = { draft: true } as const;
    if (!s.lines.length) {
      setAsk(null);
      say('bot', "What would you like to order? Name the item and how many — e.g. \"15 monitors\".");
      return;
    }
    const undecided = s.lines.find(l => l.options && l.options.length);
    if (undecided) {
      setAsk('model'); setModelFor(undecided.productName);
      say('bot', <>Which {undecided.family || 'model'} do you need? Here's what we buy, and what each is for.</>, {
        ...summary,
        chips: (undecided.options || []).map(o => ({
          label: o.name, hint: o.purpose, note: `${inr(o.price)} each · estimate`,
          onPick: () => chooseModel(undecided.productName, o),
        })),
      });
      return;
    }
    if (unsized) {
      setAsk('qty'); setQtyFor(unsized);
      say('bot', <>How many <b>{unsized}</b> do you need?</>, {
        ...summary,
        chips: [1, 5, 10, 20, 50].map(n => ({ label: String(n), onPick: () => answerQty(unsized, n) })),
      });
      return;
    }
    if (!s.branch) {
      setAsk('branch');
      say('bot', 'Which branch should it be delivered to?', {
        ...summary, chips: branches.map(b => ({ label: b, onPick: () => answer('branch', b) })),
      });
      return;
    }
    if (!s.department) {
      setAsk('department');
      say('bot', 'Which department is this for?', {
        ...summary, chips: departments.map(d => ({ label: d, onPick: () => answer('department', d) })),
      });
      return;
    }
    if (!s.neededBy) {
      setAsk('neededBy');
      say('bot', 'When do you need it by?', {
        ...summary,
        chips: [
          { label: 'In 1 week', onPick: () => answer('neededBy', addDays(7)) },
          { label: 'In 2 weeks', onPick: () => answer('neededBy', addDays(14)) },
          { label: 'In 1 month', onPick: () => answer('neededBy', addDays(30)) },
          { label: '📅 Pick a date', onPick: openDatePicker },
        ],
      });
      return;
    }
    setAsk(null);
    say('bot', <>All set — here's your request. Add anything else, or review and submit it.</>, {
      ...summary,
      // Review & submit sits on the draft card itself; offer the other way on.
      chips: [
        { label: '+ Add another item', onPick: () => { say('bot', 'Sure — what else do you need?'); inputRef.current?.focus(); } },
      ],
    });
  };

  const openDatePicker = () => {
    const el = dateRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); }
  };

  const answer = (field: 'branch' | 'department' | 'neededBy', value: string | Date) => {
    const shown = value instanceof Date ? formLabel(value) : value;
    say('me', shown);
    if (field === 'branch') { setBranch(value as string); live.current.branch = value as string; }
    if (field === 'department') { setDepartment(value as string); live.current.department = value as string; }
    if (field === 'neededBy') { setNeededBy(value as Date); live.current.neededBy = value as Date; }
    transcript.current.push(`${field}: ${shown}`);
    think(() => nextStep());
  };

  /** The requester picked a model: that line becomes it, at its price. */
  const chooseModel = (familyLine: string, model: ChatModel) => {
    say('me', model.name);
    const next = live.current.lines.map(l => l.productName === familyLine
      ? { ...l, productName: model.name, targetPrice: model.price, options: undefined, family: undefined } : l);
    setLines(next); live.current.lines = next;
    transcript.current.push(model.name);
    setModelFor('');
    think(() => nextStep());
  };

  const answerQty = (product: string, qty: number) => {
    say('me', `${qty}`);
    const next = live.current.lines.map(l => l.productName === product ? { ...l, productQty: qty } : l);
    setLines(next); live.current.lines = next;
    transcript.current.push(`${qty} × ${product}`);
    think(() => nextStep());
  };

  /** A short pause before the assistant answers, so the exchange reads as one. */
  const think = (then: () => void) => {
    setTyping(true);
    setTimeout(() => { setTyping(false); then(); }, 450);
  };

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy || typing) return;
    setInput('');
    say('me', text);
    transcript.current.push(text);

    // No server to read it with: hand the sentence to the form, as before.
    if (offline) {
      say('bot', 'Opening the request form with that…');
      onSubmit(null, text);
      return;
    }

    // Plain answers to the question on the table.
    const s = live.current;
    if (ask === 'qty' && /^\s*\d{1,5}\s*$/.test(text)) { answerQty(qtyFor, Number(text)); return; }
    if (ask === 'model' && modelFor) {
      const line = s.lines.find(l => l.productName === modelFor);
      const wanted = (line?.options || []).find(o => o.name.toLowerCase().includes(text.toLowerCase())
        || text.toLowerCase().includes(o.name.split(/[\s(]/)[0].toLowerCase()));
      if (wanted) { chooseModel(modelFor, wanted); return; }
    }
    const branchHits = pick(text, branches);
    const deptHits = pick(text, departments);
    const date = readDate(text);

    setTyping(true);
    const parsed = await preview(text, []);
    setTyping(false);
    if (parsed === null && !s.lines.length) {
      // The server does not offer the preview (or could not be reached): fall
      // back to the old one-step flow rather than guess.
      say('bot', 'Opening the request form with that…');
      onSubmit(null, text);
      return;
    }

    let understood = false;
    let unsized = '';
    if (parsed?.found.products) {
      unsized = mergeLines(parsed.lineItems, parsed.found.quantity);
      if (parsed.expenseCategory) setCategory(parsed.expenseCategory);
      understood = true;
    }
    const branchPick = branchHits.length === 1 ? branchHits[0]
      : parsed?.found.location && branches.includes(parsed.location) ? parsed.location : '';
    if (branchPick) { setBranch(branchPick); live.current.branch = branchPick; understood = true; }
    else if (branchHits.length > 1) {
      setAsk('branch');
      say('bot', 'Which of these branches?', { chips: branchHits.map(b => ({ label: b, onPick: () => answer('branch', b) })) });
      return;
    }
    const deptPick = deptHits.length === 1 ? deptHits[0]
      : parsed?.found.department && departments.includes(parsed.department) ? parsed.department : '';
    if (deptPick) { setDepartment(deptPick); live.current.department = deptPick; understood = true; }
    if (date) { setNeededBy(date); live.current.neededBy = date; understood = true; }

    // A first message that asks for something the catalogue does not know
    // ("I need 2 3D printers…") still names an item — keep it as written, the
    // way the old flow did. A message that only gives a detail ("for Mumbai")
    // does not.
    const asksForSomething = /\b(need|needs|want|require|requesting|request|order|buy|get|procure)\b|\d/i.test(text);
    if (!parsed?.found.products && !s.lines.length && parsed && asksForSomething && understood) {
      unsized = mergeLines(parsed.lineItems, parsed.found.quantity);
      say('bot', <>I couldn't match that item to our catalogue, so I've added it as written — tap its name to rename it.</>);
    }

    if (!understood) {
      if (!s.lines.length && parsed && asksForSomething) {
        // Nothing in the catalogue matched: keep their words as the item, the
        // way the old flow did, and let them correct it.
        unsized = mergeLines(parsed.lineItems, parsed.found.quantity);
        say('bot', <>I couldn't match that item to our catalogue, so I've added it as written — tap its name to rename it.</>);
      } else if (ask === 'branch' || ask === 'department') {
        say('bot', <>I don't have a {ask === 'branch' ? 'branch' : 'department'} called “{text}”. Pick one below.</>);
        think(() => nextStep());
        return;
      } else {
        say('bot', <>I didn't find an item or a detail in that. Try something like “15 monitors” or “for the Chennai office”.</>);
        return;
      }
    }
    // The companions are offered above the composer, where they stay on offer
    // for as long as the draft holds that kind of item.
    think(() => nextStep(unsized));
  };

  const addSuggested = async (name: string) => {
    say('me', `Add ${name}`);
    setTyping(true);
    const parsed = await preview('', [{ productName: name, productQty: 1, targetPrice: 0 }]);
    setTyping(false);
    const line = parsed?.lineItems?.[0] ?? { productName: name, productQty: 1, targetPrice: 0 };
    const unsized = mergeLines([line], false);
    transcript.current.push(`+ ${name}`);
    think(() => nextStep(unsized));
  };

  function submit() {
    const s = live.current;
    if (!s.lines.length || !s.branch || !s.department || !s.neededBy) { nextStep(); return; }
    say('bot', 'Opening your request for a final review…');
    onSubmit({
      lines: s.lines, branch: s.branch, department: s.department,
      neededBy: formLabel(s.neededBy), transcript: transcript.current.join(' · '),
    });
  }

  const total = lines.reduce((sum, l) => sum + l.productQty * l.targetPrice, 0);
  // Answer chips stay live on every assistant message since the requester's
  // last word — a question and the suggestions after it are both answerable.
  const lastMine = msgs.map(m => m.role).lastIndexOf('me');
  const lastDraft = [...msgs].reverse().find(m => m.draft)?.id;
  const ready = lines.length > 0 && !!branch && !!department && !!neededBy;

  // A render helper, not a component: this re-renders on every keystroke.
  const field = (Icon: typeof MapPin, label: string, value: string, onChange: () => void) => (
    <button type="button" onClick={onChange} key={label}
            className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] transition-all ${value
              ? 'border-borderTheme bg-surface text-textPrimary hover:border-brand/50' : 'border-dashed border-gold/60 bg-gold/5 text-gold'}`}>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="text-textFaint">{label}</span>
      <b className="truncate">{value || 'needed'}</b>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
    </button>
  );

  const draftCard = (
    <div className="mt-2 w-full rounded-2xl border border-borderTheme bg-surface shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 bg-secondary/70 border-b border-borderTheme">
        <span className="text-[10px] font-bold uppercase tracking-wider text-textFaint">Draft request</span>
        <span className={`text-[10px] font-bold ${ready ? 'text-pos' : 'text-gold'}`}>{ready ? '✓ ready to submit' : 'a few details to go'}</span>
      </div>
      <div className="divide-y divide-borderTheme">
        {lines.map((l, i) => (
          <div key={`${l.productName}-${i}`} className="flex items-center gap-2 px-3.5 py-2">
            <div className="min-w-0 flex-1">
              {editing === i ? (
                <input autoFocus defaultValue={l.productName}
                       onBlur={e => { const v = e.target.value.trim(); if (v) setLines(prev => prev.map((x, j) => j === i ? { ...x, productName: v } : x)); setEditing(null); }}
                       onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                       className="w-full rounded-md border border-brand/40 bg-secondary px-2 py-1 text-xs font-semibold text-textPrimary focus:outline-none" />
              ) : (
                <button type="button" onClick={() => setEditing(i)} title="Rename"
                        className="group flex items-center gap-1 text-left text-xs font-bold text-textPrimary">
                  <span className="truncate">{l.productName}</span>
                  <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
                </button>
              )}
              <span className="text-[10px] text-textFaint">
                {l.options?.length ? 'model not chosen yet' : l.targetPrice ? `${inr(l.targetPrice)} each · catalogue estimate` : 'price to be quoted'}
              </span>
            </div>
            <div className="flex items-center rounded-lg border border-borderTheme">
              <button type="button" aria-label="Fewer" onClick={() => setLines(prev => prev.map((x, j) => j === i ? { ...x, productQty: Math.max(1, x.productQty - 1) } : x))}
                      className="px-1.5 py-1 text-textSecondary hover:text-textPrimary"><Minus className="h-3 w-3" /></button>
              <input type="number" min={1} value={l.productQty} aria-label={`Quantity of ${l.productName}`}
                     onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, productQty: Math.max(1, Number(e.target.value) || 1) } : x))}
                     className="w-12 bg-transparent text-center text-xs font-bold tabular-nums text-textPrimary focus:outline-none" />
              <button type="button" aria-label="More" onClick={() => setLines(prev => prev.map((x, j) => j === i ? { ...x, productQty: x.productQty + 1 } : x))}
                      className="px-1.5 py-1 text-textSecondary hover:text-textPrimary"><Plus className="h-3 w-3" /></button>
            </div>
            <span className="w-24 text-right text-xs font-bold tabular-nums text-textPrimary">{l.targetPrice ? inr(l.productQty * l.targetPrice) : '—'}</span>
            <button type="button" aria-label={`Remove ${l.productName}`} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}
                    className="text-textFaint hover:text-neg"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 border-t border-borderTheme bg-secondary/40">
        {field(MapPin, 'Branch', branch, () => { setBranch(''); live.current.branch = ''; nextStep(); })}
        {field(Building2, 'Dept', department, () => { setDepartment(''); live.current.department = ''; nextStep(); })}
        {field(CalendarDays, 'Needed by', neededBy ? formLabel(neededBy) : '', () => { setNeededBy(null); live.current.neededBy = null; nextStep(); })}
        {category && <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-textSecondary"><Tag className="h-3.5 w-3.5 opacity-70" />{category}</span>}
        <span className="ml-auto text-right">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-textFaint">Estimated total</span>
          <span className="font-outfit text-base font-extrabold tabular-nums text-textPrimary">{inr(total)}</span>
        </span>
      </div>
      {ready && (
        <div className="px-3.5 py-2.5 border-t border-borderTheme">
          <button type="button" onClick={submit} disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-xs font-bold text-onbrand shadow-sm disabled:opacity-50">
            {busy ? 'Preparing…' : <>Review &amp; submit <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto w-full rounded-3xl border border-borderTheme bg-surface shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-borderTheme bg-gradient-to-r from-brand/[0.06] to-transparent">
        <div className="relative grid h-10 w-10 place-items-center rounded-2xl bg-brand text-onbrand shadow">
          <Sparkles className="h-5 w-5" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-pos" />
        </div>
        <div className="flex-1">
          <p className="font-outfit text-sm font-extrabold text-textPrimary">SmartSpend Assistant</p>
          <p className="text-[11px] text-textFaint">{typing ? 'typing…' : offline ? 'offline — opens the request form directly' : 'Online · drafts your request as you chat'}</p>
        </div>
        <button type="button" onClick={greet} title="Start over"
                className="inline-flex items-center gap-1 rounded-lg border border-borderTheme px-2.5 py-1.5 text-[11px] font-semibold text-textSecondary hover:text-textPrimary">
          <RotateCcw className="h-3.5 w-3.5" /> New chat
        </button>
      </div>

      {/* Conversation */}
      <div ref={scroller} className="h-[430px] overflow-y-auto px-5 py-4 space-y-3 bg-app/40" aria-live="polite">
        {msgs.map(m => (
          <div key={m.id} className={`flex ${m.role === 'me' ? 'justify-end' : 'justify-start'} chat-in`}>
            {m.role === 'bot' && (
              <div className="mr-2 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Sparkles className="h-3.5 w-3.5" /></div>
            )}
            <div className={`max-w-[85%] ${m.role === 'me' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === 'me'
                ? 'bg-brand text-onbrand rounded-br-md' : 'bg-surface border border-borderTheme text-textPrimary rounded-bl-md shadow-sm'}`}>
                {m.text}
              </div>
              {m.draft && m.id === lastDraft && lines.length > 0 && draftCard}
              {m.chips && m.chips.length > 0 && msgs.indexOf(m) > lastMine && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.chips.map(c => (c.hint ? (
                    <button key={c.label} type="button" onClick={c.onPick} disabled={busy || typing}
                            className="w-full sm:w-[calc(50%-0.375rem)] rounded-xl border border-borderTheme bg-surface px-3 py-2 text-left transition-all hover:border-brand disabled:opacity-50">
                      <span className="block text-[11px] font-bold text-textPrimary">{c.label}</span>
                      <span className="block text-[10px] text-textSecondary leading-snug">{c.hint}</span>
                      {c.note && <span className="mt-0.5 block text-[10px] font-semibold text-brand">{c.note}</span>}
                    </button>
                  ) : (
                    <button key={c.label} type="button" onClick={c.onPick} disabled={busy || typing}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${c.tone === 'primary'
                              ? 'border-brand bg-brand text-onbrand shadow-sm' : 'border-borderTheme bg-surface text-textSecondary hover:border-brand hover:text-brand'}`}>
                      {c.label}
                    </button>
                  )))}
                </div>
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start chat-in">
            <div className="mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Sparkles className="h-3.5 w-3.5" /></div>
            <div className="rounded-2xl rounded-bl-md border border-borderTheme bg-surface px-4 py-3 shadow-sm">
              <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
            </div>
          </div>
        )}
      </div>

      {/* Attachments waiting for the request */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-2 border-t border-borderTheme bg-brand/[0.04]">
          <Paperclip className="h-3.5 w-3.5 text-brand" />
          {attachments.map(f => (
            <span key={f.name} className="inline-flex items-center gap-1.5 rounded-lg border border-borderTheme bg-surface px-2 py-0.5 text-[11px] text-textSecondary">
              {f.name}
              <button type="button" onClick={() => onRemoveAttachment(f.name)} title={`Remove ${f.name}`} className="text-textFaint hover:text-neg"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <span className="text-[10px] text-textFaint">uploaded when the request is raised</span>
        </div>
      )}

      {/* What is commonly bought with what they are typing — the suggestions
          the old composer showed, still live as the message is written. */}
      {(() => {
        // What they are typing, or what the request already holds — so the
        // companions stay on offer while the draft is being built.
        const cat = suggestFor(input) || (lines.length ? suggestFor(lines.map(l => l.productName).join(' ')) : undefined);
        if (!cat) return null;
        const have = new Set(lines.map(l => l.productName.toLowerCase()));
        const offer = cat.items.filter(i => !have.has(i.toLowerCase()));
        if (!offer.length) return null;
        return (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5 border-t border-borderTheme">
            <span className="inline-flex items-center gap-1 text-[10px] text-textSecondary">
              <Sparkles className="h-3 w-3 text-brand" /> {cat.category} — often requested together:
            </span>
            {offer.map(name => (
              <button key={name} type="button" onClick={() => void addSuggested(name)} disabled={busy || typing}
                      className="rounded-full border border-borderTheme bg-surface px-2.5 py-1 text-[11px] font-semibold text-textSecondary hover:border-brand hover:text-brand disabled:opacity-50">
                + {name}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Composer */}
      <form onSubmit={e => { e.preventDefault(); if (!input.trim() && ready) submit(); else void send(); }}
            className="flex items-center gap-2 px-4 py-3 border-t border-borderTheme bg-surface">
        <button type="button" onClick={onAttach} title="Add attachment" className="rounded-full p-2 text-textSecondary hover:bg-secondary hover:text-textPrimary">
          <Paperclip className="h-5 w-5" />
        </button>
        <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
               placeholder={ask === 'branch' ? 'Type a branch, or pick one above…'
                 : ask === 'department' ? 'Type a department, or pick one above…'
                   : ask === 'neededBy' ? 'e.g. in 2 weeks, 15 Oct, next month…'
                     : ask === 'qty' ? 'Type a number…'
                       : 'Message the assistant — item, quantity, branch, date…'}
               className="flex-1 bg-transparent text-sm text-textPrimary placeholder:text-textFaint focus:outline-none" />
        <input ref={dateRef} type="date" className="sr-only" tabIndex={-1} aria-hidden="true"
               min={new Date().toISOString().slice(0, 10)}
               onChange={e => { if (e.target.value) { const [y, mo, d] = e.target.value.split('-').map(Number); answer('neededBy', new Date(y, mo - 1, d)); } }} />
        <button type="button" onClick={onVoice} title="Speak your request" className="rounded-full p-2 text-textSecondary hover:bg-secondary hover:text-textPrimary">
          <Mic className="h-5 w-5" />
        </button>
        <button type="submit" disabled={(!input.trim() && !ready) || busy || typing}
                aria-label={ready && !input.trim() ? 'Review & submit' : 'Send'} title={ready && !input.trim() ? 'Review & submit' : 'Send'}
                className="grid h-9 w-9 place-items-center rounded-full bg-brand text-onbrand shadow disabled:opacity-40">
          {ready && !input.trim() ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
