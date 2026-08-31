/**
 * The two claims worth proving rather than assuming:
 *   1. under a two-value sort, paging covers every row EXACTLY once
 *   2. the CSV export really is in the on-screen order
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const USER = process.argv[2], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now() / 1000);
const b = Buffer.from(JSON.stringify({ typ: 'platform', userId: USER, iat: n, exp: n + 28800 })).toString('base64url');
const tok = b + '.' + createHmac('sha256', SECRET).update(b).digest('base64url');
const BASE = 'http://localhost:3000/platform/dashboard/submissions';
let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

(async () => {
  const br = await chromium.launch();
  const c = await br.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.addCookies([{ name: 'sc_platform', value: tok, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const p = await c.newPage();

  console.log('\n=== every row appears exactly once across pages (sort=status) ===');
  const ids = [];
  for (let page = 1; page <= 4; page++) {
    await p.goto(`${BASE}?sort=status&dir=asc&page=${page}`, { waitUntil: 'networkidle' });
    const pageIds = await p.$$eval('tbody tr td:first-child a', (as) =>
      as.map((a) => new URL(a.href).searchParams.get('item')));
    ids.push(...pageIds);
  }
  const unique = new Set(ids);
  chk('no row appears on two pages', unique.size === ids.length, `${ids.length} rows, ${unique.size} unique`);
  chk('all 61 records reachable by paging', unique.size === 61, `${unique.size} of 61`);

  console.log('\n=== CSV export honours the active sort ===');
  for (const [qs, col, label] of [
    ['?sort=site&dir=asc', 2, 'Site ascending'],
    ['?sort=site&dir=desc', 2, 'Site descending'],
  ]) {
    const res = await p.request.get(`http://localhost:3000/api/platform/submissions/export${qs}`);
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1);
    const vals = lines.map((l) => (l.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g) || [])[col]?.replace(/^,/, '').replace(/^"|"$/g, '').replace(/""/g, '"') ?? '');
    const sorted = [...vals].sort((a, z) => qs.includes('desc') ? z.localeCompare(a) : a.localeCompare(z));
    chk(`CSV rows in ${label}`, JSON.stringify(vals) === JSON.stringify(sorted),
        `${vals.length} rows, first: ${vals[0]}`);
  }

  await br.close();
  console.log(fails ? `\n${fails} FAILED` : '\nintegrity checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
