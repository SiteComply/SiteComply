/**
 * The shared site control: identical geometry in both states, and no interactive
 * behaviour whatsoever in the read-only one.
 *
 * Geometry is compared BETWEEN the states rather than against fixed numbers —
 * "consistent presentation" is a claim about the relationship, so that is what
 * gets asserted.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const OUT = process.argv[2], S = process.env.SESSION_SECRET;
const mk = (mobile, id) => {
  const n = Math.floor(Date.now()/1000);
  const b = Buffer.from(JSON.stringify({typ:'worker',mobile,workerId:id,iat:n,exp:n+28800})).toString('base64url');
  return b + '.' + createHmac('sha256', S).update(b).digest('base64url');
};
const MULTI  = ['+447700900101','cms5ebw3v001d12v6ojfsorub'];
const SINGLE = ['+447700900150','cmt83zcmc00014tnv37p8ddso'];
let fails=0; const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`);if(!ok)fails++;};

const probe = async (br, cred, width) => {
  const c = await br.newContext({viewport:{width,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await c.addCookies([{name:'sc_worker',value:mk(cred[0],cred[1]),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p = await c.newPage();
  await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'networkidle',timeout:120000});
  await p.waitForTimeout(350);
  const r = await p.evaluate(() => {
    const hdr = document.querySelector('header');
    const sel = hdr.querySelector('select');
    // The chrome is the bounded span with the building icon inside it.
    const chrome = Array.from(hdr.querySelectorAll('span')).find(
      s => s.querySelector('svg') && /rounded-lg/.test(s.className || '') && /border/.test(s.className || ''));
    const cs = chrome ? getComputedStyle(chrome) : null;
    const b = chrome ? chrome.getBoundingClientRect() : null;
    const icon = chrome ? chrome.querySelector('svg') : null;
    const ib = icon ? icon.getBoundingClientRect() : null;
    const out = Array.from(hdr.querySelectorAll('a,button')).find(e=>/check out/i.test(e.innerText));
    const ov = (a,z)=>{ if(!a||!z) return 0; const A=a.getBoundingClientRect?a.getBoundingClientRect():a, Z=z.getBoundingClientRect();
      return Math.round(Math.max(0,Math.min(A.right,Z.right)-Math.max(A.left,Z.left))*Math.max(0,Math.min(A.bottom,Z.bottom)-Math.max(A.top,Z.top))); };
    return {
      hasSelect: !!sel,
      text: chrome ? chrome.innerText.replace(/\s+/g,' ').trim() : null,
      bg: cs ? cs.backgroundColor : null,
      radius: cs ? cs.borderTopLeftRadius : null,
      borderW: cs ? cs.borderTopWidth : null,
      padL: cs ? cs.paddingLeft : null,
      h: b ? Math.round(b.height) : null,
      align: cs ? cs.textAlign : null,
      iconOffsetFromLeft: (b && ib) ? Math.round(ib.left - b.left) : null,
      svgCount: chrome ? chrome.querySelectorAll('svg').length : 0,
      focusables: chrome ? chrome.querySelectorAll('a,button,select,input,[tabindex]').length : 0,
      overlap: ov(chrome, out),
    };
  });
  await c.close();
  return r;
};

(async()=>{
  if (OUT) fs.mkdirSync(OUT,{recursive:true});
  const br = await chromium.launch();
  for (const w of [320,390,430]) {
    const m = await probe(br, MULTI, w);
    const s = await probe(br, SINGLE, w);
    console.log(`\n### ${w}px`);
    chk('multi-site renders the interactive control', m.hasSelect && m.svgCount === 2, `${m.svgCount} icons, select=${m.hasSelect}`);
    chk('single-site renders NO select at all', !s.hasSelect);
    chk('single-site has no chevron', s.svgCount === 1, `${s.svgCount} icon(s)`);
    chk('single-site contains nothing focusable', s.focusables === 0, `${s.focusables}`);
    chk('multi says "Switch site"', /switch site/i.test(m.text||''), `"${m.text}"`);
    chk('single says "Current site"', /current site/i.test(s.text||''), `"${s.text}"`);
    // Consistency of presentation — the point of the change.
    chk('same height', m.h === s.h, `${m.h} vs ${s.h}`);
    chk('same radius, border and padding', m.radius===s.radius && m.borderW===s.borderW && m.padL===s.padL,
        `${m.radius}/${m.borderW}/${m.padL} vs ${s.radius}/${s.borderW}/${s.padL}`);
    chk('same alignment', m.align === s.align, `${m.align} vs ${s.align}`);
    chk('icon in the same place', m.iconOffsetFromLeft === s.iconOffsetFromLeft, `${m.iconOffsetFromLeft}px vs ${s.iconOffsetFromLeft}px`);
    // The one deliberate difference.
    chk('fills differ (raised vs recessed)', m.bg !== s.bg, `${m.bg} vs ${s.bg}`);
    chk('no overlap with Check out in either state', m.overlap === 0 && s.overlap === 0, `${m.overlap} / ${s.overlap}`);
  }
  await br.close();
  console.log(fails?`\n${fails} FAILED`:'\nboth states share one presentation; only the read-only signals differ');
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
