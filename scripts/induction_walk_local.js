/**
 * Walk the induction locally and photograph every screen.
 * Reads the OTP out of the mock SMS provider's server-log line.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://localhost:3111';
const SITE = process.env.SITE;
const OUT  = process.env.OUT;
const MOB  = process.env.MOB || '+447700900101';
const LOG  = process.env.LOG || '/tmp/localwalk.log';
fs.mkdirSync(OUT, { recursive: true });

const codeFromLog = () => {
  const t = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  const all = [...t.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  return all.length ? all[all.length - 1] : null;
};

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pg.goto(BASE + '/check-in', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const post = (ep, bd) => pg.evaluate(async ([b,e,d]) => {
    const r = await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});
    return { s: r.status, t: (await r.text()).slice(0,140) }; }, [BASE, ep, bd]);

  const before = codeFromLog();
  await post('/api/worker/otp/request', { mobile: MOB });
  let code = null;
  for (let i = 0; i < 20 && !code; i++) {
    await pg.waitForTimeout(300);
    const c = codeFromLog();
    if (c && c !== before) code = c;
  }
  if (!code) { console.log('  ABORT: no OTP in the log'); await br.close(); process.exit(1); }
  const v = await post('/api/worker/otp/verify', { mobile: MOB, code });
  if (v.s !== 200) { console.log('  ABORT verify ' + JSON.stringify(v)); await br.close(); process.exit(1); }

  await pg.goto(`${BASE}/check-in/site/${SITE}`, { waitUntil: 'networkidle', timeout: 120000 });
  const start = pg.locator('a,button', { hasText: /Start induction/i }).first();
  if (await start.count()) {
    await start.click();
    await pg.waitForSelector('button[aria-pressed]', { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(600);
  }

  let n = 0;
  for (let i = 0; i < 15; i++) {
    await pg.waitForTimeout(500);
    const s = await pg.evaluate(() => ({
      progress: (document.body.innerText.match(/Check\s+\d+\s+of\s+\d+/i) || [])[0] || null,
      heading: (document.querySelector('h1,h2') || {}).innerText || '',
      toggles: document.querySelectorAll('button[aria-pressed]').length,
    }));
    if (!s.progress && i > 0) break;
    n++;
    console.log(`  [${n}] ${s.progress || '—'}  ${s.heading.replace(/\n/g,' ').slice(0,52)}  (${s.toggles} control${s.toggles===1?'':'s'})`);
    await pg.screenshot({ path: `${OUT}/${String(n).padStart(2,'0')}.png` });
    if (await pg.locator('button', { hasText: /Complete check-in/i }).count()) {
      console.log('        >>> final action — stopping without submitting'); break;
    }
    const un = pg.locator('button[aria-pressed="false"]');
    for (let k = await un.count(); k > 0; k = await un.count()) { await un.first().click(); await pg.waitForTimeout(100); }
    const next = pg.locator('button', { hasText: /^Continue$/ }).first();
    if (!(await next.count())) break;
    await next.click();
  }
  console.log(`\n  SCREENS: ${n}`);
  await br.close();
})();
