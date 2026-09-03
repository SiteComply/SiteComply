/**
 * R2 — production verification.
 *
 * Drives the REAL check-in form on the live site (not the API) so what is
 * measured is the routing a worker actually experiences, then confirms the
 * paths that had to keep working.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const MOBILE = process.env.TEST_WORKER_MOBILE || '+447700900150';
const CODE = process.env.TEST_WORKER_CODE || '231001';
const OUT = process.argv[2];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  console.log(`== POST-OTP ROUTING — PRODUCTION VERIFICATION ==\n   ${BASE}\n`);
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p = await c.newPage();
  const hops = [];
  p.on('framenavigated', f => { if (f === p.mainFrame()) hops.push(f.url().replace(BASE,'')); });

  console.log('-- driving the real form --');
  await p.goto(`${BASE}/check-in`, {waitUntil:'domcontentloaded', timeout:120000});
  await p.waitForSelector('input[type=tel]', {timeout:30000});
  await p.waitForTimeout(2500);   // hydration: clicking earlier submits natively
  await p.fill('input[type=tel]', MOBILE);
  const posts = [];
  p.on('response', async r => { if (r.url().includes('/api/worker/otp/') && r.request().method()==='POST')
    posts.push({u:r.url().split('/api')[1], s:r.status()}); });
  await p.locator('button:has-text("Send my code")').first().click();
  await p.waitForTimeout(3500);
  const req = posts.find(x => x.u.includes('/otp/request'));
  if (!req || req.s !== 200) {
    console.log(`  ABORT  could not request a code (${req?`HTTP ${req.s}`:'no POST seen'}) — later checks would be vacuous.\n`);
    await br.close(); process.exit(1);
  }
  chk('the mobile step POSTed and was accepted', req.s === 200, `HTTP ${req.s}`);

  await p.waitForSelector('input[inputmode=numeric], input[autocomplete="one-time-code"]', {timeout:30000});
  await p.waitForTimeout(600);
  await p.fill('input[inputmode=numeric], input[autocomplete="one-time-code"]', CODE);
  await p.locator('button[type=submit]').first().click();
  await p.waitForTimeout(4000);

  const ver = posts.find(x => x.u.includes('/otp/verify'));
  chk('verification succeeded', !!ver && ver.s === 200, ver?`HTTP ${ver.s}`:'no verify POST seen');
  const url = p.url().replace(BASE,'');
  const trail = hops.filter((v,i)=>hops.indexOf(v)===i).join(' -> ');
  console.log(`  navigation: ${trail}`);
  chk('lands on the dashboard, not the check-in funnel', url.startsWith('/worker/dashboard'), url);
  chk('never passed through details or site selection',
      !hops.some(h => h.startsWith('/check-in/details') || h.startsWith('/check-in/site')), trail);

  const co = await p.evaluate(() => { const h=document.querySelector('header'); if(!h) return null;
    const e=Array.from(h.querySelectorAll('a,button')).find(x=>/check out/i.test(x.innerText||'')); return e?e.innerText.trim():null; });
  chk('Check out is immediately available', !!co, co||'not found');
  const site = await p.evaluate(() => {
    const h=document.querySelector('header'); if(!h) return '';
    const s=h.querySelector('select');
    return s ? s.options[s.selectedIndex].text.trim() : (h.innerText.split('\n').find(l=>l.trim())||'').trim(); });
  console.log(`  active site context: ${site}`);
  await p.screenshot({path: path.join(OUT,'prod-after-otp.png'), clip:{x:0,y:0,width:390,height:420}});

  console.log('\n-- the paths that had to keep working --');
  const p2 = await c.newPage();
  await p2.goto(`${BASE}/check-in/details`, {waitUntil:'domcontentloaded', timeout:120000});
  await p2.waitForTimeout(1200);
  chk('/check-in/details redirects a checked-in worker to the dashboard',
      p2.url().includes('/worker/dashboard'), p2.url().replace(BASE,''));

  await p2.goto(`${BASE}/check-in/site`, {waitUntil:'domcontentloaded', timeout:120000});
  await p2.waitForTimeout(1200);
  const su = p2.url().replace(BASE,'');
  const h1 = await p2.evaluate(()=>document.querySelector('h1')?.innerText.trim()||'');
  chk('/check-in/site stays reachable (second-site check-in preserved)',
      su === '/check-in/site', `${su} "${h1}"`);

  fs.writeFileSync(path.join(OUT,'postotp.json'), JSON.stringify({trail, url, site}, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
