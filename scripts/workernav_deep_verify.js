/**
 * S3: the strip on a page whose destination sits at the far end of it.
 * Confirms the current section is scrolled into view on load rather than left
 * behind the fold, and that the indicators flip to match.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const S = process.env.SESSION_SECRET, OUT = process.argv[2];
const n = Math.floor(Date.now()/1000);
const b = Buffer.from(JSON.stringify({typ:'worker',mobile:'+447700900101',workerId:'cms5ebw3v001d12v6ojfsorub',iat:n,exp:n+28800})).toString('base64url');
const cookie = b + '.' + createHmac('sha256', S).update(b).digest('base64url');
let fails = 0; const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok)fails++;};
(async()=>{
  const br = await chromium.launch();
  const c = await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await c.addCookies([{name:'sc_worker',value:cookie,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();
  console.log('\n== deep page: the last destination in the strip ==');
  await p.goto('http://localhost:3000/worker/site-information',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForSelector('nav[aria-label="Worker dashboard sections"] a',{timeout:120000});
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Worker dashboard sections"]');
    const cur = nav.querySelector('[aria-current="page"]');
    const nb = nav.getBoundingClientRect(), cb = cur.getBoundingClientRect();
    const fades = Array.from(nav.parentElement.querySelectorAll(':scope > div[aria-hidden="true"]'));
    let card = nav; while (card && !/shadow-card/.test(card.className||'')) card = card.parentElement;
    card.setAttribute('data-navcard','1');
    return {
      label: cur.getAttribute('aria-label'),
      inView: cb.left >= nb.left - 0.5 && cb.right <= nb.right + 0.5,
      scrollLeft: Math.round(nav.scrollLeft),
      leftIndicator: Number(getComputedStyle(fades[0]).opacity) > 0.9,
      rightIndicator: Number(getComputedStyle(fades[1]).opacity) > 0.9,
    };
  });
  chk('the current section is the last item', r.label === 'Site information', r.label);
  chk('the strip auto-scrolls it into view on load', r.inView, `scrollLeft=${r.scrollLeft}px`);
  chk('the left indicator appears, showing items behind', r.leftIndicator);
  chk('the right indicator is gone at the end of the strip', !r.rightIndicator);
  await p.locator('[data-navcard]').screenshot({path:`${OUT}/after-deep-390.png`});
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails?1:0);
})();
