/**
 * Induction validity — read the CURRENT production state of every site.
 *
 * Read-only. Run before and after the change so the impact is measured rather
 * than assumed.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const EMAIL = process.env.PLATFORM_EMAIL || 'jc@parryst.com';
const CODE = process.env.PLATFORM_CODE || '231001';

async function login(pg) {
  await pg.goto(`${BASE}/platform`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const call = (ep, body) => pg.evaluate(async ([b, e, bd]) => {
    const r = await fetch(b + e, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bd), credentials: 'include' });
    return { s: r.status, t: await r.text() };
  }, [BASE, ep, body]);
  await call('/api/platform/auth/start', { method: 'email', value: EMAIL });
  const v = await call('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: CODE });
  if (v.s !== 200) throw new Error(`sign-in failed: ${v.s} ${v.t.slice(0, 200)}`);
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await login(pg);
    await pg.goto(`${BASE}/platform/dashboard/sites`, { waitUntil: 'networkidle' });
    const sites = await pg.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/platform/dashboard/sites/"]'))
        .map((a) => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim().split('\n')[0] }))
        .filter((s) => /\/sites\/[a-z0-9]{20,}/.test(s.href))
        .filter((s, i, arr) => arr.findIndex((x) => x.href.split('?')[0] === s.href.split('?')[0]) === i));
    console.log(`sites found: ${sites.length}`);
    const rows = [];
    for (const s of sites) {
      const id = s.href.match(/\/sites\/([a-z0-9]+)/)[1];
      await pg.goto(`${BASE}/platform/dashboard/sites/${id}/experience`, { waitUntil: 'networkidle' });
      const info = await pg.evaluate(() => {
        const t = document.body.innerText;
        const m = t.match(/Induction validity[\s\S]{0,400}/i);
        const seg = m ? m[0] : '';
        const cur = seg.match(/Currently[:\s]*([^\n]+)/i);
        return {
          name: (document.querySelector('h1') || {}).innerText || '',
          current: cur ? cur[1].trim() : null,
          segment: seg.split('\n').slice(0, 8).join(' | '),
        };
      });
      rows.push({ id, name: (info.name || s.text).trim(), current: info.current, seg: info.segment });
      console.log(`  ${rows.length}. ${rows[rows.length - 1].name}  ->  ${info.current || '(unread)'}`);
      if (!info.current) console.log(`       raw: ${info.segment}`);
    }
    require('fs').writeFileSync(process.argv[2] || '/tmp/validity_state.json', JSON.stringify(rows, null, 2));
    console.log(`\nwrote ${rows.length} rows`);
  } finally { await b.close(); }
})();
