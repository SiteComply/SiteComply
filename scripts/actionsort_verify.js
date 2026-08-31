/** Actions sorting, on real rows: order, stability, composition, screenshots. */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const USER = process.argv[2], OUT = process.argv[3], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'platform',userId:USER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const BASE = 'http://localhost:3000/platform/dashboard/actions';
let fails=0;
const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};
const rows = p => p.$$eval('tbody tr', trs => trs.map(tr =>
  Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g,' ').trim())));
const aria = p => p.$$eval('thead th', ths => ths.map(th => `${th.innerText.trim()}=${th.getAttribute('aria-sort')}`));

(async()=>{
  if (OUT) fs.mkdirSync(OUT,{recursive:true});
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1500,height:1100},deviceScaleFactor:2});
  await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();
  const go = async qs => { await p.goto(`${BASE}${qs}`,{waitUntil:'networkidle',timeout:120000}); await p.waitForTimeout(300); };

  console.log('\n=== default: Due ascending, unchanged from before ===');
  await go('');
  chk('Due marked ascending', (await aria(p)).includes('Due=ascending'), (await aria(p)).join(' | '));
  if (OUT) await p.screenshot({path:`${OUT}/1-default-due-asc.png`, fullPage:true});

  console.log('\n=== Assigned ascending — the column with no filter equivalent ===');
  await go('?sort=assigned&dir=asc');
  let r = await rows(p);
  const who = r.map(x=>x[3]).filter(v=>v && v !== '—' && v !== 'Unassigned');
  chk('assignees in ascending order',
      JSON.stringify(who)===JSON.stringify([...who].sort((a,z)=>a.localeCompare(z))),
      who.slice(0,3).join(' / '));
  chk('Assigned header reports ascending', (await aria(p)).includes('Assigned=ascending'));
  if (OUT) await p.screenshot({path:`${OUT}/2-assigned-asc.png`, fullPage:true});

  console.log('\n=== State ascending — Open before In progress before Completed ===');
  await go('?sort=state&dir=asc');
  r = await rows(p);
  const rank = {'Open':0,'In progress':1,'Completed':2};
  const seq = r.map(x=>{const m=Object.keys(rank).find(k=>x[1].includes(k)); return m?rank[m]:99;}).filter(v=>v!==99);
  chk('states non-decreasing', seq.every((v,i)=>i===0||v>=seq[i-1]), seq.join(','));
  if (OUT) await p.screenshot({path:`${OUT}/3-state-asc.png`, fullPage:true});

  console.log('\n=== Action title, both directions ===');
  await go('?sort=action&dir=asc');
  const ta = (await rows(p)).map(x=>x[0].split('\n')[0]);
  chk('titles ascending', JSON.stringify(ta)===JSON.stringify([...ta].sort((a,z)=>a.localeCompare(z))), ta[0]);
  await go('?sort=action&dir=desc');
  const td = (await rows(p)).map(x=>x[0].split('\n')[0]);
  chk('titles descending', JSON.stringify(td)===JSON.stringify([...td].sort((a,z)=>z.localeCompare(a))), td[0]);

  console.log('\n=== Due descending must not lead with undated actions ===');
  await go('?sort=due&dir=desc');
  r = await rows(p);
  const dues = r.map(x=>x[2]);
  const firstBlank = dues.findIndex(d => !d || d === '—' || /no due/i.test(d));
  chk('undated actions sort to the end, not the top',
      firstBlank === -1 || !dues.slice(firstBlank).some(d => d && d !== '—' && !/no due/i.test(d)),
      dues.slice(0,3).join(' / '));

  console.log('\n=== paging covers every action exactly once under a tied sort ===');
  const ids=[];
  for (let page=1; page<=4; page++){
    await go(`?sort=state&dir=asc&page=${page}`);
    ids.push(...await p.$$eval('tbody tr td:first-child a', as=>as.map(a=>a.getAttribute('href'))));
  }
  chk('no duplicates across pages', new Set(ids).size===ids.length, `${ids.length} rows, ${new Set(ids).size} unique`);
  chk('all 65 reachable', new Set(ids).size===65, `${new Set(ids).size} of 65`);

  console.log('\n=== sort composes with filters, paging and links ===');
  await go('?bucket=OPEN&sort=assigned&dir=asc');
  r = await rows(p);
  chk('bucket filter still applied while sorted', r.every(x=>/Open|In progress/i.test(x[1])), `${r.length} rows`);
  await go('?sort=assigned&dir=asc');
  const next = await p.locator('a:has-text("Next")').first().getAttribute('href').catch(()=>null);
  chk('Next carries the sort', !!next && next.includes('sort=assigned'), next||'(none)');
  const filterLink = await p.locator('a[href*="bucket="]').first().getAttribute('href').catch(()=>null);
  chk('a filter link carries the sort', !!filterLink && filterLink.includes('sort=assigned'), filterLink||'(none)');
  await go('?sort=nonsense&dir=sideways');
  chk('mangled sort falls back to the default', (await aria(p)).includes('Due=ascending'));

  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nall Actions sorting checks passed');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
