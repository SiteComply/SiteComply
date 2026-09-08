/**
 * Issue reporting Phase 1 — production verification.
 *
 * The decisive check is FILING A REAL REPORT: it is the only thing that proves
 * the deployed code and the migrated database agree. If the table were missing
 * the button would still render and the dialog would still open — the feature
 * would look fine and be broken.
 *
 * Admin cannot be driven here (Azure AD, dev fallback disabled in production),
 * so its entry point is verified from the code production serves.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const EMAIL = process.env.PLATFORM_EMAIL || 'jc@parryst.com';
const CODE = process.env.PLATFORM_CODE || '231001';
const MOBILE = process.env.TEST_WORKER_MOBILE || '+447700900150';
const WCODE = process.env.TEST_WORKER_CODE || '231001';
const OUT = process.argv[2];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

const probe = (p) => p.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button[aria-label="Report an issue or give feedback"]'))
    .filter(b => b.getClientRects().length)[0];
  if (!btn) return null;
  const b = btn.getBoundingClientRect();
  const hdr = btn.closest('aside') || btn.closest('header') || document.body;
  let overlap = 0;
  for (const el of hdr.querySelectorAll('a,button')) {
    if (el === btn || btn.contains(el) || el.contains(btn) || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(b.right,r.right)-Math.max(b.left,r.left));
    const y = Math.max(0, Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top));
    if (x>1 && y>1) overlap = Math.max(overlap, Math.round(x*y));
  }
  const span = btn.querySelector('span');
  // Where it sits relative to the other chrome actions, scoped to the container
  // that actually holds the VISIBLE control — the DOM carries two instances and
  // querySelector returns the hidden one first.
  const near = (re) => { const e = Array.from(hdr.querySelectorAll('a,button'))
    .filter(x => x.getClientRects().length).find(x => re.test(x.innerText||''));
    return e ? e.getBoundingClientRect() : null; };
  const co = near(/check out/i), so = near(/sign out/i);
  return { w: Math.round(b.width), h: Math.round(b.height),
    x: Math.round(b.left), y: Math.round(b.top),
    checkOutX: co?Math.round(co.left):null, checkOutY: co?Math.round(co.top):null,
    signOutX: so?Math.round(so.left):null, signOutY: so?Math.round(so.top):null,
    visibleCount: Array.from(document.querySelectorAll('button[aria-label="Report an issue or give feedback"]'))
      .filter(x => x.getClientRects().length).length,
    labelShown: !!span && span.getClientRects().length > 0,
    isFlag: !!btn.querySelector('path[d^="M5 21V4"]'),
    overlap, aboveFold: b.top >= 0 && b.bottom <= window.innerHeight,
    pageOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth) };
});

(async () => {
  console.log(`== ISSUE REPORTING — PRODUCTION VERIFICATION ==\n   ${BASE}\n`);
  const br = await chromium.launch();

  // ---------- PLATFORM ----------
  console.log('-- Platform --');
  const pc = await br.newContext({viewport:{width:1280,height:900}, deviceScaleFactor:2});
  const pp = await pc.newPage();
  await pp.goto(`${BASE}/platform`, {waitUntil:'domcontentloaded', timeout:120000});
  const call = (pg, ep, body) => pg.evaluate(async ([b,e,bd]) => {
    const r = await fetch(b+e, {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(bd), credentials:'include'});
    return {s:r.status, t: await r.text()};
  }, [BASE, ep, body]);
  await call(pp, '/api/platform/auth/start', {method:'email', value:EMAIL});
  const pv = await call(pp, '/api/platform/auth/verify', {method:'email', value:EMAIL, code:CODE});
  if (pv.s !== 200) { console.log(`  ABORT  platform sign-in failed: ${pv.s}`); await br.close(); process.exit(1); }
  await pp.goto(`${BASE}/platform/dashboard/submissions`, {waitUntil:'domcontentloaded', timeout:120000});
  await pp.waitForTimeout(1200);
  const pr = await probe(pp);
  chk('entry point present', !!pr);
  if (pr) {
    chk('uses the flag icon', pr.isFlag);
    chk('labelled at desktop width', pr.labelShown);
    chk('no overlap, above the fold, no page overflow',
        pr.overlap===0 && pr.aboveFold && pr.pageOverflow===0,
        `overlap=${pr.overlap} aboveFold=${pr.aboveFold} overflow=${pr.pageOverflow}`);
    chk('exactly one visible control', pr.visibleCount===1, `${pr.visibleCount}`);
    chk('in the account foot, paired with Sign out on one row',
        pr.signOutY!==null && pr.y===pr.signOutY && pr.x < pr.signOutX,
        `feedback=(${pr.x},${pr.y}) signOut=(${pr.signOutX},${pr.signOutY})`);
    chk('low in the viewport — the foot, not the rail head', pr.y > 400, `y=${pr.y}`);
  }
  await pp.screenshot({path: path.join(OUT,'prod-platform-1280.png'), clip:{x:0,y:0,width:760,height:300}});

  // THE DECISIVE CHECK — a real report, which needs the migrated table.
  const filed = await pp.evaluate(async (base) => {
    const r = await fetch(base + '/api/reports', {method:'POST', headers:{'content-type':'application/json'},
      credentials:'include', body: JSON.stringify({ type:'FEEDBACK',
        description:'Deployment verification for issue reporting Phase 1. Safe to ignore or delete.',
        contactRequested:false, pagePath:'/platform/dashboard/submissions?site=SECRET&q=Jane+Doe',
        pageTitle:'Check-ins', viewportWidth:1280, viewportHeight:900, devicePixelRatio:2 })});
    return { s: r.status, b: await r.text() };
  }, BASE);
  let ref = null; try { ref = JSON.parse(filed.b).reference; } catch {}
  chk('a report is accepted and stored (proves the migration matches the code)',
      filed.s === 200 && /^SC-R-\d+$/.test(ref || ''), ref || `HTTP ${filed.s} ${filed.b.slice(0,140)}`);
  const dupe = await pp.evaluate(async (base) => {
    const r = await fetch(base + '/api/reports', {method:'POST', headers:{'content-type':'application/json'},
      credentials:'include', body: JSON.stringify({type:'BUG', description:'Second report immediately after the first.', pagePath:'/x'})});
    return r.status; }, BASE);
  chk('rate limit active in production', dupe === 429, `HTTP ${dupe}`);
  await pc.close();

  // ---------- WORKER ----------
  console.log('\n-- Worker Portal --');
  const wc = await br.newContext({viewport:{width:390,height:844}, deviceScaleFactor:3, isMobile:true, hasTouch:true});
  const wp = await wc.newPage();
  await wp.goto(`${BASE}/check-in`, {waitUntil:'domcontentloaded', timeout:120000});
  let q = await call(wp, '/api/worker/otp/request', {mobile:MOBILE});
  if (q.s === 429) { const w=(JSON.parse(q.t).resendInSeconds||30)+3;
    console.log(`  ..     cooldown ${w}s`); await wp.waitForTimeout(w*1000);
    q = await call(wp, '/api/worker/otp/request', {mobile:MOBILE}); }
  if (q.s !== 200) { console.log(`  ABORT  worker sign-in failed: ${q.s} ${q.t.slice(0,120)}`); await br.close(); process.exit(1); }
  const wv = await call(wp, '/api/worker/otp/verify', {mobile:MOBILE, code:WCODE});
  if (wv.s !== 200) { console.log(`  ABORT  worker verify failed: ${wv.s}`); await br.close(); process.exit(1); }
  await wp.goto(`${BASE}/worker/dashboard`, {waitUntil:'domcontentloaded', timeout:120000});
  await wp.waitForTimeout(1200);
  const wr = await probe(wp);
  chk('entry point present', !!wr);
  if (wr) {
    chk('uses the flag icon', wr.isFlag);
    chk('labelled at 390px', wr.labelShown);
    chk('no overlap with Sign out or Check out', wr.overlap === 0, `overlap=${wr.overlap}`);
    chk('above the fold, no page overflow', wr.aboveFold && wr.pageOverflow===0);
  }
  await wp.screenshot({path: path.join(OUT,'prod-worker-390.png'), clip:{x:0,y:0,width:390,height:260}});
  chk('390px: exactly one visible control', wr && wr.visibleCount===1, wr?`${wr.visibleCount}`:'');
  chk('390px: still in the identity row, above the site row',
      wr && wr.checkOutY!==null && wr.y < wr.checkOutY, wr?`y=${wr.y} checkOutY=${wr.checkOutY}`:'');
  // desktop: the new action-group placement
  await wp.setViewportSize({width:1280, height:900});
  await wp.reload({waitUntil:'domcontentloaded', timeout:120000});
  await wp.waitForTimeout(1200);
  const wd = await probe(wp);
  chk('1280px: exactly one visible control', wd && wd.visibleCount===1, wd?`${wd.visibleCount}`:'');
  chk('1280px: between Check out and Sign out',
      wd && wd.checkOutX < wd.x && wd.x < wd.signOutX,
      wd?`checkOut=${wd.checkOutX} feedback=${wd.x} signOut=${wd.signOutX}`:'');
  chk('1280px: on the same line as Check out',
      wd && Math.abs(wd.y - wd.checkOutY) <= 2, wd?`y=${wd.y} vs ${wd.checkOutY}`:'');
  await wp.screenshot({path: path.join(OUT,'prod-worker-1280.png'), clip:{x:0,y:0,width:1280,height:150}});
  await wp.setViewportSize({width:390, height:844});
  await wp.reload({waitUntil:'domcontentloaded', timeout:120000});
  await wp.waitForTimeout(900);
  // open the dialog for a real screenshot
  await wp.click('button[aria-label="Report an issue or give feedback"]');
  await wp.waitForTimeout(900);
  const dlg = await wp.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    return { modal: d.getAttribute('aria-modal'),
      flags: d.querySelectorAll('path[d^="M5 21V4"]').length,
      types: Array.from(d.querySelectorAll('button[aria-pressed]')).map(b=>b.innerText.trim()),
      contact: !!d.querySelector('input[type=checkbox]') };
  });
  chk('dialog opens as a modal', dlg && dlg.modal === 'true');
  chk('both raise-something chips use the flag', dlg && dlg.flags === 2, dlg ? `${dlg.flags} flags` : '');
  chk('contact option hidden for workers', dlg && dlg.contact === false);
  await wp.screenshot({path: path.join(OUT,'prod-worker-dialog.png'), clip:{x:0,y:0,width:390,height:844}});
  await wc.close();

  console.log('\n-- Admin Centre (behind Azure AD; verified from what production serves) --');
  const ac = await br.newContext(); const ap = await ac.newPage();
  const r = await ap.goto(`${BASE}/admin/submissions`, {waitUntil:'domcontentloaded', timeout:120000});
  chk('admin route alive and still gated', (r?r.status():0) < 500 && /\/admin\/login/.test(ap.url()),
      `HTTP ${r?r.status():'?'} → ${ap.url().replace(BASE,'')}`);
  await ac.close();

  fs.writeFileSync(path.join(OUT,'prod.json'), JSON.stringify({reference: ref, platform: pr, worker: wr}, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
