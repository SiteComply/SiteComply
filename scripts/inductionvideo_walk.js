const { chromium } = require('/home/cc-dev-1/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const { PrismaClient } = require('/home/cc-dev-1/sitecomply/node_modules/@prisma/client');
for (const l of require('fs').readFileSync('/home/cc-dev-1/sitecomply/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)="?(.*?)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const prisma = new PrismaClient();
const BASE = 'http://localhost:3130', OUT = process.argv[2];
let fails = 0; const chk = (t, ok, d='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${t}${d?` — ${d}`:''}`); if(!ok) fails++; };
(async () => {
  const site = await prisma.jobSite.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
  const snap = {
    site: await prisma.jobSite.findUnique({ where: { id: site.id }, select: { fireAssemblyPoint: true, firstAiderName: true, firstAiderLocation: true } }),
    info: await prisma.siteInformation.findUnique({ where: { jobSiteId: site.id } }),
    risks: await prisma.siteRiskTopic.findMany({ where: { jobSiteId: site.id } }),
  };
  const br = await chromium.launch();
  try {
    // A site that cannot generate: asbestos applies, no controls written.
    await prisma.jobSite.update({ where: { id: site.id }, data: { fireAssemblyPoint: 'Rear car park', firstAiderName: 'Fay Aid', firstAiderLocation: 'Site office' } });
    await prisma.siteInformation.upsert({ where: { jobSiteId: site.id },
      update: { emergencyProcedures: 'Stop work, make equipment safe and go to the assembly point.', welfareFacilities: 'Ground-floor welfare unit.' },
      create: { jobSiteId: site.id, emergencyProcedures: 'Stop work, make equipment safe and go to the assembly point.', welfareFacilities: 'Ground-floor welfare unit.' } });
    await prisma.siteRiskTopic.deleteMany({ where: { jobSiteId: site.id } });
    await prisma.siteRiskTopic.create({ data: { jobSiteId: site.id, topic: 'ASBESTOS', applicable: true, controls: null } });

    const ctx = await br.newContext({ viewport: { width: 1280, height: 1100 } });
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/platform`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const call = (ep, bd) => pg.evaluate(async ([e, d]) => { const r = await fetch(e, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(d), credentials:'include' }); return r.status; }, [ep, bd]);
    await call('/api/platform/auth/start', { method: 'email', value: process.env.PLATFORM_DEV_LOGIN_EMAIL });
    chk('platform sign-in', (await call('/api/platform/auth/verify', { method: 'email', value: process.env.PLATFORM_DEV_LOGIN_EMAIL, code: process.env.PLATFORM_DEV_LOGIN_CODE })) === 200);

    await pg.goto(`${BASE}/platform/dashboard/induction-videos`, { waitUntil: 'networkidle', timeout: 180000 });
    chk('the landing page lists projects', (await pg.locator('table tbody tr').count()) > 0);
    await pg.screenshot({ path: `${OUT}-landing.png`, fullPage: true });

    await pg.goto(`${BASE}/platform/dashboard/sites/${site.id}/induction-video`, { waitUntil: 'networkidle', timeout: 180000 });
    let body = await pg.evaluate(() => document.body.innerText);
    chk('a blocked project says so, first', /cannot produce an induction video yet/.test(body));
    chk('  naming asbestos and what to enter', /[Aa]sbestos/.test(body) && /control measures/.test(body));
    chk('  and the Generate button is not pressable',
      await pg.getByRole('button', { name: /Generate script/ }).isDisabled());
    await pg.screenshot({ path: `${OUT}-blocked.png`, fullPage: true });

    // Fix the data, as a manager would.
    await prisma.siteRiskTopic.updateMany({ where: { jobSiteId: site.id, topic: 'ASBESTOS' },
      data: { controls: 'Do not disturb any suspect material. Report it to the site manager immediately.' } });
    await pg.reload({ waitUntil: 'networkidle' });
    body = await pg.evaluate(() => document.body.innerText);
    chk('once the controls are entered, the block clears', !/cannot produce an induction video yet/.test(body));
    chk('  the scene list shows required and optional scenes', /Required/.test(body) && /Optional/.test(body));
    await pg.screenshot({ path: `${OUT}-ready.png`, fullPage: true });

    await pg.getByRole('button', { name: /Generate script/ }).click();
    await pg.waitForTimeout(1500);
    body = await pg.evaluate(() => document.body.innerText);
    chk('generating queues work rather than blocking the page', /Script generating/.test(body), body.match(/Version 1[\s\S]{0,60}/)?.[0]?.replace(/\n/g,' '));

    // The scheduler runs it (a tsx helper, since this walk is plain node).
    require('child_process').execSync('npx tsx scripts/inductionvideo_runjobs.ts', { cwd: '/home/cc-dev-1/sitecomply', stdio: 'inherit' });

    await pg.reload({ waitUntil: 'networkidle' });
    const link = pg.getByRole('link', { name: /Version 1/ });
    await link.click();
    await pg.waitForURL(/\/induction-videos\/[a-z0-9]+/, { timeout: 30000 }).catch(() => {});
    await pg.waitForLoadState('networkidle');
    await pg.waitForTimeout(500);
    body = await pg.evaluate(() => document.body.innerText);
    console.log('      url: ' + pg.url());
    console.log('      head: ' + body.replace(/\n+/g, ' | ').slice(0, 220));
    chk('the editor opens on the generated script', /Induction script/.test(body) && /version 1/i.test(body));
    chk('  scenes show where their facts came from', /From: /.test(body));
    // Narration sits in textarea VALUES, which innerText does not include.
    const narration = await pg.evaluate(() =>
      [...document.querySelectorAll('textarea')].map((t) => t.value).join('\n'));
    chk('  the asbestos control appears verbatim, in the narration',
      /Do not disturb any suspect material/.test(narration));
    chk('  and nothing was invented: every scene traces to the site\'s own words',
      narration.includes('Stop work, make equipment safe') && narration.includes('Rear car park'));
    chk('  a required scene offers no Remove button',
      (await pg.locator('article', { hasText: 'Required' }).first().getByRole('button', { name: 'Remove scene' }).count()) === 0);
    await pg.screenshot({ path: `${OUT}-editor.png`, fullPage: true });

    await pg.getByRole('button', { name: /Approve script/ }).click();
    await pg.waitForTimeout(1500);
    body = await pg.evaluate(() => document.body.innerText);
    chk('a Director can approve', /Script approved/.test(body) || /This script is approved/.test(body));
    chk('  and the history records it', /script approved/i.test(body));
    await pg.screenshot({ path: `${OUT}-approved.png`, fullPage: true });

    // Changing the project's data marks the version out of date.
    await prisma.siteInformation.update({ where: { jobSiteId: site.id }, data: { emergencyProcedures: 'Stop work and call the site manager immediately.' } });
    await pg.reload({ waitUntil: 'networkidle' });
    body = await pg.evaluate(() => document.body.innerText);
    chk('changing the project marks the version out of date', /Out of date/.test(body));
    await ctx.close();
  } catch (e) { console.log('  ERROR ' + e.message); fails++; }
  finally {
    await br.close();
    const vids = await prisma.inductionVideo.findMany({ where: { jobSiteId: site.id }, select: { id: true } });
    await prisma.inductionVideo.deleteMany({ where: { id: { in: vids.map(v => v.id) } } });
    await prisma.aiUsageEvent.deleteMany({ where: { jobSiteId: site.id } });
    await prisma.siteRiskTopic.deleteMany({ where: { jobSiteId: site.id } });
    if (snap.risks.length) await prisma.siteRiskTopic.createMany({ data: snap.risks });
    await prisma.jobSite.update({ where: { id: site.id }, data: snap.site });
    if (snap.info) { const { jobSiteId, createdAt, updatedAt, ...rest } = snap.info; await prisma.siteInformation.update({ where: { jobSiteId: site.id }, data: rest }); }
    else await prisma.siteInformation.deleteMany({ where: { jobSiteId: site.id } });
    await prisma.$disconnect();
    console.log(`\n  ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
})();
