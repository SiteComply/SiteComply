/**
 * SC-024 Phase 2 — how big is a real close-out archive here?
 *
 * The ZIP is built inside a single HTTP request, and Azure App Service cuts
 * requests off at 230 seconds. This reports the per-project document footprint
 * so the limit can be judged against actual data rather than guessed at.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sites = await prisma.jobSite.findMany({
    select: { id: true, name: true, jobReference: true },
  });

  const rows: {
    name: string;
    docs: number;
    mb: number;
    photos: number;
  }[] = [];

  for (const s of sites) {
    const [agg, findings, actions] = await Promise.all([
      prisma.document.aggregate({
        where: { jobSiteId: s.id },
        _sum: { sizeBytes: true },
        _count: true,
      }),
      prisma.findingEvidence.count({
        where: { finding: { audit: { jobSiteId: s.id } } },
      }),
      prisma.actionEvidence.count({ where: { action: { jobSiteId: s.id } } }),
    ]);
    rows.push({
      name: `${s.name} (${s.jobReference})`,
      docs: agg._count,
      mb: (agg._sum.sizeBytes ?? 0) / 1024 / 1024,
      photos: findings + actions,
    });
  }

  rows.sort((a, b) => b.mb - a.mb);
  console.log('== Per-project archive footprint (documents only) ==');
  for (const r of rows.slice(0, 15)) {
    console.log(
      `  ${r.mb.toFixed(1).padStart(8)} MB · ${String(r.docs).padStart(4)} docs · ${String(r.photos).padStart(4)} photos — ${r.name}`,
    );
  }

  const largest = rows[0];
  console.log(
    `\n  projects: ${rows.length}; largest document footprint: ${largest ? largest.mb.toFixed(1) : '0'} MB`,
  );
  console.log(
    '  (Evidence photos carry no recorded size, so total bytes are at least this.)',
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
