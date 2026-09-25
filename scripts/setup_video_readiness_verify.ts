export {};
/**
 * SITE SETUP COLLECTS EVERYTHING AN INDUCTION VIDEO NEEDS.
 *
 * THE EXPECTATION BEING PROTECTED: a user completes Site Setup and can generate a
 * complete induction video immediately. Not "setup tells them what is missing" -
 * setup IS the process that collects it.
 *
 * So the assertions below are of two kinds:
 *  1. every input the video pipeline reads is asked for INSIDE the wizard;
 *  2. a site that finishes the wizard satisfies every condition the pipeline
 *     refuses to generate without.
 *
 * Run: npx tsx scripts/setup_video_readiness_verify.ts
 */
const { SETUP_STEPS, applicableSteps } = require('../services/sites/siteSetupConstants');
const {
  computeDerivedCompleteness,
  stepStatus,
  requirementsFor,
} = require('../services/sites/siteSetupCompletion');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const WIZARD = read('components/platform/SiteSetupWizard.tsx');
const PAGE = read('app/platform/dashboard/sites/[id]/setup/page.tsx');
const RULES = read('services/inductionVideo/sceneRules.ts');
const key = (k: string) => SETUP_STEPS.find((s: { key: string }) => s.key === k);
// A bare includes('<Foo') also matches '<FooBar', so a renamed or replaced component
// would slip through. Require the tag to actually end.
const renders = (src: string, comp: string) =>
  new RegExp(`<${comp}[\\s/>]`).test(src);

const NARRATIVE = 'Full demolition of the existing single-storey rear extension.';
const EMPTY_COUNTS = {
  siteManagers: 0, firstAiders: 0, siteRules: 0, ppeItems: 0, risksMissingControls: 0,
};
const snap = (values: Record<string, unknown>, counts: Record<string, number> = {}) => ({
  values,
  counts: { ...EMPTY_COUNTS, ...counts },
});

console.log('\nEVERY VIDEO INPUT IS ASKED FOR INSIDE THE WIZARD');
for (const [what, comp] of [
  ['the risk register and its controls', 'SiteRiskRegister'],
  ['the site rules an operative acknowledges', 'SiteRulesConfig'],
  ['the PPE this site requires', 'PpeRequirementsConfig'],
  ['the site map', 'SiteMapUpload'],
  ['the company modules the induction carries', 'SiteInductionModules'],
  ['the company videos the induction carries', 'SiteLibraryPanel'],
] as const) {
  chk(`${what} is collected in the wizard`, renders(WIZARD, comp));
}
chk('the induction notes are collected in the wizard',
  WIZARD.includes("set('induction', 'inductionContent'"));
chk('RAMS are pointed at the document register, not re-implemented',
  /Upload a drawing, plan or RAMS/.test(WIZARD) && !/category:\s*'RAMS'/.test(WIZARD),
  'documents keep their permissions, expiry tracking and annotation');
chk('  and the wizard says how many the site has',
  /ramsCount/.test(WIZARD) && /DocumentCategory.RAMS/.test(PAGE));

console.log('\nTHE STEPS EXIST, AND SAY WHICH DOCUMENT THEY GATE');
for (const k of ['risks', 'induction', 'company-content']) {
  chk(`the "${k}" step exists`, Boolean(key(k)), k);
}
chk('the risk register gates the video', key('risks').videoRequired === true);
chk('  and the plan as well - the register IS a plan section',
  key('risks').cppRequired === true);
chk('site rules and PPE gate the video', key('induction').videoRequired === true);
chk('the free-text step gates NEITHER, because no scene reads it',
  key('rules').videoRequired === false && key('rules').cppRequired === false);
chk('  and it carries no requirement it could not satisfy',
  requirementsFor('rules').length === 0);
chk('company content gates nothing — it is centrally managed',
  key('company-content').videoRequired === false);

console.log('\nTHE SITE-CONDITION QUESTIONS ARE ASKED, NOT INFERRED');
chk('only the F10 flag is still conditional',
  SETUP_STEPS.filter((s: { requiresFlag?: string }) => s.requiresFlag)
    .every((s: { requiresFlag?: string }) => s.requiresFlag === 'cdmNotifiable'));
chk('the three condition steps are always shown',
  ['high-risk', 'temporary-works', 'traffic'].every((k) => !key(k).requiresFlag));
chk('and each asks outright', /kind: 'gate'/.test(WIZARD));
for (const [k, flag, field] of [
  ['temporary-works', 'hasTemporaryWorks', 'temporaryWorks'],
  ['traffic', 'hasTrafficManagement', 'trafficManagement'],
  ['high-risk', 'hasHighRiskActivities', 'highRiskActivities'],
] as const) {
  chk(`${k}: unanswered is outstanding`,
    stepStatus(k, snap({})).status !== 'COMPLETE');
  chk(`${k}:   answering NO completes it`,
    stepStatus(k, snap({ [k]: { [flag]: false } })).status === 'COMPLETE');
  chk(`${k}:   answering YES needs the detail`,
    stepStatus(k, snap({ [k]: { [flag]: true } })).status !== 'COMPLETE' &&
      stepStatus(k, snap({ [k]: { [flag]: true, [field]: NARRATIVE } })).status === 'COMPLETE');
}
chk('answering NO clears any detail left behind',
  /v\.hasTemporaryWorks === false \? null : text\(v\.temporaryWorks\)/.test(
    read('services/sites/siteSetupService.ts')),
  'a site that says it has none must not keep a paragraph saying it does');

console.log('\nTHE ONE CONDITION THAT REFUSES TO GENERATE IS NOW CHECKED');
chk('the pipeline still refuses on a risk with no controls',
  /no control measures have been entered/.test(RULES),
  'the condition this whole restructure exists for');
chk('setup counts that shortfall',
  requirementsFor('risks').some(
    (r: { kind: string; of?: string }) => r.kind === 'none' && r.of === 'risksMissingControls'),
);
chk('  and it must be ZERO, not merely present',
  stepStatus('risks', snap({ risks: { reviewed: true } }, { risksMissingControls: 1 }))
    .status !== 'COMPLETE');
chk('  while a reviewed register with every control written passes',
  stepStatus('risks', snap({ risks: { reviewed: true } }, { risksMissingControls: 0 }))
    .status === 'COMPLETE');

console.log('\nA FINISHED SITE IS READY FOR BOTH, AND AN UNFINISHED ONE SAYS WHICH');
const full = snap(
  {
    project: { description: NARRATIVE, scopeOfWorks: NARRATIVE, startDate: '2026-01-05', plannedEndDate: '2026-06-30', cdmNotifiable: false },
    client: { clientName: 'Acme Developments Ltd', clientContactName: 'Jo Patel', clientContactEmail: 'jo@acme.example' },
    'duty-holders': { principalDesigner: 'Beta Design LLP', principalContractor: 'Acme Construction Ltd' },
    emergency: { fireAssemblyPoint: 'Main gate, Bell Street', emergencyProcedures: NARRATIVE, nearestHospital: 'St Marys A&E' },
    welfare: { welfareFacilities: NARRATIVE, workingHours: 'Mon-Fri 07:30-17:00' },
    hazards: { siteHazards: NARRATIVE },
    access: { accessEgress: NARRATIVE },
    utilities: { utilitiesIsolation: NARRATIVE },
    environment: { environmentalControls: NARRATIVE },
    'high-risk': { hasHighRiskActivities: false },
    'temporary-works': { hasTemporaryWorks: false },
    traffic: { hasTrafficManagement: false },
    risks: { reviewed: true },
  },
  { siteManagers: 1, firstAiders: 1, siteRules: 10, ppeItems: 4, risksMissingControls: 0 },
);
const done = computeDerivedCompleteness({}, full, []);
chk('a site that finishes setup is videoReady', done.videoReady === true,
  done.outstanding.map((o: { key: string }) => o.key).join(', ') || 'nothing outstanding');
chk('  and cppReady', done.cppReady === true);
chk('  and reads 100%', done.percent === 100, `${done.percent}%`);

// PPE missing: the video is not ready, the PLAN still is - the plan wires PPE
// from data and deliberately does not gate on it.
const noPpe = computeDerivedCompleteness(
  {}, snap(full.values, { siteManagers: 1, firstAiders: 1, siteRules: 10, ppeItems: 0 }), []);
chk('no PPE means NOT videoReady', noPpe.videoReady === false);
chk('  but the plan is unaffected, as the plan already decided',
  noPpe.cppReady === true,
  'wired sections do not gate the plan; reversing that was not this change to make');

const badRisk = computeDerivedCompleteness(
  {}, snap(full.values, { siteManagers: 1, firstAiders: 1, siteRules: 10, ppeItems: 4, risksMissingControls: 1 }), []);
chk('one uncontrolled risk means NOT videoReady', badRisk.videoReady === false);
chk('  and the outstanding list names the step to open',
  badRisk.outstanding.some((o: { key: string }) => o.key === 'risks'));

const blank = computeDerivedCompleteness({}, snap({}), []);
chk('a blank site is neither', blank.videoReady === false && blank.cppReady === false);

console.log('\nEXISTING SITES ARE NOT RE-ASKED WHAT THEY ALREADY ANSWERED');
const MIG = read(
  'prisma/migrations/20260925140000_add_site_applicability_answers/migration.sql');
// Strip the comments first: the prose here explains that the columns are NOT
// defaulted, and matching the bare word found my own sentence instead of SQL.
const MIG_SQL = MIG.replace(/^\s*--.*$/gm, '');
chk('the columns are nullable and carry no DEFAULT clause',
  /ADD COLUMN IF NOT EXISTS "hasTemporaryWorks"\s+BOOLEAN,/.test(MIG_SQL) &&
    !/\bDEFAULT\b/i.test(MIG_SQL),
  'a default of false would answer "we have none" on every site\'s behalf');
for (const [flag, field] of [
  ['hasTemporaryWorks', 'temporaryWorks'],
  ['hasTrafficManagement', 'trafficManagement'],
  ['hasHighRiskActivities', 'highRiskActivities'],
] as const) {
  chk(`a site that already described its ${field} is backfilled to YES`,
    new RegExp(
      `SET "${flag}" = TRUE\\s+WHERE "${flag}" IS NULL\\s+AND COALESCE\\(TRIM\\("${field}"\\), ''\\) <> ''`,
    ).test(MIG),
    'the old rule WAS "non-empty means it applies" - that is their answer, not a guess');
}
chk('  and TRIM means whitespace is not mistaken for an answer', /TRIM\(/.test(MIG));
chk('  and an existing FALSE is never overwritten', !/SET "has\w+" = TRUE\s+WHERE\s+COALESCE/.test(MIG_SQL),
  'every backfill is guarded by IS NULL');
chk('an empty field is still left unanswered', !/= FALSE/i.test(MIG_SQL),
  '"we have none" and "nobody asked" are indistinguishable in the old data');

console.log('\nBOTH ANSWERS ARE ON THE SCREEN WHERE THE WORK IS DONE');
chk('the wizard shows video readiness', /Ready to generate an induction video/.test(WIZARD));
chk('  and plan readiness beside it', /Ready for a Construction Phase Plan/.test(WIZARD));
chk('neither is a separate screen to go and find',
  !/href=[^>]*induction-video/.test(WIZARD),
  'setup answers "am I finished" itself');

console.log('\nNOTHING WAS DUPLICATED TO ACHIEVE IT');
for (const [what, comp] of [
  ['the risk register', 'SiteRiskRegister'],
  ['the rules editor', 'SiteRulesConfig'],
  ['the PPE editor', 'PpeRequirementsConfig'],
] as const) {
  chk(`${what} is the existing component, hosted`,
    WIZARD.includes(`import { ${comp} }`) && renders(WIZARD, comp));
}
chk('the site-map uploader is shared, not copied',
  read('components/platform/SiteMapUpload.tsx').includes("sites/${siteId}/site-map") &&
    !/const\s+fileRef[\s\S]{0,4000}site-map/.test(WIZARD),
  'one uploader, two surfaces');
chk('every service import in the wizard is TYPE-ONLY',
  (WIZARD.match(/^import .*from '@\/services\//gm) ?? []).every((l: string) =>
    l.startsWith('import type ')),
  'a value import would pull Prisma into the browser bundle and the type checker cannot see it');

console.log(`\n${fails} failed\n`);
process.exit(fails === 0 ? 0 : 1);
