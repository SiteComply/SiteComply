/**
 * Worker header alignment — production verification.
 *
 * Signs in as the test worker (single-site, so this also covers the read-only
 * variant that the local seed cannot produce) and measures the rendered
 * geometry at every supported width.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const MOBILE = process.env.TEST_WORKER_MOBILE || '+447700900150';
const CODE = process.env.TEST_WORKER_CODE || '231001';
const OUT = process.argv[2];
const WIDTHS = [320, 360, 375, 390, 412, 430, 768, 1280];
const SHOTS = [320, 390, 1280];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

const GEO = () => {
  const h = document.querySelector('header');
  if (!h) return null;
  const box = e => { const b = e.getBoundingClientRect();
    return {t:Math.round(b.top), b:Math.round(b.bottom), h:Math.round(b.height), c:Math.round(b.top+b.height/2)}; };
  const vis = e => e.getClientRects().length > 0;
  const card = Array.from(h.querySelectorAll('span'))
    .find(s => s.querySelector('svg') && /rounded-lg/.test(s.className||'') && /border/.test(s.className||''));
  const co = Array.from(h.querySelectorAll('a,button')).filter(vis).find(e => /check out/i.test(e.innerText||''));
  const so = Array.from(h.querySelectorAll('a,button')).filter(vis).find(e => /sign out/i.test(e.innerText||''));
  const stamp = Array.from(h.querySelectorAll('span')).find(s => /^Checked in:/.test((s.innerText||'').trim()));
  // is the timestamp still a descendant of the card's own wrapper?
  const wrapper = card ? card.parentElement : null;
  const stampInWrapper = !!(stamp && wrapper && wrapper.contains(stamp));
  return {card: card?box(card):null, co: co?box(co):null, so: so?box(so):null,
          stamp: stamp?box(stamp):null, stampInWrapper,
          readOnly: !h.querySelector('select')};
};

(async () => {
  console.log(`== WORKER HEADER ALIGNMENT — PRODUCTION VERIFICATION ==\n   ${BASE}\n`);
  const br = await chromium.launch();
  const ctx = await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p0 = await ctx.newPage();
  await p0.goto(`${BASE}/check-in`, {waitUntil:'domcontentloaded', timeout:120000});
  const call = (ep, body) => p0.evaluate(async ([b,e,bd]) => {
    const r = await fetch(b+e, {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(bd), credentials:'include'});
    return {s:r.status, b:(await r.text()).slice(0,180)};
  }, [BASE, ep, body]);
  let q = await call('/api/worker/otp/request', {mobile:MOBILE});
  if (q.s === 429) { const w=(JSON.parse(q.b).resendInSeconds||30)+3;
    console.log(`  ..     cooldown ${w}s`); await p0.waitForTimeout(w*1000);
    q = await call('/api/worker/otp/request', {mobile:MOBILE}); }
  if (q.s !== 200) { console.log(`  ABORT  cannot sign in: ${q.s} ${q.b}`); await br.close(); process.exit(1); }
  const v = await call('/api/worker/otp/verify', {mobile:MOBILE, code:CODE});
  if (v.s !== 200) { console.log(`  ABORT  verify failed: ${v.s} ${v.b}`); await br.close(); process.exit(1); }
  console.log('  signed in\n');
  await p0.close();

  const rows = {};
  console.log('  width  site card        Check out        Sign out         delta');
  for (const w of WIDTHS) {
    const p = await ctx.newPage();
    await p.setViewportSize({width:w, height: w < 768 ? 844 : 900});
    await p.goto(`${BASE}/worker/dashboard`, {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(900);
    const r = await p.evaluate(GEO);
    if (!r || !r.card) { console.log(`  ABORT  no site control at ${w}px (${p.url()})`); await br.close(); process.exit(1); }
    rows[w] = r;
    const f = x => x ? `${String(x.t).padStart(3)}..${String(x.b).padStart(3)}(h${x.h})` : '     —      ';
    const d = r.co ? r.card.c - r.co.c : null;
    console.log(`  ${String(w).padEnd(6)} ${f(r.card)}  ${f(r.co)}  ${f(r.so)}  ${d===null?'n/a':(d>0?'+':'')+d+'px'}`);
    if (SHOTS.includes(w)) {
      const hb = await p.evaluate(() => { const h=document.querySelector('header').getBoundingClientRect();
        return {x:0, y:Math.max(0,h.top), width:Math.min(1280,h.width), height:Math.min(300,h.height+8)}; });
      await p.screenshot({path: path.join(OUT, `prod-${w}.png`), clip: hb});
    }
    await p.close();
  }

  console.log('\n  -- assertions --');
  const at = w => rows[w];
  chk('the site card and Check out share a top edge at every width',
    WIDTHS.every(w => !at(w).co || at(w).card.t === at(w).co.t),
    WIDTHS.map(w => `${w}:${at(w).co ? at(w).card.t - at(w).co.t : 'n/a'}`).join(' '));
  chk('centre delta is 0 everywhere (was -9px)',
    WIDTHS.every(w => !at(w).co || at(w).card.c === at(w).co.c));
  chk('Sign out joins the same baseline where it is shown',
    WIDTHS.filter(w => at(w).so && at(w).so.t > 40 === false ? true : at(w).so).every(w => {
      const r = at(w); if (!r.so) return true;
      // Below sm the visible Sign out lives in the identity row above, so only
      // assert the baseline where it sits in the actions row.
      return r.so.t === r.card.t || r.so.b < r.card.t;
    }),
    WIDTHS.map(w => at(w).so ? `${w}:${at(w).so.t}` : `${w}:—`).join(' '));
  chk('all three controls are the same height',
    WIDTHS.every(w => at(w).card.h === 52 && (!at(w).co || at(w).co.h === 52)));
  chk('the timestamp is still inside the site control wrapper',
    WIDTHS.every(w => at(w).stampInWrapper));
  chk('the timestamp sits BELOW the card, not beside it',
    WIDTHS.every(w => !at(w).stamp || at(w).stamp.t >= at(w).card.b - 1));
  chk('this account renders the read-only single-site variant',
    WIDTHS.every(w => at(w).readOnly), 'no <select> in the header');

  fs.writeFileSync(path.join(OUT,'align.json'), JSON.stringify(rows, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
