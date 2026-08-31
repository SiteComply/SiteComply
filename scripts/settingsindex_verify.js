/**
 * Guards for the Settings index rewrite: no horizontal overflow at any width,
 * the whole row is the link, every row navigates, and no nested interactive
 * elements inside a row.
 */
const {
  chromium,
} = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');

const ADMIN = process.argv[2];
const SECRET = process.env.SESSION_SECRET;
const n = Math.floor(Date.now() / 1000);
const payload = Buffer.from(
  JSON.stringify({
    typ: 'admin',
    adminId: ADMIN,
    email: 'dev.admin@sitecomply.local',
    name: 'Jamie Carter',
    role: 'OWNER',
    iat: n,
    exp: n + 28800,
  }),
).toString('base64url');
const tok =
  payload + '.' + createHmac('sha256', SECRET).update(payload).digest('base64url');

let fails = 0;
const chk = (t, ok, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

const EXPECTED = [
  '/admin/settings/integrations',
  '/admin/settings/authentication',
  '/admin/settings/notifications',
  '/admin/settings/company',
];

(async () => {
  const br = await chromium.launch();

  for (const w of [1440, 1024, 1023, 820, 390, 360]) {
    const c = await br.newContext({ viewport: { width: w, height: 900 } });
    await c.addCookies([
      {
        name: 'sc_admin',
        value: tok,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
    const p = await c.newPage();
    await p.goto('http://localhost:3000/admin/settings', {
      waitUntil: 'networkidle',
      timeout: 180000,
    });
    const over = await p.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    chk(`${w}px — no horizontal scroll`, over <= 0, `overflow ${over}px`);
    await c.close();
  }

  // structure + navigation at desktop width
  const c = await br.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addCookies([
    {
      name: 'sc_admin',
      value: tok,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  const p = await c.newPage();
  await p.goto('http://localhost:3000/admin/settings', {
    waitUntil: 'networkidle',
  });

  const hrefs = await p.$$eval('a[href^="/admin/settings/"]', (as) =>
    as.map((a) => a.getAttribute('href')),
  );
  chk('all four areas linked, in order', JSON.stringify(hrefs) === JSON.stringify(EXPECTED), hrefs.join(' '));

  const nested = await p.$$eval('a[href^="/admin/settings/"]', (as) =>
    as.reduce((n, a) => n + a.querySelectorAll('a, button, input, select').length, 0),
  );
  chk('no nested interactive elements inside a row', nested === 0, `${nested} found`);

  const cards = await p.$$eval('div.grid.gap-4', (d) => d.length);
  chk('old card grid is gone', cards === 0, `${cards} grid wrappers`);

  // every row navigates
  for (const href of EXPECTED) {
    await p.goto('http://localhost:3000/admin/settings', { waitUntil: 'networkidle' });
    await p.locator(`a[href="${href}"]`).click();
    const ok = await p
      .waitForURL(`**${href}`, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    chk(`row navigates to ${href}`, ok, p.url());
  }

  // the row, not just the title, is the hit target: click the far-right edge
  await p.goto('http://localhost:3000/admin/settings', { waitUntil: 'networkidle' });
  const row = p.locator('a[href="/admin/settings/company"]');
  const box = await row.boundingBox();
  await p.mouse.click(box.x + box.width - 30, box.y + box.height / 2);
  const edgeOk = await p
    .waitForURL('**/admin/settings/company', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  chk('clicking the far right of a row follows it', edgeOk, p.url());

  await br.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
