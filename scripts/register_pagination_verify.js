/**
 * Pagination stability across the four registers.
 *  1. Visit each register (which makes the app run its real list query).
 *  2. Page through Actions — the one with heavy createdAt ties — and assert
 *     every row appears exactly once, twice over.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const USER = process.argv[2], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'platform',userId:USER,iat:n,exp:n+28800})).toString('base64url');
const tok = b+'.'+createHmac('sha256',SECRET).update(b).digest('base64url');
const ROOT = 'http://localhost:3000/platform/dashboard';
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1500,height:1000}});
  await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();

  console.log('\n=== each register renders (and runs its list query) ===');
  for (const [label, path] of [['Actions','/actions'],['Audits','/audits'],['Documents','/documents'],['Permits','/permits']]) {
    const res = await p.goto(`${ROOT}${path}`, {waitUntil:'networkidle', timeout:120000});
    const rows = await p.locator('tbody tr').count();
    chk(`${label} renders`, res.status() === 200, `HTTP ${res.status()}, ${rows} rows`);
  }

  console.log('\n=== Actions: 65 rows, 45 of them sharing 3 timestamps ===');
  const sweep = async () => {
    const ids = [];
    for (let page = 1; page <= 4; page++) {
      await p.goto(`${ROOT}/actions?page=${page}`, {waitUntil:'networkidle'});
      const got = await p.$$eval('tbody tr td:first-child a', as => as.map(a => a.getAttribute('href')));
      ids.push(...got);
    }
    return ids;
  };
  const first = await sweep();
  const unique = new Set(first);
  chk('no row appears on two pages', unique.size === first.length, `${first.length} rows, ${unique.size} unique`);
  chk('every action reachable by paging', unique.size === 65, `${unique.size} of 65`);
  const second = await sweep();
  chk('two sweeps return the identical order', JSON.stringify(first) === JSON.stringify(second));

  await br.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall pagination-stability checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
