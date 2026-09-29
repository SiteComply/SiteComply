import os from 'node:os';

/**
 * PUSH A MEDIA ENCODE BEHIND THE WEB SERVER.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * Rendering and transcoding run IN THE WEB PROCESS on one small App Service
 * instance: `kickInductionJobs` spawns ffmpeg alongside the server that draws the
 * page watching it. A measured render is 123 seconds of saturated CPU, and in
 * production on 2026-09-29 a page render during one was starved badly enough that
 * its streamed React payload was truncated - the client threw `TypeError: Error in
 * input stream` and the error boundary took over (SC-E-00009).
 *
 * The page is a person waiting on a response; the encode is a background job that
 * nobody is watching frame by frame. So the encode yields. A render that takes a few
 * seconds longer costs nothing anybody can see; a page that fails costs the whole
 * workflow.
 *
 * ── WHY IT IS SAFE, AND WHY IT IS ALLOWED TO FAIL ─────────────────────────
 *
 * LOWERING a process's priority needs no privilege on Linux - only raising it does -
 * so this works as an unprivileged container user. But it is still an operating
 * system call that a sandbox may refuse, and a refused nice is not a reason to fail a
 * render: the job runs at normal priority, exactly as it did before. Hence the
 * try/catch, and hence returning whether it took, so a caller can say so in a log
 * rather than assume.
 */

/**
 * The lowest priority the platform offers. ffmpeg still gets every cycle the server
 * is not using, which on an idle instance is all of them - this changes who wins
 * when they want the CPU at the same moment, not how much work ffmpeg may do.
 */
export const ENCODE_PRIORITY = os.constants.priority.PRIORITY_LOW;

export function deprioritiseEncode(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    os.setPriority(pid, ENCODE_PRIORITY);
    return true;
  } catch {
    // Not permitted here, or the child exited between spawn and now. Either way the
    // work still happens.
    return false;
  }
}
