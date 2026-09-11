/**
 * Completed-project handling — production verification.
 *
 * Test Site C is the only completed project in production. Every refusal is
 * paired against an OPEN project, because "409 everywhere" would also pass if
 * writes were simply broken for everyone.
 *
 * The probes below are all writes that MUST be refused on the completed project.
 * On the open project they are deliberately no-op-shaped (saving a value back as
 * it already is) so the pairing costs nothing.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = 'https://sitecomply-web.azurewebsites.net';
const CLOSED = 'cmrikozgg000113416mizkixz';          // Test Site C — COMPLETED
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 1000 } });
  const post = (ep, bd) => pg.evaluate(async ([b,e,d]) => {
    const r = await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});
    return r.status; }, [BASE, ep, bd]);
  await pg.goto(BASE+'/platform',{waitUntil:'domcontentloaded',timeout:120000});
  await post('/api/platform/auth/start',{method:'email',value:'jc@parryst.com'});
  const v = await post('/api/platform/auth/verify',{method:'email',value:'jc@parryst.com',code:'231001'});
  if (v!==200){console.log('  ABORT sign-in '+v);await br.close();process.exit(1);}

  const sites = JSON.parse(require('fs').readFileSync('/tmp/validity_apply.json','utf8'));
  const OPEN = sites.find(s=>/Test Site E/.test(s.name)).id;

  const call=(m,ep,bd)=>pg.evaluate(async([b,mm,e,d])=>{
    const r=await fetch(b+e,{method:mm,headers:{'content-type':'application/json'},body:d?JSON.stringify(d):undefined,credentials:'include'});
    const t=await r.text(); let j=null; try{j=JSON.parse(t);}catch{}
    return {s:r.status,err:j&&j.error?j.error:null,len:t.length};},[BASE,m,ep,bd]);

  // days:91 on the open site is what it already holds, so the paired call is a no-op.
  const cases=[
    ['PATCH', id=>`/api/platform/sites/${id}/induction-validity`, {action:'validity',days:91},      'Save validity'],
    ['PATCH', id=>`/api/platform/sites/${id}/site-information`,   {},                               'Save site information'],
    ['PATCH', id=>`/api/platform/sites/${id}/emergency`,          {fireAssemblyPoint:'Carpark'},    'Save emergency info'],
    ['PATCH', id=>`/api/platform/sites/${id}/worker-access`,      {action:'invite',fullName:'Probe Two',company:'Probe Ltd',mobile:'+447700900803'}, 'Invite Operative'],
  ];
  console.log('  --- writes on the COMPLETED project must be refused, with a reason ---');
  for(const [m,ep,bd,label] of cases){
    const r=await call(m,ep(CLOSED),bd);
    chk(`${label}: 409 not 500`, r.s===409, `got ${r.s}${r.len===0?' with an EMPTY body':''}`);
    chk(`${label}: says why`, /completed/i.test(r.err||''), r.err?`"${String(r.err).slice(0,52)}…"`:'(no message)');
  }
  console.log('\n  --- the same writes on an OPEN project must still work ---');
  for(const [m,ep,bd,label] of cases.slice(0,3)){
    const r=await call(m,ep(OPEN),bd);
    chk(`${label}: open project unaffected`, r.s>=200&&r.s<300, `got ${r.s}`);
  }

  console.log('\n  --- the roster page that crashed ---');
  for(const [label,id] of [['completed',CLOSED],['open',OPEN]]){
    await pg.goto(`${BASE}/platform/dashboard/sites/${id}/workers`,{waitUntil:'networkidle',timeout:120000});
    const t=await pg.evaluate(()=>document.body.innerText);
    chk(`roster renders (${label})`, !/SOMETHING WENT WRONG|unexpected problem/i.test(t),
        /SOMETHING WENT WRONG/i.test(t)?'still crashing':'');
  }

  console.log('\n  --- the read-only notice, on every tab ---');
  for(const tab of ['','/workers','/experience?section=induction-validity','/compliance','/documents','/access']){
    await pg.goto(`${BASE}/platform/dashboard/sites/${CLOSED}${tab}`,{waitUntil:'networkidle',timeout:120000});
    const t=await pg.evaluate(()=>document.body.innerText);
    chk(`notice on ${tab||'/overview'}`, /This project is completed/i.test(t));
  }
  await pg.goto(`${BASE}/platform/dashboard/sites/${OPEN}`,{waitUntil:'networkidle',timeout:120000});
  chk('an OPEN project shows no such notice',
      !/This project is completed/i.test(await pg.evaluate(()=>document.body.innerText)));

  await pg.goto(`${BASE}/platform/dashboard/sites/${CLOSED}/experience?section=induction-validity`,{waitUntil:'networkidle',timeout:120000});
  await pg.waitForTimeout(500);
  await pg.screenshot({path:'/tmp/prodshots/10-closed-readonly.png'});
  console.log(`\n  ${fails===0?'ALL PASS':fails+' FAILED'}`);
  await br.close(); process.exit(fails?1:0);
})();
