/**
 * Worker header alignment: the site control, Check out and Sign out must sit
 * on one baseline at every supported width.
 *
 * Reports each control's top/bottom and the CENTRE DELTA between the site card
 * and Check out — the misalignment was 9px at every width, caused by the
 * 'Checked in' line making the control's column taller than the buttons while
 * the row was centred.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const path=require('path');
const S=process.env.SESSION_SECRET, OUT=process.argv[2], TAG=process.argv[3];
const mk=(m,i)=>{const n=Math.floor(Date.now()/1000);
 const b=Buffer.from(JSON.stringify({typ:'worker',mobile:m,workerId:i,iat:n,exp:n+43200})).toString('base64url');
 return b+'.'+createHmac('sha256',S).update(b).digest('base64url');};
const MULTI=['+447700900101','cms5ebw3v001d12v6ojfsorub'];
const WIDTHS=[320,360,390,430,768,1280];
(async()=>{
 const br=await chromium.launch();
 console.log(`  width  siteCard(top..bottom)  checkOut(top..bottom)  signOut(top..bottom)   card-vs-button centre delta`);
 for(const w of WIDTHS){
  const c=await br.newContext({viewport:{width:w,height:900},deviceScaleFactor:2,isMobile:w<768,hasTouch:w<768});
  await c.addCookies([{name:'sc_worker',value:mk(...MULTI),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const p=await c.newPage();
  await p.goto('http://localhost:3000/worker/dashboard',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(900);
  const r=await p.evaluate(()=>{
   const h=document.querySelector('header');
   const box=e=>{const b=e.getBoundingClientRect(); return {t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height),c:Math.round(b.top+b.height/2)};};
   // the bounded site control: the span with a border AND an svg inside
   const card=Array.from(h.querySelectorAll('span')).find(s=>s.querySelector('svg')&&/rounded-lg/.test(s.className||'')&&/border/.test(s.className||''));
   const co=Array.from(h.querySelectorAll('a,button')).find(e=>/check out/i.test(e.innerText||''));
   const so=Array.from(h.querySelectorAll('a,button')).filter(e=>e.getClientRects().length).find(e=>/sign out/i.test(e.innerText||''));
   const stamp=Array.from(h.querySelectorAll('span')).find(s=>/^Checked in:/.test((s.innerText||'').trim()));
   return {card:card?box(card):null, co:co?box(co):null, so:so&&so.getClientRects().length?box(so):null, stamp:stamp?box(stamp):null};
  });
  const f=x=>x?`${String(x.t).padStart(3)}..${String(x.b).padStart(3)}(h${x.h})`:'   —        ';
  const delta = (r.card&&r.co) ? (r.card.c - r.co.c) : null;
  console.log(`  ${String(w).padEnd(6)} ${f(r.card)}      ${f(r.co)}      ${f(r.so)}   ${delta===null?'n/a':(delta>0?'+':'')+delta+'px'}`);
  if([320,390,1280].includes(w)){
   const hb=await p.evaluate(()=>{const h=document.querySelector('header').getBoundingClientRect();
     return {x:0,y:Math.max(0,h.top),width:Math.min(1280,h.width),height:Math.min(300,h.height+8)};});
   await p.screenshot({path:path.join(OUT,`${TAG}-${w}.png`),clip:hb});
  }
  await c.close();
 }
 await br.close();
})();
