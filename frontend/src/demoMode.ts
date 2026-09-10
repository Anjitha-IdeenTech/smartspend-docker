/**
 * Running the walkthrough with no Odoo behind it.
 *
 * The portal is bearer-authenticated and the landing screen is the gate, so a
 * visitor who cannot reach Odoo never gets past sign-in. That is right for a
 * deployment and wrong for a hosted demo: a static build on GitHub Pages has no
 * Odoo to reach — `127.0.0.1` there is the *viewer's* machine, and an HTTPS page
 * may not call it anyway.
 *
 * So when the sign-in call cannot connect at all, the portal signs the visitor
 * in locally against the accounts below and runs on its seeded data. Every
 * screen still works; nothing is written anywhere. The banner the app renders in
 * this mode says so, because a demo that quietly invents saved data is worse
 * than one that admits it is a sample.
 *
 * This lives outside App.tsx so the accounts and the URL rules can be tested on
 * their own, without a browser.
 */

/** The token the offline session carries. Not a credential — a marker. */
export const OFFLINE_TOKEN = 'smartspend-offline-demo';

/** The default backend, used when nothing else names one. */
export const DEFAULT_API_URL = 'http://127.0.0.1:8019';

export interface DemoUser {
  id: number;
  name: string;
  login: string;
  email?: string;
  is_manager?: boolean;
  is_buyer?: boolean;
  is_vendor?: boolean;
  roles?: string[];
  defaultRole?: string;
  company?: string;
}

interface DemoAccount extends DemoUser {
  password: string;
}

/**
 * The same five sign-ins the module seeds, with the roles their Odoo groups
 * imply — manager implies buyer implies requester, which is why the manager
 * account can act as all three. Kept in step with
 * `data/smartspend_demo_users_data.xml`; if that file gains an account, this
 * list should too.
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: 101, name: 'Demo Requester', login: 'requester@smartspend.demo',
    password: 'requester', company: 'SmartSpend Demo',
    roles: ['Employee'], defaultRole: 'Employee',
  },
  {
    id: 102, name: 'Demo SCM Buyer', login: 'buyer@smartspend.demo',
    password: 'buyer', company: 'SmartSpend Demo',
    is_buyer: true,
    roles: ['Employee', 'SCM Buyer'], defaultRole: 'SCM Buyer',
  },
  {
    id: 103, name: 'Demo Procurement Manager', login: 'manager@smartspend.demo',
    password: 'manager', company: 'SmartSpend Demo',
    is_manager: true, is_buyer: true,
    roles: ['Employee', 'SCM Buyer', 'Manager', 'CEO'], defaultRole: 'Manager',
  },
  {
    id: 104, name: 'Demo Vendor', login: 'vendor@smartspend.demo',
    password: 'vendor', company: 'Primus Technologies',
    is_vendor: true,
    roles: ['Vendor'], defaultRole: 'Vendor',
  },
  {
    id: 105, name: 'SmartSpend Admin', login: 'admin@smartspend.demo',
    password: 'admin', company: 'SmartSpend Demo',
    is_manager: true, is_buyer: true,
    roles: ['Employee', 'SCM Buyer', 'Manager', 'CEO'], defaultRole: 'Manager',
  },
];

/**
 * The demo account for a sign-in, or null when there is no such pair.
 *
 * The login is matched case-insensitively and the bare name works too
 * ("manager" as well as "manager@smartspend.demo"), because that is what people
 * type when they are reading the hint off the login screen. The password is
 * matched exactly.
 */
export function resolveDemoUser(login: string, password: string): DemoUser | null {
  const wanted = (login || '').trim().toLowerCase();
  if (!wanted) return null;
  const account = DEMO_ACCOUNTS.find(a =>
    a.login === wanted || a.login.split('@')[0] === wanted);
  if (!account || account.password !== password) return null;
  const { password: _password, ...user } = account;
  return user;
}

/**
 * Which backend to talk to.
 *
 * `?api=` wins so one hosted build can be pointed at a tunnelled Odoo without
 * rebuilding — that is how a live demo is driven from the same link. Otherwise
 * whatever was stored last, then the default. A blank or non-http value is
 * ignored rather than obeyed, so a mistyped parameter falls back instead of
 * breaking every call.
 */
export function resolveApiUrl(
  search: string, stored: string | null, fallback: string = DEFAULT_API_URL,
): string {
  let fromQuery: string | null = null;
  try {
    fromQuery = new URLSearchParams(search || '').get('api');
  } catch {
    fromQuery = null;
  }
  for (const candidate of [fromQuery, stored]) {
    const value = (candidate || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/.+/i.test(value)) return value;
  }
  return fallback;
}
