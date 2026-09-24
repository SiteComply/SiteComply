import { prisma } from '@/lib/prisma';
import {
  addDaysToDateStr,
  formatTimeUK,
  toDateInputValue,
  zonedMidnightToUtc,
} from '@/lib/datetime';

/**
 * A daily ceiling on what the induction video pipeline may spend.
 *
 * ── WHY THIS EXISTS BEFORE RENDERING DOES ─────────────────────────────────
 *
 * A script costs 2-3p and a narration about 4p, so until now the approval gate
 * was cost control enough. A render is about £1.25, and a manager who does not
 * like the result can press the button again. Twenty renders is a rounding
 * error; two hundred, from a loop or an impatient afternoon, is a bill somebody
 * has to explain. The cap turns "we will notice eventually" into "it stops".
 *
 * ── IT COUNTS WHAT WAS RECORDED, NOT WHAT WAS BUDGETED ────────────────────
 *
 * The figures come from AiUsageEvent - the same rows the version pages show -
 * so the cap and the reporting can never disagree. They are ESTIMATES at the
 * rates configured when each row was written, which is the right basis for a
 * safety rail: it does not need to match the invoice to stop a runaway.
 *
 * ── IT REFUSES, IT DOES NOT QUEUE ─────────────────────────────────────────
 *
 * Reaching the cap declines the request with a message naming the figure and
 * when it resets. A job queued "for tomorrow" would be a surprise charge with a
 * delay on it, and nobody would remember requesting it.
 */

/** The default ceiling: about fifteen rendered videos a day. */
const DEFAULT_DAILY_PENCE = 2_000;

export function dailyCapPence(): number {
  const raw = Number(process.env.INDUCTION_VIDEO_DAILY_PENCE_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_DAILY_PENCE;
}

/**
 * The London day the cap counts, as UTC instants.
 *
 * Reuses the platform's existing zone helpers rather than inventing a third way
 * of asking what day it is - the same ones the compliance date ranges use, so
 * "today" means the same thing in a spend figure as in a report.
 */
export function londonDay(now = new Date()): { start: Date; resets: Date } {
  const today = toDateInputValue(now);
  return {
    start: zonedMidnightToUtc(today),
    resets: zonedMidnightToUtc(addDaysToDateStr(today, 1)),
  };
}

export interface SpendToday {
  pence: number;
  capPence: number;
  remainingPence: number;
  /** True when a further paid run must be refused. */
  exhausted: boolean;
}

/**
 * What the pipeline has spent since midnight, across every site.
 *
 * ORG-WIDE, NOT PER SITE, on purpose: the thing being protected is one bill,
 * and a runaway on one project spends the same money as a runaway spread over
 * ten.
 */
export async function spendToday(now = new Date()): Promise<SpendToday> {
  const { start } = londonDay(now);
  const sum = await prisma.aiUsageEvent.aggregate({
    where: { createdAt: { gte: start } },
    _sum: { estimatedPence: true },
  });
  const pence = sum._sum.estimatedPence ?? 0;
  const capPence = dailyCapPence();
  return {
    pence,
    capPence,
    remainingPence: Math.max(0, capPence - pence),
    exhausted: pence >= capPence,
  };
}

/**
 * May a paid run start? Returns null when it may, or the refusal to show.
 *
 * `estimatePence` is the cost of the run being asked for: a request that would
 * take the day past the ceiling is refused BEFORE it spends anything, rather
 * than being allowed to start and stopped in the middle with half a video
 * bought.
 */
export async function refuseIfOverBudget(
  estimatePence: number,
  now = new Date(),
): Promise<string | null> {
  const spend = await spendToday(now);
  if (spend.pence + Math.max(0, estimatePence) <= spend.capPence) return null;

  const reset = formatTimeUK(londonDay(now).resets);
  return (
    `The daily limit for induction video generation (${formatPence(spend.capPence)}) ` +
    `has been reached — ${formatPence(spend.pence)} spent so far today. ` +
    `It resets at ${reset}. Ask a Director to raise the limit if this is needed sooner.`
  );
}

/** Spend for one version, for the panel that shows what it cost. */
export async function spendForVideo(videoId: string): Promise<{
  pence: number;
  scriptPence: number;
  narrationPence: number;
  renderPence: number;
}> {
  const rows = await prisma.aiUsageEvent.groupBy({
    by: ['purpose'],
    where: { videoId },
    _sum: { estimatedPence: true },
  });
  const of = (purpose: string) =>
    rows.find((r) => r.purpose === purpose)?._sum.estimatedPence ?? 0;
  return {
    pence: rows.reduce((n, r) => n + (r._sum.estimatedPence ?? 0), 0),
    scriptPence: of('script'),
    narrationPence: of('narration'),
    renderPence: of('render'),
  };
}

export function formatPence(pence: number): string {
  return pence < 100 ? `${pence}p` : `£${(pence / 100).toFixed(2)}`;
}
