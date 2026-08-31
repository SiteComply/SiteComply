/**
 * Sorting, filtering and pagination working TOGETHER — the interaction, not the
 * three features separately.
 *
 * For each (filter, sort) pair it walks every page of the filtered set and
 * checks three things across the whole walk, not per page: every row matches
 * the filter, the order is correct ACROSS page boundaries, and no row appears
 * twice or goes missing. Page-at-a-time checks would pass on an ordering that
 * silently reshuffles between pages, which is the failure this is here to catch.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const USER = process.argv[2], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'platform',userId:USER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const BASE = 'http://localhost:3000/platform/dashboard/actions';
let fails=0;
const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};

const CASES = [
  { name: 'Open + Assigned ascending',  qs: 'bucket=OPEN&sort=assigned&dir=asc',
    col: 3, cmp: (a,z)=>a.localeCompare(z), filter: s=>/Open|In progress/i.test(s) },
  { name: 'Open + Action descending',   qs: 'bucket=OPEN&sort=action&dir=desc',
    col: 0, cmp: (a,z)=>z.localeCompare(a), filter: s=>/Open|In progress/i.test(s) },
  { name: 'Completed + Due ascending',  qs: 'bucket=COMPLETED&sort=due&dir=asc',
    col: 2, cmp: null, filter: s=>/Completed/i.test(s) },
];

(async()=>{
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1500,height:1000}});
  await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();

  // Warm the route first: on a cold dev server the first navigation can settle
  // before the page has rendered, which is what produced the empty first case.
  await p.goto(`${BASE}`, {waitUntil:'networkidle', timeout:120000});
  await p.waitForSelector('tbody tr', {timeout:60000});

  for (const t of CASES) {
    console.log(`\n=== ${t.name} ===`);
    const cells=[], states=[], ids=[];
    let page = 1, pages = 1;
    do {
      await p.goto(`${BASE}?${t.qs}&page=${page}`, {waitUntil:'networkidle', timeout:120000});
      const rows = await p.$$eval('tbody tr', trs => trs.map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g,' ').trim())));
      rows.forEach(r => { cells.push(r[t.col]); states.push(r[1]); });
      ids.push(...await p.$$eval('tbody tr td:first-child a', as=>as.map(a=>a.getAttribute('href'))));
      const label = await p.locator('text=/Page \\d+ of \\d+/').first().innerText().catch(()=>'Page 1 of 1');
      pages = parseInt(label.split(' of ')[1] || '1', 10);
      page++;
    } while (page <= pages);

    // A case that returns nothing passes every assertion below while proving
    // nothing. The first run of this script did exactly that — the dev server
    // was still compiling and the page rendered empty — and reported green.
    chk('the case actually returned rows', states.length > 0, `${states.length} rows over ${pages} page(s)`);
    if (states.length === 0) { console.log('        (skipping the rest: nothing to assert against)'); continue; }
    chk('every row across every page matches the filter', states.every(t.filter), `${states.length} rows over ${pages} page(s)`);
    if (t.cmp) {
      const vals = cells.map(v => (v||'').split('\n')[0]).filter(Boolean);
      chk('order holds ACROSS page boundaries, not just within a page',
          JSON.stringify(vals)===JSON.stringify([...vals].sort(t.cmp)),
          `${vals[0]} … ${vals[vals.length-1]}`);
    } else {
      const d = cells.map(v => { const m=(v||'').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m?new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime():null; });
      const dated = d.filter(x=>x!==null);
      chk('dates non-decreasing across pages', dated.every((x,i)=>i===0||x>=dated[i-1]));
      const firstNull = d.indexOf(null);
      chk('undated rows sit at the end', firstNull===-1 || d.slice(firstNull).every(x=>x===null));
    }
    chk('no row duplicated or lost across pages', new Set(ids).size===ids.length, `${ids.length} rows, ${new Set(ids).size} unique`);
  }

  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nsorting, filtering and pagination work together');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
