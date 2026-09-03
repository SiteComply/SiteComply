/**
 * Worker session TTL — production verification.
 *
 * Signs in as the test worker through the live OTP endpoints and measures what
 * production actually issues. The app-setting change is confirmed by the COOKIE,
 * not by /api/health: an old container serves 200 throughout a settings restart.
 *
 * Deliberately does NOT check out — that would alter production attendance. It
 * verifies the check-out control is present and the session authorises the call.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const MOBILE = process.env.TEST_WORKER_MOBILE || '+447700900150';
const CODE = process.env.TEST_WORKER_CODE || '231001';
const OUT = process.argv[2];
const EXPECT_HOURS = Number(process.env.EXPECT_HOURS || 12);
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  console.log(`== WORKER SESSION — PRODUCTION VERIFICATION ==\n   ${BASE}\n`);
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p = await c.newPage();
  const call = (ep, body) => p.evaluate(async ([b,e,bd]) => {
    const r = await fetch(b+e, {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(bd), credentials:'include'});
    return {s:r.status, b:(await r.text()).slice(0,200)};
  }, [BASE, ep, body]);

  console.log('-- 1. OTP login --');
  await p.goto(`${BASE}/check-in`, {waitUntil:'domcontentloaded', timeout:120000});
  let q = await call('/api/worker/otp/request', {mobile:MOBILE});
  if (q.s === 429) {
    const w = (JSON.parse(q.b).resendInSeconds || 30) + 3;
    console.log(`  ..     resend cooldown, waiting ${w}s`);
    await p.waitForTimeout(w*1000);
    q = await call('/api/worker/otp/request', {mobile:MOBILE});
  }
  chk('OTP request accepted', q.s === 200, `HTTP ${q.s}${q.s!==200?' '+q.b:''}`);
  if (q.s !== 200) { console.log('\n  ABORT — cannot sign in; later checks would be vacuous.\n'); await br.close(); process.exit(1); }
  const v = await call('/api/worker/otp/verify', {mobile:MOBILE, code:CODE});
  chk('OTP verify succeeds', v.s === 200, `HTTP ${v.s} ${v.b}`);
  if (v.s !== 200) { await br.close(); process.exit(1); }

  console.log('\n-- 2. session persistence --');
  let cks = await c.cookies();
  const sess = cks.find(k => k.name === 'sc_worker');
  const hrs = sess ? (sess.expires - Date.now()/1000)/3600 : 0;
  chk('sc_worker is issued', !!sess);
  chk(`sc_worker lasts ~${EXPECT_HOURS}h`, hrs > EXPECT_HOURS-0.2 && hrs < EXPECT_HOURS+0.2, `${hrs.toFixed(2)}h (was 2.00h)`);
  chk('sc_worker is persistent, so a browser close does not end it', !!sess && sess.expires > 0);
  chk('sc_worker stays httpOnly and secure', !!sess && sess.httpOnly && sess.secure);

  console.log('\n-- 3. dashboard access --');
  await p.goto(`${BASE}/worker/dashboard`, {waitUntil:'domcontentloaded', timeout:120000});
  await p.waitForTimeout(900);
  chk('lands on the dashboard', p.url().includes('/worker/dashboard'), p.url().replace(BASE,''));
  const co = await p.evaluate(() => {
    const h = document.querySelector('header'); if (!h) return null;
    const el = Array.from(h.querySelectorAll('a,button')).find(e => /check out/i.test(e.innerText||''));
    return el ? el.innerText.replace(/\s+/g,' ').trim() : null;
  });
  chk('Check out is available', !!co, co || 'not found');

  console.log('\n-- 4. active-site persistence --');
  const sites = await p.evaluate(() => {
    const s = document.querySelector('header select');
    return s ? Array.from(s.options).map(o => ({v:o.value, t:o.text.trim()})) : [];
  });
  console.log(`  worker is checked into ${sites.length} site(s)`);
  if (sites.length > 1) {
    const t = sites[1];
    const r = await call('/api/worker/active-site', {siteId:t.v});
    chk('switching active site succeeds', r.s === 200, `HTTP ${r.s}`);
    cks = await c.cookies();
    const site = cks.find(k => k.name === 'sc_worker_site');
    const sh = site ? (site.expires - Date.now()/1000)/3600 : 0;
    chk('sc_worker_site is issued', !!site);
    chk(`sc_worker_site ALSO lasts ~${EXPECT_HOURS}h (the code fix)`,
        sh > EXPECT_HOURS-0.2 && sh < EXPECT_HOURS+0.2, `${sh.toFixed(2)}h (was pinned at 2.00h)`);
    await p.goto(`${BASE}/worker/dashboard`, {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(800);
    const act = await p.evaluate(() => { const s=document.querySelector('header select'); return s?s.value:null; });
    chk('the chosen site survives a reload', act === t.v, t.t);
  } else {
    console.log('  NOTE  single open check-in on this account, so the switcher is read-only.');
    console.log('        The active-site cookie is exercised by the check-in path instead.');
  }

  console.log('\n-- 5. reopening the portal --');
  const p2 = await c.newPage();
  await p2.goto(`${BASE}/check-in`, {waitUntil:'domcontentloaded', timeout:120000});
  await p2.waitForTimeout(900);
  chk('an already checked-in worker goes straight to the dashboard',
      p2.url().includes('/worker/dashboard'), p2.url().replace(BASE,''));

  console.log('\n-- 6. check-out authorised (NOT executed) --');
  const probe = await p2.evaluate(async () => {
    const r = await fetch('/api/worker/checkout', {method:'POST',
      headers:{'content-type':'application/json'}, body: JSON.stringify({}), credentials:'include'});
    return {s:r.status, b:(await r.text()).slice(0,160)};
  });
  chk('check-out is not rejected as an expired session', probe.s !== 401, `HTTP ${probe.s} ${probe.b.slice(0,80)}`);
  chk('it fails only for the missing submissionId, proving authorisation passed',
      /no check-in specified/i.test(probe.b), probe.b.slice(0,90));

  fs.writeFileSync(path.join(OUT,'session.json'), JSON.stringify({sessionHours:hrs, sites:sites.length}, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
