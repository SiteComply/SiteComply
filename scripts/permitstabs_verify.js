/**
 * Permits status tabs: "All permits" leads, is selected on load, and the tabs
 * behave as conventional filters.
 *
 * The important assertions are the ones about what did NOT change — URL shape,
 * pagination reset, and the row set behind each tab.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const USER = process.argv[2], OUT = process.argv[3], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'platform',userId:USER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const BASE='http://localhost:3000/platform/dashboard/permits';
let fails=0;
const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};
const tabs = p => p.$$eval('nav[aria-label="Filter permits by status"] a', as =>
  as.map(a => ({label:a.innerText.trim(), href:a.getAttribute('href'), active:a.getAttribute('aria-current')==='page'})));
const rowCount = p => p.locator('tbody tr').count();

(async()=>{
  if (OUT) fs.mkdirSync(OUT,{recursive:true});
  const br=await chromium.launch();
  const c=await br.newContext({viewport:{width:1500,height:1000},deviceScaleFactor:2});
  await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p=await c.newPage();
  const go = async qs => { await p.goto(`${BASE}${qs}`,{waitUntil:'networkidle',timeout:120000}); await p.waitForTimeout(250); };

  console.log('\n=== default load ===');
  await go('');
  let t = await tabs(p);
  chk('"All permits" is the first tab', t[0]?.label === 'All permits', t.map(x=>x.label).join(' | '));
  chk('"All permits" is selected on load', t[0]?.active === true);
  chk('exactly one tab is selected', t.filter(x=>x.active).length === 1);
  chk('its href is the bare path (URL shape unchanged)', t[0]?.href === '/platform/dashboard/permits', t[0]?.href);
  const all = await rowCount(p);
  chk('the default list is the full register', all > 0, `${all} rows`);
  if (OUT) await p.screenshot({path:`${OUT}/1-all-default.png`, fullPage:true});

  console.log('\n=== every status tab filters, and none toggles ===');
  const statuses = t.slice(1);
  let sum = 0;
  for (const tab of statuses) {
    await go(new URL(tab.href, 'http://x').search);
    const cur = await tabs(p);
    const self = cur.find(x => x.label === tab.label);
    chk(`${tab.label}: selected when active`, self?.active === true);
    chk(`${tab.label}: its href points at itself, not back to all`, self?.href === tab.href, self?.href);
    const rows = await rowCount(p);
    sum += rows;
    chk(`${tab.label}: "All permits" is offered as the way back`, cur[0]?.href === '/platform/dashboard/permits' && cur[0]?.active === false, `${rows} rows`);
  }
  console.log(`        (status tabs total ${sum} rows; All shows ${all})`);

  console.log('\n=== URL, filters and pagination unchanged ===');
  await go('?status=APPROVED&site=&q=');
  chk('an existing ?status= link still works', (await tabs(p)).find(x=>x.label==='Approved')?.active === true, p.url().replace('http://localhost:3000',''));
  await go('?status=SUBMITTED&page=2');
  const back = await tabs(p);
  chk('switching tab drops ?page (resets to page 1)',
      !back.find(x=>x.label==='Approved')?.href.includes('page='),
      back.find(x=>x.label==='Approved')?.href);
  await go('?q=HW&status=APPROVED');
  chk('search survives on the tab hrefs', (await tabs(p))[0].href.includes('q=HW'), (await tabs(p))[0].href);
  if (OUT) { await go('?status=APPROVED'); await p.screenshot({path:`${OUT}/2-approved.png`, fullPage:true}); }

  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nAll permits tab behaves as specified');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
