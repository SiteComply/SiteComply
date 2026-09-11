/**
 * Induction validity — set every production site to the 3-month standard.
 *
 * Reads each site's CURRENT value first, writes only where it differs, and
 * reads it back. `--apply` is required; without it this is a dry run, so the
 * before-state can be reported before anything changes.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const EMAIL = process.env.PLATFORM_EMAIL || 'jc@parryst.com';
const CODE = process.env.PLATFORM_CODE || '231001';
const APPLY = process.argv.includes('--apply');
const TARGET = 91;

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 1100 } });
  const post = (ep, body) => pg.evaluate(async ([b, e, bd]) => {
    const r = await fetch(b + e, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bd), credentials: 'include' });
    return { s: r.status, t: await r.text() };
  }, [BASE, ep, body]);
  const patch = (ep, body) => pg.evaluate(async ([b, e, bd]) => {
    const r = await fetch(b + e, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bd), credentials: 'include' });
    return { s: r.status, t: await r.text() };
  }, [BASE, ep, body]);

  await pg.goto(`${BASE}/platform`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await post('/api/platform/auth/start', { method: 'email', value: EMAIL });
  const v = await post('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: CODE });
  if (v.s !== 200) { console.log(`ABORT sign-in ${v.s}`); await br.close(); process.exit(1); }

  await pg.goto(`${BASE}/platform/dashboard/sites`, { waitUntil: 'networkidle' });
  const sites = await pg.evaluate(() => {
    const seen = new Set(), out = [];
    for (const a of document.querySelectorAll('a[href*="/platform/dashboard/sites/"]')) {
      const h = a.getAttribute('href').split('?')[0];
      const m = h.match(/\/sites\/([a-z0-9]{20,})$/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], name: (a.innerText || '').trim().split('\n')[0] });
    }
    return out;
  });
  console.log(`sites: ${sites.length}\n`);

  const read = async (id) => {
    await pg.goto(`${BASE}/platform/dashboard/sites/${id}/experience?section=induction-validity`,
      { waitUntil: 'networkidle' });
    return pg.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      const m = t.match(/Currently:\s*([^.]+)\./);
      const sel = Array.from(document.querySelectorAll('select'))
        .find((s) => Array.from(s.options).some((o) => /month|week|day/i.test(o.textContent)));
      const radios = Array.from(document.querySelectorAll('input[type=radio][name=validityMode]'));
      return {
        label: m ? m[1].trim() : null,
        selectValue: sel ? sel.value : null,
        mode: radios.findIndex((r) => r.checked),
        heading: (document.querySelector('h1') || {}).innerText || '',
      };
    });
  };

  const rows = [];
  for (const s of sites) {
    const before = await read(s.id);
    let after = before, wrote = null;
    const needs = before.label !== '3 months';
    if (needs && APPLY) {
      const r = await patch(`/api/platform/sites/${s.id}/induction-validity`,
        { action: 'validity', days: TARGET });
      wrote = r.s;
      after = await read(s.id);
    }
    rows.push({ id: s.id, name: s.name || before.heading, before: before.label, after: after.label, wrote, needs });
    const tag = !needs ? 'already 3 months' : APPLY ? `${before.label} -> ${after.label} (HTTP ${wrote})` : `${before.label} -> WOULD SET 3 months`;
    console.log(`  ${s.name || before.heading}: ${tag}`);
  }

  fs.writeFileSync(process.env.OUT || '/tmp/validity_apply.json', JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => APPLY && r.after !== '3 months');
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${rows.length} sites, ${bad.length} not on the standard`);
  bad.forEach((r) => console.log(`  NOT SET: ${r.name} = ${r.after}`));
  await br.close();
  process.exit(bad.length ? 1 : 0);
})();
