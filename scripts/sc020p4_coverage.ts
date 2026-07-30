import { PrismaClient } from '@prisma/client';
import {
  dueDatesInWindow,
  londonDateStr,
  addDays,
  daysBetween,
} from '@/services/compliance/occurrenceGenerator';
import { GENERATION_HORIZON_DAYS } from '@/services/compliance/schedulerRunner';

/**
 * SC-020 Phase 4 — prove the horizon is COVERED, not merely quiet.
 *
 * "0 occurrences created" is the correct result when everything in the window
 * already exists, and it is also what a broken generator would report. This
 * recomputes, from each schedule's own rules, exactly which dates should exist
 * in the timer's window and compares that with what is stored — so the two
 * cases can be told apart. Read-only.
 */
const prisma = new PrismaClient();

async function main() {
  const today = londonDateStr(new Date());
  const from = addDays(today, -7);
  const to = addDays(today, GENERATION_HORIZON_DAYS);
  console.log(`window: ${from} .. ${to} (today ${today})\n`);

  const schedules = await prisma.complianceSchedule.findMany({
    where: { active: true, jobSite: { status: 'ACTIVE' } },
    include: {
      jobSite: { select: { name: true } },
      auditTemplate: { select: { name: true } },
      occurrences: { select: { dueDateLocal: true } },
    },
  });

  let missingTotal = 0;
  for (const s of schedules) {
    // dueDatesInWindow is the PURE frequency expander — it deliberately knows
    // nothing about activation or the schedule's start/end. ensureOccurrences
    // clamps the window first, so this check must clamp it identically or it
    // "expects" dates outside the schedule's own lifetime and reports phantom
    // gaps.
    const startLocal = londonDateStr(s.startDate);
    const activatedLocal = londonDateStr(s.activatedAt);
    const lowerBound =
      daysBetween(startLocal, activatedLocal) > 0 ? activatedLocal : startLocal;
    const windowFrom = daysBetween(from, lowerBound) > 0 ? lowerBound : from;
    const windowTo = s.endDate
      ? (() => {
          const endLocal = londonDateStr(s.endDate);
          return daysBetween(endLocal, to) > 0 ? endLocal : to;
        })()
      : to;

    const expected = dueDatesInWindow(
      { ...s, startLocal },
      windowFrom,
      windowTo,
    );
    const stored = new Set(s.occurrences.map((o) => o.dueDateLocal));
    const missing = expected.filter((d) => !stored.has(d));
    missingTotal += missing.length;
    const label = s.title || s.auditTemplate.name;
    console.log(
      `  ${missing.length === 0 ? 'COVERED ' : 'MISSING '} "${label}" (${s.jobSite.name}, ${s.frequency})` +
        ` expected-in-window=${expected.length} stored-total=${stored.size}` +
        (missing.length ? ` missing=[${missing.join(', ')}]` : ''),
    );
    if (expected.length) {
      console.log(
        `            in-window range ${expected[0]} .. ${expected[expected.length - 1]}`,
      );
    }
  }

  console.log(
    `\n${missingTotal === 0 ? 'HORIZON FULLY COVERED — "0 created" is correct, not a silent failure.' : `*** ${missingTotal} EXPECTED OCCURRENCES ARE MISSING ***`}`,
  );
  await prisma.$disconnect();
  process.exit(missingTotal === 0 ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
