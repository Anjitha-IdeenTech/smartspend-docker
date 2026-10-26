/**
 * Favourite products — what a requester orders again and again, one tap away
 * (`/api/smartspend/favorites`).
 *
 * Every favourite carries what the company knows about it: how often this user
 * ordered it, the last price paid and to whom, and whether a running rate
 * contract covers it. A selection of favourites becomes a request in one tap.
 * Beside the list sit products worth keeping, read off real requests — the
 * ones the user keeps asking for, and what their department asks for most.
 *
 * Three pieces share one list: the Favourites tab, the quick bar above the
 * New Request chat, and the heart beside each line of the request form.
 *
 * Favourite groups are named sets of products ordered together ("New joiner
 * kit"): picked, raised or added to the request form's lines in one go.
 */
import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, FileText, Heart, Layers, Minus, Pencil, Plus, Send, ShieldCheck,
  Sparkles, Trash2, TrendingDown, TrendingUp, Users, X,
} from 'lucide-react';

export interface Favorite {
  id: number; productName: string; category: string;
  defaultQty: number; targetPrice: number; note: string;
  timesOrdered: number; lastOrdered: string; lastRequest: string;
  lastPaid: number; lastVendor: string; lastPaidOn: string;
  contract: { ref: string; vendor: string; price: number } | null;
}

interface Frequent {
  productName: string; timesOrdered: number; lastOrdered: string;
  usualQty: number; lastPrice: number; category: string;
}

interface Popular {
  productName: string; colleagues: number; timesOrdered: number;
  usualQty: number; lastPrice: number; category: string;
}

/** A named set of products ordered together. */
export interface FavoriteGroup { id: number; name: string; items: { productName: string; qty: number; price: number }[] }

interface Feed {
  favorites: Favorite[]; frequent: Frequent[]; popular: Popular[];
  categories: string[]; department: string; groups?: FavoriteGroup[];
}

/** A line handed to the request flow. */
export interface FavoriteLine { productName: string; productQty: number; targetPrice: number }

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const day = (iso: string) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '';
const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The same product twice becomes one line, quantities added. */
export function mergeLines(lines: FavoriteLine[]): FavoriteLine[] {
  const out: FavoriteLine[] = [];
  for (const l of lines) {
    const at = out.findIndex(o => fold(o.productName) === fold(l.productName));
    if (at >= 0) out[at] = { ...out[at], productQty: out[at].productQty + l.productQty, targetPrice: out[at].targetPrice || l.targetPrice };
    else out.push({ ...l });
  }
  return out;
}

const groupLines = (g: FavoriteGroup): FavoriteLine[] =>
  g.items.map(i => ({ productName: i.productName, productQty: i.qty || 1, targetPrice: i.price || 0 }));

/** The price a favourite is ordered at: the user's own, else the contract's, else the last paid. */
const priceOf = (f: Favorite) => f.targetPrice || f.contract?.price || f.lastPaid || 0;

// ---------------------------------------------------------------------------
// One list, shared by every piece on screen: a heart tapped on the request
// form shows on the Favourites tab without another round trip.
// ---------------------------------------------------------------------------
let shared: { key: string; feed: Feed | null; error: string } = { key: '', feed: null, error: '' };
const listeners = new Set<(s: typeof shared) => void>();
const publish = (next: Partial<typeof shared>) => {
  shared = { ...shared, ...next };
  listeners.forEach(fn => fn(shared));
};

async function reload(fetcher: Fetcher, key: string) {
  try {
    const res = await fetcher('/api/smartspend/favorites', { method: 'GET' });
    const body = await res.json().catch(() => ({}));
    if (key !== shared.key) return; // signed out, or someone else signed in
    if (!res.ok) { publish({ error: body?.error || 'Favourites could not be loaded.' }); return; }
    publish({ feed: body, error: '' });
  } catch (e) {
    if (key === shared.key) publish({ error: e instanceof Error ? e.message : 'Favourites could not be loaded.' });
  }
}

export function useFavorites(fetcher: Fetcher, offline: boolean, userKey: string) {
  const [state, setState] = useState(shared);
  useEffect(() => {
    if (offline || !userKey) return;
    listeners.add(setState);
    if (shared.key !== userKey) {
      publish({ key: userKey, feed: null, error: '' });
      reload(fetcher, userKey);
    } else {
      setState(shared);
    }
    return () => { listeners.delete(setState); };
  }, [offline, userKey]);

  const post = async (path: string, body: object) => {
    const res = await fetcher(path, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'That was not saved.');
    await reload(fetcher, userKey);
    return data;
  };

  const feed = shared.key === userKey ? state.feed : null;
  const find = (name: string) => feed?.favorites.find(f => fold(f.productName) === fold(name));
  return {
    feed,
    error: state.error,
    find,
    star: (line: { productName: string; qty?: number; price?: number; category?: string }) =>
      post('/api/smartspend/favorites/save', {
        productName: line.productName, defaultQty: line.qty || undefined,
        targetPrice: line.price || undefined, category: line.category || undefined,
      }),
    update: (f: Pick<Favorite, 'id' | 'productName' | 'defaultQty' | 'targetPrice' | 'note'>) =>
      post('/api/smartspend/favorites/save', {
        id: f.id, productName: f.productName, defaultQty: f.defaultQty, targetPrice: f.targetPrice, note: f.note,
      }),
    unstar: (id: number) => post('/api/smartspend/favorites/delete', { id }),
    reorder: (ids: number[]) => post('/api/smartspend/favorites/reorder', { ids }),
    saveGroup: (g: { id?: number; name: string; items: FavoriteGroup['items'] }) =>
      post('/api/smartspend/favorites/groups/save', g),
    deleteGroup: (id: number) => post('/api/smartspend/favorites/groups/delete', { id }),
  };
}

// ---------------------------------------------------------------------------
// The heart beside a request line.
// ---------------------------------------------------------------------------
export function FavoriteToggle({ fetcher, offline, userKey, productName, qty, price }: {
  fetcher: Fetcher; offline: boolean; userKey: string;
  productName: string; qty: number; price: number;
}) {
  const fav = useFavorites(fetcher, offline, userKey);
  const [busy, setBusy] = useState(false);
  if (offline || !fav.feed || productName.trim().length < 3) return null;
  const existing = fav.find(productName);
  const toggle = async () => {
    setBusy(true);
    try {
      if (existing) await fav.unstar(existing.id);
      else await fav.star({ productName: productName.trim(), qty, price });
    } catch { /* the heart simply stays as it was */ }
    setBusy(false);
  };
  return (
    <button type="button" onClick={toggle} disabled={busy}
            title={existing ? 'Remove from your favourites' : 'Save to your favourites — order it again in one tap'}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold transition-all disabled:opacity-50 ${
              existing ? 'text-neg' : 'text-textFaint hover:text-neg'}`}>
      <Heart className={`h-3.5 w-3.5 ${existing ? 'fill-current' : ''}`} />
      {existing ? 'In your favourites' : 'Save to favourites'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Selection with quantities — the basket a request is raised from.
// ---------------------------------------------------------------------------
function useBasket() {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [groups, setGroups] = useState<Record<number, true>>({});
  return {
    picked,
    groups,
    has: (id: number) => id in picked,
    hasGroup: (id: number) => id in groups,
    toggle: (f: Favorite) => setPicked(prev => {
      const next = { ...prev };
      if (f.id in next) delete next[f.id]; else next[f.id] = f.defaultQty || 1;
      return next;
    }),
    toggleGroup: (id: number) => setGroups(prev => {
      const next = { ...prev };
      if (id in next) delete next[id]; else next[id] = true;
      return next;
    }),
    setQty: (id: number, qty: number) => setPicked(prev => ({ ...prev, [id]: Math.max(1, qty) })),
    selectAll: (list: Favorite[]) => setPicked(Object.fromEntries(list.map(f => [f.id, f.defaultQty || 1]))),
    clear: () => { setPicked({}); setGroups({}); },
  };
}

function linesFor(list: Favorite[], picked: Record<number, number>,
                  groups: FavoriteGroup[] = [], pickedGroups: Record<number, true> = {}): FavoriteLine[] {
  return mergeLines([
    ...groups.filter(g => g.id in pickedGroups).flatMap(groupLines),
    ...list.filter(f => f.id in picked).map(f => ({
      productName: f.productName, productQty: picked[f.id], targetPrice: priceOf(f),
    })),
  ]);
}

// ---------------------------------------------------------------------------
// Quick bar above the New Request chat.
// ---------------------------------------------------------------------------
export function FavoritesQuickBar({ fetcher, offline, userKey, onRaise, onManage, busy }: {
  fetcher: Fetcher; offline: boolean; userKey: string;
  onRaise: (lines: FavoriteLine[]) => void; onManage: () => void; busy?: boolean;
}) {
  const fav = useFavorites(fetcher, offline, userKey);
  const basket = useBasket();
  const feed = fav.feed;
  if (offline || !feed) return null;

  const groups = feed.groups || [];
  if (!feed.favorites.length && !groups.length) {
    const ideas = feed.frequent.slice(0, 3);
    if (!ideas.length) return null;
    return (
      <div className="rounded-2xl border border-dashed border-borderTheme bg-surface/60 px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-textSecondary">
          <Sparkles className="h-3.5 w-3.5 text-brand" />You order these often — keep them one tap away:
        </span>
        {ideas.map(i => (
          <button key={i.productName}
                  onClick={() => fav.star({ productName: i.productName, qty: i.usualQty, price: i.lastPrice, category: i.category })}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary border border-borderTheme text-[11px] font-bold text-textSecondary hover:text-neg hover:border-neg/40 transition-all">
            <Heart className="h-3 w-3" />{i.productName}
          </button>
        ))}
      </div>
    );
  }

  const lines = linesFor(feed.favorites, basket.picked, groups, basket.groups);
  return (
    <div className="rounded-2xl border border-borderTheme bg-surface shadow-sm px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-neg fill-current" />
        <span className="text-xs font-extrabold text-textPrimary">Order again from your favourites</span>
        <span className="text-[11px] text-textFaint">tap to pick, then raise it in one go</span>
        <button onClick={onManage} className="ml-auto text-[11px] font-bold text-brand hover:underline">Manage</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map(g => {
          const on = basket.hasGroup(g.id);
          return (
            <button key={`g${g.id}`} onClick={() => basket.toggleGroup(g.id)}
                    title={g.items.map(i => `${i.qty} × ${i.productName}`).join(' · ')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      on ? 'bg-brand text-onbrand border-transparent shadow-sm'
                         : 'bg-brand/5 text-brand border-brand/30 hover:bg-brand/10'}`}>
              {on ? <Check className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
              {g.name}
              <span className={`text-[10px] font-semibold ${on ? 'opacity-80' : 'opacity-70'}`}>{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
            </button>
          );
        })}
        {feed.favorites.map(f => {
          const on = basket.has(f.id);
          return (
            <button key={f.id} onClick={() => basket.toggle(f)}
                    title={[f.note, f.contract ? `On rate contract ${f.contract.ref}` : '', f.timesOrdered ? `Ordered ${f.timesOrdered}×` : ''].filter(Boolean).join(' · ')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      on ? 'bg-brand text-onbrand border-transparent shadow-sm'
                         : 'bg-secondary text-textSecondary border-borderTheme hover:text-textPrimary'}`}>
              {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {f.productName}
              <span className={`text-[10px] font-semibold ${on ? 'opacity-80' : 'text-textFaint'}`}>× {on ? basket.picked[f.id] : f.defaultQty}</span>
              {f.contract && <ShieldCheck className={`h-3 w-3 ${on ? '' : 'text-pos'}`} />}
            </button>
          );
        })}
      </div>
      {lines.length > 0 && (
        <div className="flex items-center gap-3 pt-1">
          <span className="text-[11px] text-textSecondary">
            {lines.length} item{lines.length === 1 ? '' : 's'} · about <b className="text-textPrimary">{inr(lines.reduce((s, l) => s + l.productQty * l.targetPrice, 0))}</b>
          </span>
          <button onClick={basket.clear} className="text-[11px] text-textFaint hover:text-textPrimary">Clear</button>
          <button onClick={() => { onRaise(lines); basket.clear(); }} disabled={busy}
                  className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all">
            <Send className="h-3.5 w-3.5" />Raise request
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Favourites tab.
// ---------------------------------------------------------------------------
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">{label}</p>
      <p className="font-outfit text-2xl font-extrabold text-textPrimary tabular-nums mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-textFaint mt-0.5">{hint}</p>}
    </div>
  );
}

function PriceSignal({ f }: { f: Favorite }) {
  if (!f.targetPrice || !f.lastPaid) return null;
  const diff = ((f.targetPrice - f.lastPaid) / f.lastPaid) * 100;
  if (Math.abs(diff) < 0.5) return null;
  const up = diff > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${up ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos'}`}
          title="Your usual price against the last price the company paid">
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{diff.toFixed(1)}% vs last paid
    </span>
  );
}

function FavoriteCard({ f, index, count, picked, qty, onPick, onQty, onMove, onEdit, onUnstar }: {
  f: Favorite; index: number; count: number; picked: boolean; qty: number;
  onPick: () => void; onQty: (n: number) => void; onMove: (dir: -1 | 1) => void;
  onEdit: () => void; onUnstar: () => void;
}) {
  const tone = f.contract ? '12 150 137' : '99 86 168';
  return (
    <div className={`req-tile p-4 pl-5 flex flex-col gap-3 ${picked ? 'ring-2 ring-brand' : ''}`}
         style={{ '--tint': tone } as React.CSSProperties}>
      <div className="flex items-start gap-3">
        <button onClick={onPick} title={picked ? 'Leave out of the request' : 'Add to the request'}
                className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-all ${
                  picked ? 'bg-brand border-transparent text-onbrand' : 'border-borderTheme bg-secondary hover:border-brand'}`}>
          {picked && <Check className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <h4 className="font-outfit font-extrabold text-sm text-textPrimary leading-snug">{f.productName}</h4>
          <p className="text-[11px] text-textFaint mt-0.5">
            {[f.category, f.note].filter(Boolean).join(' · ') || 'No category yet'}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} title="Move up"
                  className="p-1 rounded text-textFaint hover:text-textPrimary disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button onClick={() => onMove(1)} disabled={index === count - 1} title="Move down"
                  className="p-1 rounded text-textFaint hover:text-textPrimary disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button onClick={onEdit} title="Edit"
                  className="p-1 rounded text-textFaint hover:text-textPrimary"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onUnstar} title="Remove from favourites"
                  className="p-1 rounded text-neg hover:brightness-110"><Heart className="h-3.5 w-3.5 fill-current" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-borderTheme">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">Your usual</p>
          <p className="text-xs font-bold text-textPrimary mt-0.5 tabular-nums">
            {f.defaultQty} × {f.targetPrice ? inr(f.targetPrice) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-textFaint font-bold">Last paid</p>
          <p className="text-xs font-bold text-textPrimary mt-0.5 tabular-nums">
            {f.lastPaid ? inr(f.lastPaid) : 'Never bought yet'}
          </p>
          {f.lastPaid > 0 && <p className="text-[10px] text-textFaint truncate">{f.lastVendor}{f.lastPaidOn && ` · ${day(f.lastPaidOn)}`}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {f.contract ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-pos/10 text-pos border border-pos/25"
                title={`Rate contract ${f.contract.ref} with ${f.contract.vendor} — no sourcing round needed`}>
            <ShieldCheck className="h-3 w-3" />Contract {inr(f.contract.price)} · {f.contract.vendor}
          </span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gold/10 text-gold border border-gold/25">Needs sourcing</span>
        )}
        <PriceSignal f={f} />
        {f.timesOrdered > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-textFaint" title={f.lastRequest ? `Last on ${f.lastRequest}` : undefined}>
            <FileText className="h-3 w-3" />Ordered {f.timesOrdered}× {f.lastOrdered && `· last ${day(f.lastOrdered)}`}
          </span>
        )}
      </div>

      {picked && (
        <div className="flex items-center gap-2 rounded-xl bg-brand/5 border border-brand/20 px-3 py-2">
          <span className="text-[11px] font-bold text-textSecondary">Quantity</span>
          <button onClick={() => onQty(qty - 1)} className="p-1 rounded-md bg-surface border border-borderTheme"><Minus className="h-3 w-3" /></button>
          <input type="number" min={1} value={qty} onChange={e => onQty(Number(e.target.value) || 1)}
                 className="w-14 text-center text-xs font-bold bg-surface border border-borderTheme rounded-md py-1 text-textPrimary" />
          <button onClick={() => onQty(qty + 1)} className="p-1 rounded-md bg-surface border border-borderTheme"><Plus className="h-3 w-3" /></button>
          <span className="ml-auto text-[11px] font-bold text-textPrimary tabular-nums">{inr(qty * priceOf(f))}</span>
        </div>
      )}
    </div>
  );
}

const field = 'w-full text-sm px-3 py-2 bg-secondary border border-borderTheme rounded-lg text-textPrimary focus:outline-none focus:border-brand';
const label = 'text-[10px] font-bold uppercase tracking-wider text-textFaint block mb-1.5';

export function FavoritesPage({ fetcher, offline, userKey, onRaise, busy }: {
  fetcher: Fetcher; offline: boolean; userKey: string;
  onRaise: (lines: FavoriteLine[]) => void; busy?: boolean;
}) {
  const fav = useFavorites(fetcher, offline, userKey);
  const basket = useBasket();
  const [editing, setEditing] = useState<Favorite | null>(null);
  const [adding, setAdding] = useState({ productName: '', qty: '1', price: '' });
  // The group being created or changed.
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError('');
    try {
      await fn();
      if (done) { setToast(done); window.setTimeout(() => setToast(''), 3000); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That was not saved.');
    }
  };

  if (offline) {
    return (
      <div className="max-w-6xl mx-auto rounded-2xl bg-surface border border-borderTheme p-6 text-xs text-textFaint">
        Favourites are kept in Odoo — sign in against the server to use them.
      </div>
    );
  }
  const feed = fav.feed;
  if (!feed) {
    return (
      <div className={`max-w-6xl mx-auto rounded-2xl bg-surface border border-borderTheme p-6 text-xs ${fav.error ? 'text-neg' : 'text-textFaint'}`}>
        {fav.error || 'Loading your favourites…'}
      </div>
    );
  }

  const list = feed.favorites;
  const groups = feed.groups || [];
  const lines = linesFor(list, basket.picked, groups, basket.groups);
  const total = lines.reduce((s, l) => s + l.productQty * l.targetPrice, 0);
  const onContract = list.filter(f => f.contract).length;
  const ordered = list.reduce((s, f) => s + f.timesOrdered, 0);
  const move = (index: number, dir: -1 | 1) => {
    const ids = list.map(f => f.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + dir, 0, id);
    run(() => fav.reorder(ids));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-outfit text-3xl font-extrabold tracking-tight text-primary inline-flex items-center gap-2">
            <Heart className="h-7 w-7 text-neg fill-current" />My Favourites
          </h2>
          <p className="text-sm text-textSecondary mt-1">What you order again and again — pick, adjust, and raise the request in one tap.</p>
        </div>
        {list.length > 0 && (
          <button onClick={() => basket.selectAll(list)}
                  className="px-3 py-2 rounded-xl border border-borderTheme bg-surface text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
            Pick everything at my usual quantities
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Favourites" value={String(list.length)} hint="kept one tap away" />
        <Stat label="Times you ordered them" value={String(ordered)} hint="across your past requests" />
        <Stat label="On a rate contract" value={`${onContract} of ${list.length}`} hint="skip sourcing — straight to approval" />
      </div>

      {(toast || error) && (
        <p className={`text-xs rounded-xl px-3 py-2 border ${error ? 'text-neg bg-neg/10 border-neg/25' : 'text-pos bg-pos/10 border-pos/25'}`}>
          {error || toast}
        </p>
      )}

      {/* Favourite groups — products ordered together, added in one go. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-outfit text-lg font-extrabold text-textPrimary inline-flex items-center gap-2"><Layers className="h-5 w-5 text-brand" />Favourite groups</h3>
            <p className="text-[11px] text-textFaint">Products you order together — e.g. a new joiner's kit. Pick a group and every product comes with it.</p>
          </div>
          <button onClick={() => setGroupDraft({ name: '', items: [{ productName: '', qty: '1', price: '' }] })}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-borderTheme bg-surface text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
            <Plus className="h-3.5 w-3.5" />New group
          </button>
        </div>
        {groups.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map(g => {
              const on = basket.hasGroup(g.id);
              const value = g.items.reduce((t, i) => t + (i.qty || 1) * (i.price || 0), 0);
              return (
                <div key={g.id} className={`req-tile p-4 pl-5 flex flex-col gap-3 ${on ? 'ring-2 ring-brand' : ''}`}
                     style={{ '--tint': '99 86 168' } as React.CSSProperties}>
                  <div className="flex items-start gap-3">
                    <button onClick={() => basket.toggleGroup(g.id)} title={on ? 'Leave out of the request' : 'Add the whole group to the request'}
                            className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-all ${
                              on ? 'bg-brand border-transparent text-onbrand' : 'border-borderTheme bg-secondary hover:border-brand'}`}>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-outfit font-extrabold text-sm text-textPrimary leading-snug inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-brand" />{g.name}</h4>
                      <p className="text-[11px] text-textFaint mt-0.5">{g.items.length} product{g.items.length === 1 ? '' : 's'}{value ? ` · about ${inr(value)}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => setGroupDraft({ id: g.id, name: g.name, items: g.items.map(i => ({ productName: i.productName, qty: String(i.qty), price: i.price ? String(i.price) : '' })) })}
                              title="Edit group" className="p-1 rounded text-textFaint hover:text-textPrimary"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { if (window.confirm(`Delete the group “${g.name}”? The products stay in your favourites.`)) run(() => fav.deleteGroup(g.id), `Group “${g.name}” deleted.`); }}
                              title="Delete group" className="p-1 rounded text-textFaint hover:text-neg"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <ul className="space-y-1 pt-3 border-t border-borderTheme">
                    {g.items.map(i => (
                      <li key={i.productName} className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-textPrimary tabular-nums w-10 shrink-0">{i.qty} ×</span>
                        <span className="flex-1 truncate text-textSecondary" title={i.productName}>{i.productName}</span>
                        <span className="text-[11px] text-textFaint tabular-nums">{i.price ? inr(i.price) : '—'}</span>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => onRaise(groupLines(g))} disabled={busy}
                          className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-brand/10 text-brand text-xs font-bold hover:bg-brand/15 disabled:opacity-50 transition-all">
                    <Send className="h-3.5 w-3.5" />Raise a request with this group
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-borderTheme bg-surface/60 p-5 text-center">
            <p className="text-xs text-textFaint">No groups yet. Tick a few favourites below and choose <b>Save as group</b>, or start a <b>New group</b>.</p>
          </div>
        )}
      </div>

      {list.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((f, i) => (
            <FavoriteCard key={f.id} f={f} index={i} count={list.length}
                          picked={basket.has(f.id)} qty={basket.picked[f.id] ?? f.defaultQty}
                          onPick={() => basket.toggle(f)} onQty={n => basket.setQty(f.id, n)}
                          onMove={dir => move(i, dir)} onEdit={() => setEditing(f)}
                          onUnstar={() => run(() => fav.unstar(f.id), `${f.productName} removed from your favourites.`)} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-borderTheme bg-surface/60 p-8 text-center">
          <Heart className="h-8 w-8 text-textFaint mx-auto" />
          <p className="text-sm font-bold text-textPrimary mt-2">No favourites yet</p>
          <p className="text-xs text-textFaint mt-1">Tap a heart below, or on any line of a request, to keep a product one tap away.</p>
        </div>
      )}

      {/* Star something not in the history yet. */}
      <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-4">
        <p className="text-xs font-extrabold text-textPrimary mb-3">Add a favourite</p>
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-12 sm:col-span-6">
            <label className={label}>Product</label>
            <input value={adding.productName} onChange={e => setAdding({ ...adding, productName: e.target.value })}
                   placeholder="e.g. Dell Latitude 5440 Laptop" className={field} />
          </div>
          <div className="col-span-4 sm:col-span-2">
            <label className={label}>Usual qty</label>
            <input type="number" min={1} value={adding.qty} onChange={e => setAdding({ ...adding, qty: e.target.value })} className={field} />
          </div>
          <div className="col-span-8 sm:col-span-2">
            <label className={label}>Usual price ₹</label>
            <input type="number" min={0} value={adding.price} onChange={e => setAdding({ ...adding, price: e.target.value })} className={field} />
          </div>
          <div className="col-span-12 sm:col-span-2">
            <button disabled={adding.productName.trim().length < 2}
                    onClick={() => run(async () => {
                      await fav.star({ productName: adding.productName.trim(), qty: Number(adding.qty) || 1, price: Number(adding.price) || 0 });
                      setAdding({ productName: '', qty: '1', price: '' });
                    }, 'Saved to your favourites.')}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all">
              <Heart className="h-3.5 w-3.5" />Save
            </button>
          </div>
        </div>
      </div>

      {/* Products worth starring, read off real requests. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {feed.frequent.length > 0 && (
          <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-4">
            <p className="text-xs font-extrabold text-textPrimary inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-brand" />You keep ordering these
            </p>
            <p className="text-[11px] text-textFaint mt-0.5 mb-3">From your own requests — not yet in your favourites.</p>
            <div className="space-y-2">
              {feed.frequent.map(i => (
                <div key={i.productName} className="flex items-center gap-3 rounded-xl bg-secondary/50 border border-borderTheme px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-textPrimary truncate">{i.productName}</p>
                    <p className="text-[10px] text-textFaint">
                      {i.timesOrdered}× ordered{i.lastOrdered && ` · last ${day(i.lastOrdered)}`} · usually {i.usualQty} at {inr(i.lastPrice)}
                    </p>
                  </div>
                  <button onClick={() => run(() => fav.star({ productName: i.productName, qty: i.usualQty, price: i.lastPrice, category: i.category }),
                                             `${i.productName} saved to your favourites.`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface border border-borderTheme text-[11px] font-bold text-textSecondary hover:text-neg hover:border-neg/40 transition-all">
                    <Heart className="h-3 w-3" />Save
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {feed.popular.length > 0 && (
          <div className="rounded-2xl bg-surface border border-borderTheme shadow-sm p-4">
            <p className="text-xs font-extrabold text-textPrimary inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-brand" />Popular {feed.department ? `in ${feed.department}` : 'across the company'}
            </p>
            <p className="text-[11px] text-textFaint mt-0.5 mb-3">What your colleagues order most.</p>
            <div className="space-y-2">
              {feed.popular.map(i => (
                <div key={i.productName} className="flex items-center gap-3 rounded-xl bg-secondary/50 border border-borderTheme px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-textPrimary truncate">{i.productName}</p>
                    <p className="text-[10px] text-textFaint">
                      {i.colleagues} colleague{i.colleagues === 1 ? '' : 's'} · {i.timesOrdered} request{i.timesOrdered === 1 ? '' : 's'} · usually {i.usualQty} at {inr(i.lastPrice)}
                    </p>
                  </div>
                  <button onClick={() => run(() => fav.star({ productName: i.productName, qty: i.usualQty, price: i.lastPrice, category: i.category }),
                                             `${i.productName} saved to your favourites.`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface border border-borderTheme text-[11px] font-bold text-textSecondary hover:text-neg hover:border-neg/40 transition-all">
                    <Heart className="h-3 w-3" />Save
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The basket — sticks to the bottom while anything is picked. */}
      {lines.length > 0 && (
        <div className="sticky bottom-4 z-30">
          <div className="rounded-2xl bg-surface border border-brand/40 shadow-xl px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-xs font-extrabold text-textPrimary">{lines.length} item{lines.length === 1 ? '' : 's'} picked</span>
            <span className="text-[11px] text-textSecondary truncate max-w-md">
              {lines.map(l => `${l.productQty} × ${l.productName}`).join(' · ')}
            </span>
            <span className="text-xs text-textSecondary">Estimated <b className="text-textPrimary tabular-nums">{inr(total)}</b></span>
            <button onClick={basket.clear} className="text-[11px] text-textFaint hover:text-textPrimary">Clear</button>
            <button onClick={() => setGroupDraft({ name: '', items: lines.map(l => ({ productName: l.productName, qty: String(l.productQty), price: l.targetPrice ? String(l.targetPrice) : '' })) })}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary transition-all">
              <Layers className="h-3.5 w-3.5" />Save as group
            </button>
            <button onClick={() => { onRaise(lines); basket.clear(); }} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all">
              <Send className="h-3.5 w-3.5" />{busy ? 'Drafting…' : 'Raise request'}
            </button>
          </div>
        </div>
      )}

      {groupDraft && (
        <GroupEditor draft={groupDraft} favorites={list} onCancel={() => setGroupDraft(null)}
                     onSave={async g => {
                       let ok = false;
                       await run(async () => { await fav.saveGroup(g); ok = true; },
                                 g.id ? `Group “${g.name}” updated.` : `Group “${g.name}” saved — pick it to add every product at once.`);
                       if (ok) { setGroupDraft(null); basket.clear(); }
                       return ok;
                     }} />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
          <div className="w-full max-w-md rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
              <h3 className="font-outfit font-extrabold text-lg text-textPrimary">Edit favourite</h3>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className={label}>Product</label>
                <input value={editing.productName} onChange={e => setEditing({ ...editing, productName: e.target.value })} className={field} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Usual quantity</label>
                  <input type="number" min={1} value={editing.defaultQty}
                         onChange={e => setEditing({ ...editing, defaultQty: Number(e.target.value) })} className={field} />
                </div>
                <div>
                  <label className={label}>Usual price ₹</label>
                  <input type="number" min={0} value={editing.targetPrice}
                         onChange={e => setEditing({ ...editing, targetPrice: Number(e.target.value) })} className={field} />
                </div>
              </div>
              <div>
                <label className={label}>Note</label>
                <input value={editing.note} placeholder="e.g. For new joiners"
                       onChange={e => setEditing({ ...editing, note: e.target.value })} className={field} />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
              <button onClick={() => setEditing(null)}
                      className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary">
                Cancel
              </button>
              <button disabled={!editing.productName.trim() || !(editing.defaultQty > 0)}
                      onClick={() => run(async () => { await fav.update(editing); setEditing(null); }, 'Favourite updated.')}
                      className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creating or changing a favourite group.
// ---------------------------------------------------------------------------
interface GroupDraft { id?: number; name: string; items: { productName: string; qty: string; price: string }[] }

function GroupEditor({ draft, favorites, onCancel, onSave }: {
  draft: GroupDraft; favorites: Favorite[]; onCancel: () => void;
  onSave: (g: { id?: number; name: string; items: FavoriteGroup['items'] }) => Promise<boolean>;
}) {
  const [d, setD] = useState<GroupDraft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = d.items.filter(i => i.productName.trim());
  const valid = !!d.name.trim() && items.length > 0 && items.every(i => Number(i.qty) > 0);
  const setItem = (idx: number, patch: Partial<GroupDraft['items'][number]>) =>
    setD(prev => ({ ...prev, items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const inGroup = (name: string) => d.items.some(i => fold(i.productName) === fold(name));
  const addFavorite = (f: Favorite) => setD(prev => ({
    ...prev,
    items: [...prev.items.filter(i => i.productName.trim()), { productName: f.productName, qty: String(f.defaultQty || 1), price: priceOf(f) ? String(priceOf(f)) : '' }],
  }));
  const save = async () => {
    setError('');
    if (!valid) { setError(!d.name.trim() ? 'Give the group a name.' : 'Add at least one product, each with a quantity above zero.'); return; }
    setBusy(true);
    const ok = await onSave({
      id: d.id, name: d.name.trim(),
      items: items.map(i => ({ productName: i.productName.trim(), qty: Number(i.qty) || 1, price: Number(i.price) || 0 })),
    });
    setBusy(false);
    if (!ok) setError('The group was not saved — see the message above.');
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-borderTheme shadow-xl my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-borderTheme">
          <h3 className="font-outfit font-extrabold text-lg text-textPrimary inline-flex items-center gap-2"><Layers className="h-5 w-5 text-brand" />{d.id ? 'Edit group' : 'New favourite group'}</h3>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-textFaint hover:text-textPrimary hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={label}>Group name</label>
            <input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="e.g. New joiner kit" className={field} autoFocus />
          </div>
          <div>
            <div className="grid grid-cols-12 gap-2 text-[10px] text-textFaint font-bold uppercase tracking-wider mb-1">
              <span className="col-span-7">Product</span><span className="col-span-2">Qty</span><span className="col-span-2">Price ₹</span><span className="col-span-1" />
            </div>
            <div className="space-y-2">
              {d.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input value={it.productName} onChange={e => setItem(idx, { productName: e.target.value })} placeholder="Product"
                         list="favorite-group-products" className={`col-span-7 ${field}`} />
                  <input type="number" min={1} value={it.qty} onChange={e => setItem(idx, { qty: e.target.value })} className={`col-span-2 ${field}`} />
                  <input type="number" min={0} value={it.price} onChange={e => setItem(idx, { price: e.target.value })} className={`col-span-2 ${field}`} />
                  <button onClick={() => setD(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))} title="Remove"
                          className="col-span-1 flex justify-center text-textFaint hover:text-neg"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <datalist id="favorite-group-products">{favorites.map(f => <option key={f.id} value={f.productName} />)}</datalist>
            <button onClick={() => setD(prev => ({ ...prev, items: [...prev.items, { productName: '', qty: '1', price: '' }] }))}
                    className="mt-2 text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Add a product</button>
          </div>
          {favorites.some(f => !inGroup(f.productName)) && (
            <div>
              <p className={label}>Add from your favourites</p>
              <div className="flex flex-wrap gap-1.5">
                {favorites.filter(f => !inGroup(f.productName)).map(f => (
                  <button key={f.id} onClick={() => addFavorite(f)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary border border-borderTheme text-[11px] font-bold text-textSecondary hover:text-textPrimary">
                    <Plus className="h-3 w-3" />{f.productName}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-neg">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-borderTheme">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-borderTheme bg-secondary text-xs font-bold text-textSecondary hover:text-textPrimary">Cancel</button>
          <button onClick={save} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-brand text-onbrand text-xs font-bold hover:brightness-110 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save group'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// On the request form: add a group, or several favourites, as lines at once.
// ---------------------------------------------------------------------------
export function FavoritesLinePicker({ fetcher, offline, userKey, onAdd }: {
  fetcher: Fetcher; offline: boolean; userKey: string;
  onAdd: (lines: FavoriteLine[]) => void;
}) {
  const fav = useFavorites(fetcher, offline, userKey);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<number, true>>({});
  const feed = fav.feed;
  if (offline || !feed || (!feed.favorites.length && !(feed.groups || []).length)) return null;
  const groups = feed.groups || [];
  const chosen = feed.favorites.filter(f => f.id in picked);
  const add = (lines: FavoriteLine[]) => { onAdd(mergeLines(lines)); setPicked({}); setOpen(false); };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
              className="text-xs font-semibold text-brand hover:underline flex items-center gap-1">
        <Heart className="h-3.5 w-3.5" />Add from favourites
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-borderTheme bg-surface shadow-lg p-3 space-y-3">
          {groups.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint mb-1.5">Groups — every product at once</p>
              <div className="space-y-1.5">
                {groups.map(g => (
                  <div key={g.id} className="flex items-center gap-2 rounded-lg bg-secondary/60 border border-borderTheme px-2.5 py-1.5">
                    <Layers className="h-3.5 w-3.5 text-brand shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-textPrimary truncate">{g.name}</p>
                      <p className="text-[10px] text-textFaint truncate">{g.items.map(i => `${i.qty} × ${i.productName}`).join(' · ')}</p>
                    </div>
                    <button type="button" onClick={() => add(groupLines(g))}
                            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand text-onbrand text-[11px] font-bold hover:brightness-110">
                      <Plus className="h-3 w-3" />Add {g.items.length} line{g.items.length === 1 ? '' : 's'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {feed.favorites.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-textFaint mb-1.5">Favourites — tick as many as you need</p>
              <div className="flex flex-wrap gap-1.5">
                {feed.favorites.map(f => {
                  const on = f.id in picked;
                  return (
                    <button type="button" key={f.id}
                            onClick={() => setPicked(prev => { const n = { ...prev }; if (on) delete n[f.id]; else n[f.id] = true; return n; })}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                              on ? 'bg-brand text-onbrand border-transparent' : 'bg-secondary text-textSecondary border-borderTheme hover:text-textPrimary'}`}>
                      {on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{f.productName}
                      <span className="opacity-70 font-semibold">× {f.defaultQty}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button type="button" disabled={!chosen.length}
                        onClick={() => add(chosen.map(f => ({ productName: f.productName, productQty: f.defaultQty || 1, targetPrice: priceOf(f) })))}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand text-onbrand text-[11px] font-bold hover:brightness-110 disabled:opacity-40">
                  <Plus className="h-3 w-3" />Add {chosen.length || ''} selected
                </button>
                <button type="button" onClick={() => { setPicked({}); setOpen(false); }} className="text-[11px] text-textFaint hover:text-textPrimary">Close</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
