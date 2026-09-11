/**
 * Completed-project HTTP behaviour.
 *
 * The defect was never "the write got through" — it was that a blocked write
 * returned a bare 500 with no body. So the assertions are about what the CALLER
 * is told: a 409 and a sentence, on the routes a manager can actually reach.
 * Each is paired against an OPEN project, because a 409 everywhere would also
 * pass if writes were simply broken.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:3111';
const EMAIL = process.env.EMAIL || 'ux.director@sitecomply.local';
const CODE = process.env.CODE || '231001';
const CLOSED = process.env.CLOSED_SITE;
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1400, height: 1200 } });
  const post = (ep, bd) => pg.evaluate(async ([b,e,d]) => {
    const r = await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});
    return r.status; }, [BASE, ep, bd]);
  await pg.goto(BASE+'/platform',{waitUntil:'domcontentloaded',timeout:120000});
  await post('/api/platform/auth/start',{method:'email',value:EMAIL});
  const v = await post('/api/platform/auth/verify',{method:'email',value:EMAIL,code:CODE});
  if (v!==200){console.log('  ABORT sign-in '+v);await br.close();process.exit(1);}

  const open = await pg.evaluate(async (b)=>{
    const r=await fetch(b+'/platform/dashboard/sites',{credentials:'include'});
    const t=await r.text();
    const ids=[...t.matchAll(/\/platform\/dashboard\/sites\/([a-z0-9]{20,})/g)].map(m=>m[1]);
    return [...new Set(ids)];},BASE);
  const openSite = open.find(id=>id!==CLOSED);
  console.log(`  open site: ${openSite}\n  closed site: ${CLOSED}\n`);

  const call=(m,ep,bd)=>pg.evaluate(async([b,mm,e,d])=>{
    const r=await fetch(b+e,{method:mm,headers:{'content-type':'application/json'},body:d?JSON.stringify(d):undefined,credentials:'include'});
    const t=await r.text(); let j=null; try{j=JSON.parse(t);}catch{}
    return {s:r.status,err:j&&j.error?j.error:null,closed:!!(j&&j.projectClosed),len:t.length};},[BASE,m,ep,bd]);

  const cases=[
    ['PATCH', (id)=>`/api/platform/sites/${id}/induction-validity`, {action:'validity',days:91},        'Save validity'],
    ['PATCH', (id)=>`/api/platform/sites/${id}/induction-validity`, {action:'invalidate'},              'Invalidate inductions'],
    ['PATCH', (id)=>`/api/platform/sites/${id}/site-information`,   {workingHours:'0800-1700'},         'Save site information'],
    ['PATCH', (id)=>`/api/platform/sites/${id}/emergency`,          {fireAssemblyPoint:'Car park'},     'Save emergency info'],
    ['PATCH', (id)=>`/api/platform/sites/${id}/gps`,                {action:'config',config:{enabled:false,radiusM:200}}, 'GPS config'],
    ['PATCH', (id)=>`/api/platform/sites/${id}/worker-access`,      {action:'invite',fullName:'HTTP Probe',company:'Probe Ltd',mobile:'+447700900802'}, 'Invite Operative'],
  ];
  for(const [m,ep,bd,label] of cases){
    const c=await call(m,ep(CLOSED),bd);
    chk(`${label}: completed -> 409`, c.s===409, `got ${c.s}${c.len===0?' with an EMPTY body':''}`);
    chk(`${label}: completed -> explains why`, /completed/i.test(c.err||''), c.err?`"${String(c.err).slice(0,60)}…"`:'(no message)');
    const o=await call(m,ep(openSite),bd);
    chk(`${label}: open project still works`, o.s>=200&&o.s<300, `got ${o.s}`);
  }

  console.log('\n  --- the roster page that crashed ---');
  for(const [label,id] of [['completed',CLOSED],['open',openSite]]){
    await pg.goto(`${BASE}/platform/dashboard/sites/${id}/workers`,{waitUntil:'networkidle',timeout:120000});
    const t=await pg.evaluate(()=>document.body.innerText);
    chk(`roster renders (${label})`, !/SOMETHING WENT WRONG|unexpected problem/i.test(t));
  }

  console.log('\n  --- the read-only notice, on every tab ---');
  for(const tab of ['','/workers','/experience?section=induction-validity','/compliance','/documents','/access']){
    await pg.goto(`${BASE}/platform/dashboard/sites/${CLOSED}${tab}`,{waitUntil:'networkidle',timeout:120000});
    const t=await pg.evaluate(()=>document.body.innerText);
    chk(`notice on ${tab||'/overview'}`, /This project is completed|read-only and preserved/i.test(t));
  }
  await pg.goto(`${BASE}/platform/dashboard/sites/${openSite}`,{waitUntil:'networkidle',timeout:120000});
  const ot=await pg.evaluate(()=>document.body.innerText);
  chk('an OPEN project shows no such notice', !/This project is completed/i.test(ot));

  console.log(`\n  ${fails===0?'ALL PASS':fails+' FAILED'}`);
  await br.close(); process.exit(fails?1:0);
})();
