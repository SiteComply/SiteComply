/**
 * Induction validity — drive the real config UI and prove the standard is what
 * a manager actually sees and saves. Screenshots so the copy is reviewable.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3111';
const EMAIL = process.env.EMAIL || 'ux.director@sitecomply.local';
const CODE = process.env.CODE || '231001';
const OUT = process.env.OUT || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 1100 } });
  await pg.goto(`${BASE}/platform`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const call = (ep, body) => pg.evaluate(async ([b, e, bd]) => {
    const r = await fetch(b + e, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bd), credentials: 'include' });
    return { s: r.status, t: await r.text() };
  }, [BASE, ep, body]);
  await call('/api/platform/auth/start', { method: 'email', value: EMAIL });
  const v = await call('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: CODE });
  if (v.s !== 200) { console.log(`  ABORT sign-in ${v.s} ${v.t.slice(0, 160)}`); await br.close(); process.exit(1); }

  await pg.goto(`${BASE}/platform/dashboard/sites`, { waitUntil: 'networkidle' });
  const href = await pg.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href*="/platform/dashboard/sites/"]'))
      .find((x) => /\/sites\/[a-z0-9]{20,}/.test(x.getAttribute('href')));
    return a ? a.getAttribute('href').split('?')[0] : null;
  });
  if (!href) { console.log('  ABORT no site'); await br.close(); process.exit(1); }
  const id = href.match(/\/sites\/([a-z0-9]+)/)[1];

  const EXP = `${BASE}/platform/dashboard/sites/${id}/experience?section=induction-validity`;
  await pg.goto(EXP, { waitUntil: 'networkidle' });
  const card = pg.locator('text=Set how long a completed induction').locator('xpath=ancestor::*[self::section or self::div][4]').first();
  await card.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(400);
  await card.screenshot({ path: `${OUT}/01-validity-card.png` });

  const opts = await pg.evaluate(() => {
    const sel = Array.from(document.querySelectorAll('select'))
      .find((s) => Array.from(s.options).some((o) => /month|week|day/i.test(o.textContent)));
    return sel ? { list: Array.from(sel.options).map((o) => `${o.textContent}=${o.value}`), value: sel.value } : null;
  });
  chk('the validity picker is on the page', Boolean(opts));
  chk('"3 months" is offered', Boolean(opts && opts.list.some((o) => o.startsWith('3 months=91'))), opts ? opts.list.join(', ') : '');
  chk('the picker pre-selects the standard', opts && opts.value === '91', opts ? opts.value : '');

  const copy = await pg.evaluate(() => document.body.innerText);
  chk('the standard is stated to the manager', /platform standard is 3 months/i.test(copy));
  chk('no "(default)" claim on every check-in', !/re-induct each time \(default\)/i.test(copy));
  chk('no stray "worker" in this card', !/\bworkers?\b/i.test(
    (copy.match(/Set how long a completed induction[\s\S]{0,600}/i) || [''])[0]),
    (copy.match(/Set how long a completed induction[\s\S]{0,600}/i) || [''])[0].split('\n').filter(l => /worker/i.test(l)).join(' | '));

  // Save it and prove it persists as a preset, not as a custom value.
  await pg.evaluate(() => {
    const r = Array.from(document.querySelectorAll('input[type=radio][name=validityMode]'));
    if (r[1]) r[1].click();
  });
  await pg.waitForTimeout(200);
  const btn = pg.locator('button', { hasText: /^Save/ }).first();
  if (await btn.count()) { await btn.click(); await pg.waitForTimeout(1500); }
  await pg.goto(EXP, { waitUntil: 'networkidle' });
  const after = await pg.evaluate(() => document.body.innerText);
  chk('it saved and reads back as "3 months"', /Currently:\s*3 months/i.test(after.replace(/\s+/g, ' ')),
      (after.match(/Currently:[^\n.]*/i) || ['(not found)'])[0]);
  const card2 = pg.locator('text=Set how long a completed induction').locator('xpath=ancestor::*[self::section or self::div][4]').first();
  await card2.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(300);
  await card2.screenshot({ path: `${OUT}/02-validity-saved.png` });

  console.log(`\n  ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}   shots in ${OUT}`);
  await br.close();
  process.exit(fails ? 1 : 0);
})();
