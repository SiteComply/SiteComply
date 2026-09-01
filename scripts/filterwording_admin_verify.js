/** Admin Check-ins filters: wording changed, filtering behaviour unchanged. */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const ADMIN = process.argv[2], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'admin',adminId:ADMIN,email:'dev.admin@sitecomply.local',name:'Jamie Carter',role:'OWNER',iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const URL_='http://localhost:3000/admin/submissions';
let fails=0;
const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};
(async()=>{
  const br=await chromium.launch();
  const c=await br.newContext({viewport:{width:1500,height:1000}});
  await c.addCookies([{name:'sc_admin',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p=await c.newPage();
  await p.goto(URL_,{waitUntil:'networkidle',timeout:120000});
  await p.waitForSelector('form select',{timeout:60000});

  const ss = await p.$$eval('form select', els => els.map(s => ({
    name:s.getAttribute('name'),
    label:(s.closest('label')?.querySelector('span')?.innerText||'').trim(),
    first:s.options[0].text, value:s.options[0].value, selected:s.value })));
  for (const s of ss) {
    chk(`${s.name}: default reads "All"`, s.first==='All', `"${s.first}" under label "${s.label}"`);
    chk(`${s.name}: the field label is still visible`, s.label.length>0, `"${s.label}"`);
    chk(`${s.name}: default value still empty and selected on load`, s.value==='' && s.selected==='', `value="${s.value}" selected="${s.selected}"`);
  }

  // Behaviour: the site filter must still filter, and "All" must clear it.
  const total = await p.locator('table tbody tr, li').count();
  const siteOpts = await p.$$eval('select[name="site"] option', o=>o.map(x=>x.value).filter(Boolean));
  if (siteOpts.length) {
    await p.selectOption('select[name="site"]', siteOpts[0]);
    await p.locator('button[type="submit"], input[type="submit"]').first().click();
    await p.waitForURL(new RegExp(`site=${siteOpts[0]}`),{timeout:15000});
    chk('choosing a site sets the URL param', p.url().includes(`site=${siteOpts[0]}`));
    await p.selectOption('select[name="site"]','');
    await p.locator('button[type="submit"], input[type="submit"]').first().click();
    await p.waitForFunction(s=>!location.search.includes(`site=${s}`), siteOpts[0], {timeout:15000});
    const back = await p.locator('table tbody tr, li').count();
    chk('choosing "All" leaves the site unset', (new URL(p.url()).searchParams.get('site')??'')==='' , p.url().replace('http://localhost:3000',''));
    chk('and the unfiltered count is restored', back===total, `${back} of ${total}`);
  } else {
    chk('site options available to test with', false, 'no sites in the dropdown');
  }
  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nadmin filters: wording changed, behaviour unchanged');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
