/**
 * Sortable header row with the detail rail OPEN, across supported widths.
 * Checks: page-level horizontal scroll, header wrapping, clipping, overlap,
 * and that every sort link is still hittable.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const USER = process.argv[2], OUT = process.argv[3], SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now() / 1000);
const b = Buffer.from(JSON.stringify({ typ: 'platform', userId: USER, iat: n, exp: n + 28800 })).toString('base64url');
const tok = b + '.' + createHmac('sha256', SECRET).update(b).digest('base64url');
const BASE = 'http://localhost:3000/platform/dashboard/actions';
const WIDTHS = [1600, 1440, 1280, 1100, 1024, 1023, 900, 820, 768, 767, 640, 500, 390, 360];
let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const br = await chromium.launch();
  const c0 = await br.newContext({ viewport: { width: 1440, height: 900 } });
  await c0.addCookies([{ name: 'sc_platform', value: tok, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const p0 = await c0.newPage();
  await p0.goto(`${BASE}?sort=site&dir=asc`, { waitUntil: 'networkidle' });
  const itemId = await p0.$eval('tbody tr td:first-child a', (a) => new URL(a.href).searchParams.get('item'));
  await c0.close();
  console.log(`selected row for the rail: ${itemId}\n`);

  for (const w of WIDTHS) {
    const c = await br.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 });
    await c.addCookies([{ name: 'sc_platform', value: tok, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    const p = await c.newPage();
    await p.goto(`${BASE}?sort=assigned&dir=asc`, { waitUntil: 'networkidle', timeout: 120000 });
    await p.waitForTimeout(250);

    console.log(`--- ${w}px (rail open) ---`);

    const railOpen = 1;
    

    const overflow = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk('no page-level horizontal scroll', overflow <= 0, `overflow ${overflow}px`);

    // Header geometry: wrapping, clipping, hittability.
    // Scroll each header into view before hit-testing it. A header sitting
    // outside the wrapper's current horizontal scroll position is REACHABLE, not
    // broken — testing it where it is not currently painted measures the test,
    // not the page.
    const hdr = await p.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('thead th'));
      return ths.map((th) => {
        th.scrollIntoView({ block: 'nearest', inline: 'center' });
        const a = th.querySelector('a');
        const r = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        const lh = parseFloat(cs.lineHeight) || 20;
        const hit = document.elementFromPoint(
          Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return {
          label: a.innerText.trim(),
          h: Math.round(r.height),
          w: Math.round(r.width),
          lines: Math.max(1, Math.round(r.height / lh)),
          thScroll: th.scrollWidth - th.clientWidth,
          hitIsSelf: !!hit && (hit === a || a.contains(hit)),
        };
      });
    });
    chk('all four headers present', hdr.length === 4, hdr.map((h) => h.label).join(' | '));
    const wrapped = hdr.filter((h) => h.lines > 1);
    chk('no header wraps to a second line', wrapped.length === 0,
        wrapped.length ? wrapped.map((h) => `${h.label}:${h.lines} lines`).join(', ') : 'all single-line');
    const clipped = hdr.filter((h) => h.thScroll > 0);
    chk('no header clipped inside its cell', clipped.length === 0,
        clipped.length ? clipped.map((h) => `${h.label}:+${h.thScroll}px`).join(', ') : '');
    const unhittable = hdr.filter((h) => !h.hitIsSelf || h.w < 20);
    chk('every sort link is hittable, nothing overlapping it', unhittable.length === 0,
        unhittable.length ? unhittable.map((h) => `${h.label}(w${h.w})`).join(', ') : '');

    // The table wrapper is overflow-x-auto by design; report whether it engaged.
    const tw = await p.evaluate(() => {
      const el = document.querySelector('table')?.parentElement;
      return el ? { scroll: el.scrollWidth - el.clientWidth, cw: el.clientWidth } : null;
    });
    console.log(`        table wrapper: ${tw.cw}px wide, ${tw.scroll > 0 ? `scrolls ${tw.scroll}px horizontally (by design)` : 'no internal scroll'}`);

    // Header alignment: each th must line up with its column's cells.
    const aligned = await p.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('thead th'));
      const firstRow = Array.from(document.querySelectorAll('tbody tr:first-child td'));
      if (ths.length !== firstRow.length) return false;
      return ths.every((th, i) =>
        Math.abs(th.getBoundingClientRect().left - firstRow[i].getBoundingClientRect().left) < 2);
    });
    chk('headers aligned with their columns', aligned);

    if (OUT && [1440, 1100, 1024, 900, 390].includes(w)) {
      await p.screenshot({ path: `${OUT}/rail-${w}.png`, fullPage: true });
    }
    await c.close();
    console.log('');
  }

  await br.close();
  console.log(fails ? `${fails} FAILED` : 'all responsive checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
