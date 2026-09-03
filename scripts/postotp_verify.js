/**
 * R2 — post-OTP routing.
 *
 * A worker who is already checked in must land on their dashboard after
 * verification, not in the check-in funnel. Equally important, the paths that
 * must KEEP working: a worker with no open check-in still goes to details, and
 * the site routes stay reachable so a second-site check-in is still possible.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { execSync } = require('child_process');
const { createHmac } = require('crypto');
const S = process.env.SESSION_SECRET;
const CHECKED_IN = ['+447700900101', 'cms5ebw3v001d12v6ojfsorub'];
let fails = 0;
const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };
const lastCode = () => { const o = execSync("grep -o '[0-9]\\{6\\} is your SiteComply' /tmp/dev3000.log | tail -1").toString().trim(); return o ? o.split(' ')[0] : null; };
const fresh = async (prev) => { for (let i=0;i<60;i++){ const c=lastCode(); if(c&&c!==prev) return c; await new Promise(r=>setTimeout(r,250)); } throw new Error('no new OTP in the dev log'); };
/**
 * LOCAL ONLY: clear this test number's OTP challenges so the resend cooldown and
 * hourly cap do not make a repeat run fail for reasons unrelated to the change.
 * Never point this at production.
 */
const resetOtp = (mobile) => {
  const lib = `${process.env.HOME}/.local/pgsql/usr/lib`;
  execSync(`LD_LIBRARY_PATH=${lib}/x86_64-linux-gnu:${lib}/postgresql/16/lib `
    + `${process.env.HOME}/.local/pgsql/usr/lib/postgresql/16/bin/psql `
    + `-h ${process.env.HOME}/.local/pgsql/run -U postgres -d sitecomply `
    + `-tAc "DELETE FROM \\"OtpChallenge\\" WHERE mobile='${mobile}';"`, {stdio:'ignore'});
};

const mint = (mobile, id) => { const n=Math.floor(Date.now()/1000);
  const b=Buffer.from(JSON.stringify({typ:'worker',mobile,workerId:id,iat:n,exp:n+43200})).toString('base64url');
  return b+'.'+createHmac('sha256',S).update(b).digest('base64url'); };

(async () => {
  const br = await chromium.launch();

  resetOtp(CHECKED_IN[0]);
  console.log('== 1. THE DEFECT: full OTP flow for a worker who IS checked in ==');
  {
    const c = await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const p = await c.newPage();
    const posts = [];
    p.on('request', r => { if (r.method()==='POST' && r.url().includes('/api/worker/otp')) posts.push(r.url().split('/api')[1]); });
    await p.goto('http://localhost:3000/check-in',{waitUntil:'domcontentloaded',timeout:120000});
    // The form must be HYDRATED before it is driven — clicking too early submits
    // natively (a GET) and the JS handler never runs, so no code is ever sent.
    await p.waitForSelector('input[type=tel]', {timeout:30000});
    await p.waitForTimeout(2500);
    await p.fill('input[type=tel]', CHECKED_IN[0]);
    const prev = lastCode();
    await p.locator('button:has-text("Send my code")').first().click();
    await p.waitForTimeout(1200);
    chk('the mobile step POSTed (form was hydrated)', posts.some(u=>u.includes('/otp/request')), JSON.stringify(posts));
    const code = await fresh(prev);
    await p.waitForSelector('input[inputmode=numeric], input[autocomplete="one-time-code"]', {timeout:30000});
    await p.waitForTimeout(500);
    await p.fill('input[inputmode=numeric], input[autocomplete="one-time-code"]', code);
    await p.locator('button[type=submit]').first().click();
    await p.waitForURL(u => !u.pathname.endsWith('/check-in'), {timeout:30000}).catch(()=>{});
    await p.waitForTimeout(1500);
    const url = p.url().replace('http://localhost:3000','');
    chk('lands on the dashboard, not the funnel', url.startsWith('/worker/dashboard'), url);
    const co = await p.evaluate(() => { const h=document.querySelector('header'); if(!h) return null;
      const e=Array.from(h.querySelectorAll('a,button')).find(x=>/check out/i.test(x.innerText||'')); return e?e.innerText.trim():null; });
    chk('Check out is immediately available', !!co, co||'not found');
    const site = await p.evaluate(() => { const s=document.querySelector('header select');
      return s ? s.options[s.selectedIndex].text.trim() : (document.querySelector('header')?.innerText.split('\n')[0]||''); });
    console.log(`     active site shown: ${site}`);
    await c.close();
  }

  resetOtp(CHECKED_IN[0]);
  console.log('\n== 2. the API now reports it ==');
  {
    const c = await br.newContext(); const p = await c.newPage();
    await p.goto('http://localhost:3000/check-in',{waitUntil:'domcontentloaded',timeout:120000});
    const prev = lastCode();
    const q = await p.evaluate(async (m) => { const r = await fetch('/api/worker/otp/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mobile:m}),credentials:'include'}); return r.status; }, CHECKED_IN[0]);
    const code = await fresh(prev);
    const v = await p.evaluate(async ([m,cd]) => { const r = await fetch('/api/worker/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mobile:m,code:cd}),credentials:'include'}); return {s:r.status, b:await r.text()}; }, [CHECKED_IN[0], code]);
    chk('verify still returns 200', v.s===200, `HTTP ${v.s}`);
    let j={}; try{ j=JSON.parse(v.b); }catch{}
    chk('response carries checkedIn:true', j.checkedIn===true, v.b.slice(0,120));
    chk('workerKnown is unchanged', j.workerKnown===true, String(j.workerKnown));
    await c.close();
  }

  console.log('\n== 3. SAFETY NET: direct navigation to /check-in/details while checked in ==');
  {
    const c = await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await c.addCookies([{name:'sc_worker',value:mint(...CHECKED_IN),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
    const p = await c.newPage();
    await p.goto('http://localhost:3000/check-in/details',{waitUntil:'domcontentloaded',timeout:120000});
    await p.waitForTimeout(900);
    chk('/check-in/details redirects to the dashboard', p.url().includes('/worker/dashboard'), p.url().replace('http://localhost:3000',''));
    await c.close();
  }

  console.log('\n== 4. MUST STILL WORK: the site routes stay reachable ==');
  {
    const c = await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await c.addCookies([{name:'sc_worker',value:mint(...CHECKED_IN),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
    const p = await c.newPage();
    await p.goto('http://localhost:3000/check-in/site',{waitUntil:'domcontentloaded',timeout:120000});
    await p.waitForTimeout(900);
    const url = p.url().replace('http://localhost:3000','');
    const heading = await p.evaluate(()=>document.querySelector('h1')?.innerText.trim()||'');
    chk('/check-in/site is NOT redirected (second-site check-in preserved)', url==='/check-in/site', `${url} "${heading}"`);
    await c.close();
  }

  console.log('\n== 5. MUST STILL WORK: a worker with NO open check-in still goes to details ==');
  {
    const c = await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    // a real worker record with no open check-in
    await c.addCookies([{name:'sc_worker',value:mint('+447700900150','cmt83zcmc00014tnv37p8ddso'),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
    const p = await c.newPage();
    await p.goto('http://localhost:3000/check-in/details',{waitUntil:'domcontentloaded',timeout:120000});
    await p.waitForTimeout(900);
    const url = p.url().replace('http://localhost:3000','');
    chk('/check-in/details still renders for a worker not on site', url==='/check-in/details', url);
    await c.close();
  }

  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
