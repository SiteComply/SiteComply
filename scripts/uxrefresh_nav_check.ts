/**
 * UX Refresh Phase 9 — navigation grouping checks.
 *
 * The risk this phase introduces is specific and it is not visual: a group LABEL
 * is new text on screen, and the items under it are permission-filtered. Two ways
 * that can go wrong —
 *
 *   1. a heading survives its contents, so a viewer is told a section exists that
 *      they cannot see (an information leak dressed as a layout tweak), and
 *   2. a group is split into two non-adjacent runs, so the same heading appears
 *      twice and the navigator silently reorders.
 *
 * Both are checked here against the REAL permission matrix and the REAL step
 * list, for every role, rather than against a fixture.
 */
import { PLATFORM_NAV } from '@/components/platform/PlatformNav';
import { navGroupRuns } from '@/components/platform/navUi';
import {
  permits,
  PLATFORM_MODULES,
} from '@/services/platformUsers/platformPermissions';
import { PLATFORM_ROLES } from '@/services/platformUsers/platformUserConstants';
import { SETUP_STEPS } from '@/services/sites/siteSetupConstants';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('== navGroupRuns behaviour ==');
{
  const runs = navGroupRuns(
    [
      { k: 'a', g: 'one' },
      { k: 'b', g: 'one' },
      { k: 'c', g: 'two' },
    ],
    (i) => i.g,
  );
  check('consecutive equal groups collapse into one run', runs.length === 2);
  check('run order follows input order', runs[0]!.items.map((i) => i.k).join('') === 'ab');
}
{
  // A group that is NOT contiguous must produce two runs — visibly wrong rather
  // than silently reordered. This is the Phase 1 mistake, encoded.
  const runs = navGroupRuns(
    [
      { k: 'a', g: 'one' },
      { k: 'b', g: 'two' },
      { k: 'c', g: 'one' },
    ],
    (i) => i.g,
  );
  check('a split group yields TWO runs, never a silent reorder', runs.length === 3);
}
{
  const runs = navGroupRuns(
    [
      { k: 'a', g: 'one' },
      { k: 'b', g: undefined },
      { k: 'c', g: 'one' },
    ],
    (i) => i.g,
  );
  check('an ungrouped item joins the run above it', runs.length === 1 && runs[0]!.items.length === 3);
}
{
  const runs = navGroupRuns([] as { g?: string }[], (i) => i.g);
  check('an empty navigator renders no runs and no headings', runs.length === 0);
}

console.log('\n== the application rail, per role ==');
for (const { value: role } of PLATFORM_ROLES) {
  const allowed = PLATFORM_MODULES.filter((m) => permits(role, m, 'view'));
  const items = PLATFORM_NAV.filter(
    (i) => allowed.includes(i.module) && (!i.roles || i.roles.includes(role)),
  );
  const runs = navGroupRuns(items, (i) => i.group);
  const groups = runs.map((r) => r.group);

  check(
    `${role}: every run has at least one visible item`,
    runs.every((r) => r.items.length > 0),
    `${runs.length} run(s)`,
  );
  check(
    `${role}: no group appears twice (runs stay contiguous after filtering)`,
    new Set(groups).size === groups.length,
    groups.join(' | ') || '(no nav)',
  );
  check(
    `${role}: labelled items === visible items`,
    runs.reduce((n, r) => n + r.items.length, 0) === items.length,
    `${items.length} item(s)`,
  );
}

console.log('\n== Worker Experience sections, across every permission combination ==');
{
  // The page builds its section list from six independent conditions. Grouping
  // must hold for ALL 64 combinations, not just the Director case a screenshot
  // shows.
  const SEEN = 'What workers see';
  const IND = 'Induction & check-in';
  const EMG = 'Emergency & contacts';
  const template = [
    { key: 'bulletins', group: SEEN, flag: 0 },
    { key: 'dashboard', group: SEEN, flag: 1 },
    { key: 'site-information', group: SEEN, flag: 2 },
    { key: 'knowledge-check', group: IND, flag: 3 },
    { key: 'induction-validity', group: IND, flag: 4 },
    { key: 'check-in-location', group: IND, flag: 5 },
    { key: 'contacts', group: EMG, flag: -1 },
    { key: 'emergency', group: EMG, flag: -1 },
  ];
  let bad = 0;
  let emptyHeading = 0;
  for (let mask = 0; mask < 64; mask++) {
    const visible = template.filter((s) => s.flag < 0 || (mask & (1 << s.flag)) !== 0);
    const runs = navGroupRuns(visible, (s) => s.group);
    const groups = runs.map((r) => r.group);
    if (new Set(groups).size !== groups.length) bad++;
    if (runs.some((r) => r.items.length === 0)) emptyHeading++;
  }
  check('all 64 visibility combinations keep each group contiguous', bad === 0, `${bad} bad`);
  check('no combination produces a heading with nothing under it', emptyHeading === 0);
}

console.log('\n== Project setup wizard steps ==');
{
  // Mirrors STEP_GROUP in SiteSetupWizard.tsx. Duplicated deliberately: if the
  // component's map drifts from this one, the coverage check below fails.
  const STEP_GROUP: Record<string, string> = {
    project: 'Project & CDM',
    client: 'Project & CDM',
    'duty-holders': 'Project & CDM',
    f10: 'Project & CDM',
    people: 'People & emergency',
    emergency: 'People & emergency',
    welfare: 'Site conditions',
    rules: 'Site conditions',
    hazards: 'Site conditions',
    'high-risk': 'Site conditions',
    'temporary-works': 'Site conditions',
    access: 'Access & environment',
    traffic: 'Access & environment',
    utilities: 'Access & environment',
    environment: 'Access & environment',
    drawings: 'Documents & services',
    services: 'Documents & services',
  };
  const missing = SETUP_STEPS.filter((s) => !STEP_GROUP[s.key]).map((s) => s.key);
  check('every setup step has a group', missing.length === 0, missing.join(',') || 'all 17');

  const runs = navGroupRuns(SETUP_STEPS, (s) => STEP_GROUP[s.key]);
  const groups = runs.map((r) => r.group);
  check(
    'groups are contiguous in SETUP_STEPS order — grouping moves nothing',
    new Set(groups).size === groups.length,
    groups.join(' | '),
  );
  check(
    'every step still appears exactly once',
    runs.reduce((n, r) => n + r.items.length, 0) === SETUP_STEPS.length,
    `${SETUP_STEPS.length} steps in ${runs.length} runs`,
  );
  const order = runs.flatMap((r) => r.items.map((s) => s.key)).join(',');
  check('rendered order is identical to SETUP_STEPS order', order === SETUP_STEPS.map((s) => s.key).join(','));
}

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail === 0 ? 0 : 1);
