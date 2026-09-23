/**
 * The induction site briefing: operatives are shown the site's information
 * BEFORE they confirm they have received it.
 *
 * Covers the pure composition (what appears, what never appears, the order),
 * where the screens sit in the flow, and the two routes that serve the site map
 * and RAMS before check-in - including who they refuse.
 *
 * Run: npx tsx scripts/induction_briefing_verify.ts
 */
import { readFileSync } from 'fs';
import {
  composeBriefing,
  type BriefingSource,
} from '../services/induction/inductionBriefing';
import {
  buildInductionSteps,
  isStepComplete,
  type FlowItem,
} from '../services/checklists/inductionFlow';

let pass = 0; const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};

const EMPTY_INFO = {
  workingHours: null, welfareFacilities: null, siteHazards: null, emergencyProcedures: null,
  existingSiteRisks: null, temporaryWorks: null, trafficManagement: null, deliveryProcedures: null,
  accessEgress: null, environmentalControls: null, utilitiesIsolation: null, highRiskActivities: null,
  fireArrangements: null, hasSiteMap: false,
};
const base = (over: Partial<BriefingSource> = {}): BriefingSource => ({
  siteId: 'site1', siteName: 'Dorchester Road', address: '72 Dorchester Road, Oldham', jobReference: 'DR-1',
  inductionNotes: null, project: null, duty: null, siteManager: null,
  emergency: { fireAssemblyPoint: null, firstAiderName: null, firstAiderNumber: null, firstAiderLocation: null,
               nearestHospital: null, emergencyNumber: null },
  keyPeople: [], info: EMPTY_INFO, incidentReporting: null, risks: [], permitTypes: [], ramsDocuments: [],
  ...over,
});
type Screens = ReturnType<typeof composeBriefing>;
const allBlocks = (x: Screens[number]) => x.sections.flatMap((sec) => sec.blocks);
/** Block keys in the group `key`, wherever condensing put it. */
const blocks = (s: Screens, key: string) =>
  s.flatMap((x) => x.sections).find((sec) => sec.key === key)?.blocks.map((b) => b.key) ?? [];

async function main() {
  console.log('== INDUCTION SITE BRIEFING ==\n');

  console.log('[1] Nothing to brief, nothing shown');
  ok('a site with no briefing content has NO briefing screens', composeBriefing(base()).length === 0,
     composeBriefing(base()));
  ok('  - name, address and reference alone are not a briefing (the previous page said them)',
     composeBriefing(base()).every((s) => s.key !== 'site'));
  ok('whitespace is not content',
     composeBriefing(base({ info: { ...EMPTY_INFO, siteHazards: '   \n ' } })).length === 0);

  console.log('\n[2] Each screen appears only with its own content');
  const hazardsOnly = composeBriefing(base({ info: { ...EMPTY_INFO, siteHazards: 'Live cables in the loft.' } }));
  ok('site hazards alone produce only the hazards screen',
     hazardsOnly.length === 1 && hazardsOnly[0].key === 'hazards', hazardsOnly.map((s) => s.key));

  const full = composeBriefing(base({
    inductionNotes: 'Residential site.',
    project: { description: 'Rewire of 72 Dorchester Road.', scopeOfWorks: 'Full rewire.' },
    duty: { principalContractor: 'RS Electrical', client: null },
    siteManager: { name: 'Sam Manager', phone: '07700 900000' },
    emergency: { fireAssemblyPoint: 'Rear car park', firstAiderName: 'Fay Aid', firstAiderNumber: '07700 900001',
                 firstAiderLocation: 'Site office', nearestHospital: 'Royal Oldham', emergencyNumber: '999' },
    keyPeople: [
      { kind: 'FIRST_AIDER', name: 'fay aid', phone: null, location: null },
      { kind: 'FIRE_MARSHAL', name: 'Mo Marshal', phone: '07700 900002', location: null },
    ],
    info: { ...EMPTY_INFO, workingHours: '08:00-17:00', welfareFacilities: 'Ground floor.', siteHazards: 'Public in work area.',
            emergencyProcedures: 'Raise the alarm.', trafficManagement: 'N/A', deliveryProcedures: 'Via Leamington St.',
            accessEgress: 'Via Oldham Rd.', highRiskActivities: 'Working at height.', fireArrangements: 'Muster rear car park.',
            hasSiteMap: true },
    incidentReporting: 'Report every accident and near miss to the site manager the same day.',
    risks: [{ label: 'Preventing falls', controls: 'Podium steps only.' }, { label: 'Asbestos', controls: null }],
    permitTypes: ['Hot works', 'Electrical isolation'],
    ramsDocuments: [{ id: 'doc1', title: 'Rewire RAMS' }],
  }));
  ok('three screens at most, in reading order: site, emergency, hazards',
     full.map((s) => s.key).join(',') === 'site,emergency,hazards', full.map((s) => s.key));
  ok('the site screen: project, work, team notes, hours, team, welfare, access, deliveries, map - traffic was "N/A", so it is not shown',
     blocks(full, 'site').join(',') === 'project,description,notes,hours,team,welfare,access,deliveries,map', blocks(full, 'site'));
  ok('the emergency screen: procedures, fire, contacts, first aid, reporting',
     blocks(full, 'emergency').join(',') === 'procedures,fire,contacts,firstaid,reporting', blocks(full, 'emergency'));
  const traffic = composeBriefing(base({ info: { ...EMPTY_INFO, trafficManagement: 'Banksman for all reversing vehicles.' } }));
  ok('real traffic management content IS shown, on the site screen',
     blocks(traffic, 'site').includes('traffic'), blocks(traffic, 'site'));
  ok('the hazards screen: hazards, high-risk, permits, risks, RAMS',
     blocks(full, 'hazards').join(',') === 'hazards,highrisk,permits,risks,rams', blocks(full, 'hazards'));

  const get = (screen: string, key: string) =>
    full.flatMap((x) => x.sections).find((sec) => sec.key === (screen === 'welfare' ? 'site' : screen))!.blocks.find((b) => b.key === key)!;
  ok('a placeholder entry ("N/A") is suppressed, not shown', !blocks(full, 'site').includes('traffic'));
  ok('real text is shown exactly as the site team wrote it', get('welfare', 'deliveries').text === 'Via Leamington St.');
  const firstAid = get('emergency', 'firstaid').people!;
  ok('a first aider held in BOTH places is shown once', firstAid.filter((p) => /fay aid/i.test(p.name)).length === 1, firstAid);
  ok('  and fire marshals are listed with first aid', firstAid.some((p) => p.role === 'Fire marshal'));
  ok('the principal contractor is named; an absent client is not an empty row',
     JSON.stringify(get('site', 'project').rows).includes('RS Electrical') &&
     !JSON.stringify(get('site', 'project').rows).includes('Client'));
  const risks = get('hazards', 'risks').entries!;
  ok('a risk with controls shows them', risks[0].text === 'Podium steps only.');
  ok('a risk with NO controls appears by title alone - nothing is invented for it',
     risks[1].title === 'Asbestos' && risks[1].text === undefined, risks[1]);
  ok('RAMS link to the induction route, not the checked-in-only one',
     get('hazards', 'rams').links![0].href === '/api/worker/induction/site1/documents/doc1', get('hazards', 'rams').links);
  ok('the site map is served by the induction route',
     get('welfare', 'map').image!.src === '/api/worker/induction/site1/site-map');
  ok('the incident-reporting arrangement is the reporting block',
     /near miss/.test(get('emergency', 'reporting').text ?? ''));
  ok('the screens are plain data (serialisable to the client)',
     JSON.stringify(JSON.parse(JSON.stringify(full))) === JSON.stringify(full));

  console.log('\n[2b] Placeholders are suppressed; real content is not');
  const { isMeaningful } = require('../services/induction/inductionBriefing');
  for (const p of ['N/A', 'n/a', 'NA', 'None', 'none.', 'TBC', 'tba', 'To be confirmed', '-', '--', '...', '?',
                   'test', 'X', 'Normal', 'What\'s required here?', 'What is needed?', '  N/A  ']) {
    ok(`suppressed: ${JSON.stringify(p)}`, isMeaningful(p) === false);
  }
  for (const r of ['N/A - no vehicles enter the site.', 'None of the site is open to the public.', '999',
                   'Rear car park', 'Access via Oldham Road,', 'Normal site rules apply plus the client\'s own.',
                   'Welfare is in the basement. Is the lift working? Check with the site manager before using it.',
                   'Working at height & electrical permits required.']) {
    ok(`kept: ${JSON.stringify(r)}`, isMeaningful(r) === true);
  }
  const placeholderSite = composeBriefing(base({
    emergency: { fireAssemblyPoint: 'TBC', firstAiderName: 'N/A', firstAiderNumber: null, firstAiderLocation: null,
                 nearestHospital: '-', emergencyNumber: 'n/a' },
    info: { ...EMPTY_INFO, emergencyProcedures: "What's required here?", trafficManagement: 'N/A', siteHazards: 'None' },
  }));
  ok('a site whose entries are all placeholders gets NO briefing screens', placeholderSite.length === 0,
     placeholderSite.map((x) => x.key));
  const mixed = composeBriefing(base({
    emergency: { fireAssemblyPoint: 'Rear car park', firstAiderName: 'TBC', firstAiderNumber: null, firstAiderLocation: null,
                 nearestHospital: null, emergencyNumber: null },
    info: { ...EMPTY_INFO, emergencyProcedures: "What's required here?" },
  }));
  ok('a placeholder beside real content: only the real content shows',
     mixed.length === 1 && blocks(mixed, 'emergency').join(',') === 'fire', blocks(mixed, 'emergency'));

  console.log('\n[2c] At most three screens, none too thin to stand alone');
  const rich = { ...EMPTY_INFO, workingHours: '08:00-17:00', welfareFacilities: 'Ground floor.', accessEgress: 'Via Oldham Rd.',
                 siteHazards: 'Public in work area.', highRiskActivities: 'Working at height.' };
  const thinEmergency = composeBriefing(base({ info: rich, permitTypes: ['Hot works'],
    emergency: { fireAssemblyPoint: 'Rear car park', firstAiderName: null, firstAiderNumber: null, firstAiderLocation: null,
                 nearestHospital: null, emergencyNumber: null } }));
  ok('a one-card emergency group does not get a screen of its own',
     thinEmergency.length === 2, thinEmergency.map((x) => x.key));
  ok('  it is folded into the screen BEFORE it', thinEmergency[0].key === 'site+emergency', thinEmergency[0].key);
  ok('  keeping its own heading as a subheading - nothing buried unlabelled',
     thinEmergency[0].sections.map((sec) => sec.title).join('|') === 'About this site|Emergencies and first aid',
     thinEmergency[0].sections.map((sec) => sec.title));
  ok('  and the combined screen has its own heading', thinEmergency[0].heading === 'Before you start on site');
  ok('  a screen that stands alone has no subheading', thinEmergency[1].sections.every((sec) => sec.title === undefined));

  const thinSite = composeBriefing(base({ info: { ...EMPTY_INFO, workingHours: '08:00-17:00', emergencyProcedures: 'Raise the alarm.',
    siteHazards: 'Public.', highRiskActivities: 'Height.' },
    emergency: { fireAssemblyPoint: 'Car park', firstAiderName: null, firstAiderNumber: null, firstAiderLocation: null, nearestHospital: null, emergencyNumber: '999' } }));
  ok('a thin FIRST group folds forward into the next', thinSite[0].key === 'site+emergency', thinSite.map((x) => x.key));

  const allThin = composeBriefing(base({ info: { ...EMPTY_INFO, workingHours: '08:00-17:00', emergencyProcedures: 'Raise the alarm.', siteHazards: 'Public.' } }));
  ok('three one-card groups become ONE screen', allThin.length === 1 && allThin[0].sections.length === 3, allThin.map((x) => x.key));

  const everything = composeBriefing(base({ info: { ...rich, emergencyProcedures: 'Raise the alarm.', fireArrangements: 'Muster rear.' },
    permitTypes: ['Hot works'] }));
  ok('never more than three screens', everything.length <= 3 && full.length <= 3);
  const count = (x: Screens) => x.reduce((n, sc) => n + allBlocks(sc).length, 0);
  // thinEmergency: site 4 (project, hours, welfare, access) + fire 1 + hazards 3 (hazards, high-risk, permits).
  // allThin: site 2 (project, hours) + procedures 1 + hazards 1.
  ok('condensing never loses a block',
     count(thinEmergency) === 8 && count(allThin) === 4, { thinEmergency: count(thinEmergency), allThin: count(allThin) });
  ok('the identity card alone does not justify a screen (it repeats the previous page)',
     thinSite[0].key === 'site+emergency');
  ok('every screen that remains has at least two cards beyond the identity card, unless it is the only one',
     [full, thinEmergency, thinSite, everything].every((x) => x.length === 1 ||
       x.every((sc) => allBlocks(sc).filter((b) => b.key !== 'project').length >= 2)));
  ok('  and a first aider named "TBC" is not listed as a person',
     !JSON.stringify(mixed).includes('TBC'));

  console.log('\n[3] The briefing comes BEFORE anything is confirmed');
  const items: FlowItem[] = [
    { id: 'a1', label: 'I have received and understood the site induction.', type: 'ACKNOWLEDGEMENT', required: true },
    { id: 'a2', label: 'I have read and will follow the site rules and signage.', type: 'ACKNOWLEDGEMENT', required: true },
    { id: 'p1', label: 'Hard hat', type: 'PPE_CONFIRM', required: true },
  ];
  const withBriefing = buildInductionSteps(items, full);
  const firstNonBriefing = withBriefing.findIndex((s) => s.kind !== 'briefing');
  ok('every briefing screen precedes the first acknowledgement',
     firstNonBriefing === full.length && withBriefing.slice(0, firstNonBriefing).every((s) => s.kind === 'briefing'),
     withBriefing.map((s) => s.kind));
  ok('a briefing screen asks nothing - it can always be continued',
     withBriefing.filter((s) => s.kind === 'briefing').every((s) => isStepComplete(s, {}, false)));
  ok('the checklist steps after it are exactly the ones without a briefing',
     JSON.stringify(withBriefing.slice(full.length)) === JSON.stringify(buildInductionSteps(items)));
  ok('no briefing leaves the flow exactly as it was', JSON.stringify(buildInductionSteps(items, [])) === JSON.stringify(buildInductionSteps(items)));
  ok('GDPR consent is still the last step', withBriefing[withBriefing.length - 1].kind === 'gdpr');

  console.log('\n[4] The page and wizard use it');
  const page = readFileSync('app/check-in/site/[siteId]/induction/page.tsx', 'utf8');
  ok('the induction page loads the briefing, for THIS operative\'s company',
    /getInductionBriefing\(site\.id, site\.name, siteCompany\?\.id \?\? null\)/.test(page),
    'briefing not company-scoped');
  ok('  and passes it to the wizard', /briefing=\{briefing\}/.test(page));
  const wiz = readFileSync('components/checkin/InductionWizard.tsx', 'utf8');
  ok('the wizard builds its steps WITH the briefing', /buildInductionSteps\(items, briefing\)/.test(wiz));
  ok('  and renders the briefing screen', /step\.kind === 'briefing' && <BriefingStep/.test(wiz));

  console.log('\n[5] Map and RAMS before check-in - and who is refused');
  let reader: { workerId: string } | null = null;
  const accessPath = require.resolve('../services/induction/inductionAccess');
  require.cache[accessPath] = { id: accessPath, filename: accessPath, loaded: true,
    exports: { inductionReaderFor: async () => reader } } as never;
  const blobPath = require.resolve('../services/documents/blobStorage');
  require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true,
    exports: { downloadDocumentBlob: async () => Buffer.from('%PDF-1.4 test') } } as never;
  const { prisma } = require('../lib/prisma');
  const docRoute = require('../app/api/worker/induction/[siteId]/documents/[documentId]/route');
  const [siteA, siteB] = await prisma.jobSite.findMany({ take: 2, orderBy: { createdAt: 'asc' }, select: { id: true } });
  const mk = (jobSiteId: string, category: string, title: string) => prisma.document.create({ data: {
    jobSiteId, category, title, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 10,
    blobPath: `test/${title}.pdf` } }).catch((e: Error) => { throw new Error(`seed failed: ${e.message}`); });
  let made: string[] = [];
  try {
    const rams = await mk(siteA.id, 'RAMS', 'briefing-test-rams');
    const insurance = await mk(siteA.id, 'INSURANCE', 'briefing-test-ins');
    const otherSite = await mk(siteB.id, 'RAMS', 'briefing-test-other');
    made = [rams.id, insurance.id, otherSite.id];
    const call = async (site: string, doc: string) =>
      (await docRoute.GET(new Request('http://x') as never, { params: { siteId: site, documentId: doc } })).status;
    reader = null;
    ok('someone the induction would refuse gets 404', (await call(siteA.id, rams.id)) === 404);
    reader = { workerId: 'w' };
    ok('an operative allowed on the site can open its RAMS', (await call(siteA.id, rams.id)) === 200);
    ok('  but not a non-RAMS document on the same site', (await call(siteA.id, insurance.id)) === 404);
    ok('  nor another site\'s RAMS through this site\'s route', (await call(siteA.id, otherSite.id)) === 404);
  } finally {
    await prisma.document.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  }
  const mapSrc = readFileSync('app/api/worker/induction/[siteId]/site-map/route.ts', 'utf8');
  ok('the map route applies the same access test', /inductionReaderFor\(params\.siteId\)/.test(mapSrc));
  ok('  and reads THIS site\'s map, not the checked-in site\'s', /getSiteMapBlobForSite\(params\.siteId\)/.test(mapSrc));
  const acc = readFileSync('services/induction/inductionAccess.ts', 'utf8');
  ok('access is the induction page\'s own test (canWorkerCheckIn)', /canWorkerCheckIn\(worker\.id, siteId\)/.test(acc) && /access\.allowed/.test(acc));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
