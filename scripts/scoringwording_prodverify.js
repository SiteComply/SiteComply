/**
 * Audit Scoring wording — production verification.
 *
 * Signs in as a Director on the live site and reads the rendered screen. The
 * rename exists to remove a duplicate name, so ABSENCE is asserted as hard as
 * presence: neither view may carry the other's title, and the old label must
 * appear nowhere.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const EMAIL = process.env.PLATFORM_EMAIL || 'jc@parryst.com';
const CODE = process.env.PLATFORM_CODE || '231001';
const OUT = process.argv[2];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  console.log(`== AUDIT SCORING WORDING — PRODUCTION VERIFICATION ==\n   ${BASE}\n`);
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:2});
  const p = await c.newPage();

  console.log('-- sign-in --');
  await p.goto(`${BASE}/platform`, {waitUntil:'domcontentloaded', timeout:120000});
  const call = (ep, body) => p.evaluate(async ([b,e,bd]) => {
    const r = await fetch(b+e, {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(bd), credentials:'include'});
    return {s:r.status, b:(await r.text()).slice(0,180)};
  }, [BASE, ep, body]);
  await call('/api/platform/auth/start', {method:'email', value:EMAIL});
  const v = await call('/api/platform/auth/verify', {method:'email', value:EMAIL, code:CODE});
  if (v.s !== 200) { console.log(`  ABORT  platform sign-in failed: ${v.s} ${v.b}`); await br.close(); process.exit(1); }
  chk('signed in as a Director', true);

  console.log('\n-- find an audit with questions --');
  await p.goto(`${BASE}/platform/dashboard/audits`, {waitUntil:'domcontentloaded', timeout:120000});
  await p.waitForTimeout(1800);
  const audits = await p.evaluate(() => Array.from(document.querySelectorAll('a[href*="/platform/dashboard/audits/"]'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && /\/audits\/[a-z0-9]{20,}$/.test(h)));
  const uniq = [...new Set(audits)];
  if (!uniq.length) { console.log('  ABORT  no audits listed; nothing to verify against.'); await br.close(); process.exit(1); }
  console.log(`  ${uniq.length} audit(s) available`);

  let scored = null;
  for (const href of uniq.slice(0, 6)) {
    await p.goto(`${BASE}${href}/scoring`, {waitUntil:'domcontentloaded', timeout:120000});
    await p.waitForTimeout(1600);
    if (!/scoring/.test(p.url())) continue;
    const t = await p.evaluate(() => document.body.innerText);
    if (t.includes('Set question rules')) { scored = {href, text:t}; break; }
  }
  if (!scored) { console.log('  ABORT  could not open a scoring screen; the checks below would be vacuous.'); await br.close(); process.exit(1); }
  console.log(`  using ${scored.href}/scoring`);

  console.log('\n-- scoring workspace --');
  const t1 = scored.text;
  chk('legend card reads "How questions are scored"', t1.includes('How questions are scored'));
  chk('hand-off reads "Set question rules"', t1.includes('Set question rules'));
  chk('footer hint names the audit template as the source',
      t1.includes('Questions come from the audit template. Set how each one scores.'));
  chk('the stale "audit content" hint is gone', !t1.includes('configuring the audit content'));
  chk('"Configure Questions" appears nowhere', !t1.includes('Configure Questions'));
  chk('no duplicate name: "Question Scoring Rules" absent from this view',
      !t1.includes('Question Scoring Rules'));
  await p.screenshot({path: path.join(OUT,'prod-scoring.png'), clip:{x:0,y:0,width:1440,height:900}});

  console.log('\n-- editor workspace --');
  await p.locator('button:has-text("Set question rules")').first().click();
  await p.waitForTimeout(1500);
  const t2 = await p.evaluate(() => document.body.innerText);
  const title = (t2.match(/Question Scoring Rules \(\d+\)/) || [null])[0];
  chk('editor panel reads "Question Scoring Rules (N)"', !!title, title || 'not found');
  chk('no duplicate name: "How questions are scored" absent from this view',
      !t2.includes('How questions are scored'));
  chk('"Configure Questions" appears nowhere here either', !t2.includes('Configure Questions'));
  chk('"Back to scoring" still returns to the scoring workspace', t2.includes('Back to scoring'));
  await p.screenshot({path: path.join(OUT,'prod-editor.png'), clip:{x:0,y:0,width:1440,height:700}});

  fs.writeFileSync(path.join(OUT,'wording.json'), JSON.stringify({audit:scored.href, editorTitle:title}, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
