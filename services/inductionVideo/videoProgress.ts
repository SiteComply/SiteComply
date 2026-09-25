import { InductionVideoStatus } from '@prisma/client';

/**
 * IS THERE WORK IN FLIGHT ON THIS VERSION, and what should we say about it?
 *
 * ── WHY THIS IS A SHARED FUNCTION AND NOT A CHECK IN EACH PAGE ────────────
 *
 * Four screens ask it: each tier's project page and each tier's version page.
 * If any one of them disagreed about what "still working" means, that screen
 * would either stop refreshing while a job was running - the bug this exists to
 * fix - or poll forever after it finished. The Platform and the Admin Centre are
 * the same product seen twice, so the answer is defined once.
 *
 * ── THE TRANSIENT STATES ARE THE LOCK STATES ──────────────────────────────
 *
 * SCRIPT_GENERATING, NARRATION_GENERATING and VIDEO_GENERATING are already the
 * locks that stop a second job being queued, so they are exactly the states in
 * which something is happening and the screen is out of date. GENERATION_FAILED
 * is deliberately NOT one: a failure is a resting state a person has to act on,
 * and polling it forever would hide that.
 */
const WORKING: InductionVideoStatus[] = [
  InductionVideoStatus.SCRIPT_GENERATING,
  InductionVideoStatus.NARRATION_GENERATING,
  InductionVideoStatus.VIDEO_GENERATING,
];

export function isWorkingStatus(status: string): boolean {
  return (WORKING as string[]).includes(status);
}

/** True when any version of a project has work in flight. */
export function anyWorking(versions: { status: string }[]): boolean {
  return versions.some((v) => isWorkingStatus(v.status));
}

/**
 * What is happening across a project's versions, for a project-level screen.
 *
 * Only one version of a project can have work in flight at a time - the
 * transient statuses are the locks - so the first one found is the one to name.
 */
export function describeAnyWork(versions: { status: string }[]): string | null {
  const working = versions.find((v) => isWorkingStatus(v.status));
  return working ? describeWork(working.status) : null;
}

/**
 * What is happening, in the words the person is waiting on.
 *
 * "Working…" tells someone nothing about whether to wait ten seconds or two
 * minutes. Naming the step does, and the three steps have genuinely different
 * costs: a script is a model call, narration is a speech service per scene, a
 * render is ffmpeg.
 */
export function describeWork(status: string): string | null {
  switch (status) {
    case InductionVideoStatus.SCRIPT_GENERATING:
      return 'Writing the script';
    case InductionVideoStatus.NARRATION_GENERATING:
      return 'Recording the narration';
    case InductionVideoStatus.VIDEO_GENERATING:
      return 'Rendering the video';
    default:
      return null;
  }
}

/**
 * How long to keep checking before giving up and leaving it to the person.
 *
 * A render of a long induction is the slowest thing here and has been measured at
 * about a minute and a half, so ten minutes is generous rather than tight. The
 * cap exists because a job that dies without writing a failure would otherwise
 * leave every open tab polling this project for as long as the tab is open.
 */
export const WORK_POLL_CEILING_MS = 10 * 60 * 1000;

/**
 * How often to check.
 *
 * Jobs start immediately (`kickInductionJobs`), so a script is usually ready in a
 * few seconds and a three-second beat makes it feel instant. Each check is one
 * server render of a page the person is already looking at - cheap next to the
 * model call it is waiting for - and it stops the moment the work does.
 */
export const WORK_POLL_INTERVAL_MS = 3_000;
