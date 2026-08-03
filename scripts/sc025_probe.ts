import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const sites = await p.jobSite.findMany({ select: { id: true, name: true, status: true } });
  console.log('sites by status:', sites.reduce((a: any, s) => ({ ...a, [s.status]: (a[s.status] ?? 0) + 1 }), {}));
  for (const s of sites) {
    const [openActions, livePermits, openCheckIns, dueOccurrences, assignments, packs] = await Promise.all([
      p.action.count({ where: { jobSiteId: s.id, status: { not: 'COMPLETED' } } }),
      p.permit.count({ where: { jobSiteId: s.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } } }),
      p.submission.count({ where: { jobSiteId: s.id, checkedOutAt: null } }),
      p.complianceOccurrence.count({ where: { schedule: { jobSiteId: s.id }, completedAt: null } }),
      p.workerSiteAssignment.count({ where: { jobSiteId: s.id } }),
      p.closeOutPack.count({ where: { jobSiteId: s.id } }),
    ]);
    console.log(`  ${s.name} [${s.status}] actions:${openActions} permits:${livePermits} onsite:${openCheckIns} dueTasks:${dueOccurrences} assignments:${assignments} packs:${packs}`);
  }
  await p.$disconnect();
})().catch(async (e) => { console.error(String(e).slice(0, 400)); await p.$disconnect(); process.exit(1); });
