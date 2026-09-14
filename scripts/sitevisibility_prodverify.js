/**
 * Owner Review Item 17 — production verification.
 *
 * Two halves:
 *   1. the operative sees only their own projects (the fix);
 *   2. every assignment state still renders (the risk in the fix).
 *
 * For (2) it temporarily SUSPENDS one of the operative's assignments through the
 * platform, checks the operative view, and reinstates it. That is a real
 * production change on a test project, made and undone in the same run, because
 * asserting the label is compiled into the bundle is not the same as seeing it.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE='https://sitecomply-web.azurewebsites.net';
const MOB='+447700900150', CODE='231001';
let fails=0;
const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};

async function operativeView(br, shot) {
  const pg = await br.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  await pg.goto(BASE+'/check-in',{waitUntil:'domcontentloaded',timeout:120000});
  const post=(ep,bd)=>pg.evaluate(async([b,e,d])=>{const r=await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});return {s:r.status,t:(await r.text()).slice(0,100)};},[BASE,ep,bd]);
  await post('/api/worker/otp/request',{mobile:MOB});
  const v=await post('/api/worker/otp/verify',{mobile:MOB,code:CODE});
  if (v.s!==200) { await pg.close(); return { error:`sign-in ${v.s} ${v.t}` }; }
  await pg.goto(BASE+'/check-in/site',{waitUntil:'networkidle',timeout:120000});
  await pg.waitForTimeout(900);
  const out = await pg.evaluate(()=>{
    const body=document.body.innerText;
    const cards=Array.from(document.querySelectorAll('li'))
      .map(li=>li.innerText.replace(/\n/g,' · ').trim())
      .filter(t=>t && !/^(Verify|Your details|Choose site|Induction)$/.test(t));
    return { cards, notAvailable:/NOT AVAILABLE TO YOU/i.test(body), notInvited:/Not invited/i.test(body), body };
  });
  if (shot) await pg.screenshot({ path: shot, fullPage:true });
  await pg.close();
  return out;
}

(async()=>{
const br=await chromium.launch();

console.log('  --- 1. the operative sees only their own projects ---');
const before = await operativeView(br, '/tmp/item17/prod-after.png');
if (before.error) { console.log('  ABORT '+before.error); await br.close(); process.exit(1); }
console.log(`     sites shown: ${before.cards.length}`);
before.cards.forEach((c,i)=>console.log(`       ${i+1}. ${c.slice(0,72)}`));
chk('no "NOT AVAILABLE TO YOU" section', !before.notAvailable);
chk('no "Not invited" badge', !before.notInvited);
chk('they still see their own projects', before.cards.length > 0, `${before.cards.length}`);

// Platform session, to change an assignment state.
const pg=await br.newPage({viewport:{width:1400,height:1200}});
const post=(ep,bd)=>pg.evaluate(async([b,e,d])=>{const r=await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});return r.status;},[BASE,ep,bd]);
await pg.goto(BASE+'/platform',{waitUntil:'domcontentloaded',timeout:120000});
await post('/api/platform/auth/start',{method:'email',value:'jc@parryst.com'});
await post('/api/platform/auth/verify',{method:'email',value:'jc@parryst.com',code:'231001'});
const sites=JSON.parse(require('fs').readFileSync('/tmp/validity_apply.json','utf8'));
const E=sites.find(s=>/Test Site E/.test(s.name)).id;

// Drive the roster UI rather than scraping an id out of the flight payload:
// the actions rail already holds the assignment, so clicking Suspend needs no id.
// The roster DOES honour ?item=worker:<id> (unlike the check-ins register).
const TW='cmt859itw000a5fgb7mri21u4';
const RAIL=`${BASE}/platform/dashboard/sites/${E}/workers?item=worker%3A${TW}`;
await pg.goto(RAIL,{waitUntil:'networkidle',timeout:120000});
await pg.waitForTimeout(1200);
console.log(`\n  --- 2. non-active states still render ---`);
const haveRow = await pg.evaluate(()=>/MANAGE ACCESS/i.test(document.body.innerText));
chk('opened the operative actions rail', haveRow);
if (haveRow) {
  const suspend = pg.locator('button', { hasText: /^Suspend$/ }).first();
  chk('a Suspend action is offered', await suspend.count() > 0);
  if (await suspend.count()) {
    await suspend.click(); await pg.waitForTimeout(1000);
    // Some actions confirm; click any confirm that appears.
    const confirm = pg.locator('button', { hasText: /^(Suspend|Confirm)$/ }).last();
    if (await confirm.count()) { await confirm.click(); await pg.waitForTimeout(2200); }
    const state = await pg.evaluate(() => document.body.innerText);
    chk('the roster now shows them suspended', /Suspended|Access suspended/i.test(state),
        (state.match(/Suspended[^\n]{0,30}/i) || ['(not shown)'])[0]);

    const susp = await operativeView(br, '/tmp/item17/prod-suspended.png');
    chk('the site is STILL VISIBLE when suspended',
        susp.cards.some((c) => /Test Site E/.test(c)),
        susp.cards.map((c) => c.split(' · ')[0]).join(', '));
    chk('and it is labelled "Access suspended"', /Access suspended/i.test(susp.body));

    // Put it back, whatever happened above.
    await pg.goto(RAIL,{waitUntil:'networkidle',timeout:120000});
    await pg.waitForTimeout(1200);
    {
      const rein = pg.locator('button', { hasText: /^Reinstate$/ }).first();
      if (await rein.count()) {
        await rein.click(); await pg.waitForTimeout(1000);
        const c2 = pg.locator('button', { hasText: /^(Reinstate|Confirm)$/ }).last();
        if (await c2.count()) { await c2.click(); await pg.waitForTimeout(2200); }
      }
      chk('reinstated', await pg.evaluate(() => !/Access suspended/i.test(document.body.innerText)));
    }
    const back = await operativeView(br, null);
    chk('operative view back to normal', !/Access suspended/i.test(back.body));
  }
}

console.log(`\n  ${fails===0?'ALL PASS':fails+' FAILED'}`);
await br.close(); process.exit(fails?1:0);
})();
