export {};
/**
 * Induction videos driven from BOTH tiers.
 *
 * THE PROPERTIES THAT MATTER:
 *  - one workflow: both entry points go through one dispatcher and one service,
 *    so the order of generate → approve → narrate → render → publish, and every
 *    rule guarding it, cannot differ between them;
 *  - SITE AUTHORITY IS ASKED, NOT ENUMERATED. This is the thing videos needed and
 *    modules did not: an admin has no assigned sites, and an empty list would
 *    silently deny everything while looking like a permission decision;
 *  - an Admin OWNER and ADMIN can do everything a Platform Director can, VIEWER
 *    nothing; a Platform PROJECT_MANAGER can still prepare but not approve;
 *  - every action records which realm it came from, and the realm never decides
 *    anything;
 *  - an admin id is never written into a platform user column.
 *
 * Run: npx tsx scripts/inductionvideo_realm_verify.ts
 */
const { prisma } = require('../lib/prisma');
const {
  videoActorFromAdmin,
  videoActorFromPlatformViewer,
  describeVideoRealm,
} = require('../services/inductionVideo/videoActor');
const { readFileSync, existsSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const admin = (role: string) => ({
  typ: 'admin', adminId: 'adm-9', email: 'a@b.c', name: 'Ada Admin', role, iat: 0, exp: 0,
});
const plat = (role: string, siteIds: string[]) => ({
  id: 'u9', name: 'Dee Director', role, siteIds,
});

const SVC = 'services/inductionVideo/inductionVideoService.ts';
const REND = 'services/inductionVideo/renderService.ts';
const NARR = 'services/inductionVideo/narrationService.ts';
const ACTIONS = 'services/inductionVideo/videoActions.ts';
const ACTOR = 'services/inductionVideo/videoActor.ts';
const ADMIN_VID_ROUTE = 'app/api/admin/induction-video/[videoId]/route.ts';
const ADMIN_SITE_ROUTE = 'app/api/admin/sites/[id]/induction-video/route.ts';
const PLAT_VID_ROUTE = 'app/api/platform/induction-video/[videoId]/route.ts';
const PLAT_SITE_ROUTE = 'app/api/platform/sites/[id]/induction-video/route.ts';
const SURFACE = 'components/inductionVideo/VideoVersionSurface.tsx';

(async () => {
  console.log('\nSITE AUTHORITY IS ASKED, NOT ENUMERATED');
  const owner = videoActorFromAdmin(admin('OWNER'));
  const adm = videoActorFromAdmin(admin('ADMIN'));
  const viewer = videoActorFromAdmin(admin('VIEWER'));
  chk('an admin may act on any project at all', owner.maySite('any-site-id') === true);
  chk('  including one nobody is assigned to', adm.maySite('some-other-site') === true);
  chk('an admin VIEWER may act on none', viewer.maySite('any-site-id') === false);
  const director = videoActorFromPlatformViewer(plat('DIRECTOR', ['site-a']));
  chk('a Director is still limited to their assigned projects',
    director.maySite('site-a') === true && director.maySite('site-b') === false,
    'the Platform rule must not have been widened by this change');
  const engineer = videoActorFromPlatformViewer(plat('ENGINEER', ['site-a']));
  chk('an Engineer may act on none, assigned or not', engineer.maySite('site-a') === false);

  console.log('\nWHAT EACH ACTOR MAY DO');
  chk('an Admin OWNER manages and approves', owner.canManage && owner.canApprove);
  chk('an Admin ADMIN manages and approves', adm.canManage && adm.canApprove);
  chk('an Admin VIEWER does neither', !viewer.canManage && !viewer.canApprove);
  chk('a Director manages and approves', director.canManage && director.canApprove);
  const pm = videoActorFromPlatformViewer(plat('PROJECT_MANAGER', ['site-a']));
  chk('a Project Manager prepares but does NOT approve',
    pm.canManage === true && pm.canApprove === false,
    'the existing Platform split must survive');
  const pc = videoActorFromPlatformViewer(plat('PRINCIPAL_CONTRACTOR', ['site-a']));
  chk('a Principal Contractor likewise', pc.canManage === true && pc.canApprove === false);

  console.log('\nIDENTITY AND REALM');
  chk('an admin actor carries no platform user id', owner.userId === null);
  chk('a platform actor carries no admin id', director.adminId === null);
  chk('realms are tagged', owner.realm === 'ADMIN' && director.realm === 'PLATFORM');
  chk('realms read for humans',
    describeVideoRealm('ADMIN') === 'Admin Centre' &&
    describeVideoRealm('PLATFORM') === 'Platform');

  console.log('\nTHE SERVICES READ NO ROLE STRING');
  for (const [label, f] of [['video', SVC], ['render', REND], ['narration', NARR]] as const) {
    const src = read(f);
    // canWorkOnVideoSite survives in the video service as a PLATFORM-only helper
    // for the media routes, so that one file may still name PlatformViewer.
    if (f !== SVC) {
      chk(`the ${label} service takes no PlatformViewer`, !/PlatformViewer/.test(src));
    }
    if (f === SVC) {
      /*
       * One exception, asserted rather than waved through: canWorkOnVideoSite is
       * still the PLATFORM-only helper two platform routes use (video streaming
       * and the per-site module decisions), so this file may name viewer.role
       * exactly once, inside it. Any second use would mean a role check had crept
       * back into the workflow.
       */
      const uses = (src.match(/viewer\.role/g) ?? []).length;
      chk('the video service reads viewer.role ONLY in canWorkOnVideoSite',
        uses === 1 &&
          /export function canWorkOnVideoSite[\s\S]{0,200}viewer\.role/.test(src),
        `${uses} use(s)`);
    } else {
      chk(`the ${label} service reads no viewer.role`, !/viewer\.role/.test(src));
    }
    chk(`the ${label} service branches on no AdminRole`,
      !/'OWNER'|'VIEWER'|AdminRole/.test(src));
  }
  chk('the realm is never used for a decision',
    ![SVC, REND, NARR].some((f) => /(if|&&|\|\|)[^\n]*actor\.realm/.test(read(f))),
    'canManage/canApprove decide; realm is for the record');

  console.log('\nONE WORKFLOW, TWO ENTRY POINTS');
  chk('the admin version route exists', existsSync(ADMIN_VID_ROUTE));
  chk('the admin project route exists', existsSync(ADMIN_SITE_ROUTE));
  for (const [label, f, fn] of [
    ['platform version', PLAT_VID_ROUTE, 'handleVideoAction'],
    ['admin version', ADMIN_VID_ROUTE, 'handleVideoAction'],
    ['platform project', PLAT_SITE_ROUTE, 'handleSiteVideoAction'],
    ['admin project', ADMIN_SITE_ROUTE, 'handleSiteVideoAction'],
  ] as const) {
    const src = read(f);
    chk(`the ${label} route uses the shared dispatcher`, new RegExp(`${fn}\\(`).test(src));
    chk(`the ${label} route implements no action itself`,
      !/approveScript\(|publishVideo\(|requestRender\(|requestNarration\(|editScene\(/.test(src),
      'an action implemented twice is a workflow duplicated');
  }
  chk('the admin routes refuse a VIEWER at the door',
    /requireAdminRole\(ADMIN_WRITE_ROLES\)/.test(read(ADMIN_VID_ROUTE)) &&
    /requireAdminRole\(ADMIN_WRITE_ROLES\)/.test(read(ADMIN_SITE_ROUTE)));
  chk('approval supersedes earlier versions in the SHARED dispatcher',
    /supersedeEarlierVersions\(/.test(read(ACTIONS)),
    'leaving it in one route would let the other approve without superseding');

  console.log('\nONE WORKING SURFACE, NOT TWO COPIES');
  chk('the shared surface exists', existsSync(SURFACE));
  for (const [label, f, base] of [
    ['Platform', 'app/platform/dashboard/induction-videos/[videoId]/page.tsx', '/api/platform/induction-video/'],
    ['Admin', 'app/admin/(dashboard)/induction-videos/[videoId]/page.tsx', '/api/admin/induction-video/'],
  ] as const) {
    const src = read(f);
    chk(`the ${label} version page renders the shared surface`,
      /VideoVersionSurface/.test(src));
    chk(`  and passes its own API base`, src.includes(base));
    chk(`  and assembles no panels itself`,
      !/ScriptEditor|NarrationPanel|RenderPanel/.test(src),
      'the assembly is the part that rots');
  }

  console.log('\nTHE RECORD SAYS WHERE AN ACTION CAME FROM');
  const svcSrc = read(SVC);
  chk('events record a realm', /actorRealm: actor\.realm/.test(svcSrc));
  chk('approval records its realm', /approvedByRealm: actor\.realm/.test(svcSrc));
  chk('approval records an admin id separately',
    /approvedByAdminId: actor\.adminId/.test(svcSrc),
    'an admin id must never go in a platform user column');
  chk('publishing records its realm', /publishedByRealm: actor\.realm/.test(read(REND)));
  chk('withdrawing CLEARS the publish attribution',
    /publishedByRealm: null/.test(read(REND)),
    'a withdrawn video must not still claim to have been published from somewhere');
  chk('a background job records no realm rather than claiming one',
    /SYSTEM_ACTOR = \{ name: 'SiteComply', realm: null \}/.test(svcSrc));
  chk('the surface shows the realm beside who acted',
    /describeVideoRealm\(e\.actorRealm\)/.test(read(SURFACE)));

  console.log('\nTHE SCHEMA MATCHES THE MIGRATIONS');
  const SCHEMA = read('prisma/schema.prisma');
  const MIG = require('fs')
    .readdirSync('prisma/migrations')
    .filter((d: string) => existsSync(`prisma/migrations/${d}/migration.sql`))
    .map((d: string) => read(`prisma/migrations/${d}/migration.sql`))
    .join('\n');
  let model = '';
  const declared: string[] = [];
  for (const line of SCHEMA.split('\n')) {
    const m = /^model (\w+)/.exec(line);
    if (m) model = m[1];
    const c = /^\s{2}(\w*(?:Realm|ByAdminId))\s/.exec(line);
    if (c) declared.push(`${model}.${c[1]}`);
  }
  const migrated = new Set<string>();
  let table = '';
  for (const line of MIG.split('\n')) {
    const t = /^ALTER TABLE "(\w+)"/.exec(line);
    if (t) table = t[1];
    const c = /ADD COLUMN IF NOT EXISTS "(\w+)"/.exec(line);
    if (c) migrated.add(`${table}.${c[1]}`);
  }
  const videoCols = declared.filter((k) => /^InductionVideo/.test(k));
  const orphaned = videoCols.filter((k) => !migrated.has(k));
  chk('every induction-video realm column is migrated',
    orphaned.length === 0,
    orphaned.length ? `orphaned: ${orphaned.join(', ')}` : videoCols.join(' '));

  await prisma.$disconnect();
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
