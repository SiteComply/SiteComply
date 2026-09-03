/**
 * Worker session TTL + active-site persistence.
 *
 * Run against a dev server started with WORKER_TTL_SECONDS=43200 to prove the
 * configured value reaches BOTH cookies. Reads the OTP out of the mock-SMS dev
 * log, waiting for a code newer than the last one — `tail -1` alone returns a
 * consumed code and the verify then fails for the wrong reason.
 */
/**
 * End-to-end on a 12h-TTL dev server: OTP login, cookie lifetimes, active-site
 * persistence, dashboard access and check-out availability.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { execSync } = require('child_process');
const MOBILE='+447700900101';
let fails=0; const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok)fails++;};
const lastCode=()=>{
  const out=execSync("grep -o '[0-9]\\{6\\} is your SiteComply' /tmp/dev3000.log | tail -1").toString().trim();
  return out ? out.split(' ')[0] : null;
};
/** Wait for a code NEWER than `prev` — tail -1 otherwise returns a consumed one. */
const freshCode=async(prev)=>{
  for(let i=0;i<40;i++){
    const c=lastCode();
    if(c && c!==prev) return c;
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('no new OTP appeared in the dev log');
};
(async()=>{
 const br=await chromium.launch();
 const c=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const p=await c.newPage();
 const call=(ep,body)=>p.evaluate(async([e,bd])=>{const r=await fetch(e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(bd),credentials:'include'});return{s:r.status,b:(await r.text()).slice(0,200)};},[ep,body]);

 console.log('== 1. OTP LOGIN ==');
 await p.goto('http://localhost:3000/check-in',{waitUntil:'domcontentloaded',timeout:120000});
 const prev=lastCode();
 let q=await call('/api/worker/otp/request',{mobile:MOBILE});
 chk('OTP request accepted', q.s===200, `HTTP ${q.s}`);
 const code=await freshCode(prev);
 chk('a code was issued', /^\d{6}$/.test(code), code);
 const v=await call('/api/worker/otp/verify',{mobile:MOBILE, code});
 chk('OTP verify succeeds', v.s===200, `HTTP ${v.s} ${v.b}`);

 console.log('\n== 2. SESSION COOKIE LIFETIME ==');
 let cks=await c.cookies();
 const sess=cks.find(k=>k.name==='sc_worker');
 const hours=sess ? (sess.expires - Date.now()/1000)/3600 : 0;
 chk('sc_worker is set', !!sess);
 chk('sc_worker lasts ~12 hours', hours>11.9 && hours<12.1, `${hours.toFixed(2)}h`);
 chk('sc_worker is persistent, not a browser-session cookie', sess && sess.expires>0);

 console.log('\n== 3. DASHBOARD ACCESS + CHECK-OUT AVAILABLE ==');
 await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'domcontentloaded',timeout:120000});
 await p.waitForTimeout(900);
 chk('lands on the dashboard', p.url().includes('/worker/dashboard'), p.url().replace('http://localhost:3000',''));
 // Look for the CONTROL, not a truncated slice of the header's text.
 const co0=await p.evaluate(()=>{
   const h=document.querySelector('header'); if(!h) return null;
   const el=Array.from(h.querySelectorAll('a,button')).find(e=>/check out/i.test(e.innerText||''));
   return el?{text:el.innerText.replace(/\s+/g,' ').trim(), tag:el.tagName.toLowerCase()}:null;});
 chk('Check out is offered in the header', !!co0, co0?`<${co0.tag}> "${co0.text}"`:'no Check out control found');

 console.log('\n== 4. ACTIVE-SITE PERSISTENCE ==');
 const sites=await p.evaluate(()=>{const s=document.querySelector('header select'); return s?Array.from(s.options).map(o=>({v:o.value,t:o.text.trim()})):[];});
 console.log(`  worker is checked into ${sites.length} site(s): ${sites.map(s=>s.t).join(', ')}`);
 if(sites.length>1){
   const target=sites[1];
   const r=await call('/api/worker/active-site',{siteId:target.v});
   chk('switching active site succeeds', r.s===200, `HTTP ${r.s}`);
   cks=await c.cookies();
   const site=cks.find(k=>k.name==='sc_worker_site');
   const sh=site ? (site.expires - Date.now()/1000)/3600 : 0;
   chk('sc_worker_site is set', !!site, site?site.value:'');
   chk('sc_worker_site ALSO lasts ~12 hours (the fix)', sh>11.9 && sh<12.1, `${sh.toFixed(2)}h`);
   await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'domcontentloaded',timeout:120000});
   await p.waitForTimeout(800);
   const active=await p.evaluate(()=>{const s=document.querySelector('header select'); return s?s.value:null;});
   chk('the chosen site survives a reload', active===target.v, `${target.t}`);
 } else chk('multi-site switch exercised', false, 'worker has only one open check-in');

 console.log('\n== 5. REOPEN THE PORTAL (new tab, same cookie jar) ==');
 const p2=await c.newPage();
 await p2.goto('http://localhost:3000/check-in',{waitUntil:'domcontentloaded',timeout:120000});
 await p2.waitForTimeout(800);
 chk('an already checked-in worker is sent straight to the dashboard',
     p2.url().includes('/worker/dashboard'), p2.url().replace('http://localhost:3000',''));

 console.log('\n== 6. CHECK-OUT ==');
 const before=await p2.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,60));
 const co=await p2.evaluate(async()=>{const r=await fetch('/api/worker/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({}),credentials:'include'});return{s:r.status,b:(await r.text()).slice(0,160)};});
 chk('check-out endpoint reachable and authorised', co.s===200||co.s===400, `HTTP ${co.s} ${co.b.slice(0,80)}`);
 chk('check-out was NOT rejected as an expired session', !/session has expired/i.test(co.b), co.b.slice(0,60));

 await br.close();
 console.log(`\n  ${fails} failure(s)\n`);
 process.exit(fails?1:0);
})();
