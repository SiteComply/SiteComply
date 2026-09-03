/**
 * Admin Check-ins pagination.
 *
 * The claims that matter: every record is reachable (the old 1,000 ceiling is
 * gone), paging is STABLE when timestamps collide, and filters survive paging.
 *
 * Stability is checked by walking every page and looking for a row id that
 * appears twice or never — which is exactly what a non-unique sort produces,
 * and what no single-page screenshot would reveal.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs'), path = require('path');
const S = process.env.SESSION_SECRET;
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.argv[2];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

const adminCookie = () => {
  const n = Math.floor(Date.now()/1000);
  const b = Buffer.from(JSON.stringify({typ:'admin', adminId:process.env.ADMIN_ID,
    email:process.env.ADMIN_EMAIL, name:'Verify', role:process.env.ADMIN_ROLE,
    iat:n, exp:n+28800})).toString('base64url');
  return b + '.' + createHmac('sha256', S).update(b).digest('base64url');
};

const readPage = (p) => p.evaluate(() => {
  const ids = Array.from(document.querySelectorAll('a[href^="/admin/submissions/"]'))
    .map(a => a.getAttribute('href').split('/').pop())
    .filter(h => h && h !== 'export');
  const body = document.body.innerText.replace(/\s+/g, ' ');
  const showing = (body.match(/Showing\s+([\d,]+)–([\d,]+)\s+of\s+([\d,]+)/) || []).slice(1);
  const found = (body.match(/([\d,]+)\s+records? found/) || [])[1];
  const nav = Array.from(document.querySelectorAll('a'))
    .filter(a => /^(Previous|Next)$/.test(a.innerText.trim()))
    .map(a => ({label:a.innerText.trim(), href:a.getAttribute('href')}));
  return {ids, showing, found, nav, truncationMsg: /Showing the first/.test(body)};
});

(async () => {
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:2});
  await c.addCookies([{name:'sc_admin', value:adminCookie(), domain:'localhost', path:'/',
    httpOnly:true, secure:false, sameSite:'Lax'}]);
  const p = await c.newPage();

  console.log('== page 1 ==');
  await p.goto(`${BASE}/admin/submissions`, {waitUntil:'domcontentloaded', timeout:120000});
  await p.waitForTimeout(900);
  if (!/\/admin\/submissions/.test(p.url())) { console.log(`  ABORT  not on the page: ${p.url()}`); await br.close(); process.exit(1); }
  const p1 = await readPage(p);
  if (!p1.ids.length) { console.log('  ABORT  no rows rendered; later checks would be vacuous.'); await br.close(); process.exit(1); }
  const total = Number((p1.found||'0').replace(/,/g,''));
  console.log(`  ${p1.found} records found · showing ${p1.showing.join('–')} · ${p1.ids.length} rows on screen`);
  chk('page size is 20', p1.ids.length === 20, `${p1.ids.length} rows`);
  chk('the "Showing X–Y of N" range is rendered', p1.showing.length === 3, p1.showing.join('/'));
  chk('range starts at 1 and the total matches the record count',
      p1.showing[0] === '1' && p1.showing[2].replace(/,/g,'') === String(total));
  chk('the old "Showing the first 1,000" caveat is gone', !p1.truncationMsg);
  chk('dataset is larger than the old cap, so this is a real test',
      total > 1000, `${total} records`);
  await p.screenshot({path: path.join(OUT,'admin-page1.png'), clip:{x:0,y:0,width:1440,height:1000}});

  console.log('\n== walking every page ==');
  const seen = new Map();
  let pageNo = 1, pages = 0, dupes = 0;
  const expectedPages = Math.ceil(total / 20);
  while (pageNo <= expectedPages) {
    await p.goto(`${BASE}/admin/submissions?page=${pageNo}`, {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(120);
    const r = await readPage(p);
    for (const id of r.ids) { if (seen.has(id)) dupes++; seen.set(id, (seen.get(id)||0)+1); }
    pages++;
    if (pageNo === expectedPages) {
      chk('the last page is reachable and non-empty', r.ids.length > 0, `page ${pageNo}: ${r.ids.length} rows`);
      await p.screenshot({path: path.join(OUT,'admin-lastpage.png'), clip:{x:0,y:0,width:1440,height:1000}});
    }
    pageNo++;
  }
  console.log(`  walked ${pages} pages, collected ${seen.size} distinct ids`);
  chk('no record appears on two pages (stable ordering)', dupes === 0, `${dupes} duplicate(s)`);
  chk('every record is reachable — distinct ids equals the total',
      seen.size === total, `${seen.size} of ${total}`);
  chk('records beyond the old 1,000 ceiling are reachable',
      seen.size > 1000, `${seen.size - 1000} past the old cap`);

  console.log('\n== ordering is total where timestamps collide ==');
  const collide = await p.evaluate(async (base) => {
    // the 40 seeded rows share one timestamp; read them across two runs
    const grab = async () => {
      const out = [];
      for (let i = 1; i <= 3; i++) {
        const r = await fetch(`${base}/admin/submissions?page=${i}&from=2026-07-01&to=2026-07-01`);
        const t = await r.text();
        out.push(...(t.match(/\/admin\/submissions\/[a-z0-9]+/g) || []));
      }
      return out;
    };
    const a = await grab(); const b = await grab();
    return {same: JSON.stringify(a) === JSON.stringify(b), n: a.length};
  }, BASE);
  chk('two identical requests return the same order for colliding timestamps',
      collide.same, `${collide.n} rows compared`);

  console.log('\n== filters survive paging ==');
  await p.goto(`${BASE}/admin/submissions?status=COMPLIANT&page=2`, {waitUntil:'domcontentloaded', timeout:120000});
  await p.waitForTimeout(700);
  const f = await readPage(p);
  chk('a filtered page 2 renders', f.ids.length > 0, `${f.ids.length} rows`);
  chk('Previous/Next keep the filter in the URL',
      f.nav.length > 0 && f.nav.every(n => n.href.includes('status=COMPLIANT')),
      f.nav.map(n => `${n.label}:${n.href}`).join(' | ') || 'no nav links');
  chk('the filtered total is lower than the unfiltered total',
      Number((f.found||'0').replace(/,/g,'')) < total,
      `${f.found} filtered vs ${p1.found} total`);
  await p.screenshot({path: path.join(OUT,'admin-filtered.png'), clip:{x:0,y:0,width:1440,height:1000}});

  console.log('\n== out-of-range page is clamped, not empty ==');
  await p.goto(`${BASE}/admin/submissions?page=99999`, {waitUntil:'domcontentloaded', timeout:120000});
  await p.waitForTimeout(700);
  const oob = await readPage(p);
  chk('a far out-of-range ?page= still renders rows', oob.ids.length > 0, `${oob.ids.length} rows`);

  fs.writeFileSync(path.join(OUT,'pagination.json'), JSON.stringify({total, pages, distinct:seen.size, dupes}, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
