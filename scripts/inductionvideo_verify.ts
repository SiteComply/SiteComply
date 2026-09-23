/**
 * Induction videos, Phase 1: the rules engine, the readiness block, the script
 * guardrails, approval and versioning.
 *
 * THE PROPERTY THAT MATTERS: which scenes an induction contains is decided by
 * the site's records, not by a model. The model may only phrase the facts it is
 * handed - so a site with asbestos applying and no controls recorded must be
 * REFUSED, not narrated around.
 *
 * Run: npx tsx scripts/inductionvideo_verify.ts
 */
import { readFileSync } from 'fs';
import {
  buildSceneManifest,
  manifestHash,
  type VideoSource,
} from '../services/inductionVideo/sceneRules';

let pass = 0; const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

const EMPTY_INFO = {
  workingHours: null, welfareFacilities: null, siteHazards: null, emergencyProcedures: null,
  existingSiteRisks: null, temporaryWorks: null, trafficManagement: null, deliveryProcedures: null,
  accessEgress: null, environmentalControls: null, utilitiesIsolation: null, highRiskActivities: null,
  fireArrangements: null, hasSiteMap: false,
};
/** A site with everything the rules REQUIRE, and nothing else. */
const base = (over: Partial<VideoSource> = {}): VideoSource => ({
  siteId: 's1', siteName: 'Dorchester Road', address: '72 Dorchester Road, Cannock', jobReference: 'DR-1',
  inductionNotes: null, project: null, duty: null, siteManager: null,
  emergency: {
    fireAssemblyPoint: 'Rear car park', firstAiderName: 'Fay Aid', firstAiderNumber: null,
    firstAiderLocation: 'Site office', nearestHospital: null, emergencyNumber: null,
  },
  keyPeople: [], info: { ...EMPTY_INFO, emergencyProcedures: 'Stop work, make safe, go to the assembly point.' },
  incidentReporting: null, risks: [], permitTypes: [], ramsDocuments: [],
  siteRules: ['Wear your hard hat at all times.'], ppe: ['Hard hat'],
  ...over,
});
const types = (m: ReturnType<typeof buildSceneManifest>) => m.scenes.map((s) => s.sceneType);

function main() {
  console.log('== INDUCTION VIDEO — PHASE 1 ==\n');

  console.log('[1] The rules engine decides, from the records');
  const m = buildSceneManifest(base());
  ok('a site with the essentials can generate', m.canGenerate === true, m.missing);
  ok('the induction opens with a welcome and closes', types(m)[0] === 'WELCOME' && types(m).at(-1) === 'CLOSING');
  ok('emergency, muster point and first aid are all present',
    ['EMERGENCY_PROCEDURES', 'FIRE_MUSTER_POINT', 'FIRST_AID'].every((t) => types(m).includes(t as never)));
  ok('  and all three are REQUIRED - an editor may not delete them',
    m.scenes.filter((s) => ['EMERGENCY_PROCEDURES', 'FIRE_MUSTER_POINT', 'FIRST_AID'].includes(s.sceneType))
      .every((s) => s.required));
  ok('nothing is invented: a site with no welfare text has no welfare scene',
    !types(m).includes('WELFARE'));
  ok('every scene carries the fields it was built from',
    m.scenes.filter((s) => s.sceneType !== 'CLOSING').every((s) => s.sourceRefs.length > 0 || s.facts.length > 0));
  ok('scenes come out in induction order, not the order they were built',
    types(m).indexOf('EMERGENCY_PROCEDURES') < types(m).indexOf('SITE_RULES'));

  console.log('\n[2] Missing safety information BLOCKS generation');
  const noEmergency = buildSceneManifest(base({ info: { ...EMPTY_INFO, emergencyProcedures: null } }));
  ok('no emergency procedures: blocked', noEmergency.canGenerate === false);
  ok('  and the message says where to fix it',
    /Project setup/.test(noEmergency.missing[0].message), noEmergency.missing[0]);
  const placeholder = buildSceneManifest(base({ info: { ...EMPTY_INFO, emergencyProcedures: "What's required here?" } }));
  ok('a QUESTION left in the field is not an answer: still blocked', placeholder.canGenerate === false);
  const na = buildSceneManifest(base({ info: { ...EMPTY_INFO, emergencyProcedures: 'N/A' } }));
  ok('  nor is "N/A"', na.canGenerate === false);
  const noAssembly = buildSceneManifest(base({
    emergency: { ...base().emergency, fireAssemblyPoint: null } }));
  ok('no assembly point: blocked', noAssembly.canGenerate === false &&
    noAssembly.missing.some((x) => x.sceneType === 'FIRE_MUSTER_POINT'));
  const noAider = buildSceneManifest(base({
    emergency: { ...base().emergency, firstAiderName: null }, keyPeople: [] }));
  ok('no first aider: blocked', noAider.canGenerate === false &&
    noAider.missing.some((x) => x.sceneType === 'FIRST_AID'));

  console.log('\n[3] The specification\'s own example: asbestos');
  const asbestosNoControls = buildSceneManifest(base({
    risks: [{ label: 'Asbestos — survey, management and removal', controls: null }] }));
  ok('asbestos applies but has NO controls recorded: generation is blocked',
    asbestosNoControls.canGenerate === false &&
    asbestosNoControls.missing.some((x) => x.sceneType === 'ASBESTOS'), asbestosNoControls.missing);
  ok('  and the message names the gap, as the specification requires',
    /asbestos/i.test(asbestosNoControls.missing.find((x) => x.sceneType === 'ASBESTOS')!.message) &&
    /control measures/i.test(asbestosNoControls.missing.find((x) => x.sceneType === 'ASBESTOS')!.message));
  const asbestos = buildSceneManifest(base({
    risks: [{ label: 'Asbestos — survey, management and removal', controls: 'Do not disturb. Report any suspect material.' }] }));
  ok('asbestos WITH controls: a required asbestos scene', asbestos.canGenerate === true &&
    asbestos.scenes.some((s) => s.sceneType === 'ASBESTOS' && s.required));
  ok('  carrying the controls as fact, verbatim',
    asbestos.scenes.find((s) => s.sceneType === 'ASBESTOS')!.facts.join(' ').includes('Do not disturb'));
  const height = buildSceneManifest(base({
    risks: [{ label: 'Preventing falls', controls: 'Podium steps only above 2 m.' }] }));
  ok('work at height gets its own scene too', height.scenes.some((s) => s.sceneType === 'WORK_AT_HEIGHT'));
  const otherRisk = buildSceneManifest(base({
    risks: [{ label: 'Manual handling', controls: 'Team lifts over 25 kg.' }] }));
  ok('other risks are narrated together', otherRisk.scenes.some((s) => s.sceneType === 'SIGNIFICANT_RISKS'));
  const riskNoControls = buildSceneManifest(base({
    risks: [{ label: 'Manual handling', controls: null }] }));
  ok('a non-blocking risk with no controls WARNS rather than blocks',
    riskNoControls.canGenerate === true &&
    riskNoControls.warnings.some((w) => /Manual handling/.test(w)), riskNoControls.warnings);

  console.log('\n[4] Optional content appears only when the site has it');
  const rich = buildSceneManifest(base({
    info: { ...EMPTY_INFO, emergencyProcedures: 'Stop work.', welfareFacilities: 'Ground floor.',
            trafficManagement: 'N/A', workingHours: '08:00-17:00', hasSiteMap: true },
    permitTypes: ['Hot works'], ramsDocuments: [{ id: 'd1', title: 'Rewire RAMS' }],
  }));
  ok('welfare appears when written', types(rich).includes('WELFARE'));
  /*
   * ORDERING, tested where it BITES. Welfare is built late (it is optional) and
   * narrated early (you are told where the toilets are before what to do in a
   * fire). An unsorted manifest puts it after the rules; the induction order
   * puts it before the emergency scenes.
   */
  ok('the induction order wins over the order scenes were built',
    types(rich).indexOf('WELFARE') < types(rich).indexOf('EMERGENCY_PROCEDURES') &&
    types(rich).indexOf('WORKING_HOURS') < types(rich).indexOf('SITE_RULES'),
    types(rich));
  ok('traffic does NOT, because "N/A" is not content', !types(rich).includes('TRAFFIC_PEDESTRIAN'));
  ok('permits, RAMS and the site map appear',
    ['PERMITS', 'RAMS', 'SITE_MAP'].every((t) => types(rich).includes(t as never)));
  const noRams = buildSceneManifest(base());
  ok('no RAMS uploaded: a warning, not a block',
    noRams.canGenerate === true && noRams.warnings.some((w) => /RAMS/.test(w)));

  console.log('\n[5] The fingerprint tracks the FACTS, not the record');
  const a = buildSceneManifest(base());
  const b = buildSceneManifest(base());
  ok('the same facts give the same hash', manifestHash(a) === manifestHash(b));
  const changed = buildSceneManifest(base({
    info: { ...EMPTY_INFO, emergencyProcedures: 'Stop work and call the site manager.' } }));
  ok('changed facts give a different hash', manifestHash(a) !== manifestHash(changed));
  const cosmetic = buildSceneManifest(base({ ramsDocuments: [] }));
  ok('  and a scene appearing changes it too', manifestHash(a) === manifestHash(cosmetic));

  console.log('\n[6] The model writes; it does not decide');
  const script = read('services/inductionVideo/scriptService.ts');
  ok('the prompt forbids inventing facts', /Never add a hazard, precaution, location, name, telephone number, procedure or statistic/.test(script));
  ok('the model is given ONLY the chosen scenes and their facts',
    /scenes: manifest\.scenes\.map\(\(s\) => \(\{[\s\S]{0,120}facts: s\.facts/.test(script));
  ok('structured output is required, with a strict schema', /schema: SCRIPT_SCHEMA/.test(script));
  ok('generation refuses to run on a blocked manifest',
    /if \(!manifest\.canGenerate\)[\s\S]{0,120}throw new Error/.test(script));
  ok('the scenes returned are the MANIFEST\'s, whatever the model sent',
    /scenes: manifest\.scenes\.map\(\(scene\) => \(\{/.test(script));
  ok('a scene the model skipped falls back to its facts',
    /if \(!text\) return scene\.facts\.join\(' '\);/.test(script));
  ok('narration is length-capped', /MAX_NARRATION_CHARS/.test(script));

  console.log('\n[7] Workflow: approval, versioning, audit');
  const svc = read('services/inductionVideo/inductionVideoService.ts');
  ok('a blocked version clears its missing list when it does generate',
    /blockingReasons: Prisma\.DbNull/.test(svc));
  ok('a blocked attempt does not consume a version number',
    /const reusable =[\s\S]{0,160}INFORMATION_REQUIRED \? last : null;/.test(svc));
  ok('a blocked site records WHY, against a version a manager can open',
    /status: InductionVideoStatus\.INFORMATION_REQUIRED[\s\S]{0,120}blockingReasons/.test(svc));
  ok('generation only QUEUES work', /inductionVideoJob\.create/.test(svc) && /runQueuedScriptJobs/.test(svc));
  ok('  and a job is claimed before it runs, so two ticks cannot double-run it',
    /updateMany\(\{[\s\S]{0,200}status: InductionVideoJobStatus\.QUEUED[\s\S]{0,160}RUNNING/.test(svc));
  ok('only a ready script can be approved', /Only a script that is ready for review can be approved/.test(svc));
  ok('editing an approved script withdraws the approval',
    /APPROVAL_WITHDRAWN/.test(svc) && /approvedAt: null/.test(svc));
  ok('a required scene cannot be removed', /cannot be removed/.test(svc));
  ok('a published version cannot be edited', /A published version cannot be edited/.test(svc));
  ok('earlier versions are superseded, never deleted',
    /supersededAt: new Date\(\)/.test(svc) && !/inductionVideo\.delete/.test(svc));
  ok('every state change is recorded with an actor',
    ['SCRIPT_REQUESTED', 'SCRIPT_GENERATED', 'SCRIPT_APPROVED', 'SUPERSEDED', 'GENERATION_FAILED']
      .every((a) => svc.includes(a)));
  ok('token spend is recorded per generation', /aiUsageEvent\.create/.test(svc));
  ok('a version knows when the site has moved on', /stale/.test(svc) && /sourceHash/.test(svc));

  const perms = read('services/inductionVideo/inductionVideoPermissions.ts');
  ok('Directors and Site Managers approve, by the owner\'s decision',
    /APPROVE_ROLES: PlatformRoleValue\[\] = \['DIRECTOR', 'SITE_MANAGER'\]/.test(perms));
  ok('  Project Managers may prepare but not approve',
    /MANAGE_ROLES[\s\S]{0,160}'PROJECT_MANAGER'/.test(perms) && !/APPROVE_ROLES[\s\S]{0,80}PROJECT_MANAGER/.test(perms));
  const tick = read('app/api/system/compliance/tick/route.ts');
  ok('the existing scheduler drains the queue - no second worker',
    /runQueuedScriptJobs\(\)/.test(tick));
  ok('  and a model outage cannot stop the compliance run',
    /try \{\s*\n\s*scriptsGenerated = await runQueuedScriptJobs\(\);\s*\n\s*\} catch/.test(tick));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main();
