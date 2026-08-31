/**
 * Every sortable column, both directions, plus the URL after each real click.
 * Clicks the headers rather than navigating to crafted URLs — the point is to
 * show what the user's own clicking produces.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const USER = process.argv[2], OUT = process.argv[3], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'platform',userId:USER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const BASE = 'http://localhost:3000/platform/dashboard/actions';

const trail = [];
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1500,height:1150},deviceScaleFactor:2});
  await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();

  const shot = async (name, note) => {
    await p.waitForTimeout(350);
    const url = p.url().replace('http://localhost:3000','');
    const aria = await p.$$eval('thead th', ths =>
      ths.map(th => `${th.innerText.trim()}=${th.getAttribute('aria-sort')}`).join(' · '));
    trail.push({ name, note, url, aria });
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(`${name.padEnd(22)} ${url}`);
    console.log(`${''.padEnd(22)} ${aria}`);
  };

  // Wait for the URL, not for load state: these are client-side navigations, so
  // waitForLoadState resolves on the page already loaded and captures the OLD
  // state. That is exactly what corrupted the first run of this script.
  const clickAndWait = async (locator, expect) => {
    const before = p.url();
    await locator.click();
    await p.waitForFunction(u => location.href !== u, before, { timeout: 15000 });
    if (expect) await p.waitForURL(expect, { timeout: 15000 });
    await p.waitForLoadState('networkidle');
  };
  const clickHeader = (label, expect) =>
    clickAndWait(p.locator(`thead th a:has-text("${label}")`).first(), expect);

  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
  await shot('00-default', 'Landing on the register with no sort in the URL');

  for (const [label, slug] of [['Action','action'],['State','state'],['Assigned','assigned']]) {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await clickHeader(label, /dir=asc/);
    await shot(`${slug}-asc`, `One click on ${label} — ascending`);
    await clickHeader(label, /dir=desc/);
    await shot(`${slug}-desc`, `Second click on ${label} — reverses to descending`);
  }

  // Due is the column the table already sorts by, so its FIRST click reverses
  // rather than starting ascending. Shown as it actually behaves.
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await clickHeader('Due', /dir=desc/);
  await shot('due-desc', 'One click on Due — it is already the active column, so it reverses to descending');
  await clickHeader('Due');
  await shot('due-asc-default', 'Second click returns to Due ascending, which is the default — so the params clear');

  // URL behaviour: sort survives a filter change and paging, and returning to
  // the default clears the params rather than restating them.
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await clickHeader('Assigned', /sort=assigned/);
  await clickAndWait(p.getByRole('link', { name: /^Open/ }).first(), /bucket=OPEN/);
  await shot('url-1-filter-keeps-sort', 'Applying the Open filter keeps the sort');
  const next = p.locator('a:has-text("Next")').first();
  if (await next.count()) {
    await clickAndWait(next, /page=2/);
    await shot('url-2-paging-keeps-sort', 'Paging keeps both the filter and the sort');
  }
  await p.goto(`${BASE}?sort=assigned&dir=asc`, { waitUntil: 'networkidle' });
  await clickHeader('Due');
  await shot('url-3-back-to-default', 'Sorting back to the default clears the params — plain URL, not one restating the default');

  fs.writeFileSync(`${OUT}/trail.json`, JSON.stringify(trail, null, 2));
  await br.close();
  console.log('\ncaptured', trail.length, 'states');
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
