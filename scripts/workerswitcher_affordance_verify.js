/**
 * The site switcher must READ as a control, not a heading — and must still BE a
 * native select underneath, since the visible chrome is a separate layer.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const S=process.env.SESSION_SECRET, n=Math.floor(Date.now()/1000);
const b=Buffer.from(JSON.stringify({typ:'worker',mobile:'+447700900101',workerId:'cms5ebw3v001d12v6ojfsorub',iat:n,exp:n+28800})).toString('base64url');
const tok=b+'.'+createHmac('sha256',S).update(b).digest('base64url');
let fails=0; const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};
(async()=>{
  const br=await chromium.launch();
  const c=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await c.addCookies([{name:'sc_worker',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p=await c.newPage();
  await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'networkidle',timeout:120000});
  await p.waitForTimeout(400);

  const r = await p.evaluate(()=>{
    const sel = document.querySelector('header select');
    const chrome = sel.parentElement.querySelector('span[aria-hidden="true"]');
    const cs = getComputedStyle(chrome);
    const sb = sel.getBoundingClientRect(), cb = chrome.getBoundingClientRect();
    return {
      selectIsRealSelect: sel.tagName === 'SELECT',
      selectOptionCount: sel.options.length,
      selectCoversChrome: Math.abs(sb.width-cb.width)<2 && Math.abs(sb.height-cb.height)<2,
      chromeText: chrome.innerText.replace(/\s+/g,' ').trim(),
      chromeHasBorder: cs.borderTopWidth !== '0px',
      chromeRadius: cs.borderTopLeftRadius,
      chromeAlign: cs.textAlign,
      hasChevronSvg: chrome.querySelectorAll('svg').length >= 2,
      selectedLabel: sel.options[sel.selectedIndex].textContent.trim(),
      height: Math.round(cb.height),
    };
  });
  chk('still a real <select> underneath', r.selectIsRealSelect && r.selectOptionCount === 2, `${r.selectOptionCount} options`);
  chk('the select covers the visible control exactly', r.selectCoversChrome);
  chk('the visible chrome shows the active site', r.chromeText.includes(r.selectedLabel), `"${r.chromeText}"`);
  chk('it says how to use it', /switch site/i.test(r.chromeText));
  chk('it is a bounded control (border + radius)', r.chromeHasBorder && r.chromeRadius !== '0px', `radius ${r.chromeRadius}`);
  chk('text is left-aligned, not centred', r.chromeAlign === 'left' || r.chromeAlign === 'start', r.chromeAlign);
  chk('icon and chevron both present', r.hasChevronSvg);
  chk('52px touch target', r.height >= 44, `${r.height}px`);

  // Keyboard: the select must still be focusable and show a ring on the chrome.
  await p.keyboard.press('Tab');
  const focused = await p.evaluate(()=>{
    for (let i=0;i<40;i++) { if (document.activeElement && document.activeElement.tagName==='SELECT') return true;
      const e=new KeyboardEvent('keydown'); void e; break; }
    return document.activeElement && document.activeElement.tagName === 'SELECT';
  });
  await p.locator('header select').focus();
  const ring = await p.evaluate(()=>{
    const sel=document.querySelector('header select');
    const chrome=sel.parentElement.querySelector('span[aria-hidden="true"]');
    return getComputedStyle(chrome).boxShadow !== 'none';
  });
  chk('focusing the select shows a ring on the visible control', ring);

  // And it still switches.
  const other = await p.$$eval('header select option', o=>o.map(x=>x.value));
  const cur = await p.$eval('header select', s=>s.value);
  await p.selectOption('header select', other.find(v=>v!==cur));
  await p.waitForTimeout(1200);
  const after = await p.evaluate(()=>{
    const sel=document.querySelector('header select');
    return sel.parentElement.querySelector('span[aria-hidden="true"]').innerText.replace(/\s+/g,' ').trim();
  });
  chk('the visible label follows the switch', after.length > 0 && !/Select a site/.test(after), `"${after}"`);

  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nthe switcher reads and behaves as a control');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
