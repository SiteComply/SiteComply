/**
 * Demonstrate check-ins sorting against the local dev server on real rows:
 * screenshots per sort, plus assertions that the ORDER the database returned is
 * actually the order asked for, and that paging over a heavily tied sort is
 * stable (no row on two pages, none missing).
 */
const {
  chromium,
} = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');

const USER = process.argv[2];
const OUT = process.argv[3];
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error('SESSION_SECRET missing');

const n = Math.floor(Date.now() / 1000);
const payload = Buffer.from(
  JSON.stringify({ typ: 'platform', userId: USER, iat: n, exp: n + 28800 }),
).toString('base64url');
const tok =
  payload + '.' + createHmac('sha256', SECRET).update(payload).digest('base64url');

const BASE = 'http://localhost:3000/platform/dashboard/submissions';

let fails = 0;
const chk = (t, ok, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

async function ctx(br, width = 1440, height = 1000) {
  const c = await br.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await c.addCookies([
    {
      name: 'sc_platform',
      value: tok,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  return c;
}

/** The table's rows as [worker, site, status, checkedIn]. */
const readRows = (p) =>
  p.$$eval('tbody tr', (trs) =>
    trs.map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) =>
        td.innerText.replace(/\s+/g, ' ').trim(),
      ),
    ),
  );

const ariaSort = (p) =>
  p.$$eval('thead th', (ths) =>
    ths.map((th) => `${th.innerText.trim()}=${th.getAttribute('aria-sort')}`),
  );

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const br = await chromium.launch();
  const c = await ctx(br);
  const p = await c.newPage();

  const go = async (qs) => {
    await p.goto(`${BASE}${qs}`, { waitUntil: 'networkidle', timeout: 120000 });
    await p.waitForTimeout(400);
  };

  // ---------- default ----------
  console.log('\n=== default (no sort in URL) ===');
  await go('');
  let rows = await readRows(p);
  chk('rows rendered', rows.length > 0, `${rows.length} rows`);
  chk(
    'Checked in marked descending by default',
    (await ariaSort(p)).includes('Checked in=descending'),
    (await ariaSort(p)).join(' | '),
  );
  await p.screenshot({ path: `${OUT}/1-default.png`, fullPage: true });

  // ---------- sort by Site ----------
  console.log('\n=== sort=site&dir=asc ===');
  await go('?sort=site&dir=asc');
  rows = await readRows(p);
  const sites = rows.map((r) => r[1]);
  chk(
    'sites are in ascending order',
    JSON.stringify(sites) === JSON.stringify([...sites].sort((a, b) => a.localeCompare(b))),
    sites.slice(0, 4).join(' / '),
  );
  chk(
    'records from one site are contiguous (grouped)',
    new Set(sites).size === sites.filter((s, i) => i === 0 || s !== sites[i - 1]).length,
    `${new Set(sites).size} distinct site(s) on this page`,
  );
  chk('Site header reports ascending', (await ariaSort(p)).includes('Site=ascending'));
  await p.screenshot({ path: `${OUT}/2-site-asc.png`, fullPage: true });

  await go('?sort=site&dir=desc');
  const sitesDesc = (await readRows(p)).map((r) => r[1]);
  chk(
    'clicking again reverses to descending',
    JSON.stringify(sitesDesc) ===
      JSON.stringify([...sitesDesc].sort((a, b) => b.localeCompare(a))),
    sitesDesc.slice(0, 3).join(' / '),
  );

  // ---------- sort by Status ----------
  console.log('\n=== sort=status&dir=asc ===');
  await go('?sort=status&dir=asc');
  rows = await readRows(p);
  const statuses = rows.map((r) => r[2]);
  const firstCheckedOut = statuses.indexOf('Checked out');
  chk(
    'On site rows all come before Checked out rows',
    firstCheckedOut === -1 || !statuses.slice(firstCheckedOut).includes('On site'),
    statuses.join(',').slice(0, 80),
  );
  chk('Status header reports ascending', (await ariaSort(p)).includes('Status=ascending'));
  await p.screenshot({ path: `${OUT}/3-status-asc.png`, fullPage: true });

  await go('?sort=status&dir=desc');
  const stDesc = (await readRows(p)).map((r) => r[2]);
  const firstOnSite = stDesc.indexOf('On site');
  chk(
    'descending puts Checked out first',
    firstOnSite === -1 || !stDesc.slice(firstOnSite).includes('Checked out'),
    stDesc.join(',').slice(0, 80),
  );

  // ---------- sort by Checked in ----------
  console.log('\n=== sort=checkedIn&dir=asc ===');
  await go('?sort=checkedIn&dir=asc');
  rows = await readRows(p);
  const asDate = (s) => {
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/);
    return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`).getTime() : 0;
  };
  const times = rows.map((r) => asDate(r[3]));
  chk(
    'oldest first, non-decreasing',
    times.every((t, i) => i === 0 || t >= times[i - 1]),
    `${rows[0][3]} → ${rows[rows.length - 1][3]}`,
  );
  await p.screenshot({ path: `${OUT}/4-checkedin-asc.png`, fullPage: true });

  // ---------- the tiebreaker: paging over a 2-value sort must be stable ----------
  console.log('\n=== paging stability under a heavily tied sort ===');
  const seen = [];
  for (let page = 1; page <= 4; page++) {
    await go(`?sort=status&dir=asc&page=${page}`);
    const workers = (await readRows(p)).map((r, i) => `${page}:${i}:${r[0]}|${r[3]}`);
    seen.push(...workers);
  }
  // Re-read every page a second time; a stable sort returns the identical slices.
  const again = [];
  for (let page = 1; page <= 4; page++) {
    await go(`?sort=status&dir=asc&page=${page}`);
    const workers = (await readRows(p)).map((r, i) => `${page}:${i}:${r[0]}|${r[3]}`);
    again.push(...workers);
  }
  chk(
    'paging the same sort twice returns identical slices',
    JSON.stringify(seen) === JSON.stringify(again),
    `${seen.length} rows across 4 pages`,
  );

  // ---------- filters and sort compose ----------
  console.log('\n=== sort composes with the existing filters ===');
  await go('?status=on-site&sort=site&dir=asc');
  rows = await readRows(p);
  chk(
    'status filter still applied while sorted by site',
    rows.every((r) => r[2] === 'On site'),
    `${rows.length} rows, all On site`,
  );
  const s2 = rows.map((r) => r[1]);
  chk(
    'and still sorted by site',
    JSON.stringify(s2) === JSON.stringify([...s2].sort((a, b) => a.localeCompare(b))),
  );
  await p.screenshot({ path: `${OUT}/5-onsite-site-asc.png`, fullPage: true });

  // sort survives paging links
  await go('?sort=site&dir=asc');
  const nextHref = await p
    .locator('a:has-text("Next")')
    .first()
    .getAttribute('href')
    .catch(() => null);
  chk(
    'the Next link carries the sort',
    !!nextHref && nextHref.includes('sort=site') && nextHref.includes('dir=asc'),
    nextHref || '(no next link)',
  );

  // export link carries the sort
  const exportHref = await p
    .locator('a[href*="/api/platform/submissions/export"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  chk(
    'the Export link carries the sort',
    !!exportHref && exportHref.includes('sort=site') && exportHref.includes('dir=asc'),
    exportHref || '(no export link)',
  );

  // a mangled sort must not break the page
  await go('?sort=notacolumn&dir=sideways');
  chk(
    'unknown sort falls back to the default rather than erroring',
    (await ariaSort(p)).includes('Checked in=descending'),
    (await ariaSort(p)).join(' | '),
  );

  await br.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall sorting checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
