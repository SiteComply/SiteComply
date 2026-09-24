/**
 * Company induction modules, Phase B — how they reach a site's induction.
 *
 * THE PROPERTIES THAT MATTER:
 *  - module words are NEVER sent to the model, and are used verbatim;
 *  - the company band sits after the project's own content and before the
 *    site rules, PPE and the close;
 *  - when a project records its own arrangement, the module is left out — the
 *    operative is never told the same thing twice;
 *  - issuing a revision makes every affected video read as out of date;
 *  - a module scene is not a site's to edit or remove.
 *
 * Run: npx tsx scripts/induction_modules_phaseb_verify.ts
 */
import { readFileSync } from 'fs';
import {
  buildSceneManifest,
  manifestHash,
  type ResolvedModuleScene,
  type VideoSource,
} from '../services/inductionVideo/sceneRules';

let pass = 0;
const failures: string[] = [];
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

const mod = (over: Partial<ResolvedModuleScene> = {}): ResolvedModuleScene => ({
  moduleId: 'm1', slug: 'MANUAL_HANDLING', title: 'Manual handling', order: 50,
  revisionId: 'rev-1', version: 1,
  heading: 'Lifting and carrying',
  narration: 'Before you lift anything, ask whether it needs to be lifted by hand at all.',
  replacesSceneType: null, overridden: false, overrideReason: null,
  ...over,
});

const base = (over: Partial<VideoSource> = {}): VideoSource => ({
  siteId: 's1', siteName: 'Dorchester Road', address: '72 Dorchester Road', jobReference: 'DR-1',
  inductionNotes: null, project: null, duty: null, siteManager: null,
  emergency: {
    fireAssemblyPoint: 'Rear car park', firstAiderName: 'Fay Aid', firstAiderNumber: null,
    firstAiderLocation: 'Site office', nearestHospital: null, emergencyNumber: null,
  },
  keyPeople: [],
  info: { ...EMPTY_INFO, emergencyProcedures: 'Stop work, make safe, go to the assembly point.' },
  incidentReporting: null, risks: [], permitTypes: [], ramsDocuments: [],
  siteRules: ['Wear your hard hat at all times.'], ppe: ['Hard hat'],
  modules: [],
  ...over,
});
const types = (m: ReturnType<typeof buildSceneManifest>) => m.scenes.map((s) => s.sceneType);

function main() {
  console.log('== INDUCTION MODULES — PHASE B ==\n');

  console.log('[1] A site with no modules is exactly as it was');
  const plain = buildSceneManifest(base());
  ok('no company scenes appear', !types(plain).includes('COMPANY_MODULE'));
  ok('  and the induction still generates', plain.canGenerate === true);

  console.log('\n[2] Where the company band sits');
  const withModules = buildSceneManifest(base({
    modules: [mod(), mod({ moduleId: 'm2', slug: 'PPE_EXPECTATIONS', title: 'PPE expectations', order: 10, revisionId: 'rev-2', heading: 'What we expect of your PPE', narration: 'Wear it from the moment you enter the working area.' })],
  }));
  const order = types(withModules);
  const firstModule = order.indexOf('COMPANY_MODULE');
  ok('company modules appear', firstModule >= 0);
  ok('  after the project’s own emergency content',
    order.indexOf('EMERGENCY_PROCEDURES') < firstModule, order.join(' → '));
  ok('  and before the site rules, PPE and the close',
    firstModule < order.indexOf('SITE_RULES') &&
      firstModule < order.indexOf('PPE') &&
      firstModule < order.indexOf('CLOSING'), order.join(' → '));
  const moduleScenes = withModules.scenes.filter((s) => s.sceneType === 'COMPANY_MODULE');
  ok('  ordered within the band by the module’s own order, not by chance',
    moduleScenes[0]!.heading === 'What we expect of your PPE',
    moduleScenes.map((m) => m.heading));

  console.log('\n[3] The words are the Director’s, verbatim');
  ok('the narration is carried on the scene, already written',
    moduleScenes[0]!.narration === 'Wear it from the moment you enter the working area.');
  ok('  it has no facts for a model to turn into prose', moduleScenes[0]!.facts.length === 0);
  ok('  and it is marked as coming from a module, not the site',
    moduleScenes.every((m) => m.source === 'MODULE' && Boolean(m.moduleRevisionId)));
  ok('a module scene is required — a site may not drop it from the script',
    moduleScenes.every((m) => m.required));

  const script = read('services/inductionVideo/scriptService.ts');
  ok('the model is sent SITE scenes only',
    /filter\(\(s\) => s\.source === 'SITE'\)/.test(script));
  ok('  and a module’s words are used verbatim, never regenerated',
    /scene\.source === 'MODULE'[\s\S]{0,120}scene\.narration/.test(script));

  console.log('\n[4] Nobody is told the same thing twice');
  const overlapping = mod({
    moduleId: 'm3', slug: 'ACCIDENT_REPORTING', title: 'Accident and near-miss reporting',
    order: 30, revisionId: 'rev-3', replacesSceneType: 'INCIDENT_REPORTING',
    heading: 'Reporting accidents and near misses',
    narration: 'Report every accident on the day it happens, and report near misses too.',
  });
  const noSiteArrangement = buildSceneManifest(base({ modules: [overlapping] }));
  ok('with no arrangement of its own, the project gets the company module',
    types(noSiteArrangement).includes('COMPANY_MODULE'));

  const hasSiteArrangement = buildSceneManifest(base({
    modules: [overlapping],
    incidentReporting: 'Report everything to Sam Manager the same day, on the form in the cabin.',
  }));
  ok('when the project records its OWN arrangement, the module is left out',
    !types(hasSiteArrangement).includes('COMPANY_MODULE'),
    types(hasSiteArrangement).join(' → '));
  ok('  and the site’s own words are what is said',
    types(hasSiteArrangement).includes('INCIDENT_REPORTING'));
  ok('  with the manager told which module was dropped, and why',
    hasSiteArrangement.warnings.some((w) => /left out/i.test(w) && /Accident/i.test(w)),
    hasSiteArrangement.warnings);

  console.log('\n[5] A departure from the standard is visible');
  const overridden = buildSceneManifest(base({
    modules: [mod({ overridden: true, overrideReason: 'Client requires cut-resistant gloves.', narration: 'On this site you must also wear cut-resistant gloves.' })],
  }));
  ok('the overridden words are the ones used',
    overridden.scenes.find((s) => s.sceneType === 'COMPANY_MODULE')!.narration ===
      'On this site you must also wear cut-resistant gloves.');
  ok('  the scene is flagged as a departure',
    overridden.scenes.find((s) => s.sceneType === 'COMPANY_MODULE')!.overridden === true);
  ok('  and the manager is told, with the reason',
    overridden.warnings.some((w) => /no longer matches the company standard/i.test(w) && /gloves/i.test(w)),
    overridden.warnings);

  console.log('\n[6] Issuing a revision makes every video read as out of date');
  const v1 = buildSceneManifest(base({ modules: [mod({ revisionId: 'rev-1' })] }));
  const v2 = buildSceneManifest(base({
    modules: [mod({ revisionId: 'rev-2', narration: 'Use a trolley where one is available. Get help with anything awkward.' })],
  }));
  ok('a new revision changes the fingerprint', manifestHash(v1) !== manifestHash(v2));
  ok('  while the same revision keeps it stable',
    manifestHash(v1) === manifestHash(buildSceneManifest(base({ modules: [mod({ revisionId: 'rev-1' })] }))));
  ok('  and a site with no modules is unaffected either way',
    manifestHash(buildSceneManifest(base())) === manifestHash(buildSceneManifest(base())));

  console.log('\n[7] A module is not a site’s to rewrite');
  const svc = read('services/inductionVideo/inductionVideoService.ts');
  ok('editing a module scene is refused, and says where to go instead',
    /scene\.moduleRevisionId[\s\S]{0,300}managed centrally[\s\S]{0,200}override/.test(svc));
  ok('removing one is refused, and says where to go instead',
    /scene\.moduleRevisionId[\s\S]{0,300}exclude the module/.test(svc));
  ok('the revision is stored on the scene, so what was heard stays answerable',
    /moduleRevisionId: s\.moduleRevisionId/.test(svc));
  const editor = read('components/platform/ScriptEditor.tsx');
  ok('the editor shows it read-only, not editable-then-refused',
    /readOnly=\{readOnly \|\| scene\.companyModule\}/.test(editor));
  ok('  labelled as the company standard', /Company standard/.test(editor));
  ok('  and a departure is labelled as one', /changed here/.test(editor));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
main();
