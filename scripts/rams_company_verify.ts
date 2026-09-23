/**
 * RAMS belong to a company, not just to a site.
 *
 * "Each company will have their own RAMS." Every document was site-owned, so an
 * electrician was shown the scaffolder's method statements - and, since the
 * induction briefing now links RAMS directly, would be handed them at induction.
 *
 * THE RULE: site-wide (no company) reaches everyone; a company's documents reach
 * that company's operatives; an operative with NO company sees site-wide only.
 *
 * Runs the real services against the local database. Everything it creates is
 * deleted again.
 *
 * Run: npx tsx scripts/rams_company_verify.ts
 */
import { readFileSync } from 'fs';
import {
  documentCompanyWhere,
  documentIsVisibleTo,
  documentScopeNote,
} from '../services/documents/documentVisibility';
import { normaliseCompanyName } from '../services/companies/siteCompanyService';

const { prisma } = require('../lib/prisma');
const companies = require('../services/companies/siteCompanyService');
const { getWorkerDocuments, countWorkerDocuments } = require('../services/workerDashboard/workerDashboardService');

let pass = 0; const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');
const actor = { id: 'test-actor', name: 'Test Actor' };
const TAG = 'ramscoTEST';

async function main() {
  console.log('== RAMS BELONG TO A COMPANY ==\n');

  console.log('[1] The rule itself');
  ok('no company: site-wide documents only',
    JSON.stringify(documentCompanyWhere(null)) === JSON.stringify({ siteCompanyId: null }));
  ok('  blank and whitespace are the same as none',
    JSON.stringify(documentCompanyWhere('   ')) === JSON.stringify({ siteCompanyId: null }));
  ok('with a company: site-wide OR theirs',
    JSON.stringify(documentCompanyWhere('c1')) ===
      JSON.stringify({ OR: [{ siteCompanyId: null }, { siteCompanyId: 'c1' }] }));
  ok('a site-wide document reaches everyone', documentIsVisibleTo({ siteCompanyId: null }, 'c1') &&
    documentIsVisibleTo({ siteCompanyId: null }, null));
  ok('a company document reaches its own operatives', documentIsVisibleTo({ siteCompanyId: 'c1' }, 'c1'));
  ok('  and NOT another company\'s', !documentIsVisibleTo({ siteCompanyId: 'c1' }, 'c2'));
  ok('  and NOT an operative with no company', !documentIsVisibleTo({ siteCompanyId: 'c1' }, null));
  ok('the operative is told what they are looking at', /Sparks Ltd/.test(documentScopeNote('Sparks Ltd')));
  ok('  and, with no company, why the list may look short',
    /site manager/.test(documentScopeNote(null)));

  console.log('\n[2] Companies are records, and are never merged on a resemblance');
  const site = await prisma.jobSite.findFirst({ select: { id: true } });
  const made: { companies: string[]; docs: string[]; workers: string[] } = { companies: [], docs: [], workers: [] };
  try {
    const a = await companies.createSiteCompany(site.id, ` ${TAG} Sparks Ltd `, actor);
    ok('a company can be added', a.ok === true, a.ok ? '' : a.error);
    made.companies.push(a.value.id);
    ok('  stored as typed, trimmed', a.value.name === `${TAG} Sparks Ltd`, a.value.name);
    const dup = await companies.createSiteCompany(site.id, `${TAG.toLowerCase()} sparks   ltd`, actor);
    ok('the SAME name in another case or spacing is refused', dup.ok === false, dup);
    const b = await companies.createSiteCompany(site.id, `${TAG} Sparks Electrical`, actor);
    ok('a DIFFERENT but similar name is allowed - never merged automatically', b.ok === true);
    made.companies.push(b.value.id);
    ok('  the comparison key only ignores case and spacing',
      normaliseCompanyName('  RS   Electrical ') === 'rs electrical' &&
      normaliseCompanyName('RS Elec - Test') !== normaliseCompanyName('RS Electrical'));

    console.log('\n[3] What each operative sees');
    const mk = async (mobile: string, name: string, companyId: string | null) => {
      const w = await prisma.worker.create({ data: { mobile, fullName: name, firstName: name, surname: 'Test', company: 'x' } });
      made.workers.push(w.id);
      await prisma.workerSiteAssignment.create({
        data: { workerId: w.id, jobSiteId: site.id, status: 'ACTIVE', siteCompanyId: companyId },
      });
      return w;
    };
    const sparks = await mk('+447700900981', 'Sparks Operative', a.value.id);
    const other = await mk('+447700900982', 'Other Operative', b.value.id);
    const nobody = await mk('+447700900983', 'Unassigned Operative', null);

    const doc = async (title: string, companyId: string | null) => {
      const d = await prisma.document.create({ data: {
        jobSiteId: site.id, category: 'RAMS', title, fileName: `${title}.pdf`,
        mimeType: 'application/pdf', sizeBytes: 1, blobPath: `t/${title}.pdf`, siteCompanyId: companyId } });
      made.docs.push(d.id);
      return d;
    };
    const mine = await doc(`${TAG} Sparks RAMS`, a.value.id);
    const theirs = await doc(`${TAG} Other RAMS`, b.value.id);
    const shared = await doc(`${TAG} Site-wide RAMS`, null);

    const titlesFor = async (companyId: string | null) =>
      (await getWorkerDocuments(site.id, { category: 'RAMS', siteCompanyId: companyId }))
        .map((d: { title: string }) => d.title)
        .filter((t: string) => t.startsWith(TAG))
        .sort();

    ok('an operative sees their own company\'s RAMS and the site-wide one',
      JSON.stringify(await titlesFor(a.value.id)) === JSON.stringify([`${TAG} Site-wide RAMS`, `${TAG} Sparks RAMS`]),
      await titlesFor(a.value.id));
    ok('  and NOT the other company\'s', !(await titlesFor(a.value.id)).includes(`${TAG} Other RAMS`));
    ok('the other company sees theirs, not the first\'s',
      JSON.stringify(await titlesFor(b.value.id)) === JSON.stringify([`${TAG} Other RAMS`, `${TAG} Site-wide RAMS`]),
      await titlesFor(b.value.id));
    ok('an operative with NO company sees the site-wide one only',
      JSON.stringify(await titlesFor(null)) === JSON.stringify([`${TAG} Site-wide RAMS`]),
      await titlesFor(null));
    const countMine = await countWorkerDocuments(site.id, { category: 'RAMS', siteCompanyId: a.value.id });
    const countNone = await countWorkerDocuments(site.id, { category: 'RAMS', siteCompanyId: null });
    ok('the dashboard count matches the list it links to', countMine - countNone === 1, { countMine, countNone });

    console.log('\n[4] Retrieving by id obeys the same rule as listing');
    /*
     * The lists never link another company's RAMS - but a document id in a URL
     * must not fetch one either, or the protection is only as good as nobody
     * trying it.
     */
    const readerPath = require.resolve('../services/induction/inductionAccess');
    let reader: { workerId: string } | null = null;
    require.cache[readerPath] = { id: readerPath, filename: readerPath, loaded: true,
      exports: { inductionReaderFor: async () => reader } } as never;
    const blobPath = require.resolve('../services/documents/blobStorage');
    require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true,
      exports: { downloadDocumentBlob: async () => Buffer.from('%PDF-1.4 test') } } as never;
    const inductionRoute = require('../app/api/worker/induction/[siteId]/documents/[documentId]/route');
    const fetchAs = async (worker: { id: string }, documentId: string) => {
      reader = { workerId: worker.id };
      const res = await inductionRoute.GET(new Request('http://x') as never, {
        params: { siteId: site.id, documentId },
      });
      return res.status;
    };
    ok('an operative can fetch their OWN company\'s RAMS by id',
      (await fetchAs(sparks, mine.id)) === 200);
    ok('  and a site-wide one', (await fetchAs(sparks, shared.id)) === 200);
    ok('another company\'s RAMS is NOT FOUND, even with the id',
      (await fetchAs(sparks, theirs.id)) === 404);
    ok('  and for an operative with no company, neither company\'s is',
      (await fetchAs(nobody, mine.id)) === 404 && (await fetchAs(nobody, theirs.id)) === 404);
    ok('  while the site-wide one still reaches them',
      (await fetchAs(nobody, shared.id)) === 200);

    // The dashboard download path resolves the company from the open check-in.
    const { getDocumentForCheckedInWorker } = require('../services/workerDashboard/workerDashboardService');
    const sub = await prisma.submission.create({ data: {
      workerId: sparks.id, jobSiteId: site.id, checklistVersion: 1, status: 'COMPLIANT', gdprConsent: true } });
    ok('the dashboard download serves their own company\'s document',
      (await getDocumentForCheckedInWorker(sparks.id, mine.id)) !== null);
    ok('  and the site-wide one',
      (await getDocumentForCheckedInWorker(sparks.id, shared.id)) !== null);
    ok('  but refuses another company\'s, by id',
      (await getDocumentForCheckedInWorker(sparks.id, theirs.id)) === null);
    await prisma.submission.delete({ where: { id: sub.id } });

    console.log('\n[5] Tidying up is deliberate');
    const busy = await companies.removeSiteCompany(site.id, a.value.id);
    ok('a company with operatives or documents cannot be removed',
      busy.ok === false && /operative/.test(busy.error), busy);
    const merged = await companies.mergeCompanies(site.id, b.value.id, a.value.id);
    ok('merging moves the operatives and the documents together',
      merged.ok === true && merged.value.operatives === 1 && merged.value.documents === 1, merged);
    made.companies = made.companies.filter((id) => id !== b.value.id);
    ok('  after which the merged company\'s people see the combined set',
      (await titlesFor(a.value.id)).length === 3, await titlesFor(a.value.id));
    ok('  and the source company is gone',
      (await prisma.siteCompany.findUnique({ where: { id: b.value.id } })) === null);
    void sparks; void other; void nobody; void mine; void theirs; void shared;

    console.log('\n[6] Wiring');
    const svc = read('services/workerDashboard/workerDashboardService.ts');
    ok('the worker document query applies the rule', /\.\.\.documentCompanyWhere\(opts\.siteCompanyId\)/.test(svc));
    ok('the worker context resolves the company from the ASSIGNMENT, not the typed one',
      /siteCompany: assignment\?\.siteCompany \?\? null/.test(svc));
    const rams = read('app/worker/rams/page.tsx');
    ok('the RAMS page passes it', /siteCompanyId: siteCompany\?\.id \?\? null/.test(rams));
    const briefing = read('services/induction/inductionBriefingService.ts');
    ok('the induction briefing passes it', /category: DocumentCategory\.RAMS, siteCompanyId/.test(briefing));
    const indPage = read('app/check-in/site/[siteId]/induction/page.tsx');
    ok('  resolved for the operative before check-in', /companyForAssignment\(worker\.id, site\.id\)/.test(indPage));
    const docs = read('services/documents/documentService.ts');
    ok('an annotated copy inherits its original\'s owner', /annotation\?\.originalDocumentId[\s\S]{0,200}siteCompanyId: true/.test(docs));
    const indDoc = read('app/api/worker/induction/[siteId]/documents/[documentId]/route.ts');
    ok('the induction download applies the visibility rule',
      /\.\.\.documentCompanyWhere\(company\?\.id \?\? null\)/.test(indDoc));
    ok('the dashboard download applies it too',
      /\.\.\.documentCompanyWhere\(assignment\?\.siteCompanyId \?\? null\)/.test(svc));
    ok('a document can only belong to a company on its own project',
      /That company is not on this project/.test(docs));
    const invite = read('services/workerAccess/workerAssignmentService.ts');
    ok('inviting checks the company is on this project',
      /Choose a company from this project’s list\./.test(invite));
    const dialog = read('components/platform/InviteWorkerDialog.tsx');
    ok('the invite dialog CHOOSES a company rather than typing one',
      /<select[\s\S]{0,200}id="invite-company"/.test(dialog) && !/id="invite-company"[\s\S]{0,120}<input/.test(dialog));
    const form = read('components/platform/DocumentForm.tsx');
    ok('the document form asks who it applies to, defaulting to everyone',
      /label="Applies to"/.test(form) && /<option value="">Everyone on this site<\/option>/.test(form));
  } finally {
    await prisma.document.deleteMany({ where: { id: { in: made.docs } } });
    await prisma.workerSiteAssignment.deleteMany({ where: { workerId: { in: made.workers } } });
    await prisma.worker.deleteMany({ where: { id: { in: made.workers } } });
    await prisma.siteCompany.deleteMany({ where: { id: { in: made.companies } } });
    await prisma.siteCompany.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.$disconnect();
  }

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
