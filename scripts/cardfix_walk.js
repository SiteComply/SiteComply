/**
 * Ryan's journey, in a browser: a checked-in operative whose card failed its
 * check presses "Check my card details" and must land on the card form.
 *
 * WHY A BROWSER AND NOT A UNIT TEST. The bug was not in either half - the
 * banner linked correctly and the details page guarded correctly. It lived in
 * the journey between them, where a server redirect sent every person who could
 * press the button back to the page they pressed it on. Only actually pressing
 * it finds that.
 *
 * Needs: a local dev server on 3111 (mock SMS, so the OTP is in its log), a
 * worker with an OPEN check-in and a failed card status, and
 * CSCS_REMEDIATION_ENABLED=1.
 *
 *   MOB=+447700900102 node scripts/cardfix_walk.js
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://localhost:3111';
const MOB = '+447700900102';
const LOG = '/tmp/localwalk.log';
const OUT = '/tmp/claude-1000/-home-cc-dev-1/1ed67f4f-30dd-4382-b81f-7504e3a32d9a/scratchpad';
let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };
const codeFromLog = () => {
  const t = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  const all = [...t.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  return all.length ? all[all.length - 1] : null;
};

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pg.goto(BASE + '/check-in', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const post = (ep, bd) => pg.evaluate(async ([b, e, d]) => {
    const r = await fetch(b + e, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d), credentials: 'include' });
    return { s: r.status, t: (await r.text()).slice(0, 200) };
  }, [BASE, ep, bd]);

  const before = codeFromLog();
  await post('/api/worker/otp/request', { mobile: MOB });
  let code = null;
  for (let i = 0; i < 40 && !code; i++) { await pg.waitForTimeout(300); const c = codeFromLog(); if (c && c !== before) code = c; }
  if (!code) { console.log('  ABORT: no OTP in the log'); await br.close(); process.exit(1); }
  const v = await post('/api/worker/otp/verify', { mobile: MOB, code });
  if (v.s !== 200) { console.log('  ABORT verify ' + JSON.stringify(v)); await br.close(); process.exit(1); }

  await pg.goto(BASE + '/worker/dashboard', { waitUntil: 'networkidle', timeout: 120000 });
  const dash = await pg.innerText('body');
  chk('the dashboard shows the failed-card prompt', /could not find your CSCS card/i.test(dash),
    (dash.match(/.{0,50}CSCS card.{0,40}/i) || [''])[0].replace(/\n/g, ' '));
  await pg.screenshot({ path: `${OUT}/cardfix-1-dashboard.png`, fullPage: false });

  const btn = pg.locator('a', { hasText: /Check my card details/i }).first();
  chk('  and offers "Check my card details"', (await btn.count()) > 0);

  const from = pg.url();
  await btn.click();
  await pg.waitForLoadState('networkidle');
  await pg.waitForTimeout(800);
  const to = pg.url();
  chk('pressing it LEAVES the dashboard', !to.includes('/worker/dashboard'), `${from} → ${to}`);
  chk('  landing on the card details screen', to.includes('/check-in/details'), to);

  const body = await pg.innerText('body');
  chk('  which says why they are there', /Check the card details below/i.test(body));
  chk('  and is titled for the job', /Your card details/i.test(body));
  // The field is labelled, not id'd - find it the way a person would.
  const cardField = pg.getByLabel(/Card number/i).first();
  const visible = (await cardField.count()) > 0 && (await cardField.isVisible());
  chk('  with the card number field visible, not collapsed', visible,
    visible ? `value="${await cardField.inputValue()}"` : 'not visible');
  chk('  showing the card that failed', visible && (await cardField.inputValue()).length > 0,
    visible ? await cardField.inputValue() : '');
  /*
   * The label depends on whether a check will actually RUN: promising "check my
   * card" on a deployment with verification switched off would be a lie, which
   * is the rule the form already follows for the check-in flow.
   */
  chk('  the button says what it will do, and does not promise a check that will not run',
    /Save & check my card again/i.test(body) || /Save my details/i.test(body),
    (body.match(/Save[^\n]{0,40}/i) || [''])[0]);
  chk('  and there is a way out without saving', /Back without changes/i.test(body));
  chk('  no check-in step counter is shown', !/Choose site/i.test(body));
  await pg.screenshot({ path: `${OUT}/cardfix-2-details.png`, fullPage: true });

  await br.close();
  console.log(`\n  ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
