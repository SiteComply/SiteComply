/**
 * S3 worker navigation: per-item reachability at phone widths.
 *
 * "Visible" is measured against the SCROLLER's own viewport rect, not the
 * window, because the strip scrolls inside a card — an item can be inside the
 * window and still be past the strip's right edge.
 *
 * Runs unchanged against the old and the new nav, so before/after numbers are
 * produced by the same measurement rather than by two descriptions of it.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const path = require('path');

const LABEL = process.argv[2];            // 'before' | 'after'
const OUT = process.argv[3];
const S = process.env.SESSION_SECRET;
if (!S) { console.error('SESSION_SECRET missing'); process.exit(1); }

const WIDTHS = [320, 360, 375, 390, 412, 430, 480];
const SHOT_WIDTHS = [320, 390, 430];
const WORKER = ['+447700900101', 'cms5ebw3v001d12v6ojfsorub'];

const cookie = () => {
  const n = Math.floor(Date.now() / 1000);
  const b = Buffer.from(JSON.stringify({ typ: 'worker', mobile: WORKER[0], workerId: WORKER[1], iat: n, exp: n + 28800 })).toString('base64url');
  return b + '.' + createHmac('sha256', S).update(b).digest('base64url');
};

let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

const probe = async (br, width) => {
  const c = await br.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addCookies([{ name: 'sc_worker', value: cookie(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const p = await c.newPage();
  await p.goto('http://localhost:3000/worker/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForSelector('nav[aria-label="Worker dashboard sections"] a', { timeout: 120000 });
  await p.waitForTimeout(600);

  const r = await p.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Worker dashboard sections"]');
    const links = Array.from(nav.querySelectorAll('a'));
    const nb = nav.getBoundingClientRect();
    const items = links.map((a) => {
      const b = a.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(b.right, nb.right) - Math.max(b.left, nb.left));
      const state = overlap <= 0.5 ? 'offscreen'
        : (b.left >= nb.left - 0.5 && b.right <= nb.right + 0.5) ? 'visible' : 'clipped';
      return {
        href: a.getAttribute('href'),
        label: (a.getAttribute('aria-label') || a.innerText).replace(/\s+/g, ' ').trim(),
        text: a.innerText.replace(/\s+/g, ' ').trim(),
        state,
        h: Math.round(b.height),
        w: Math.round(b.width),
        // how far the strip must scroll for this item to become fully visible
        need: Math.max(0, Math.round(b.right - nb.right)),
      };
    });
    // Overflow affordances: gradients that are actually painted, and buttons.
    const container = nav.parentElement;
    const fades = Array.from(container.querySelectorAll(':scope > div[aria-hidden="true"]')).map((d) => ({
      opacity: getComputedStyle(d).opacity,
      gradient: /gradient/.test(getComputedStyle(d).backgroundImage),
    }));
    const buttons = Array.from(container.querySelectorAll(':scope > button'));
    // The indicator floats over the strip, so confirm taps land on the item
    // underneath it rather than on the indicator.
    const probeAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.closest('a') ? 'link' : (el.closest('nav') ? 'nav' : el.tagName.toLowerCase())) : 'none';
    };
    const midY = nb.top + nb.height / 2;
    const hitUnderIndicator = probeAt(nb.right - 12, midY);
    const indicatorHasChevron = Array.from(container.querySelectorAll(':scope > div[aria-hidden="true"]'))
      .every((d) => !!d.querySelector('svg'));
    return {
      items,
      scrollWidth: Math.round(nav.scrollWidth),
      clientWidth: Math.round(nav.clientWidth),
      overflowX: getComputedStyle(nav).overflowX,
      fades, buttonCount: buttons.length, hitUnderIndicator, indicatorHasChevron,
    };
  });
  return { r, p, c };
};

(async () => {
  const br = await chromium.launch();
  const report = {};
  console.log(`\n== WORKER NAV (${LABEL.toUpperCase()}) ==`);

  for (const w of WIDTHS) {
    const { r, p, c } = await probe(br, w);
    report[w] = r;
    const vis = r.items.filter(i => i.state === 'visible').length;
    const clip = r.items.filter(i => i.state === 'clipped').length;
    const off = r.items.filter(i => i.state === 'offscreen').length;
    const emerg = r.items.find(i => /Emergency/i.test(i.label));
    console.log(`  ${String(w).padEnd(4)} items=${r.items.length}  visible=${vis} clipped=${clip} offscreen=${off}  scroll=${r.scrollWidth - r.clientWidth}px  emergency=${emerg ? emerg.state + (emerg.need ? `(+${emerg.need}px)` : '') : 'n/a'}  h=${r.items[0].h}px`);

    if (SHOT_WIDTHS.includes(w)) {
      // Tag the nav's own card, whatever depth it sits at, so before and after
      // frame exactly the same element.
      await p.evaluate(() => {
        let el = document.querySelector('nav[aria-label="Worker dashboard sections"]');
        while (el && !/shadow-card/.test(el.className || '')) el = el.parentElement;
        if (el) el.setAttribute('data-navcard', '1');
      });
      await p.locator('[data-navcard]').screenshot({ path: path.join(OUT, `${LABEL}-${w}.png`) });
    }
    await c.close();
  }

  // Does the affordance actually track the scroll position, and does the
  // button actually move the strip? Measured at 390px.
  const { r: _r, p: ip, c: ic } = await probe(br, 390);
  const interaction = await ip.evaluate(async () => {
    const nav = document.querySelector('nav[aria-label="Worker dashboard sections"]');
    const box = nav.parentElement;
    const state = () => {
      const fades = Array.from(box.querySelectorAll(':scope > div[aria-hidden="true"]'));
      return {
        left: Number(getComputedStyle(fades[0]).opacity) > 0.9,
        right: Number(getComputedStyle(fades[1]).opacity) > 0.9,
        scrollLeft: Math.round(nav.scrollLeft),
      };
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const atStart = state();
    // a swipe of roughly one screen
    nav.scrollLeft = 200;
    nav.dispatchEvent(new Event('scroll'));
    await wait(300);
    const afterPress = state();
    nav.scrollLeft = nav.scrollWidth;
    nav.dispatchEvent(new Event('scroll'));
    await wait(300);
    const atEnd = state();
    return { atStart, afterPress, atEnd };
  });
  await ic.close();

  // Desktop must be untouched: a vertical list with icon beside the full label.
  const dc = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await dc.addCookies([{ name: 'sc_worker', value: cookie(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const dp = await dc.newPage();
  await dp.goto('http://localhost:3000/worker/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await dp.waitForSelector('nav[aria-label="Worker dashboard sections"] a', { timeout: 120000 });
  await dp.waitForTimeout(400);
  const desktop = await dp.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Worker dashboard sections"]');
    const links = Array.from(nav.querySelectorAll('a'));
    const r = links.map((a) => a.getBoundingClientRect());
    return {
      stacked: r.every((b, i) => i === 0 || b.top >= r[i - 1].bottom - 1),
      heights: r.map((b) => Math.round(b.height)),
      texts: links.map((a) => a.innerText.replace(/\s+/g, ' ').trim()),
      overflowX: getComputedStyle(nav).overflowX,
      affordancesHidden: Array.from(nav.parentElement.querySelectorAll(':scope > div[aria-hidden], :scope > button'))
        .every((e) => e.getBoundingClientRect().width === 0),
    };
  });
  await dp.screenshot({ path: path.join(OUT, `${LABEL}-desktop.png`), clip: { x: 0, y: 0, width: 420, height: 760 } });
  await dc.close();

  console.log('\n  -- assertions --');
  const at = (w) => report[w];
  const count = (w, s) => at(w).items.filter(i => i.state === s).length;
  const total = at(390).items.length;

  chk('nav renders the same destinations at every width',
    WIDTHS.every(w => at(w).items.length === total), `${total} items`);
  chk('all items meet the 52px touch target',
    WIDTHS.every(w => at(w).items.every(i => i.h >= 52)),
    `min height ${Math.min(...WIDTHS.flatMap(w => at(w).items.map(i => i.h)))}px`);
  // Emergency info now CLOSES the list by decision, so it is behind the swipe
  // at every phone width. Recorded as a measurement rather than asserted away.
  console.log('  NOTE  Emergency info position/state: ' +
    WIDTHS.map(w => { const it = at(w).items; const i = it.findIndex(x => /Emergency/i.test(x.label));
      return `${w}:#${i + 1}/${it.length} ${it[i].state}${it[i].need ? ` (+${it[i].need}px)` : ''}`; }).join('  '));
  // Targets, and — where a baseline run exists — a comparison against it, so
  // "improved" is measured rather than asserted.
  chk('at least 3 items fully visible at 320px', count(320, 'visible') >= 3, `${count(320, 'visible')}`);
  chk('at least 4 items fully visible at 390px', count(390, 'visible') >= 4, `${count(390, 'visible')}`);
  chk('at least 5 items fully visible at 430px', count(430, 'visible') >= 5, `${count(430, 'visible')}`);

  const basePath = path.join(OUT, 'before.json');
  if (LABEL === 'after' && fs.existsSync(basePath)) {
    const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    const bcount = (w, st) => base[w].items.filter(i => i.state === st).length;
    chk('every width gains reachable items against the baseline',
      WIDTHS.every(w => count(w, 'visible') > bcount(w, 'visible')),
      WIDTHS.map(w => `${w}:${bcount(w, 'visible')}->${count(w, 'visible')}`).join(' '));
    chk('every width needs less scrolling than the baseline',
      WIDTHS.every(w => (at(w).scrollWidth - at(w).clientWidth) < (base[w].scrollWidth - base[w].clientWidth) * 0.6),
      WIDTHS.map(w => `${w}:${base[w].scrollWidth - base[w].clientWidth}->${at(w).scrollWidth - at(w).clientWidth}`).join(' '));
    chk('the strip still needs far less scrolling than the original',
      WIDTHS.every(w => (at(w).scrollWidth - at(w).clientWidth) < (base[w].scrollWidth - base[w].clientWidth) * 0.6));
  }
  chk('a painted right-edge fade is present while items remain',
    WIDTHS.every(w => at(w).fades.some(f => f.gradient && Number(f.opacity) > 0.9)));
  chk('the fade carries a chevron, so the signal is a direction and not just a blur',
    WIDTHS.every(w => at(w).indicatorHasChevron));
  chk('the indicator intercepts nothing — taps at the edge reach the strip',
    WIDTHS.every(w => ['link', 'nav'].includes(at(w).hitUnderIndicator)),
    WIDTHS.map(w => `${w}:${at(w).hitUnderIndicator}`).join(' '));
  chk('no extra controls added to the nav',
    WIDTHS.every(w => at(w).buttonCount === 0));

  chk('at rest the strip signals right only, not left',
    interaction.atStart.right === true && interaction.atStart.left === false,
    JSON.stringify(interaction.atStart));
  chk('part-way along the strip signals both directions',
    interaction.afterPress.right === true && interaction.afterPress.left === true,
    JSON.stringify(interaction.afterPress));
  chk('scrolled to the end the signal flips to left only',
    interaction.atEnd.right === false && interaction.atEnd.left === true,
    JSON.stringify(interaction.atEnd));

  // Permits is off on this site, so it is absent from the rendered strip.
  const EXPECTED_HREFS = ['/worker/dashboard', '/worker/inductions', '/worker/bulletins', '/worker/site-information', '/worker/attendance', '/worker/rams', '/worker/documents', '/worker/actions', '/worker/contacts', '/worker/emergency'];
  chk('routes and order are exactly as specified',
    JSON.stringify(at(390).items.map(i => i.href)) === JSON.stringify(EXPECTED_HREFS),
    at(390).items.map(i => i.href).join(' '));
  chk('panel permissions still filter — Permits is off for this site and absent',
    !at(390).items.some(i => i.href === '/worker/permits'));
  chk('every visible short label is contained in the accessible name',
    WIDTHS.every(w => at(w).items.every(i => i.label.startsWith(i.text.split('\n')[0]))),
    at(390).items.map(i => `${i.text}|${i.label}`).join(' '));

  chk('desktop is still a vertical list, unscrolled, with full labels',
    desktop.stacked && desktop.overflowX === 'visible' && desktop.affordancesHidden
      && desktop.texts.includes('Site information') && desktop.texts.includes('Emergency info'),
    `overflowX=${desktop.overflowX} heights=${[...new Set(desktop.heights)].join('/')}`);

  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
  await br.close();
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(LABEL === 'before' ? 0 : (fails ? 1 : 0));
})();
