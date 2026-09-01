/**
 * Filter default wording — a WORDING change, so the whole job is proving the
 * behaviour underneath it did not move.
 *
 * Asserts the visible option text, that each select still has the same
 * accessible name (which comes from the <label>, not the option), and that the
 * empty value still round-trips: filter applied → URL param set → choose the
 * default again → param gone and every row back.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const USER = process.argv[2], OUT = process.argv[3], SECRET = process.env.SESSION_SECRET;
const fs = require('fs');
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'platform',userId:USER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const ROOT = 'http://localhost:3000/platform/dashboard';
let fails=0;
const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};

const selects = p => p.$$eval('form select', ss => ss.map(s => ({
  name: s.getAttribute('name'),
  label: (s.closest('label')?.querySelector('span')?.innerText || s.getAttribute('aria-label') || '').trim(),
  first: s.options[0].text,
  firstValue: s.options[0].value,
  count: s.options.length,
})));

(async()=>{
  if (OUT) fs.mkdirSync(OUT,{recursive:true});
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1500,height:1000},deviceScaleFactor:2});
  await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();

  for (const [page, expected] of [
    ['documents', {category:'All', site:'All', expiry:'All'}],
    ['actions',   {site:'All', priority:'All'}],
    ['audits',    {status:'All', site:'All'}],
    ['permits',   {site:'All'}],
  ]) {
    console.log(`\n=== ${page} ===`);
    await p.goto(`${ROOT}/${page}`, {waitUntil:'networkidle', timeout:120000});
    await p.waitForSelector('form select', {timeout:60000});
    const ss = await selects(p);
    for (const [name, want] of Object.entries(expected)) {
      const s = ss.find(x => x.name === name);
      chk(`${name}: default option reads "${want}"`, !!s && s.first === want, s ? `"${s.first}" under label "${s.label}"` : 'select not found');
      chk(`${name}: the field label still names the filter`, !!s && s.label.length > 0, s ? `label "${s.label}"` : '');
      chk(`${name}: default value is still empty`, !!s && s.firstValue === '', s ? `value="${s.firstValue}"` : '');
    }
    if (OUT) await p.screenshot({path:`${OUT}/${page}.png`, fullPage:false});
  }

  console.log('\n=== unlabelled selects keep the noun, in sentence case ===');
  await p.goto(`${ROOT}/submissions`, {waitUntil:'networkidle'});
  const sitesel = await p.$eval('select', s => ({first:s.options[0].text, value:s.options[0].value, aria:s.getAttribute('aria-label')}));
  chk('Check-ins site filter reads "All sites"', sitesel.first === 'All sites', `"${sitesel.first}" (aria "${sitesel.aria}")`);
  chk('its default value is still empty', sitesel.value === '');
  if (OUT) await p.screenshot({path:`${OUT}/submissions.png`, fullPage:false});

  console.log('\n=== behaviour round-trip: filter on, then back to the default ===');
  await p.goto(`${ROOT}/documents`, {waitUntil:'networkidle'});
  const total = await p.locator('tbody tr').count();
  // Pick a category the data actually has, so "it narrowed" is a real
  // observation rather than one that passes because nothing matched.
  const CAT = 'INSURANCE';
  await p.selectOption('select[name="category"]', CAT);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(new RegExp(`category=${CAT}`), {timeout:15000});
  const filtered = await p.locator('tbody tr').count();
  chk('choosing a category sets the URL param', p.url().includes(`category=${CAT}`), p.url().replace('http://localhost:3000',''));
  chk('the list narrowed to a NON-EMPTY subset', filtered > 0 && filtered < total, `${filtered} of ${total}`);

  await p.selectOption('select[name="category"]', '');
  await p.locator('button[type="submit"]').first().click();
  await p.waitForFunction(c => !location.search.includes(`category=${c}`), CAT, {timeout:15000});
  const back = await p.locator('tbody tr').count();
  // A plain GET form submits EVERY named field, so the default leaves
  // `category=` present but empty. That is pre-existing form behaviour and is
  // untouched by this change — what matters is that no category is selected.
  const params = new URL(p.url()).searchParams;
  chk('choosing "All" leaves the category unset', (params.get('category') ?? '') === '', p.url().replace('http://localhost:3000',''));
  chk('and every row is back', back === total, `${back} of ${total}`);

  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nwording changed, behaviour unchanged');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
