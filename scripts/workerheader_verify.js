/**
 * Worker header — S1 (unique sites) and S2 (no overlap) across supported widths.
 *
 * The overlap check is the point of this script: it measures the geometry AND
 * hit-tests the band where the two controls used to collide, because "they no
 * longer overlap" and "you can actually tap the switcher" are different claims.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const WORKER = process.argv[2] || 'cms5ebw3v001d12v6ojfsorub';
const MOBILE = process.argv[3] || '+447700900101';
const S = process.env.SESSION_SECRET, n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'worker',mobile:MOBILE,workerId:WORKER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',S).update(b).digest('base64url');
const WIDTHS = [320, 360, 375, 390, 412, 414, 430, 480, 640, 768];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  const br = await chromium.launch();

  // --- S1: the switcher lists sites, not check-ins ---
  console.log('\n=== S1 · unique sites ===');
  {
    const c = await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await c.addCookies([{name:'sc_worker',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
    const p = await c.newPage();
    const errs = [];
    p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'networkidle',timeout:120000});
    await p.waitForTimeout(400);
    const opts = await p.$$eval('header select option', o => o.map(x => x.textContent.trim()));
    chk('one option per site, no repeats', opts.length === new Set(opts).size, `${opts.length} options: ${opts.join(' | ')}`);
    chk('every site the worker is open at is offered', opts.length >= 2, `${opts.length}`);
    const dupKey = errs.filter(e => /same key/i.test(e));
    chk('no duplicate-key warnings', dupKey.length === 0, `${dupKey.length} warning(s)`);
    await c.close();
  }

  // --- S2: no overlap, and the switcher is genuinely tappable ---
  console.log('\n=== S2 · header geometry across supported widths ===');
  for (const w of WIDTHS) {
    const c = await br.newContext({viewport:{width:w,height:844},isMobile:w<768,hasTouch:true});
    await c.addCookies([{name:'sc_worker',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
    const p = await c.newPage();
    await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'networkidle',timeout:120000});
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => {
      const box = e => { const b = e.getBoundingClientRect(); return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height}; };
      const sel = document.querySelector('header select');
      const out = Array.from(document.querySelectorAll('header a, header button')).find(e=>/check out/i.test(e.innerText));
      const so  = Array.from(document.querySelectorAll('header a, header button')).filter(e=>/sign out/i.test(e.innerText))
                    .filter(e => e.getBoundingClientRect().width > 0);
      if (!sel || !out) return { missing: true, hasSel: !!sel, hasOut: !!out };
      const S = box(sel), O = box(out);
      const ox = Math.max(0, Math.min(S.r,O.r) - Math.max(S.l,O.l));
      const oy = Math.max(0, Math.min(S.b,O.b) - Math.max(S.t,O.t));
      // Hit-test the switcher's own chevron area (right 20px of the select).
      const hx = Math.round(S.r - 10), hy = Math.round(S.t + S.h/2);
      const hit = document.elementFromPoint(hx, hy);
      const hitsSelf = !!hit && (hit === sel || sel.contains(hit));
      return {
        sel:{w:Math.round(S.w),h:Math.round(S.h)}, out:{w:Math.round(O.w),h:Math.round(O.h)},
        overlapArea: Math.round(ox*oy), overlapX: Math.round(ox),
        hitsSelf, signOutCount: so.length,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        headerH: Math.round(document.querySelector('header').getBoundingClientRect().height),
      };
    });
    if (r.missing) { chk(`${w}px — header controls present`, false, `select:${r.hasSel} checkout:${r.hasOut}`); await c.close(); continue; }
    const ok = r.overlapArea === 0 && r.hitsSelf && r.docOverflow <= 0 && r.sel.h >= 44 && r.signOutCount === 1;
    console.log(`  ${ok?'PASS':'FAIL'}  ${String(w).padStart(3)}px  select ${r.sel.w}×${r.sel.h}  checkout ${r.out.w}×${r.out.h}  ` +
                `overlap ${r.overlapArea}px²  chevron→${r.hitsSelf?'SWITCHER':'WRONG TARGET'}  ` +
                `signout×${r.signOutCount}  docOvf ${r.docOverflow}  hdr ${r.headerH}px`);
    if (!ok) fails++;
    await c.close();
  }

  await br.close();
  console.log(fails ? `\n${fails} FAILED` : '\nS1 and S2 resolved at every supported width');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
