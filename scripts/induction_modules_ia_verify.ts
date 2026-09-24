export {};
/**
 * Company induction modules — the move out of Settings and into Induction Videos.
 *
 * THE PROPERTIES THAT MATTER, and why each is asserted rather than eyeballed:
 *
 *  - The move must not widen access. The Induction Videos area admits
 *    PROJECT_MANAGER and PRINCIPAL_CONTRACTOR; company policy administration
 *    must not be handed to a Principal Contractor as a side effect of a page
 *    changing folders.
 *  - The move must not narrow access either. A Project Manager could read this
 *    screen through Settings, so gating on "may draft" would quietly remove it.
 *  - The new page must NOT inherit the videos listing's site-scope redirect.
 *    Company modules are company-wide; a guard about having projects would lock
 *    a Director out of company content on a tenant with no active sites.
 *  - The old URL must redirect, not 404 — it shipped to production.
 *  - Governance is untouched. Issuing stays a Director's, drafting stays the two
 *    roles it was, and the resolver still ignores drafts. A navigation change
 *    that quietly altered any of those would be the whole risk of doing it.
 *
 * Source-level, with no database: this is an information-architecture change, and
 * what it must not break is which role reaches which screen.
 *
 * Run: npx tsx scripts/induction_modules_ia_verify.ts
 */
const svc = require('../services/inductionModules/inductionModuleService');
const vidPerms = require('../services/inductionVideo/inductionVideoPermissions');
const ws = require('../components/platform/InductionVideoWorkspace');
const settings = require('../components/platform/SettingsWorkspace');
const { readFileSync, existsSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
/** JSX wraps prose across lines; a sentence a reader sees as one line is not. */
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

const MODULES_PAGE = 'app/platform/dashboard/induction-videos/modules/page.tsx';
const VIDEOS_PAGE = 'app/platform/dashboard/induction-videos/page.tsx';
const OLD_PAGE = 'app/platform/dashboard/settings/induction-modules/page.tsx';
const NEW_API = 'app/api/platform/induction-modules/route.ts';
const OLD_API = 'app/api/platform/settings/induction-modules/route.ts';
const SECTION = 'components/platform/InductionModulesSection.tsx';
const NEW_HREF = '/platform/dashboard/induction-videos/modules';

console.log('\nWHO MAY READ THE COMPANY MODULES SCREEN');
chk('a Director may', svc.canViewInductionModules('DIRECTOR') === true);
chk(
  'a Project Manager KEEPS the read access they had via Settings',
  svc.canViewInductionModules('PROJECT_MANAGER') === true,
);
chk(
  'a Site Manager may — the role the old placement locked out',
  svc.canViewInductionModules('SITE_MANAGER') === true,
);
chk(
  'a Principal Contractor may NOT, though they may work on a video',
  svc.canViewInductionModules('PRINCIPAL_CONTRACTOR') === false,
);
chk('an Engineer may not', svc.canViewInductionModules('ENGINEER') === false);
chk('a Client may not', svc.canViewInductionModules('CLIENT') === false);

console.log('\nTHE VIEW GATE IS ITS OWN, NOT THE AREA’S AND NOT DRAFTING’S');
// If these two ever coincide, the assertions above stop proving anything.
chk(
  'the area gate is WIDER than the module view gate',
  vidPerms.canManageInductionVideos('PRINCIPAL_CONTRACTOR') === true &&
    svc.canViewInductionModules('PRINCIPAL_CONTRACTOR') === false,
  'canManageInductionVideos must not be reused as the module gate',
);
chk(
  'the view gate is WIDER than the draft gate',
  svc.canViewInductionModules('PROJECT_MANAGER') === true &&
    svc.canDraftInductionModule('PROJECT_MANAGER') === false,
  'reading is not drafting',
);
chk(
  'the page gates on canViewInductionModules',
  /canViewInductionModules\(viewer\.role\)/.test(read(MODULES_PAGE)),
);
chk(
  'the page does NOT gate on canManageInductionVideos',
  !/canManageInductionVideos/.test(read(MODULES_PAGE)),
);

console.log('\nTHE NEW PAGE MUST NOT INHERIT THE LISTING’S SITE-SCOPE GUARD');
chk(
  'the videos listing still redirects when a viewer has no sites',
  /siteIds\.length === 0\)\s*redirect/.test(read(VIDEOS_PAGE)),
  'the guard being copied FROM must still exist, or this proves nothing',
);
chk(
  'the modules page has no siteIds guard',
  !/siteIds/.test(read(MODULES_PAGE)),
  'company content is not site-scoped',
);

console.log('\nBACKWARDS COMPATIBILITY');
chk('the old settings page still exists', existsSync(OLD_PAGE));
chk(
  'it redirects to the new location',
  flat(OLD_PAGE).includes(`redirect('${NEW_HREF}')`),
);
chk(
  'the Settings entry points at the new location',
  settings.SETTINGS_AREAS.some(
    (a: { key: string; href: string }) =>
      a.key === 'induction-modules' && a.href === NEW_HREF,
  ),
  'a Director who learned the Settings path must still arrive',
);
chk(
  'the Settings entry says where it went',
  /Now managed with Induction videos/.test(
    settings.SETTINGS_AREAS.find((a: { key: string }) => a.key === 'induction-modules')
      ?.description ?? '',
  ),
);

console.log('\nTHE API MOVED WITH THE PAGE');
chk('the new API route exists', existsSync(NEW_API));
chk(
  'the settings-shaped API path is gone',
  !existsSync(OLD_API),
  'a settings/ API for a screen no longer in Settings is stale naming',
);
chk(
  'the editor takes its endpoint rather than hard-coding one',
  // It now serves BOTH front doors, so a hard-coded path would be the bug.
  /endpoint: string/.test(read(SECTION)) && !/fetch\('\/api\//.test(read(SECTION)),
);
chk(
  'the Induction Videos page passes the platform endpoint',
  read('app/platform/dashboard/induction-videos/modules/page.tsx')
    .includes('endpoint="/api/platform/induction-modules"'),
);
chk(
  'the editor posts to no settings path',
  !read(SECTION).includes('/api/platform/settings/induction-modules'),
);

console.log('\nTHE AREA’S SHAPE');
const keys = ws.INDUCTION_VIDEO_AREAS.map((a: { key: string }) => a.key);
chk('two areas', keys.length === 2, keys.join(', '));
chk('videos first — it is the daily task', keys[0] === 'videos');
chk('company modules second', keys[1] === 'modules');
chk(
  'the modules area href matches the page route',
  ws.INDUCTION_VIDEO_AREAS[1].href === NEW_HREF,
);
chk(
  'the listing hides the modules area from roles that may not read it',
  /a\.key !== 'modules' \|\| canViewInductionModules\(viewer\.role\)/.test(
    read(VIDEOS_PAGE),
  ),
  'a redirect the user could have been spared',
);
chk(
  'the workspace CALLS no permission predicate',
  // Deliberately matched as calls, not as words: the file's comments explain the
  // role problem the move fixes, and a bare /role/ would fail on correct code.
  !/can(View|Draft|Issue)\w*\(|canManageInductionVideos\(/.test(
    read('components/platform/InductionVideoWorkspace.tsx'),
  ),
  'presentation only, like SettingsWorkspace',
);

console.log('\nGOVERNANCE IS UNTOUCHED BY THE MOVE');
chk('issuing is still a Director’s alone', svc.canIssueInductionModule('DIRECTOR') === true);
chk('a Site Manager still may not issue', svc.canIssueInductionModule('SITE_MANAGER') === false);
chk(
  'a Project Manager still may not draft',
  svc.canDraftInductionModule('PROJECT_MANAGER') === false,
);
chk('a Site Manager still may draft', svc.canDraftInductionModule('SITE_MANAGER') === true);
const SVC_SRC = read('services/inductionModules/inductionModuleService.ts');
chk(
  'a draft still reaches nobody',
  SVC_SRC.includes('if (!issued) continue; // a draft never reaches a site'),
);
chk(
  'an issued revision is still immutable',
  SVC_SRC.includes('An issued revision cannot be edited'),
);
chk(
  'issuing still supersedes',
  SVC_SRC.includes('status: InductionModuleRevisionStatus.SUPERSEDED'),
);
chk(
  'a site decision is still written by id',
  SVC_SRC.includes('update({ where: { id: existing.id }') &&
    !SVC_SRC.includes('siteInductionModule.upsert'),
  'the closed-project guard depends on it',
);

console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
