/**
 * Admin Check-ins pagination — production verification.
 *
 * The Admin Centre signs in through Azure AD and its dev fallback is disabled in
 * production, so the rendered Admin page cannot be driven from here. What IS
 * verifiable in production, and is also the riskiest part of this change, is the
 * shared PaginationControls move: five live Platform lists import it, and those
 * do have a sanctioned sign-in. Each is paged end to end.
 *
 * The Admin page itself is verified from the code production is serving, read
 * off its own disk — see the companion shell checks.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const EMAIL = process.env.PLATFORM_EMAIL || 'jc@parryst.com';
const CODE = process.env.PLATFORM_CODE || '231001';
const OUT = process.argv[2];
const LISTS = ['submissions', 'audits', 'documents', 'actions', 'permits'];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  console.log(`== ADMIN PAGINATION — PRODUCTION VERIFICATION ==\n   ${BASE}\n`);
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:2});
  const p = await c.newPage();

  console.log('-- the Admin route is alive and still gated --');
  const r = await p.goto(`${BASE}/admin/submissions`, {waitUntil:'domcontentloaded', timeout:120000});
  const status = r ? r.status() : 0;
  const landed = p.url().replace(BASE, '');
  chk('/admin/submissions does not error', status < 500, `HTTP ${status}`);
  chk('it is still behind the admin login', /\/admin\/login/.test(landed) || status === 401 || status === 403,
      `landed on ${landed}`);

  console.log('\n-- sign in to Platform (the five lists that share the moved control) --');
  await p.goto(`${BASE}/platform`, {waitUntil:'domcontentloaded', timeout:120000});
  const call = (ep, body) => p.evaluate(async ([b,e,bd]) => {
    const res = await fetch(b+e, {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(bd), credentials:'include'});
    return {s:res.status, b:(await res.text()).slice(0,160)};
  }, [BASE, ep, body]);
  await call('/api/platform/auth/start', {method:'email', value:EMAIL});
  const v = await call('/api/platform/auth/verify', {method:'email', value:EMAIL, code:CODE});
  if (v.s !== 200) { console.log(`  ABORT  platform sign-in failed: ${v.s} ${v.b}`); await br.close(); process.exit(1); }
  chk('signed in', true);

  console.log('\n-- every list that imports the moved control still pages --');
  const seen = {};
  for (const list of LISTS) {
    await p.goto(`${BASE}/platform/dashboard/${list}`, {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(1100);
    const info = await p.evaluate(() => {
      const body = document.body.innerText.replace(/\s+/g, ' ');
      const showing = (body.match(/Showing\s+([\d,]+)–([\d,]+)\s+of\s+([\d,]+)/) || []).slice(1);
      const noResults = /No results/.test(body);
      const nav = Array.from(document.querySelectorAll('a'))
        .filter(a => /^(Previous|Next)$/.test(a.innerText.trim()))
        .map(a => a.innerText.trim());
      return {showing, noResults, nav};
    });
    seen[list] = info;
    const bar = info.showing.length === 3 || info.noResults;
    chk(`/platform/dashboard/${list} renders the pagination bar`, bar,
        info.showing.length ? `Showing ${info.showing[0]}–${info.showing[1]} of ${info.showing[2]}` : (info.noResults ? 'No results' : 'NO BAR'));
  }
  await p.screenshot({path: path.join(OUT,'prod-platform-list.png'), clip:{x:0,y:0,width:1440,height:1000}});

  console.log('\n-- paging actually advances where there is more than one page --');
  let exercised = 0;
  for (const list of LISTS) {
    const info = seen[list];
    if (info.showing.length !== 3) continue;
    const total = Number(info.showing[2].replace(/,/g,''));
    if (total <= 20) continue;
    await p.goto(`${BASE}/platform/dashboard/${list}?page=2`, {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(1000);
    const two = await p.evaluate(() => {
      const body = document.body.innerText.replace(/\s+/g, ' ');
      return (body.match(/Showing\s+([\d,]+)–([\d,]+)\s+of\s+([\d,]+)/) || []).slice(1);
    });
    chk(`${list}: page 2 starts at 21`, two[0] === '21', two.length ? `Showing ${two[0]}–${two[1]} of ${two[2]}` : 'no range');
    exercised++;
  }
  if (!exercised) console.log('  NOTE  no production list currently holds more than 20 rows, so page 2 could not be exercised.');

  fs.writeFileSync(path.join(OUT,'prod.json'), JSON.stringify(seen, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
