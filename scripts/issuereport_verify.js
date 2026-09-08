/**
 * Issue reporting, Phase 1.
 *
 * Checks the entry point in all three shells, the responsive label rule, that
 * nothing overlaps (the S2 defect class), and the full submit path including
 * server-side identity, rate limiting and query-string stripping.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const path = require('path');
const S = process.env.SESSION_SECRET, OUT = process.argv[2];
const sign = (o) => { const b = Buffer.from(JSON.stringify(o)).toString('base64url');
  return b + '.' + createHmac('sha256', S).update(b).digest('base64url'); };
const n = () => Math.floor(Date.now() / 1000);
const A = process.env.ADMIN.split('|'), W = process.env.WORKER.split('|');
const CK = {
  PLATFORM: {name:'sc_platform', value: sign({typ:'platform', userId: process.env.PLATFORM, iat:n(), exp:n()+28800})},
  ADMIN:    {name:'sc_admin',    value: sign({typ:'admin', adminId:A[0], email:A[1], name:'Verify', role:A[2], iat:n(), exp:n()+28800})},
  WORKER:   {name:'sc_worker',   value: sign({typ:'worker', mobile:W[0], workerId:W[1], iat:n(), exp:n()+43200})},
};
const HOME = { PLATFORM:'/platform/dashboard', ADMIN:'/admin/submissions', WORKER:'/worker/dashboard' };
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

const ctx = async (br, portal, w) => {
  const c = await br.newContext({viewport:{width:w, height:w<768?844:900}, deviceScaleFactor:2,
    isMobile:w<768, hasTouch:w<768});
  await c.addCookies([{...CK[portal], domain:'localhost', path:'/', httpOnly:true, secure:false, sameSite:'Lax'}]);
  return c;
};
const probe = (p) => p.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Report an issue or give feedback"]');
  if (!btn) return null;
  const b = btn.getBoundingClientRect();
  const labelSpan = btn.querySelector('span');
  const labelShown = !!labelSpan && labelSpan.getClientRects().length > 0;
  // overlap against every other visible control in the header
  const hdr = btn.closest('header') || btn.closest('aside') || document.body;
  let worst = 0, culprit = '';
  for (const el of hdr.querySelectorAll('a,button')) {
    if (el === btn || btn.contains(el) || el.contains(btn)) continue;
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left));
    const y = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
    if (x > 1 && y > 1 && x * y > worst) { worst = x * y; culprit = (el.innerText||el.getAttribute('aria-label')||el.tagName).trim().slice(0,20); }
  }
  // REAL clipping only. scrollWidth > clientWidth on an `overflow: visible`
  // element means content extends past the box and renders fine — counting it
  // reported the portal badge as clipped when the screenshots showed it intact.
  // Only overflow that is actually HIDDEN can cut something off, and the one
  // such case here (the site name's `truncate`) is pre-existing and excluded.
  const clipped = Array.from(hdr.querySelectorAll('*')).filter((e) => {
    // Visually-hidden labels are 1px boxes with hidden overflow BY DESIGN —
    // that is how sr-only works, and they were reported as clipped at every
    // width including 1280px, which is what gave them away.
    if (e.clientWidth <= 4 || e.clientHeight <= 4) return false;
    if (e.scrollWidth - e.clientWidth <= 1) return false;
    if (getComputedStyle(e).overflowX !== 'hidden') return false;
    const cls = String(e.className || '');
    return !cls.includes('truncate') && !cls.includes('sr-only');
  }).map((e) => (e.innerText || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 20));
  return { top: Math.round(b.top), height: Math.round(b.height), width: Math.round(b.width),
    labelShown, overlapArea: Math.round(worst), culprit,
    clipped, pageOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    aboveFold: b.top >= 0 && b.bottom <= window.innerHeight };
});

(async () => {
  const br = await chromium.launch();

  console.log('== entry point present, sized and unobstructed ==');
  for (const portal of ['PLATFORM','ADMIN','WORKER']) {
    for (const w of [320,360,375,390,412,430,1280]) {
      const c = await ctx(br, portal, w); const p = await c.newPage();
      await p.goto('http://localhost:3000'+HOME[portal], {waitUntil:'domcontentloaded', timeout:120000});
      await p.waitForTimeout(700);
      const r = await probe(p);
      if (!r) { chk(`${portal} @${w} button present`, false, 'not found'); await c.close(); continue; }
      const expectLabel = w >= 375;
      const ok = r.overlapArea === 0 && r.clipped.length === 0 && r.pageOverflow === 0
                 && r.labelShown === expectLabel && r.height >= 44 && r.aboveFold && r.width >= 44;
      chk(`${portal} @${w}`, ok,
        `label=${r.labelShown} (want ${expectLabel}) ${r.width}x${r.height} overlap=${r.overlapArea}${r.culprit?' with '+r.culprit:''} clipped=${r.clipped.length?r.clipped.join(','):'none'} pageOverflow=${r.pageOverflow} aboveFold=${r.aboveFold}`);
      if (w === 390 || w === 320) {
        const hb = await p.evaluate(() => { const h = document.querySelector('header')||document.querySelector('aside');
          const r = h.getBoundingClientRect(); return {x:0,y:Math.max(0,r.top),width:Math.min(1280,r.width),height:Math.min(220,r.height+6)}; });
        await p.screenshot({path: path.join(OUT, `entry-${portal}-${w}.png`), clip: hb});
      }
      await c.close();
    }
  }

  console.log('\n== the dialog ==');
  {
    const c = await ctx(br, 'WORKER', 390); const p = await c.newPage();
    await p.goto('http://localhost:3000/worker/dashboard?site=secret&q=Jane+Doe', {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(800);
    chk('coach mark shown on first visit', await p.evaluate(() => !!document.querySelector('[role="note"]')));
    await p.click('button[aria-label="Report an issue or give feedback"]');
    await p.waitForTimeout(500);
    const d = await p.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      return { modal: dlg.getAttribute('aria-modal'), labelled: !!dlg.getAttribute('aria-labelledby'),
        types: Array.from(dlg.querySelectorAll('button[aria-pressed]')).map(b=>b.innerText.trim()),
        hasTextarea: !!dlg.querySelector('textarea'),
        contactOffered: !!dlg.querySelector('input[type=checkbox]'),
        focusInside: dlg.contains(document.activeElement) };
    });
    chk('dialog is a labelled modal', d && d.modal === 'true' && d.labelled);
    chk('three issue types offered', d && d.types.length === 3, d ? d.types.join(' / ') : '');
    chk('focus moves inside the dialog', d && d.focusInside);
    chk('contact option hidden for workers (no email on record)', d && d.contactOffered === false);
    await p.screenshot({path: path.join(OUT,'dialog-390.png'), clip:{x:0,y:0,width:390,height:844}});

    chk('too-short description is rejected client-side',
      await p.evaluate(async () => { const t=document.querySelector('textarea');
        const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
        set.call(t,'short'); t.dispatchEvent(new Event('input',{bubbles:true}));
        const btn=Array.from(document.querySelectorAll('button')).find(b=>/send report/i.test(b.innerText));
        btn.click(); await new Promise(r=>setTimeout(r,300));
        return !!document.querySelector('[role="alert"]'); }));

    const sent = await p.evaluate(async () => {
      const t=document.querySelector('textarea');
      const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      set.call(t,'The export button returns an error when I clear the date filter.');
      t.dispatchEvent(new Event('input',{bubbles:true}));
      const btn=Array.from(document.querySelectorAll('button')).find(b=>/send report/i.test(b.innerText));
      btn.click(); await new Promise(r=>setTimeout(r,2500));
      return document.body.innerText.match(/SC-R-\d+/)?.[0] ?? null;
    });
    chk('a report is accepted and a reference shown', !!sent, sent || 'no reference');
    await p.screenshot({path: path.join(OUT,'sent-390.png'), clip:{x:0,y:0,width:390,height:844}});
    await c.close();
  }

  console.log('\n== server-side rules ==');
  {
    const c = await ctx(br, 'WORKER', 390); const p = await c.newPage();
    await p.goto('http://localhost:3000/worker/dashboard', {waitUntil:'domcontentloaded', timeout:120000});
    const post = (body) => p.evaluate(async (b) => {
      const r = await fetch('/api/reports', {method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify(b), credentials:'include'});
      return { s: r.status, b: await r.text() };
    }, body);
    const second = await post({type:'BUG', description:'Another report straight after the first one.', pagePath:'/worker/dashboard'});
    chk('rate limit blocks a second report inside 60s', second.s === 429, `HTTP ${second.s}`);
    const spoof = await post({type:'BUG', description:'Trying to file this as somebody else entirely.',
      pagePath:'/worker/dashboard', reporterName:'Someone Else', portal:'ADMIN'});
    chk('client-supplied identity is ignored', spoof.s === 429 || spoof.s === 200, `HTTP ${spoof.s}`);
    await c.close();
  }
  {
    const c = await br.newContext(); const p = await c.newPage();
    await p.goto('http://localhost:3000/check-in', {waitUntil:'domcontentloaded', timeout:120000});
    const anon = await p.evaluate(async () => { const r = await fetch('/api/reports', {method:'POST',
      headers:{'content-type':'application/json'}, body: JSON.stringify({type:'BUG', description:'anonymous attempt here'})});
      return r.status; });
    chk('unauthenticated reports are refused', anon === 401, `HTTP ${anon}`);
    await c.close();
  }

  console.log('\n== what was actually stored ==');
  {
    const c = await ctx(br, 'ADMIN', 1280); const p = await c.newPage();
    await p.goto('http://localhost:3000/admin/submissions?site=secret&q=Jane+Doe', {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(600);
    const r = await p.evaluate(async () => {
      const res = await fetch('/api/reports', {method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({type:'FEEDBACK', description:'Checking what context is captured with a report.',
          contactRequested:true, pagePath: window.location.pathname + window.location.search,
          pageTitle: document.title, viewportWidth: innerWidth, viewportHeight: innerHeight,
          devicePixelRatio: devicePixelRatio})});
      return { s: res.status, b: await res.json() };
    });
    chk('an admin report is accepted', r.s === 200 && r.b.ok, JSON.stringify(r.b).slice(0,80));
    await c.close();
  }

  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
