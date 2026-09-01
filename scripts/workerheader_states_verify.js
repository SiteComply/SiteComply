/**
 * The two worker states, and the case where they meet.
 *
 * The third case is the one that matters for closing S1: several open check-ins
 * at ONE site. Before the dedupe that counted as multi-site and produced a
 * switcher listing the same site three times. It must now render as single-site.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const OUT = process.argv[2], S = process.env.SESSION_SECRET;
const mk = (mobile, id) => {
  const n = Math.floor(Date.now()/1000);
  const b = Buffer.from(JSON.stringify({typ:'worker',mobile,workerId:id,iat:n,exp:n+28800})).toString('base64url');
  return b + '.' + createHmac('sha256', S).update(b).digest('base64url');
};
const CASES = [
  ['multi-2sites', '+447700900101', 'cms5ebw3v001d12v6ojfsorub', 'open at 2 sites', true],
  ['single-3checkins-1site', '+447700900150', 'cmt83zcmc00014tnv37p8ddso', '3 open check-ins, 1 site', false],
];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  if (OUT) fs.mkdirSync(OUT, {recursive:true});
  const br = await chromium.launch();
  for (const [tag, mobile, id, desc, expectSwitcher] of CASES) {
    const c = await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    await c.addCookies([{name:'sc_worker',value:mk(mobile,id),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
    const p = await c.newPage();
    await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'networkidle',timeout:120000});
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const sel = document.querySelector('header select');
      const chrome = sel && sel.parentElement.querySelector('span[aria-hidden="true"]');
      const out = Array.from(document.querySelectorAll('header a, header button')).find(e=>/check out/i.test(e.innerText));
      const ctx = document.querySelector('header .flex-1, header span.min-w-0');
      const ov = (a,z)=>{ if(!a||!z) return 0; const A=a.getBoundingClientRect(),Z=z.getBoundingClientRect();
        return Math.round(Math.max(0,Math.min(A.right,Z.right)-Math.max(A.left,Z.left))*Math.max(0,Math.min(A.bottom,Z.bottom)-Math.max(A.top,Z.top))); };
      return {
        hasSwitcher: !!sel, options: sel ? sel.options.length : 0,
        controlText: chrome ? chrome.innerText.replace(/\s+/g,' ').trim() : null,
        contextText: ctx ? ctx.innerText.replace(/\s+/g,' ').trim() : null,
        contextAlign: ctx ? getComputedStyle(ctx).textAlign : null,
        overlap: ov(sel || ctx, out),
      };
    });
    console.log(`\n### ${tag} — ${desc}`);
    chk(`switcher ${expectSwitcher ? 'shown' : 'NOT shown'}`, r.hasSwitcher === expectSwitcher,
        r.hasSwitcher ? `${r.options} option(s)` : 'static site name');
    if (expectSwitcher) {
      chk('one option per site', r.options === 2, `${r.options}`);
      chk('bounded control with the affordance', /switch site/i.test(r.controlText||''), `"${r.controlText}"`);
    } else {
      chk('shows the site name and check-in time as plain text', /checked in/i.test(r.contextText||''), `"${r.contextText}"`);
      chk('no "Switch site" affordance offered', !/switch site/i.test(r.contextText||''));
    }
    chk('no overlap with Check out', r.overlap === 0, `${r.overlap}px²`);
    console.log(`        context alignment: ${r.contextAlign}`);
    if (OUT) {
      const h = await p.locator('header').first().boundingBox();
      await p.screenshot({path:`${OUT}/${tag}.png`, clip:{x:0,y:0,width:390,height:Math.ceil(h.height)+6}});
    }
    await c.close();
  }
  await br.close();
  console.log(fails ? `\n${fails} FAILED` : '\nboth worker states behave as specified');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
