/**
 * SiteComply database seed — realistic UK sample data.
 *
 * Populates: one admin, three active UK construction sites, each with a standard
 * UK induction checklist (PPE + RAMS + toolbox talk + CDM 2015 safe-working),
 * a handful of workers across two companies, and a couple of sample check-ins
 * (one worker currently on site, one historic check-out) to exercise relations.
 *
 * Idempotent: clears the seeded tables first, so it can be re-run safely.
 * Mobile numbers use Ofcom's reserved 07700 900xxx fictitious range.
 *
 * Run with: npm run db:seed   (or: npm run db:reset to migrate + seed afresh)
 */
import {
  PrismaClient,
  ChecklistItemType,
  CscsCardType,
  SubmissionStatus,
  AdminRole,
} from '@prisma/client';
import { UK_INDUCTION_TEMPLATE } from '../services/checklists/ukInductionTemplate';

const prisma = new PrismaClient();

/** Build a default `answers` JSON for a fully-completed induction. */
function completedAnswers(
  items: { id: string; type: ChecklistItemType }[],
): Record<string, boolean | string> {
  const answers: Record<string, boolean | string> = {};
  for (const item of items) {
    answers[item.id] = item.type === ChecklistItemType.YES_NO ? 'yes' : true;
  }
  return answers;
}

async function main() {
  console.warn('Seeding SiteComply sample data…');

  // Clear in dependency order so foreign keys are satisfied.
  await prisma.submission.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.complianceChecklist.deleteMany();
  await prisma.jobSite.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.admin.deleteMany();

  // --- Admin ---------------------------------------------------------------
  const admin = await prisma.admin.create({
    data: {
      azureObjectId: 'seed-00000000-0000-0000-0000-000000000001',
      email: 'site.administrator@sitecomply.example',
      displayName: 'Site Administrator',
      role: AdminRole.OWNER,
    },
  });

  // --- Sites (with their checklists) --------------------------------------
  const sites = [
    {
      name: 'Brunel Quarter — Phase 2',
      addressLine1: 'Unit 4, Temple Way',
      town: 'Bristol',
      postcode: 'BS1 6AG',
      jobReference: 'BNE-2026-014',
      inductionContent:
        'Welcome to Brunel Quarter Phase 2. This is an active groundworks and ' +
        'structures site. Welfare facilities and the site office are by the ' +
        'main gate. Site hours are 07:30–17:00, Monday to Friday. Speed limit ' +
        'on site is 5mph. Report to the site manager before starting work.',
      fireAssemblyPoint: 'Main gate car park (north end, by the blue cabin)',
      firstAiderName: 'Dawn Phillips',
      firstAiderNumber: '07700 900145',
    },
    {
      name: 'Kingsway Tower Refurbishment',
      addressLine1: '120 Kingsway',
      town: 'London',
      postcode: 'WC2B 6NH',
      jobReference: 'KGW-2026-003',
      inductionContent:
        'Kingsway Tower is an occupied-building refurbishment. Permit to work ' +
        'is required for all hot works, work at height and isolations. Keep ' +
        'fire escape routes clear at all times. Deliveries via the rear ' +
        'loading bay only. Welfare is on level B1.',
      fireAssemblyPoint: 'Lincoln’s Inn Fields — east lawn',
      firstAiderName: 'Marcus Bell',
      firstAiderNumber: '07700 900233',
    },
    {
      name: 'Northgate Retail Park',
      addressLine1: 'Northgate Avenue',
      town: 'Manchester',
      postcode: 'M40 2WL',
      jobReference: 'NGR-2026-021',
      inductionContent:
        'New-build retail units with associated external works. Banksman ' +
        'required for all reversing plant. Segregation barriers between ' +
        'pedestrian and vehicle routes must not be moved. Near misses are to ' +
        'be reported to the site office the same day.',
      fireAssemblyPoint: 'Visitor car park — bay Z',
      firstAiderName: 'Priya Anand',
      firstAiderNumber: '07700 900318',
    },
  ];

  const createdSites = [];
  for (const site of sites) {
    const jobSite = await prisma.jobSite.create({
      data: {
        ...site,
        createdByAdminId: admin.id,
        checklists: {
          create: {
            title: 'Site induction & compliance checklist',
            version: 1,
            items: {
              create: UK_INDUCTION_TEMPLATE.map((item, index) => ({
                label: item.label,
                helpText: item.helpText,
                type: item.type,
                required: item.required,
                order: index,
              })),
            },
          },
        },
      },
      include: { checklists: { include: { items: true } } },
    });
    createdSites.push(jobSite);
  }

  // --- Workers (two companies) --------------------------------------------
  const workers = await Promise.all(
    [
      {
        fullName: 'Aileen McGregor',
        company: 'Caledonian Groundworks Ltd',
        mobile: '+447700900101',
        cscsCardNumber: 'CSCS-8841201',
        cscsCardType: CscsCardType.BLUE_SKILLED,
        cscsExpiry: new Date('2028-03-31'),
      },
      {
        fullName: 'Tomasz Kowalski',
        company: 'Caledonian Groundworks Ltd',
        mobile: '+447700900102',
        cscsCardNumber: 'CSCS-7720934',
        cscsCardType: CscsCardType.GREEN_LABOURER,
        cscsExpiry: new Date('2027-09-30'),
      },
      {
        fullName: 'Rhys Davies',
        company: 'Severn Electrical Services',
        mobile: '+447700900103',
        cscsCardNumber: 'CSCS-5519088',
        cscsCardType: CscsCardType.GOLD_SUPERVISORY,
        cscsExpiry: new Date('2029-01-31'),
      },
      {
        fullName: 'Sandra O’Neill',
        company: 'Severn Electrical Services',
        mobile: '+447700900104',
        cscsCardNumber: 'CSCS-6302455',
        cscsCardType: CscsCardType.BLUE_SKILLED,
        cscsExpiry: new Date('2028-11-30'),
      },
    ].map((data) => prisma.worker.create({ data })),
  );

  // --- Sample check-ins ----------------------------------------------------
  const bristol = createdSites[0];
  const london = createdSites[1];
  const bristolItems = bristol.checklists[0].items;
  const londonItems = london.checklists[0].items;

  // Aileen is currently ON SITE at Bristol (checked in, not checked out).
  await prisma.submission.create({
    data: {
      workerId: workers[0].id,
      jobSiteId: bristol.id,
      checklistVersion: bristol.checklists[0].version,
      answers: completedAnswers(bristolItems),
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      status: SubmissionStatus.COMPLIANT,
      checkedInAt: new Date('2026-06-25T06:50:00Z'), // 07:50 BST
    },
  });

  // Rhys completed a historic check-in/out at Kingsway yesterday.
  await prisma.submission.create({
    data: {
      workerId: workers[2].id,
      jobSiteId: london.id,
      checklistVersion: london.checklists[0].version,
      answers: completedAnswers(londonItems),
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      status: SubmissionStatus.COMPLIANT,
      checkedInAt: new Date('2026-06-24T06:35:00Z'), // 07:35 BST
      checkedOutAt: new Date('2026-06-24T15:10:00Z'), // 16:10 BST
    },
  });

  console.warn(
    `Seeded: 1 admin, ${createdSites.length} sites, ${workers.length} workers, 2 submissions.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
