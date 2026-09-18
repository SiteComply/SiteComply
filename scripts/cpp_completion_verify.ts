/**
 * CPP completion — verification.
 *
 *   npx tsx scripts/cpp_completion_verify.ts
 *
 * No database. The completion rules are pure by design, which is the whole
 * reason the wizard and the server can be proven to agree.
 *
 * THE BUG THIS GUARDS: completion used to be a list of ticked step keys that
 * never saw a field value, so a site could report 100% and cppReady with every
 * field blank while the CPP page's own gap list named the missing sections.
 */
import { readFileSync } from 'node:fs';
import {
  computeDerivedCompleteness,
  stepStatus,
  hasSubstance,
  requirementsFor,
  STEPS_WITH_REQUIREMENTS,
  type SetupSnapshot,
} from '../services/sites/siteSetupCompletion';
import { SETUP_STEPS, applicableSteps } from '../services/sites/siteSetupConstants';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const EMPTY_COUNTS = { siteManagers: 0, firstAiders: 0, siteRules: 0 };
const snap = (
  values: SetupSnapshot['values'],
  counts: Partial<SetupSnapshot['counts']> = {},
): SetupSnapshot => ({ values, counts: { ...EMPTY_COUNTS, ...counts } });

const NARRATIVE = 'Full demolition of the existing single-storey rear extension.';

function main() {
  console.log('== CPP COMPLETION ==\n');

  // -----------------------------------------------------------------------
  console.log('[1] The original bug cannot recur');
  // -----------------------------------------------------------------------
  const blank = snap({});
  const allTicked = SETUP_STEPS.map((s) => s.key);
  const c = computeDerivedCompleteness({}, blank, allTicked);
  chk('[1] ticking every step with NO data gives 0%', c.percent === 0, `${c.percent}%`);
  chk('[1]   and cppReady is false', c.cppReady === false);
  chk('[1]   and every required section is outstanding', c.outstanding.length > 0, `${c.outstanding.length}`);
  chk('[1] the ticks are still visible as "reviewed"', c.reviewed.length > 0);
  chk('[1]   and are reported as reviewed-but-incomplete',
    c.reviewedButIncomplete.length === c.outstanding.length,
    `${c.reviewedButIncomplete.length} vs ${c.outstanding.length}`);
  // The guard's own control: a genuinely complete site must reach 100%.
  const full = snap({
    project: { description: NARRATIVE, scopeOfWorks: NARRATIVE, startDate: '2026-01-05', plannedEndDate: '2026-06-30', cdmNotifiable: false },
    client: { clientName: 'Acme Developments Ltd', clientContactName: 'Jo Patel', clientContactEmail: 'jo@acme.example' },
    'duty-holders': { principalDesigner: 'Beta Design LLP', principalContractor: 'Acme Construction Ltd' },
    emergency: { fireAssemblyPoint: 'Main gate, Bell Street', emergencyProcedures: NARRATIVE, nearestHospital: 'St Marys A&E, Paddington' },
    welfare: { welfareFacilities: NARRATIVE, workingHours: 'Mon-Fri 07:30-17:00' },
    hazards: { siteHazards: NARRATIVE },
    access: { accessEgress: NARRATIVE },
    utilities: { utilitiesIsolation: NARRATIVE },
    environment: { environmentalControls: NARRATIVE },
  }, { siteManagers: 1, firstAiders: 1, siteRules: 10 });
  const cf = computeDerivedCompleteness({}, full, []);
  chk('[1] CONTROL — a genuinely complete site reaches 100%', cf.percent === 100,
    `${cf.percent}% (outstanding: ${cf.outstanding.map((o) => o.key).join(', ') || 'none'})`);
  chk('[1]   and is cppReady with nothing reviewed', cf.cppReady === true && cf.reviewed.length === 0);

  // -----------------------------------------------------------------------
  console.log('\n[2] Empty / Partial / Complete');
  // -----------------------------------------------------------------------
  chk('[2] nothing recorded is EMPTY',
    stepStatus('welfare', snap({})).status === 'EMPTY');
  chk('[2] some but not all required is PARTIAL',
    stepStatus('welfare', snap({ welfare: { welfareFacilities: NARRATIVE } })).status === 'PARTIAL');
  chk('[2] all required is COMPLETE',
    stepStatus('welfare', snap({ welfare: { welfareFacilities: NARRATIVE, workingHours: 'Mon-Fri 07:30-17:00' } })).status === 'COMPLETE');
  chk('[2] PARTIAL names what is missing',
    stepStatus('welfare', snap({ welfare: { welfareFacilities: NARRATIVE } })).missing.join() === 'Working hours');
  chk('[2] a step with no requirements is never a gap',
    stepStatus('drawings', snap({})).status === 'COMPLETE' && requirementsFor('drawings').length === 0);
  chk('[2]   but is NOT counted as a free mark',
    stepStatus('drawings', snap({})).measurable === false);
  chk('[2]   and no such step is cppRequired — it could not inflate cppReady',
    SETUP_STEPS.filter((s) => requirementsFor(s.key).length === 0).every((s) => !s.cppRequired),
    SETUP_STEPS.filter((s) => requirementsFor(s.key).length === 0).map((s) => s.key).join(', '));

  // -----------------------------------------------------------------------
  console.log('\n[3] Substance, not presence');
  // -----------------------------------------------------------------------
  chk('[3] a real answer passes', hasSubstance(NARRATIVE));
  chk('[3] blank fails', !hasSubstance('') && !hasSubstance('   '));
  chk('[3] a single character fails', !hasSubstance('x'));
  for (const p of ['TBC', 'tbc', 'n/a', 'N/A', 'none', 'nil', 'todo', '-', '?', 'unknown']) {
    chk(`[3] placeholder "${p}" fails`, !hasSubstance(p));
  }
  // The rule is WHOLE-VALUE. A real answer that happens to contain "TBC" is an
  // answer, and rejecting it would train people to write worse ones.
  chk('[3] a real answer CONTAINING a placeholder word passes',
    hasSubstance('Access via Gate 2; final crane position TBC with the PD.'));
  chk('[3] short structured values are not held to the narrative floor',
    stepStatus('client', snap({ client: { clientName: 'BT plc', clientContactName: 'Jo Ng', clientContactPhone: '02079460000' } })).status === 'COMPLETE');
  chk('[3] terse but legitimate working hours pass',
    stepStatus('welfare', snap({ welfare: { welfareFacilities: NARRATIVE, workingHours: 'Mon-Fri 07:30-17:00' } })).status === 'COMPLETE');

  // -----------------------------------------------------------------------
  console.log('\n[4] The rules section uses the LIBRARY, not the free text');
  // -----------------------------------------------------------------------
  chk('[4] free text alone does NOT complete the rules section',
    stepStatus('rules', snap({ rules: { siteRules: NARRATIVE } })).status === 'EMPTY');
  chk('[4] one published library rule does',
    stepStatus('rules', snap({}, { siteRules: 1 })).status === 'COMPLETE');
  chk('[4]   and zero rules with free text is still outstanding',
    stepStatus('rules', snap({ rules: { siteRules: NARRATIVE } }, { siteRules: 0 })).missing.length === 1);

  // -----------------------------------------------------------------------
  console.log('\n[5] Personnel');
  // -----------------------------------------------------------------------
  chk('[5] no personnel is EMPTY', stepStatus('people', snap({})).status === 'EMPTY');
  chk('[5] a site manager alone is PARTIAL — a first aider is required',
    stepStatus('people', snap({}, { siteManagers: 1 })).status === 'PARTIAL');
  chk('[5] a first aider alone is PARTIAL',
    stepStatus('people', snap({}, { firstAiders: 1 })).status === 'PARTIAL');
  chk('[5] one of each is COMPLETE',
    stepStatus('people', snap({}, { siteManagers: 1, firstAiders: 1 })).status === 'COMPLETE');

  // -----------------------------------------------------------------------
  console.log('\n[6] Dates and either/or');
  // -----------------------------------------------------------------------
  const proj = (o: Record<string, unknown>) => stepStatus('project', snap({ project: o }));
  chk('[6] a malformed date does not count',
    proj({ description: NARRATIVE, scopeOfWorks: NARRATIVE, startDate: '05/01/2026', plannedEndDate: '2026-06-30', cdmNotifiable: true }).missing.includes('Start date'));
  chk('[6] cdmNotifiable=false IS an answer',
    !proj({ description: NARRATIVE, scopeOfWorks: NARRATIVE, startDate: '2026-01-05', plannedEndDate: '2026-06-30', cdmNotifiable: false }).missing.includes('CDM notifiable answered'));
  chk('[6] cdmNotifiable unanswered is NOT',
    proj({ description: NARRATIVE, scopeOfWorks: NARRATIVE, startDate: '2026-01-05', plannedEndDate: '2026-06-30', cdmNotifiable: null }).missing.includes('CDM notifiable answered'));
  chk('[6] client email OR phone satisfies the contact requirement',
    stepStatus('client', snap({ client: { clientName: 'Acme Ltd', clientContactName: 'Jo Patel', clientContactPhone: '02079460000' } })).status === 'COMPLETE' &&
    stepStatus('client', snap({ client: { clientName: 'Acme Ltd', clientContactName: 'Jo Patel', clientContactEmail: 'jo@acme.example' } })).status === 'COMPLETE');
  chk('[6]   but neither does not',
    stepStatus('client', snap({ client: { clientName: 'Acme Ltd', clientContactName: 'Jo Patel' } })).status === 'PARTIAL');

  // -----------------------------------------------------------------------
  console.log('\n[7] Percent counts COMPLETE only');
  // -----------------------------------------------------------------------
  const half = computeDerivedCompleteness({}, snap({ welfare: { welfareFacilities: NARRATIVE } }), []);
  const none = computeDerivedCompleteness({}, snap({}), []);
  chk('[7] a PARTIAL section earns no part-credit', half.percent === none.percent,
    `${half.percent}% vs ${none.percent}%`);
  chk('[7]   but it is visibly PARTIAL, not EMPTY',
    half.outstanding.find((o) => o.key === 'welfare')?.status === 'PARTIAL');

  // -----------------------------------------------------------------------
  console.log('\n[8] Conditional steps are not gaps');
  // -----------------------------------------------------------------------
  const off = computeDerivedCompleteness({}, snap({}), []);
  const on = computeDerivedCompleteness({ hasTemporaryWorks: true }, snap({}), []);
  chk('[8] temporary works is not counted when the flag is off',
    !off.outstanding.some((o) => o.key === 'temporary-works'));
  chk('[8]   and IS counted when it is on',
    on.outstanding.some((o) => o.key === 'temporary-works'));
  chk('[8] applicable tracks the flag', on.applicable > off.applicable);

  // -----------------------------------------------------------------------
  console.log('\n[9] The wizard and the server cannot drift');
  // -----------------------------------------------------------------------
  // THE ONE REAL RISK. The wizard evaluates values[stepKey][fieldName] from its
  // own form state; the server rebuilds that shape in buildSetupSnapshot. A
  // field name in one and not the other would be permanently unsatisfiable on
  // one side while green on the other — silently, and only for that field.
  const svc = readFileSync('services/sites/siteSetupService.ts', 'utf8');
  const wiz = readFileSync('components/platform/SiteSetupWizard.tsx', 'utf8');
  const snapBlock = svc.slice(svc.indexOf('export function buildSetupSnapshot'), svc.indexOf('export async function completenessFor'));
  let missingInServer: string[] = [];
  let missingInWizard: string[] = [];
  for (const key of STEPS_WITH_REQUIREMENTS) {
    for (const r of requirementsFor(key)) {
      const fields = r.kind === 'either' ? r.fields : r.kind === 'count' ? [] : [r.field];
      for (const f of fields) {
        if (!new RegExp(`\\b${f}\\b`).test(snapBlock)) missingInServer.push(`${key}.${f}`);
        if (!new RegExp(`name: '${f}'`).test(wiz)) missingInWizard.push(`${key}.${f}`);
      }
    }
  }
  chk('[9] every required field is mapped in buildSetupSnapshot',
    missingInServer.length === 0, missingInServer.join(', '));
  chk('[9] every required field exists as a wizard input',
    missingInWizard.length === 0, missingInWizard.join(', '));
  // Control: prove those regexes can fail, so a passing run means something.
  chk('[9] CONTROL — an invented field is caught by both checks',
    !/\bnotAFieldAtAll\b/.test(snapBlock) && !/name: 'notAFieldAtAll'/.test(wiz));
  chk('[9] the counts the wizard sends match the ones requirements read',
    /siteManagers:/.test(wiz) && /firstAiders:/.test(wiz) && /siteRules: siteRuleCount/.test(wiz));

  // -----------------------------------------------------------------------
  console.log('\n[10] The old model is gone, and the screens agree');
  // -----------------------------------------------------------------------
  const consts = readFileSync('services/sites/siteSetupConstants.ts', 'utf8');
  chk('[10] the tick-based computeCompleteness is deleted',
    !/export function computeCompleteness/.test(consts));
  chk('[10]   and nothing imports it', !/computeCompleteness/.test(wiz));
  chk('[10] the API no longer speaks of marking complete',
    !/markComplete/.test(readFileSync('app/api/platform/sites/[id]/setup/route.ts', 'utf8')));
  chk('[10] the wizard button says reviewed, not complete',
    /Save and mark reviewed/.test(wiz) && !/Save and mark complete/.test(wiz));
  chk('[10] the recalculation is explained to the user',
    /Completion is now based on the information recorded/.test(wiz));
  const cppSvc = readFileSync('services/sites/cppService.ts', 'utf8');
  const cppPage = readFileSync('app/platform/dashboard/sites/[id]/cpp/page.tsx', 'utf8');
  chk('[10] the CPP takes its section status from the shared computation',
    /completeness\.statuses\[s\.stepKey\]/.test(cppSvc));
  chk('[10]   and no longer computes `empty` for itself', !/empty: entries\.every/.test(cppSvc));
  chk('[10]   and isRelevant is gone — applicableSteps owns that', !/function isRelevant/.test(cppSvc));
  chk('[10] the printed status and the gap list share one source',
    /cpp\.outstanding\.length/.test(cppPage) && !/outstandingTitles/.test(cppPage));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
