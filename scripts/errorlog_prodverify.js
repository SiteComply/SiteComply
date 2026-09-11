/**
 * Error logging — production verification.
 *
 * Reads back through the Error log page, because the production database is not
 * reachable from this VM: the firewall allows Azure sources only, and the
 * temporary rule has been removed. The page IS the interface an investigator
 * would use, so verifying through it is closer to the real thing than a query.
 *
 * The failures triggered here are REAL — code that actually throws in a timer,
 * a promise that actually rejects. They are labelled so they can be told apart
 * from genuine faults, and they expire with the 90-day retention.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = 'https://sitecomply-web.azurewebsites.net';
const TAG = 'PRODUCTION VERIFICATION (safe to ignore)';
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 1000 } });
  const post = (ep, bd) => pg.evaluate(async ([b,e,d]) => {
    const r = await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});
    return r.status; }, [BASE, ep, bd]);
  await pg.goto(BASE+'/platform',{waitUntil:'domcontentloaded',timeout:120000});
  await post('/api/platform/auth/start',{method:'email',value:'jc@parryst.com'});
  const v = await post('/api/platform/auth/verify',{method:'email',value:'jc@parryst.com',code:'231001'});
  if (v!==200){console.log('  ABORT sign-in '+v);await br.close();process.exit(1);}

  const ERRORS = `${BASE}/platform/dashboard/settings/errors`;

  console.log('  --- 1. the migration is live and the page knows it ---');
  await pg.goto(ERRORS,{waitUntil:'networkidle',timeout:120000});
  let t = await pg.evaluate(()=>document.body.innerText);
  chk('the Error log page renders', /Error log/.test(t));
  chk('logging is switched ON (table found)', !/not yet switched on/i.test(t),
      /not yet switched on/i.test(t) ? 'the table is still missing' : '');
  chk('retention is stated', /90 days/.test(t));
  chk('it is reachable from Settings', /Authentication & access/.test(t));

  console.log('\n  --- 2. a real uncaught browser error ---');
  await pg.goto(BASE+'/platform/dashboard',{waitUntil:'networkidle',timeout:120000});
  await pg.evaluate((tag) => { setTimeout(() => { throw new Error(tag + ' timer'); }, 0); }, TAG);
  await pg.waitForTimeout(2500);
  await pg.goto(`${ERRORS}?q=${encodeURIComponent('PRODUCTION VERIFICATION')}`,{waitUntil:'networkidle',timeout:120000});
  t = await pg.evaluate(()=>document.body.innerText);
  chk('it was recorded', /PRODUCTION VERIFICATION/.test(t));
  chk('classified as an uncaught browser error', /Uncaught browser error/.test(t));
  chk('the page is recorded', /\/platform\/dashboard/.test(t));
  chk('WHO hit it', /JC/.test(t), 'the signed-in user, from the session');

  console.log('\n  --- 3. a real unhandled promise rejection ---');
  await pg.goto(BASE+'/platform/dashboard/submissions',{waitUntil:'networkidle',timeout:120000});
  await pg.evaluate((tag) => { Promise.reject(new Error(tag + ' rejection')); }, TAG);
  await pg.waitForTimeout(2500);
  await pg.goto(`${ERRORS}?q=${encodeURIComponent('PRODUCTION VERIFICATION')}`,{waitUntil:'networkidle',timeout:120000});
  t = await pg.evaluate(()=>document.body.innerText);
  chk('it was recorded', /Unhandled promise rejection/.test(t));
  chk('on the page it happened on', /\/platform\/dashboard\/submissions/.test(t));

  console.log('\n  --- 4. query strings and personal data are not stored ---');
  await pg.goto(BASE+'/platform/dashboard',{waitUntil:'networkidle',timeout:120000});
  await pg.evaluate((tag) => {
    history.replaceState({}, '', '/platform/dashboard?operative=Bob%20Smith&token=supersecret123');
    setTimeout(() => { throw new Error(tag + ' leak check bob@example.com +447700900123'); }, 0);
  }, TAG);
  await pg.waitForTimeout(2500);
  await pg.goto(`${ERRORS}?q=${encodeURIComponent('leak check')}`,{waitUntil:'networkidle',timeout:120000});
  t = await pg.evaluate(()=>document.body.innerText);
  chk('recorded', /leak check/.test(t));
  chk('the email was redacted', !/bob@example\.com/.test(t) && /\[email\]/.test(t));
  chk('the phone was redacted', !/447700900123/.test(t) && /\[phone\]/.test(t));
  chk('no query string stored', !/operative=Bob/.test(t) && !/supersecret123/.test(t));

  console.log('\n  --- 5. an investigator can find a fault from the log alone ---');
  await pg.goto(`${ERRORS}?q=${encodeURIComponent('PRODUCTION VERIFICATION')}`,{waitUntil:'networkidle',timeout:120000});
  const detail = await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x)=>/^SC-E-/.test(x.innerText||''));
    if (b) b.click();
    return new Promise((r)=>setTimeout(()=>r(document.body.innerText),400));
  });
  chk('a reference was issued', /SC-E-\d{5}/.test(detail), (detail.match(/SC-E-\d{5}/)||[''])[0]);
  chk('the build is recorded', /Build:/.test(detail));
  chk('the device is recorded', /Device:/.test(detail) && /Chrome/.test(detail));
  chk('a stack is available', /at /.test(detail));
  await pg.screenshot({ path: '/tmp/errshots/prod-01-error-log.png', fullPage: true });

  console.log('\n  --- 6. filters work ---');
  await pg.goto(`${ERRORS}?portal=WORKER`,{waitUntil:'networkidle',timeout:120000});
  t = await pg.evaluate(()=>document.body.innerText);
  chk('filtering to a portal with no faults says so', /Nothing logged in this period|Operative/.test(t));

  console.log(`\n  ${fails===0?'ALL PASS':fails+' FAILED'}`);
  await br.close(); process.exit(fails?1:0);
})();
