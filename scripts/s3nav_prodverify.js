/**
 * S3 navigation: production verification against the live site.
 *
 * Signs in as the TEST WORKER through the real OTP endpoints — the scoped
 * override plants a challenge rather than bypassing verification, so this is
 * the same code path a real worker takes. Everything measured here is measured
 * on production, not on a local build.
 *
 * If sign-in cannot be completed the script ABORTS rather than reporting on an
 * empty page: a pass over nothing proves nothing.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PROD_BASE || 'https://sitecomply-web.azurewebsites.net';
const MOBILE = process.env.TEST_WORKER_MOBILE || '+447700900150';
const CODE = process.env.TEST_WORKER_CODE || '231001';
const OUT = process.argv[2];
const WIDTHS = [320, 360, 375, 390, 412, 430, 480];
const SHOTS = [320, 390, 430];

let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

const signIn = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/check-in`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let req = await p.evaluate(async ([base, mobile]) => {
    const r = await fetch(`${base}/api/worker/otp/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile }), credentials: 'include',
    });
    return { status: r.status, body: await r.text() };
  }, [BASE, MOBILE]);
  // A 429 is the resend cooldown, not a failure — wait it out once and retry.
  if (req.status === 429) {
    const wait = (JSON.parse(req.body).resendInSeconds || 30) + 3;
    console.log(`  ..     resend cooldown, waiting ${wait}s`);
    await p.waitForTimeout(wait * 1000);
    req = await p.evaluate(async ([base, mobile]) => {
      const r = await fetch(`${base}/api/worker/otp/request`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile }), credentials: 'include',
      });
      return { status: r.status, body: await r.text() };
    }, [BASE, MOBILE]);
  }
  if (req.status !== 200) throw new Error(`OTP request failed: ${req.status} ${req.body}`);
  const ver = await p.evaluate(async ([base, mobile, code]) => {
    const r = await fetch(`${base}/api/worker/otp/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile, code }), credentials: 'include',
    });
    return { status: r.status, body: await r.text() };
  }, [BASE, MOBILE, CODE]);
  if (ver.status !== 200) throw new Error(`OTP verify failed: ${ver.status} ${ver.body}`);
  await p.close();
  return JSON.parse(ver.body);
};

const measure = async (ctx, width, label) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height: 844 });
  await p.goto(`${BASE}/worker/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const url = p.url();
  const nav = await p.$('nav[aria-label="Worker dashboard sections"]');
  if (!nav) { await p.close(); return { url, missing: true }; }
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Worker dashboard sections"]');
    const links = Array.from(nav.querySelectorAll('a'));
    const nb = nav.getBoundingClientRect();
    const items = links.map((a) => {
      const b = a.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(b.right, nb.right) - Math.max(b.left, nb.left));
      return {
        href: a.getAttribute('href'),
        label: (a.getAttribute('aria-label') || '').trim(),
        text: a.innerText.replace(/\s+/g, ' ').trim(),
        state: overlap <= 0.5 ? 'offscreen'
          : (b.left >= nb.left - 0.5 && b.right <= nb.right + 0.5) ? 'visible' : 'clipped',
        h: Math.round(b.height),
        stacked: getComputedStyle(a).flexDirection === 'column',
      };
    });
    const box = nav.parentElement;
    const fades = Array.from(box.querySelectorAll(':scope > div[aria-hidden="true"]')).map((d) => ({
      opacity: Number(getComputedStyle(d).opacity),
      gradient: /gradient/.test(getComputedStyle(d).backgroundImage),
      chevron: !!d.querySelector('svg'),
    }));
    const midY = nb.top + nb.height / 2;
    const el = document.elementFromPoint(nb.right - 12, midY);
    let card = nav; while (card && !/shadow-card/.test(card.className || '')) card = card.parentElement;
    if (card) card.setAttribute('data-navcard', '1');
    return {
      items, fades,
      scroll: Math.round(nav.scrollWidth - nav.clientWidth),
      buttons: box.querySelectorAll(':scope > button').length,
      edgeHit: el ? (el.closest('a') ? 'link' : (el.closest('nav') ? 'nav' : el.tagName.toLowerCase())) : 'none',
    };
  });
  if (SHOTS.includes(width)) {
    await p.locator('[data-navcard]').screenshot({ path: path.join(OUT, `prod-${width}.png`) });
  }
  await p.close();
  return { url, ...r };
};

(async () => {
  console.log('== S3 NAV — PRODUCTION VERIFICATION ==');
  console.log(`   ${BASE}\n`);
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  console.log('-- sign-in --');
  let session;
  try { session = await signIn(ctx); }
  catch (e) { console.log(`  ABORT  could not sign in to production — ${e.message}`); await br.close(); process.exit(1); }
  chk('signed in through the live OTP endpoints', !!session && session.ok !== false, JSON.stringify(session).slice(0, 120));

  console.log('\n-- the live navigation --');
  const report = {};
  for (const w of WIDTHS) {
    const r = await measure(ctx, w, 'prod');
    if (r.missing) {
      console.log(`  ABORT  ${w}px: no worker navigation on the page (landed on ${r.url})`);
      await br.close(); process.exit(1);
    }
    report[w] = r;
    const c = (s) => r.items.filter(i => i.state === s).length;
    const em = r.items.find(i => /Emergency/i.test(i.label));
    console.log(`  ${String(w).padEnd(4)} items=${r.items.length}  visible=${c('visible')} clipped=${c('clipped')} offscreen=${c('offscreen')}  scroll=${r.scroll}px  emergency=${em ? em.state : 'n/a'}  h=${r.items[0].h}px`);
  }

  console.log('\n-- assertions --');
  const at = (w) => report[w];
  const vis = (w) => at(w).items.filter(i => i.state === 'visible').length;

  chk('pills are stacked at every phone width', WIDTHS.every(w => at(w).items.every(i => i.stacked)));
  chk('every item clears the 52px touch target',
    WIDTHS.every(w => at(w).items.every(i => i.h >= 52)),
    `min ${Math.min(...WIDTHS.flatMap(w => at(w).items.map(i => i.h)))}px`);
  chk('Emergency info is third and in view at every width',
    WIDTHS.every(w => at(w).items[2].href === '/worker/emergency' && at(w).items[2].state === 'visible'));
  chk('3 or more destinations in view at 320px', vis(320) >= 3, `${vis(320)}`);
  chk('4 or more destinations in view at 390px', vis(390) >= 4, `${vis(390)}`);
  chk('5 or more destinations in view at 430px', vis(430) >= 5, `${vis(430)}`);
  // Per item, not a fixed length: production sites enable different panels, so
  // the strip's total length depends on how many destinations that site has.
  // This one has Permits on, giving 11 where the local site gives 10.
  const stripPerItem = (w) => {
    const r = at(w);
    return Math.round((r.scroll + (w - 48)) / r.items.length);
  };
  chk('the strip costs under 80px per destination (was ~130px)',
    WIDTHS.every(w => stripPerItem(w) <= 80),
    WIDTHS.map(w => `${w}:${stripPerItem(w)}px/item`).join(' '));
  chk('a gradient with a chevron marks the end that still has items',
    WIDTHS.every(w => at(w).fades.length === 2 && at(w).fades.every(f => f.gradient && f.chevron)
      && at(w).fades.some(f => f.opacity > 0.9)));
  chk('the indicator has no hit area — edge taps reach the strip',
    WIDTHS.every(w => ['link', 'nav'].includes(at(w).edgeHit)),
    WIDTHS.map(w => `${w}:${at(w).edgeHit}`).join(' '));
  chk('no controls were added to the nav', WIDTHS.every(w => at(w).buttons === 0));
  chk('short labels are contained in the accessible names',
    WIDTHS.every(w => at(w).items.every(i => i.label.startsWith(i.text.split('\n')[0]))));

  // Compare against the pre-deploy measurement taken on the dev build.
  const localPath = path.join(OUT, 'after.json');
  if (fs.existsSync(localPath)) {
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const lv = (w) => local[String(w)].items.filter(i => i.state === 'visible').length;
    chk('live counts match what was measured before deployment',
      WIDTHS.every(w => vis(w) === lv(w)),
      WIDTHS.map(w => `${w}: measured ${lv(w)} / live ${vis(w)}`).join(' · '));
  }

  fs.writeFileSync(path.join(OUT, 'prod.json'), JSON.stringify(report, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails ? 1 : 0);
})();
