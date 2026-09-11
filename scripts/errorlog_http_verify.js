/**
 * Error logging, end to end.
 *
 * The point of the whole feature is that a crash becomes a record WITHOUT the
 * person writing anything down. So these assertions are about what lands in the
 * table after a genuine failure — not about the capture functions, which
 * scripts/errorlog_verify.ts covers.
 *
 * The browser failures below are real: code that actually throws in a timer and
 * a promise that actually rejects. Dispatching a synthetic ErrorEvent would
 * prove only that the listener is attached.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { execFileSync } = require('node:child_process');
const BASE = process.env.BASE || 'http://localhost:3111';
const EMAIL = process.env.EMAIL || 'ux.director@sitecomply.local';
const CODE = process.env.CODE || '231001';
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };

function query(sql) {
  const out = execFileSync('npx', ['tsx', '-e', `
    import { prisma } from './lib/prisma';
    (async()=>{ const r = await prisma.$queryRawUnsafe(${JSON.stringify(sql)});
      console.log('<<<'+JSON.stringify(r, (k,v)=>typeof v==='bigint'?Number(v):v)+'>>>');
      await prisma.$disconnect(); })();`], { encoding: 'utf8', cwd: process.cwd() });
  const m = out.match(/<<<([\s\S]*)>>>/);
  return m ? JSON.parse(m[1]) : [];
}
const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const recent = (where) =>
  query(`select "reference","kind","portal","message","stack","pagePath","route","method","userName","userRole","browser","os","deviceType","viewportWidth","buildId","digest","occurrences" from "ErrorEvent" where "lastSeenAt" > '${since}' and ${where} order by "lastSeenAt" desc limit 1`);

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
  const post = (ep, bd) => pg.evaluate(async ([b,e,d]) => {
    const r = await fetch(b+e,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),credentials:'include'});
    return r.status; }, [BASE, ep, bd]);
  await pg.goto(BASE+'/platform',{waitUntil:'domcontentloaded',timeout:120000});
  await post('/api/platform/auth/start',{method:'email',value:EMAIL});
  const v = await post('/api/platform/auth/verify',{method:'email',value:EMAIL,code:CODE});
  if (v!==200){console.log('  ABORT sign-in '+v);await br.close();process.exit(1);}

  console.log('  --- 1. a real API route failure ---');
  const st = await post('/api/platform/zzverifythrow', {});
  chk('the route still fails the way it did before', st === 500, `got ${st}`);
  await pg.waitForTimeout(1200);
  let r = recent(`"message" like 'verify: cannot read properties%'`)[0];
  chk('it was recorded', Boolean(r));
  if (r) {
    chk('kind is an API failure', r.kind === 'SERVER_ROUTE', r.kind);
    chk('the route is recorded', r.route === '/api/platform/zzverifythrow', String(r.route));
    chk('the method is recorded', r.method === 'POST', String(r.method));
    chk('the portal is recorded', r.portal === 'PLATFORM', r.portal);
    chk('WHO it happened to', Boolean(r.userName) && Boolean(r.userRole), `${r.userName} / ${r.userRole}`);
    chk('which deploy', Boolean(r.buildId), String(r.buildId));
    chk('the stack is kept', /at /.test(r.stack || ''), (r.stack||'').split('\n')[1]);
    chk('the reference is quotable', /^SC-E-\d{5}$/.test(r.reference), r.reference);
  }

  console.log('\n  --- 2. a real page crash (server render) ---');
  await pg.goto(BASE+'/platform/zzverifycrash',{waitUntil:'networkidle',timeout:120000});
  const crashText = await pg.evaluate(()=>document.body.innerText);
  chk('the user sees the branded screen', /unexpected problem/i.test(crashText));
  const refShown = (crashText.match(/Reference code:\s*(\S+)/) || [])[1] || null;
  chk('a reference code is shown to the user', Boolean(refShown), String(refShown));
  await pg.waitForTimeout(1500);
  r = recent(`"kind" = 'SERVER_RENDER'`)[0];
  chk('the crash was recorded', Boolean(r));
  if (r) {
    chk('the page is recorded', r.pagePath === '/platform/zzverifycrash', String(r.pagePath));
    chk('WHO saw it', Boolean(r.userName), String(r.userName));
    chk('the browser is recorded', Boolean(r.browser), String(r.browser));
    chk('the device is recorded', Boolean(r.deviceType), String(r.deviceType));
    chk('the viewport is recorded', r.viewportWidth === 1280, String(r.viewportWidth));
    chk("the user's reference code matches the record", r.digest === refShown,
        `shown ${refShown} / stored ${r.digest}`);
  }

  console.log('\n  --- 3. a real uncaught browser error ---');
  await pg.goto(BASE+'/platform/dashboard',{waitUntil:'networkidle',timeout:120000});
  await pg.evaluate(() => { setTimeout(() => { throw new Error('verify: timer blew up'); }, 0); });
  await pg.waitForTimeout(1500);
  r = recent(`"message" like 'verify: timer blew up%'`)[0];
  chk('an error thrown in a timer was recorded', Boolean(r));
  if (r) {
    chk('kind is uncaught', r.kind === 'CLIENT_UNCAUGHT', r.kind);
    chk('the page is recorded', r.pagePath === '/platform/dashboard', String(r.pagePath));
    chk('WHO hit it', Boolean(r.userName), String(r.userName));
  }

  console.log('\n  --- 4. a real unhandled promise rejection ---');
  await pg.evaluate(() => { Promise.reject(new Error('verify: promise rejected')); });
  await pg.waitForTimeout(1500);
  r = recent(`"message" like 'verify: promise rejected%'`)[0];
  chk('an unhandled rejection was recorded', Boolean(r));
  if (r) chk('kind is a rejection', r.kind === 'CLIENT_REJECTION', r.kind);

  console.log('\n  --- 5. query strings and secrets never stored ---');
  await pg.evaluate(() => {
    history.replaceState({}, '', '/platform/dashboard?worker=Bob%20Smith&token=supersecret123');
    setTimeout(() => { throw new Error('verify: leak check for bob@example.com and +447700900123'); }, 0);
  });
  await pg.waitForTimeout(1500);
  r = recent(`"message" like 'verify: leak check%'`)[0];
  chk('recorded', Boolean(r));
  if (r) {
    chk('no query string stored', !String(r.pagePath).includes('?'), String(r.pagePath));
    chk('no operative name stored', !JSON.stringify(r).includes('Bob'), '');
    chk('no email stored', !JSON.stringify(r).includes('bob@example.com'));
    chk('no phone stored', !JSON.stringify(r).includes('447700900123'));
  }

  console.log('\n  --- 6. the review page shows them ---');
  await pg.goto(BASE+'/platform/dashboard/settings/errors',{waitUntil:'networkidle',timeout:120000});
  const t = await pg.evaluate(()=>document.body.innerText);
  chk('the error log page renders', /Error log/.test(t));
  chk('it lists the API failure', /API failure/.test(t));
  chk('it lists the page crash', /Page failed on the server|Page crashed/.test(t));
  chk('it shows who and where', /Director|Ux Director/i.test(t));
  chk('retention is stated', /90 days/.test(t));
  await pg.screenshot({ path: '/tmp/errshots/01-error-log.png', fullPage: true });

  console.log('\n  --- 7. searching by the code the user quotes ---');
  if (refShown) {
    await pg.goto(`${BASE}/platform/dashboard/settings/errors?q=${encodeURIComponent(refShown)}`,{waitUntil:'networkidle',timeout:120000});
    const s = await pg.evaluate(()=>document.body.innerText);
    chk('the exact failure is found from the reference code alone', /zzverifycrash/.test(s),
        'this is the whole point of the feature');
    await pg.screenshot({ path: '/tmp/errshots/02-search-by-code.png', fullPage: true });
  }

  console.log(`\n  ${fails===0?'ALL PASS':fails+' FAILED'}`);
  await br.close(); process.exit(fails?1:0);
})();
