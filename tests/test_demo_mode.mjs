// The hosted build has no Odoo behind it, so sign-in falls back to a local
// session and ?api= redirects the whole portal at a tunnelled backend. Both
// rules are pure, so they are tested here directly rather than mirrored.
//
// Needs no running Odoo. Compiles src/demoMode.ts and imports the result.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.SMARTSPEND_UI
  || resolve(HERE, '../../spendwise_frontend/smartspend-demo');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => {
  c ? pass++ : fail++;
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? ' :: ' + d : ''));
};

const out = mkdtempSync(join(tmpdir(), 'smartspend-demo-'));
// Run from the temp directory and with the project's own tsc: given files on
// the command line, tsc refuses to start if a tsconfig.json sits in the cwd.
execFileSync(join(APP, 'node_modules/.bin/tsc'), [join(APP, 'src/demoMode.ts'),
  '--outDir', out, '--target', 'es2022', '--module', 'es2022'],
  { cwd: out, stdio: 'pipe' });
const { resolveDemoUser, resolveApiUrl, DEFAULT_API_URL, OFFLINE_TOKEN, DEMO_ACCOUNTS } =
  await import(pathToFileURL(join(out, 'demoMode.js')).href);

console.log('--- signing in with no Odoo ---');
const mgr = resolveDemoUser('manager@smartspend.demo', 'manager');
ok('the manager account resolves', !!mgr, mgr && mgr.name);
ok('and carries the roles its Odoo groups imply',
   mgr && ['Employee', 'SCM Buyer', 'Manager', 'CEO'].every(r => mgr.roles.includes(r)),
   mgr && mgr.roles.join(', '));
ok('and lands on Manager', mgr && mgr.defaultRole === 'Manager', mgr && mgr.defaultRole);
ok('the bare name works too — it is what people type',
   !!resolveDemoUser('manager', 'manager'));
ok('the login is matched case-insensitively',
   !!resolveDemoUser('MANAGER@SmartSpend.Demo', 'manager'));
ok('the buyer holds SCM Buyer but not Manager', (() => {
  const b = resolveDemoUser('buyer', 'buyer');
  return b && b.roles.includes('SCM Buyer') && !b.roles.includes('Manager');
})());
ok('the vendor is a vendor and nothing else', (() => {
  const v = resolveDemoUser('vendor', 'vendor');
  return v && v.is_vendor === true && v.roles.join() === 'Vendor';
})());
ok('a wrong password is refused', resolveDemoUser('manager', 'nope') === null);
ok('an unknown login is refused', resolveDemoUser('nobody@example.com', 'x') === null);
ok('an empty login is refused', resolveDemoUser('', '') === null);
ok('no account leaks its password',
   DEMO_ACCOUNTS.every(a => !('password' in (resolveDemoUser(a.login, a.password) || {}))));
ok('the offline token is a marker, not a credential',
   typeof OFFLINE_TOKEN === 'string' && !OFFLINE_TOKEN.includes('@'));

console.log('\n--- pointing the hosted build at a backend ---');
ok('?api= wins over the stored value',
   resolveApiUrl('?api=https://demo.trycloudflare.com', 'http://127.0.0.1:8019')
   === 'https://demo.trycloudflare.com');
ok('a trailing slash is trimmed so paths do not double up',
   resolveApiUrl('?api=https://x.example.com/', null) === 'https://x.example.com');
ok('the stored value is used when there is no parameter',
   resolveApiUrl('', 'http://192.168.1.9:8019') === 'http://192.168.1.9:8019');
ok('a mistyped parameter falls back instead of breaking every call',
   resolveApiUrl('?api=not-a-url', null) === DEFAULT_API_URL);
ok('an empty parameter falls through to the stored value',
   resolveApiUrl('?api=', 'http://127.0.0.1:8019') === 'http://127.0.0.1:8019');
ok('with neither, the default stands',
   resolveApiUrl('', null) === DEFAULT_API_URL);
ok('other query parameters are ignored',
   resolveApiUrl('?utm=x&api=https://a.example.com&z=1', null) === 'https://a.example.com');

console.log('\n' + '='.repeat(60));
console.log(`${pass + fail} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
