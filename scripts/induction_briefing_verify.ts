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
const blocks = (s: ReturnType<typeof composeBriefing>, key: string) =>
  s.find((x) => x.key === key)?.blocks.map((b) => b.key) ?? [];

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
  ok('all four screens, in reading order: site, emergency, welfare, hazards',
     full.map((s) => s.key).join(',') === 'site,emergency,welfare,hazards', full.map((s) => s.key));
  ok('the site screen carries the project, the work, the team notes, hours and the team',
     blocks(full, 'site').join(',') === 'project,description,notes,hours,team', blocks(full, 'site'));
  ok('the emergency screen: procedures, fire, contacts, first aid, reporting',
     blocks(full, 'emergency').join(',') === 'procedures,fire,contacts,firstaid,reporting', blocks(full, 'emergency'));
  ok('the welfare screen: welfare, access, deliveries, traffic, map',
     blocks(full, 'welfare').join(',') === 'welfare,access,deliveries,traffic,map', blocks(full, 'welfare'));
  ok('the hazards screen: hazards, high-risk, permits, risks, RAMS',
     blocks(full, 'hazards').join(',') === 'hazards,highrisk,permits,risks,rams', blocks(full, 'hazards'));

  const get = (screen: string, key: string) => full.find((s) => s.key === screen)!.blocks.find((b) => b.key === key)!;
  ok('text is shown exactly as the site team wrote it, "N/A" included',
     get('welfare', 'traffic').text === 'N/A');
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
  ok('the induction page loads the briefing', /getInductionBriefing\(site\.id, site\.name\)/.test(page));
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
