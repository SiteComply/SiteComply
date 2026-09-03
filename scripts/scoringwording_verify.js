/**
 * Audit Scoring wording: scoring configuration vs question authoring.
 *
 * The point of the rename is that no two things share a name, so this asserts
 * ABSENCE as well as presence: the legend name must not appear on the editor
 * view, and the editor name must not appear on the scoring view.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const path=require('path');
const OUT=process.argv[2];
const WITH='cmsfmtpgm0001wf75eofdp8jk';   // 36 questions
const EMPTY='cms5ednqw000j9gj7ujwdr6rg';  // 0 questions
let fails=0; const chk=(t,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok)fails++;};
(async()=>{
 const br=await chromium.launch();
 const c=await br.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:2});
 const p=await c.newPage();
 // The local seed has a different Director to production, so mint the session
 // rather than depend on an override that only exists in prod.
 const { createHmac } = require('crypto');
 const n=Math.floor(Date.now()/1000);
 const pl=Buffer.from(JSON.stringify({typ:'platform',userId:'cmscrs2u80000bsjqt0qq29a2',iat:n,exp:n+28800})).toString('base64url');
 const tok=pl+'.'+createHmac('sha256',process.env.SESSION_SECRET).update(pl).digest('base64url');
 await c.addCookies([{name:'sc_platform',value:tok,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);

 const url=`http://localhost:3000/platform/dashboard/audits/${WITH}/scoring`;
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
 await p.waitForTimeout(2000);
 if(!/scoring/.test(p.url())){ console.log('  ABORT: not on the scoring page —', p.url()); await br.close(); process.exit(1); }

 console.log('== scoring workspace ==');
 const t1=await p.evaluate(()=>document.body.innerText);
 chk('summary card is "How questions are scored"', t1.includes('How questions are scored'));
 chk('hand-off button reads "Set question rules"', t1.includes('Set question rules'));
 chk('footer hint names the template as the source',
     t1.includes('Questions come from the audit template. Set how each one scores.'));
 chk('no "Configure Questions" anywhere', !t1.includes('Configure Questions'));
 chk('"Question Scoring Rules" is NOT on this view (no duplicate name)',
     !t1.includes('Question Scoring Rules'));
 // frame the legend card
 const box=await p.evaluate(()=>{
   const h=Array.from(document.querySelectorAll('*')).find(e=>e.children.length===0 && e.textContent.trim()==='How questions are scored');
   if(!h) return null; let card=h;
   for(let i=0;i<8&&card.parentElement;i++){ const r=card.getBoundingClientRect(); if(r.width>700&&r.height>150) break; card=card.parentElement; }
   card.scrollIntoView({block:'center'}); const r=card.getBoundingClientRect();
   return {x:Math.max(0,r.left-10),y:Math.max(0,r.top-10),width:Math.min(1440,r.width+20),height:Math.min(560,r.height+20)};});
 if(box&&box.width>10) await p.screenshot({path:path.join(OUT,'after-summary.png'),clip:box});

 console.log('\n== editor workspace (after pressing the hand-off) ==');
 await p.locator('button:has-text("Set question rules")').first().click();
 await p.waitForTimeout(1200);
 const t2=await p.evaluate(()=>document.body.innerText);
 chk('editor panel is "Question Scoring Rules (36)"', /Question Scoring Rules \(36\)/.test(t2),
     (t2.match(/Question Scoring Rules \([0-9]+\)/)||['not found'])[0]);
 chk('"How questions are scored" is NOT on this view', !t2.includes('How questions are scored'));
 chk('Back to scoring is offered', t2.includes('Back to scoring'));
 await p.screenshot({path:path.join(OUT,'after-editor.png'),clip:{x:0,y:0,width:1440,height:560}});

 console.log('\n== empty state (audit with no questions) ==');
 await p.goto(`http://localhost:3000/platform/dashboard/audits/${EMPTY}/scoring`,{waitUntil:'domcontentloaded',timeout:120000});
 await p.waitForTimeout(1800);
 await p.locator('button:has-text("Set question rules")').first().click();
 await p.waitForTimeout(1200);
 const t3=await p.evaluate(()=>document.body.innerText);
 chk('panel reads "Question Scoring Rules (0)"', t3.includes('Question Scoring Rules (0)'));
 chk('empty state still explains template inheritance',
     t3.includes('Questions come from the audit template'));
 await p.screenshot({path:path.join(OUT,'after-empty.png'),clip:{x:0,y:0,width:1440,height:520}});

 await br.close();
 console.log(`\n  ${fails} failure(s)\n`);
 process.exit(fails?1:0);
})();
