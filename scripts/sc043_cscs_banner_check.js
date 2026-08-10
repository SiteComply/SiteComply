/**
 * M-5 verification — the CSCS status banner must report the LIVE provider.
 *
 * Drives the real Admin Centre screen through the whole lifecycle: initial
 * load, changing the dropdown without saving, saving, and a hard refresh.
 * Asserts the banner against the database at every step.
 */
const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { createHmac } = require('crypto');
const { execSync } = require('child_process');

// argv: node m5_verify.js <adminId> <outputDir>
const S = process.env.SESSION_SECRET, ADMIN = process.argv[2], OUT = process.argv[3];
const n = Math.floor(Date.now() / 1000);
const b = Buffer.from(JSON.stringify({ typ: 'admin', adminId: ADMIN, email: 'a@b.c', name: 'M5 Audit', role: 'OWNER', iat: n, exp: n + 28800 })).toString('base64url');
const tok = b + '.' + createHmac('sha256', S).update(b).digest('base64url');

const PG = `${process.env.HOME}/.local/pgsql/usr/lib/postgresql/16/bin/psql`;
const DBU = process.env.M5_DBURL;
const db = (sql) => execSync(`LD_LIBRARY_PATH=${process.env.HOME}/.local/pgsql/usr/lib/x86_64-linux-gnu ${PG} "${DBU}" -tAc '${sql}'`).toString().trim();
const storedProvider = () => db('select "activeProvider" from "CscsConfig"');

let fails = 0;
const chk = (t, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

const banner = (p) => p.evaluate(() => {
  const m = document.body.innerText.match(/Currently verifying with[^.]*\./);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '(no banner)';
});
const dropdown = (p) => p.evaluate(() => document.querySelector('select').value);

(async () => {
  const br = await chromium.launch();
  const c = await br.newContext({ viewport: { width: 1400, height: 1300 }, deviceScaleFactor: 2 });
  await c.addCookies([{ name: 'sc_admin', value: tok, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  const p = await c.newPage();
  const URL_ = 'http://localhost:3000/admin/settings/integrations?tab=cscs';

  console.log('=== 1. initial load: banner matches the stored provider ===');
  await p.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForTimeout(2000);
  let stored = storedProvider();
  let text = await banner(p);
  console.log(`      stored=${stored}  dropdown=${await dropdown(p)}`);
  console.log(`      banner: ${text}`);
  chk('banner names the stored provider (mock)', /Mock/.test(text), text);

  console.log('\n=== 2. change the dropdown WITHOUT saving ===');
  await p.selectOption('select', 'smartcheck');
  await p.waitForTimeout(800);
  text = await banner(p);
  console.log(`      stored=${storedProvider()}  dropdown=${await dropdown(p)}`);
  console.log(`      banner: ${text}`);
  chk('dropdown really did change', (await dropdown(p)) === 'smartcheck');
  chk('banner still reports the LIVE provider, not the selection', /Mock/.test(text), text);
  chk('banner does not claim Smart Check is verifying', !/verifying with CSCS Smart Check/i.test(text), text);
  await p.screenshot({ path: `${OUT}/m5-unsaved-selection.png`, fullPage: true });

  console.log('\n=== 3. the dropdown description still follows the selection ===');
  const desc = await p.evaluate(() => document.body.innerText.includes('Verifies the card against the official CSCS Smart Check service'));
  chk('description under the select describes the CHOSEN option', desc);

  console.log('\n=== 4. save a real change, banner must follow ===');
  // Give Smart Check credentials so it can legitimately be selected.
  await p.fill('input[type=url]', 'https://api.cscssmartcheck.example');
  await p.fill('input[type=password]', 'partner-key-m5');
  await p.locator('button:has-text("Save CSCS settings")').click();
  await p.waitForTimeout(3500);
  stored = storedProvider();
  text = await banner(p);
  console.log(`      stored=${stored}`);
  console.log(`      banner: ${text}`);
  chk('save applied', stored === 'smartcheck', stored);
  chk('banner now reports Smart Check', /CSCS Smart Check/.test(text), text);
  chk('banner attributes it to the database', /set here/i.test(text), text);

  console.log('\n=== 5. hard refresh: banner unchanged and still correct ===');
  await p.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForTimeout(2000);
  text = await banner(p);
  console.log(`      stored=${storedProvider()}  dropdown=${await dropdown(p)}`);
  console.log(`      banner: ${text}`);
  chk('after refresh the banner still reports Smart Check', /CSCS Smart Check/.test(text), text);
  chk('dropdown agrees with the saved value after refresh', (await dropdown(p)) === 'smartcheck');
  await p.screenshot({ path: `${OUT}/m5-after-save.png`, fullPage: true });

  console.log('\n=== 6. select back to mock without saving ===');
  await p.selectOption('select', 'mock');
  await p.waitForTimeout(800);
  text = await banner(p);
  console.log(`      stored=${storedProvider()}  dropdown=${await dropdown(p)}`);
  console.log(`      banner: ${text}`);
  chk('banner still reports the live provider (Smart Check)', /CSCS Smart Check/.test(text), text);
  chk('banner does not fall back to the unsaved mock selection', !/verifying with Mock/i.test(text), text);

  console.log(`\n== ${fails === 0 ? 'ALL PASSED' : `${fails} FAILED`} ==`);
  await br.close();
  process.exit(fails === 0 ? 0 : 1);
})();
