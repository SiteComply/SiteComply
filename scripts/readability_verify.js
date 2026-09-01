/**
 * Readability fixes: contrast measured on the rendered page, and the two type
 * changes checked for the layout cost they could have introduced.
 *
 * Contrast is computed from the COMPUTED colour and the nearest painted
 * ancestor background, so it reflects what is actually on screen rather than
 * what the token file says.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs'), path = require('path');
const S = process.env.SESSION_SECRET, OUT = process.argv[2];
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'worker',mobile:'+447700900101',workerId:'cms5ebw3v001d12v6ojfsorub',iat:n,exp:n+28800})).toString('base64url');
const ck = b + '.' + createHmac('sha256', S).update(b).digest('base64url');
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

const CONTRAST = `
  const px=s=>{const m=s.match(/[\\d.]+/g); return m?m.slice(0,3).map(Number):[255,255,255];};
  const lum=c=>{const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
  const ratio=(el)=>{let e=el,bg=[255,255,255];
    while(e){const s=getComputedStyle(e).backgroundColor;
      if(s&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(s)){bg=px(s);break;} e=e.parentElement;}
    const fg=px(getComputedStyle(el).color);const L1=lum(fg),L2=lum(bg);
    return {r:Math.round(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05))*100)/100,
            fg:getComputedStyle(el).color,bg:'rgb('+bg.join(', ')+')',
            size:Math.round(parseFloat(getComputedStyle(el).fontSize)*10)/10};};
`;

const ctx = async (br, w) => {
  const c = await br.newContext({viewport:{width:w,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await c.addCookies([{name:'sc_worker',value:ck,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  return c;
};
const crop = async (p, sel, file, minW=250) => {
  const box = await p.evaluate(([s,mw]) => {
    const el = document.querySelector(s); if(!el) return null;
    let c = el;
    for(let k=0;k<6&&c.parentElement;k++){const r=c.getBoundingClientRect(); if(r.width>mw&&r.height>36) break; c=c.parentElement;}
    c.scrollIntoView({block:'center'});
    const r = c.getBoundingClientRect();
    return {x:Math.max(0,r.left-6),y:Math.max(0,r.top-6),width:Math.min(390,r.width+12),height:Math.min(340,r.height+12)};
  },[sel,minW]);
  if (box && box.width > 10) { await p.screenshot({path:path.join(OUT,file),clip:box}); return true; }
  return false;
};

(async () => {
  const br = await chromium.launch();
  console.log('== READABILITY FIXES ==\n-- contrast, measured on the rendered page --');

  const c = await ctx(br, 390); const p = await c.newPage();
  await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(800);
  const r1 = await p.evaluate(new Function(CONTRAST + `
    const nav=document.querySelector('nav[aria-label="Worker dashboard sections"]');
    const act=Array.from(nav.querySelectorAll('a')).find(a=>a.getAttribute('aria-current')==='page');
    const inact=Array.from(nav.querySelectorAll('a')).find(a=>a.getAttribute('aria-current')!=='page');
    const lbl=a=>Array.from(a.querySelectorAll('span')).find(s=>s.className==='md:hidden');
    const badge=Array.from(document.querySelectorAll('*')).find(e=>/bg-safe-/.test(typeof e.className==='string'?e.className:''));
    return {active:ratio(lbl(act)), inactive:ratio(lbl(inact)), badge:badge?ratio(badge):null};
  `));
  chk('active nav pill label meets AA (4.5:1)', r1.active.r >= 4.5,
      `${r1.active.r}:1 — white on ${r1.active.bg} at ${r1.active.size}px (was 2.5:1)`);
  chk('inactive nav labels unchanged and still strong', r1.inactive.r >= 4.5, `${r1.inactive.r}:1`);
  chk('Worker role badge meets AA (4.5:1)', r1.badge.r >= 4.5,
      `${r1.badge.r}:1 — white on ${r1.badge.bg} at ${r1.badge.size}px (was 2.7:1)`);
  await crop(p, 'nav[aria-label="Worker dashboard sections"] a[aria-current="page"]', 'after-nav.png', 300);
  await crop(p, 'header', 'after-badge.png', 300);

  console.log('\n-- type sizes, measured on the rendered page --');
  await p.goto('http://localhost:3000/worker/emergency',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(700);
  const r2 = await p.evaluate(new Function(CONTRAST + `
    const el=Array.from(document.querySelectorAll('p')).find(e=>/^(Muster at|Name|Contact number)$/i.test(e.innerText.trim()));
    if(!el) return null; const cs=getComputedStyle(el);
    return {...ratio(el), transform:cs.textTransform, spacing:cs.letterSpacing, text:el.innerText.trim()};
  `));
  chk('emergency labels are 14px', r2 && r2.size === 14, r2 ? `${r2.size}px "${r2.text}"` : 'not found');
  chk('emergency labels are no longer uppercase', r2 && r2.transform === 'none', r2 ? r2.transform : '');
  chk('emergency labels still meet AA', r2 && r2.r >= 4.5, r2 ? `${r2.r}:1` : '');
  await crop(p, 'p.text-sm.font-medium', 'after-emergency.png');

  await p.goto('http://localhost:3000/worker/attendance',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(700);
  const r3 = await p.evaluate(new Function(CONTRAST + `
    const warn=Array.from(document.querySelectorAll('p')).find(e=>/^Not checked out$/.test(e.innerText.trim()));
    // Scope to the attendance ROW, not the KPI tile above it, which shows the
    // same shape of value at 24px.
    const row=warn?warn.closest('a'):null;
    const other=Array.from(document.querySelectorAll('a[href^="/worker/attendance/"]'))
      .map(a=>Array.from(a.querySelectorAll('p')).find(e=>/^\\d+h \\d+m$/.test(e.innerText.trim())))
      .find(Boolean);
    return {warn:warn?ratio(warn):null, hours:other?ratio(other):null};
  `));
  chk('"Not checked out" is 14px', r3.warn && r3.warn.size === 14, r3.warn ? `${r3.warn.size}px` : 'not found');
  chk('the hours label it replaces stays 12px', !r3.hours || r3.hours.size === 12, r3.hours ? `${r3.hours.size}px` : 'no complete rows on screen');
  // NOT an approved item: discovered while implementing. The whole hivis scale
  // fails on white (2.56:1 at its darkest), so this cannot be fixed without a
  // palette change. Reported rather than silently passed or silently altered.
  console.log(`  NOTE  "Not checked out" contrast is ${r3.warn ? r3.warn.r : '?'}:1 — FAILS AA (4.5:1).`);
  console.log('        Unchanged by this work; no amber token in the palette reaches 4.5:1 on white.');
  chk('"Not checked out" contrast is no worse than before', r3.warn && r3.warn.r >= 2.5, r3.warn ? `${r3.warn.r}:1 (was 2.56:1)` : '');
  await crop(p, 'a[href^="/worker/attendance/"]', 'after-notcheckedout.png');
  await c.close();

  const c2 = await ctx(br, 390); const p2 = await c2.newPage();
  await p2.goto('http://localhost:3000/check-in/site',{waitUntil:'domcontentloaded',timeout:120000});
  await p2.waitForTimeout(800);
  const r4 = await p2.evaluate(() => {
    const els=Array.from(document.querySelectorAll('span')).filter(e=>/^(Verify|Your details|Choose site|Induction)$/.test(e.innerText.trim()));
    if(!els.length) return null;
    const lh=parseFloat(getComputedStyle(els[0]).lineHeight);
    return {size:Math.round(parseFloat(getComputedStyle(els[0]).fontSize)),
      count:els.length, wrapped:els.filter(e=>e.getBoundingClientRect().height>lh*1.4).length,
      overflow:els.some(e=>{const r=e.getBoundingClientRect(); return r.right>window.innerWidth+0.5||r.left<-0.5;})};
  });
  chk('check-in stepper is 12px', r4 && r4.size === 12, r4 ? `${r4.size}px` : 'not found');
  chk('no stepper label wraps or overflows', r4 && r4.wrapped === 0 && !r4.overflow, r4 ? `${r4.wrapped} wrapped of ${r4.count}` : '');
  await crop(p2, 'span.text-xs.font-medium', 'after-stepper.png', 300);
  await c2.close();

  console.log('\n-- regression: the nav fix must not cost destinations --');
  const counts = [];
  for (const w of [320,360,390,430,480]) {
    const cc = await ctx(br, w); const pp = await cc.newPage();
    await pp.goto('http://localhost:3000/worker/dashboard',{waitUntil:'domcontentloaded',timeout:120000});
    await pp.waitForTimeout(600);
    const v = await pp.evaluate(() => { const nav=document.querySelector('nav[aria-label="Worker dashboard sections"]');
      const nb=nav.getBoundingClientRect();
      return Array.from(nav.querySelectorAll('a')).filter(a=>{const b=a.getBoundingClientRect();
        return b.left>=nb.left-0.5&&b.right<=nb.right+0.5;}).length; });
    counts.push([w,v]); await cc.close();
  }
  const expected = {320:3,360:4,390:4,430:5,480:6};
  chk('destinations in view unchanged by the colour change',
    counts.every(([w,v]) => v === expected[w]), counts.map(([w,v])=>`${w}:${v}`).join(' '));

  fs.writeFileSync(path.join(OUT,'readability.json'), JSON.stringify({contrast:r1, emergency:r2, attendance:r3, stepper:r4, counts}, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
