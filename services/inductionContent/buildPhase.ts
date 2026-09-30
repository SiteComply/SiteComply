/**
 * ⚠ BUILD-PHASE CONTENT RESET. Off unless switched on, and it never weakens the
 * one protection that matters.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The induction content lifecycle is built for a live platform: wording is
 * issued, never overwritten; versions supersede rather than disappear; an
 * approved script is part of an approval workflow. That is correct once
 * operatives are being inducted, and it is the wrong shape while the company
 * modules and the library are still being written, rendered, watched back and
 * thrown away. During the build, a rejected render is not history — it is a
 * failed experiment, and being made to carry it forward forever is noise that
 * hides the content that counts.
 *
 * ── WHAT IT DOES AND DOES NOT RELAX ───────────────────────────────────────
 *
 * There are two different reasons the code refuses to delete something, and only
 * one of them is about the record:
 *
 *   EVIDENCE      published to operatives, or watched by one. This is the record
 *                 of what somebody was shown. NEVER deletable — not with this
 *                 flag on, not by a Director, not at all. See `consumption.ts`,
 *                 which is the single place that answers the question.
 *
 *   HOUSEKEEPING  superseded, or approved-but-unpublished, or simply "a newer
 *                 version exists". Nobody outside the platform has seen any of
 *                 it. Refusing these is versioning discipline, not evidence
 *                 protection, and this flag is what stands them down.
 *
 * So the flag shifts exactly the second category. Every refusal that cites a
 * published version or a viewing record is unconditional and stays in force.
 *
 * ── FAIL-CLOSED, AND VISIBLE ──────────────────────────────────────────────
 *
 * INDUCTION_CONTENT_RESET_ENABLED must be exactly "1". Unset, blank, "true",
 * "yes" or anything else means OFF and the lifecycle behaves as it does in
 * production — the same shape as the login overrides in
 * `services/auth/platformDevOverride.ts`, deliberately, because a capability
 * this broad should read the same way as the other temporary ones.
 *
 * It is also never silent: every screen offering a reset says the platform is in
 * its build phase, so nobody can be looking at a delete button without knowing
 * why it is there. Turning the flag off is the whole of the cutover.
 */

/** True only when the build-phase reset capability is explicitly switched on. */
export function contentResetEnabled(): boolean {
  return process.env.INDUCTION_CONTENT_RESET_ENABLED === '1';
}

/**
 * The sentence shown wherever a build-phase-only control appears.
 *
 * Kept here rather than in the components so the screens cannot drift into
 * describing the capability differently from one another.
 */
export const BUILD_PHASE_NOTICE =
  'SiteComply is in its build phase, so content that no operative has seen can be ' +
  'deleted or started again. Anything published to operatives, or watched by one, ' +
  'is still kept permanently.';

/**
 * The refusal used when a housekeeping-only rule is still in force because the
 * flag is off. Names the flag: the person reading it is the person who can
 * switch it on.
 */
export const RESET_DISABLED_REASON =
  'Build-phase reset is switched off, so this is kept as version history.';
