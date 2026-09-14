/**
 * Walk the induction and photograph every screen.
 *
 * Read-only: it advances through the wizard but stops before the final check-in
 * button, so no submission is recorded. The controls are styled
 * `<button aria-pressed>`, not checkboxes — that is what to click.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = process.env.BASE || 'https://sitecomply-web.azurewebsites.net';
const SITE = process.env.SITE;
const OUT  = process.env.OUT || '/tmp/indshots';
const MOB  = process.env.MOB || '+447700900150';
const CODE = process.env.CODE || '231001';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pg.goto(BASE + '/check-in', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const post = (ep, bd) => pg.evaluate(async ([b,e,d]) => {
    const r = await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});
    return r.status; }, [BASE, ep, bd]);
  await post('/api/worker/otp/request', { mobile: MOB });
  const v = await post('/api/worker/otp/verify', { mobile: MOB, code: CODE });
  if (v !== 200) { console.log('  ABORT sign-in ' + v); await br.close(); process.exit(1); }

  await pg.goto(`${BASE}/check-in/site/${SITE}`, { waitUntil: 'networkidle', timeout: 120000 });
  // The express path offers "Start induction" to run the full thing anyway.
  // Wait for the wizard itself, not a fixed delay: the link navigates.
  const start = pg.locator('a,button', { hasText: /Start induction/i }).first();
  if (await start.count()) {
    await start.click();
    await pg.waitForSelector('button[aria-pressed]', { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(800);
  }
  if (!(await pg.locator('button[aria-pressed]').count())) {
    console.log('  the wizard did not open; url=' + pg.url());
  }

  const screens = [];
  for (let i = 0; i < 15; i++) {
    await pg.waitForTimeout(600);
    const s = await pg.evaluate(() => {
      const t = document.body.innerText;
      return {
        progress: (t.match(/Check\s+\d+\s+of\s+\d+/i) || [])[0] || null,
        heading: (document.querySelector('h1,h2') || {}).innerText || '',
        toggles: Array.from(document.querySelectorAll('button[aria-pressed]'))
          .map((b) => (b.innerText || '').trim().split('\n')[0]).filter(Boolean),
      };
    });
    screens.push(s);
    console.log(`  [${i + 1}] ${s.progress || '—'}  ${s.heading.replace(/\n/g,' ').slice(0,58)}`);
    if (s.toggles.length) console.log(`        ${s.toggles.length} control(s): ${s.toggles.join(' · ').slice(0,110)}`);
    await pg.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}.png` });

    const finalBtn = await pg.locator('button', { hasText: /Complete check-in/i }).count();
    if (finalBtn) { console.log('        >>> final action reached — stopping without submitting'); break; }

    const untoggled = pg.locator('button[aria-pressed="false"]');
    for (let k = await untoggled.count(); k > 0; k = await untoggled.count()) {
      await untoggled.first().click(); await pg.waitForTimeout(120);
    }
    const next = pg.locator('button', { hasText: /^Continue$/ }).first();
    if (!(await next.count())) { console.log('        no Continue — stopping'); break; }
    await next.click();
  }
  console.log(`\n  SCREENS: ${screens.length}`);
  await br.close();
})();
