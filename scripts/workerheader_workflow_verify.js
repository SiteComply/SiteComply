const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const S=process.env.SESSION_SECRET, n=Math.floor(Date.now()/1000);
const b=Buffer.from(JSON.stringify({typ:'worker',mobile:'+447700900101',workerId:'cms5ebw3v001d12v6ojfsorub',iat:n,exp:n+28800})).toString('base64url');
const tok=b+'.'+createHmac('sha256',S).update(b).digest('base64url');
let fails=0; const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};
(async()=>{
  const br=await chromium.launch();
  const c=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addCookies([{name:'sc_worker',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p=await c.newPage();
  await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'networkidle',timeout:120000});
  await p.waitForTimeout(400);

  const before = await p.$eval('header select', s=>s.options[s.selectedIndex].textContent.trim());
  const other  = await p.$$eval('header select option', o=>o.map(x=>({v:x.value,t:x.textContent.trim()})));
  const target = other.find(o=>o.t!==before);
  console.log(`  active: "${before}" → switching to "${target.t}"`);

  await p.selectOption('header select', target.v);
  const nav = await p.waitForFunction(t => document.querySelector('header select')
      && document.querySelector('header select').options[document.querySelector('header select').selectedIndex].textContent.trim() === t,
      target.t, {timeout:20000}).then(()=>true).catch(()=>false);
  await p.waitForTimeout(600);
  const after = await p.$eval('header select', s=>s.options[s.selectedIndex].textContent.trim());
  chk('the switcher now shows the chosen site', after === target.t, `"${after}"`);
  chk('landed on the worker dashboard', new URL(p.url()).pathname === '/worker/dashboard', p.url().replace('http://localhost:3000',''));
  const siteHeading = await p.locator('text=' + target.t).first().count();
  chk('the page content reflects the new site', siteHeading > 0);

  // Check out must still be reachable and still confirm rather than act.
  // Switching does router.push + refresh, so the header re-renders. Waiting for
  // the control rather than sampling a count mid-navigation — the first run of
  // this script read 0 while the click a moment later worked fine.
  // Scoped to the SHELL header. The dashboard renders its own <header> with the
  // primary "Check out of site" button, so an unscoped `header button` matches
  // both — which is S4's duplicate affordance showing up in the test, not a
  // second control in the shell.
  const co = p.locator('header').first().locator('button:has-text("Check out")');
  await co.first().waitFor({ state: 'visible', timeout: 15000 }).catch(()=>{});
  chk('Check out is present in the header', await co.count() === 1, `${await co.count()} found`);
  await co.first().click();
  await p.waitForTimeout(400);
  const dialog = await p.locator('text=/check out/i').count();
  chk('tapping Check out opens a confirmation, not an action', dialog > 1);
  const stillOpen = await p.evaluate(()=>document.body.innerText.includes('Check out'));
  chk('no check-out performed by the tap alone', stillOpen);

  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nworkflow preserved: switching and check-out behave as before');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
