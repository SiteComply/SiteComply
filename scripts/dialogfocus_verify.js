/**
 * Feedback dialog — keyboard focus must stay in the textarea while typing.
 *
 * The bug: Dialog's focus effect listed `onClose` (and `busy`) as dependencies.
 * A caller's callback is a new function on every render, so every keystroke
 * re-ran the effect: cleanup threw focus back to the trigger, then the body
 * moved it to the first focusable control — the close button.
 *
 * This test types ONE CHARACTER AT A TIME and records where focus is after each,
 * because that is the only way to see the fault. A `fill()` sets the value in one
 * go and passes even when the bug is present.
 *
 * It must FAIL on the pre-fix code. A focus test that passes either way is worth
 * nothing, so run it against both.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:3120';
const EMAIL = process.env.PLATFORM_EMAIL || 'jc@parryst.com';
const CODE = process.env.PLATFORM_CODE || '231001';
const PHRASE = process.env.PHRASE || 'Focus should stay here while I type.';
const OUT = process.argv[2] || '/tmp/dialogfocus';
let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

(async () => {
  console.log(`== FEEDBACK DIALOG — TYPING FOCUS ==\n   ${BASE}\n`);
  const br = await chromium.launch();
  const W = parseInt(process.env.WIDTH || '1280', 10);
  const ctx = await br.newContext({ viewport: { width: W, height: W < 600 ? 844 : 900 }, isMobile: W < 600, hasTouch: W < 600 });
  const pg = await ctx.newPage();

  await pg.goto(`${BASE}/platform`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const call = (ep, body) => pg.evaluate(async ([b, e, bd]) => {
    const r = await fetch(b + e, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bd), credentials: 'include' });
    return { s: r.status, t: await r.text() };
  }, [BASE, ep, body]);
  await call('/api/platform/auth/start', { method: 'email', value: EMAIL });
  const v = await call('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: CODE });
  if (v.s !== 200) { console.log(`  ABORT  sign-in failed: ${v.s} ${v.t.slice(0, 200)}`); await br.close(); process.exit(1); }

  await pg.goto(`${BASE}/platform/dashboard/submissions`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForTimeout(1500);

  // Open the dialog from the VISIBLE trigger — the shell renders two.
  const opened = await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button[aria-label="Report an issue or give feedback"]'))
      .filter((x) => x.getClientRects().length)[0];
    if (!b) return false;
    b.click();
    return true;
  });
  chk('the Feedback dialog can be opened', opened);
  if (!opened) { await br.close(); process.exit(1); }
  await pg.waitForSelector('#report-description', { timeout: 15000 });

  // Where focus lands on OPEN. This is asserted too: landing on the close button
  // means opening the dialog and typing immediately destroys the input, because
  // the first space presses it.
  const onOpen = await pg.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
  chk('opening the dialog focuses the message field, not the close button', onOpen === 'report-description', `focus on open: ${onOpen}`);

  // And typing straight after opening, without clicking, must work.
  await pg.keyboard.type('typed without clicking first', { delay: 20 });
  const blind = await pg.evaluate(() => document.querySelector('#report-description')?.value ?? null);
  chk('you can type immediately on open', blind === 'typed without clicking first', blind === null ? 'the dialog closed itself' : `"${blind}"`);
  await pg.evaluate(() => { const t = document.querySelector('#report-description'); if (t) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); } });
  await pg.waitForTimeout(200);

  await pg.click('#report-description');
  const focusAfter = [];
  let closedAfter = -1;
  for (let i = 0; i < PHRASE.length; i++) {
    await pg.keyboard.type(PHRASE[i], { delay: 25 });
    focusAfter.push(await pg.evaluate(() =>
      document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName || '<none>'));
    // With the bug, focus lands on the close BUTTON — so the next space or
    // enter in the phrase activates it and the dialog shuts itself. Stop and
    // report that rather than throwing thirty seconds later on a missing node.
    if (await pg.evaluate(() => !document.querySelector('#report-description'))) { closedAfter = i + 1; break; }
  }
  chk('the dialog stayed open while typing', closedAfter === -1,
      closedAfter === -1 ? 'still open' : `it closed itself after character ${closedAfter} — focus had moved to the close button and a space pressed it`);

  const strayed = focusAfter.filter((f) => f !== 'report-description');
  const firstStray = focusAfter.findIndex((f) => f !== 'report-description');
  chk('focus never leaves the textarea while typing',
      strayed.length === 0,
      strayed.length ? `left after character ${firstStray + 1} of ${PHRASE.length}, to "${strayed[0]}" (${strayed.length} keystrokes affected)` : `${PHRASE.length} keystrokes, all held`);

  const value = closedAfter === -1 ? await pg.inputValue('#report-description') : null;
  chk('every character reached the textarea', value === PHRASE,
      value === null ? 'the dialog was gone before it could be read'
        : value === PHRASE ? `${value.length} chars` : `got ${value.length} of ${PHRASE.length}: "${value}"`);

  // The counter is what the user watches, and it is driven by the same state.
  const counter = closedAfter !== -1 ? null : await pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*')).find((n) => /^\d+\s*\/\s*\d+$/.test(n.textContent?.trim() || '') && n.children.length === 0);
    return el ? el.textContent.trim() : null;
  });
  chk('the character counter agrees', counter !== null && counter.startsWith(String(PHRASE.length)), `${counter}`);

  // Escape must still close — the key handler now reads its callback via a ref,
  // so this proves the ref is actually current rather than a stale first render.
  // The Tab trap moved into its own effect during the fix, so prove it still
  // holds. Tabbing past the last control must wrap to the first, never escape
  // into the page behind, which is still rendered and still clickable.
  if (closedAfter === -1) {
    const trapped = [];
    for (let i = 0; i < 14; i++) {
      await pg.keyboard.press('Tab');
      trapped.push(await pg.evaluate(() => {
        const card = document.querySelector('[role="dialog"]');
        return !!(card && document.activeElement && card.contains(document.activeElement));
      }));
    }
    chk('Tab stays inside the dialog', trapped.every(Boolean),
        `${trapped.filter(Boolean).length}/14 tab stops stayed inside`);
  }

  if (closedAfter === -1) {
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(600);
    const gone = await pg.evaluate(() => !document.querySelector('#report-description'));
    chk('Escape still closes the dialog', gone);
  } else {
    chk('Escape still closes the dialog', false, 'not reached — the dialog had already closed itself');
  }

  await pg.screenshot({ path: `${OUT}/dialog-typing.png` }).catch(() => {});
  console.log(`\n  ${fails} failure(s)`);
  await br.close();
  process.exit(fails ? 1 : 0);
})();
