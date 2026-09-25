export {};
/**
 * The Induction Videos area MIRRORS across both tiers.
 *
 * THE PROPERTY THAT MATTERS, and the reason this suite exists:
 *
 *   The Platform and the Admin Centre show the same product. If each tier keeps
 *   its own list of areas and its own wording, they drift on the first change -
 *   somebody renames an area in one tier and the other keeps the old word for
 *   good. So the areas, their order, their labels and their descriptions are
 *   defined ONCE and both tiers render from that definition.
 *
 * Which means the assertions below are mostly of the form "this string appears in
 * exactly one place". A test that merely checked both tiers currently agree would
 * pass just as happily on two hardcoded copies, and would not notice the day they
 * stopped agreeing.
 *
 * Run: npx tsx scripts/induction_modules_admin_ia_verify.ts
 */
const areas = require('../services/inductionVideo/inductionVideoAreas');
const platformWs = require('../components/platform/InductionVideoWorkspace');
const adminNav = require('../components/admin/AdminNav');
const { readFileSync, existsSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');
/**
 * The file with its comments removed.
 *
 * The literal-uniqueness checks below must read CODE. Asserting against the raw
 * text fails on a comment that merely discusses a label in prose - which is how
 * the first run of this suite failed, on a sentence in the Admin listing
 * explaining why the tab strip must not lie.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SHARED = 'services/inductionVideo/inductionVideoAreas.ts';
const PLAT_WS = 'components/platform/InductionVideoWorkspace.tsx';
const ADMIN_WS = 'components/admin/AdminInductionVideoWorkspace.tsx';
const ADMIN_VIDEOS = 'app/admin/(dashboard)/induction-videos/page.tsx';
const ADMIN_MODULES = 'app/admin/(dashboard)/induction-videos/modules/page.tsx';
const ADMIN_OLD = 'app/admin/(dashboard)/settings/induction-modules/page.tsx';
const ADMIN_SETTINGS_INDEX = 'app/admin/(dashboard)/settings/page.tsx';
const PLAT_NAV = 'components/platform/PlatformNav.tsx';

console.log('\nONE DEFINITION, NOT TWO COPIES');
chk('the shared area definition exists', existsSync(SHARED));
chk(
  'the Platform workspace does not define its own areas',
  !/INDUCTION_VIDEO_AREAS\s*:\s*InductionVideoArea\[\]\s*=/.test(read(PLAT_WS)),
  'it must re-export the shared list, not declare one',
);
chk(
  'the Admin workspace does not define its own areas',
  !/INDUCTION_VIDEO_AREAS\s*:\s*InductionVideoArea\[\]\s*=/.test(read(ADMIN_WS)),
);
for (const [label, f] of [['Platform', PLAT_WS], ['Admin', ADMIN_WS]] as const) {
  chk(
    `the ${label} workspace imports the shared definition`,
    /inductionVideoAreas'/.test(read(f)),
  );
}
// The labels must exist as literals in ONE file only. This is the assertion that
// actually prevents drift; everything else is a consequence of it.
for (const label of areas.INDUCTION_VIDEO_AREAS.map((a: { label: string }) => a.label)) {
  const holders = [SHARED, PLAT_WS, ADMIN_WS, ADMIN_VIDEOS, ADMIN_MODULES].filter(
    (f) => code(f).includes(`'${label}'`) || code(f).includes(`"${label}"`),
  );
  chk(
    `the label "${label}" is written in exactly one file`,
    holders.length === 1 && holders[0] === SHARED,
    holders.length ? holders.join(', ') : 'found nowhere',
  );
}

console.log('\nTHE TWO TIERS AGREE, BECAUSE THEY CANNOT DISAGREE');
chk(
  'the Platform re-exports the same array object',
  platformWs.INDUCTION_VIDEO_AREAS === areas.INDUCTION_VIDEO_AREAS,
  'identity, not equality: a copy would pass a deep-equal check today and rot tomorrow',
);
const keys = areas.INDUCTION_VIDEO_AREAS.map((a: { key: string }) => a.key);
chk('three areas in the agreed order',
  keys.length === 3 && keys[0] === 'sites' && keys[1] === 'modules' && keys[2] === 'library',
  keys.join(', '));
chk(
  'the same area sits at the same relative path in both tiers',
  areas.inductionVideoHref('PLATFORM', 'modules').replace('/platform/dashboard', '') ===
    areas.inductionVideoHref('ADMIN', 'modules').replace('/admin', ''),
  `${areas.inductionVideoHref('PLATFORM', 'modules')} vs ${areas.inductionVideoHref('ADMIN', 'modules')}`,
);
chk(
  'each tier builds hrefs from the shared helper',
  /inductionVideoHref\('PLATFORM'/.test(read(PLAT_WS)) &&
    /inductionVideoHref\('ADMIN'/.test(read(ADMIN_WS)),
);

console.log('\nIT IS AN AREA IN ADMIN, NOT A SETTING');
chk(
  'the Admin nav has an Induction videos entry',
  adminNav.ADMIN_NAV.some(
    (n: { href: string; label: string }) =>
      n.href === '/admin/induction-videos' && n.label === areas.INDUCTION_VIDEO_AREA_TITLE,
  ),
);
chk(
  'it uses the SAME wording as the Platform nav',
  read(PLAT_NAV).includes(`label: '${areas.INDUCTION_VIDEO_AREA_TITLE}'`),
  'an administrator moving between tiers must read the same word',
);
chk(
  'the Admin nav entry sits before Settings',
  adminNav.ADMIN_NAV.findIndex((n: { href: string }) => n.href === '/admin/induction-videos') <
    adminNav.ADMIN_NAV.findIndex((n: { href: string }) => n.href === '/admin/settings'),
  'it is daily work, not administration',
);
chk(
  'the Admin Settings index no longer lists induction modules',
  !read(ADMIN_SETTINGS_INDEX).includes('induction-modules'),
  'that placement is the thing being fixed',
);
chk('the old Admin settings URL still exists', existsSync(ADMIN_OLD));
chk(
  'and it redirects into the new area',
  read(ADMIN_OLD).includes("redirect('/admin/induction-videos/modules')"),
);

console.log('\nBOTH ADMIN AREAS ARE REAL DESTINATIONS');
chk('the Admin videos listing exists', existsSync(ADMIN_VIDEOS));
chk('the Admin modules page exists', existsSync(ADMIN_MODULES));
/*
 * Derived from the href helper rather than from a hardcoded pair, so ADDING an
 * area to the shared list fails here until it has an Admin destination. The first
 * version of this check hardcoded the two keys and would have passed a third area
 * that led nowhere - which is precisely the case it exists to catch.
 */
const adminPageFor = (key: string) =>
  'app/admin/(dashboard)' +
  areas.inductionVideoHref('ADMIN', key).replace('/admin', '') +
  '/page.tsx';
const dangling = areas.INDUCTION_VIDEO_AREAS.map((a: { key: string }) => a.key).filter(
  (k: string) => !existsSync(adminPageFor(k)),
);
chk(
  'every shared area has an Admin destination',
  dangling.length === 0,
  dangling.length ? `no Admin page for: ${dangling.join(', ')}` : 'both areas resolve',
);
chk(
  'no area carries an adminReadOnly flag any more',
  areas.INDUCTION_VIDEO_AREAS.every(
    (a: Record<string, unknown>) => !('adminReadOnly' in a),
  ),
  'both areas are fully actionable in both tiers; what a PERSON may do is a role',
);
chk(
  'the Admin videos listing leads into the Admin project page',
  /\/admin\/induction-videos\/projects\//.test(read(ADMIN_VIDEOS)),
  'a listing that leads nowhere is the read-only design being fixed',
);
chk(
  'the Admin videos listing does not link into Platform routes',
  !/platform\/dashboard/.test(read(ADMIN_VIDEOS)),
  'an admin may hold no Platform account - those would be dead ends',
);
chk(
  'no read-only messaging survives in the Admin video area',
  !/Read-only/.test(read(ADMIN_VIDEOS)) &&
    !/Read-only/.test(read('app/admin/(dashboard)/induction-videos/projects/[id]/page.tsx')),
);

console.log('\nSTILL ONE SYSTEM UNDERNEATH');
chk(
  'the Admin modules page renders the shared editor with the admin endpoint',
  /InductionModulesSection/.test(read(ADMIN_MODULES)) &&
    /endpoint="\/api\/admin\/induction-modules"/.test(read(ADMIN_MODULES)),
);
chk(
  'and builds its rows with the shared builder',
  /moduleRowsForEditor/.test(read(ADMIN_MODULES)),
);
chk(
  'neither workspace evaluates a permission',
  !/can(View|Draft|Issue)\w*\(|adminCanManage\(/.test(read(ADMIN_WS)) &&
    !/can(View|Draft|Issue)\w*\(|canManageInductionVideos\(/.test(read(PLAT_WS)),
  'presentation only in both tiers',
);

console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
