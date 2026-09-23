/**
 * How a site assignment is described, in ONE place.
 *
 * There were two label maps — one in WorkerAccessManager, one on the Workers
 * page — and they disagreed: the same row read "Awaiting approval" in the access
 * panel and "Invited, not yet approved" in the worker rail. Two maps for one
 * concept is how that happens, so both now call this.
 *
 * ACTIVE deliberately splits in two. A first-time invitation grants access
 * outright, so every ordinary worker is ACTIVE from the moment they are invited.
 * Calling that "Approved" describes a step that no longer exists, and calling it
 * "Active" claims someone is on the project before they have ever arrived. It
 * reads INVITED until their first check-in to this site, then ACTIVE.
 *
 * `arrivedAt` is DERIVED from attendance history, not stored. A stored flag
 * needed a backfill in every environment and could drift from the check-ins it
 * was summarising.
 *
 * "Awaiting approval" survives only for a genuinely INVITED row, which now
 * arises in exactly three ways: re-inviting a suspended worker, re-inviting a
 * removed one, and a transfer in from another site.
 */

import { formatDateUK } from '@/lib/datetime';
export interface AssignmentLabelInput {
  status: string;
  /**
   * Where today sits in the assignment's access window, when one is set.
   *
   * ACTIVE ALONE IS NOT ACCESS. An assignment outside its window is refused at
   * the gate, and a roster that answered "Active" sent managers looking for a
   * fault that was sitting in the dates. Optional so callers that do not carry
   * the window keep the old behaviour rather than claiming a state they cannot
   * see.
   */
  windowState?: 'pending' | 'open' | 'expired' | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  /**
   * The worker's first check-in to this site, DERIVED from attendance history
   * rather than stored. Null until they have actually turned up.
   */
  arrivedAt: Date | string | null;
}

export function assignmentStatusLabel(a: AssignmentLabelInput): string {
  switch (a.status) {
    case 'ACTIVE':
      // The window first: an approved worker outside it cannot check in, and
      // that is the fact a manager needs, not whether they once arrived.
      if (a.windowState === 'expired' && a.endDate) {
        return `Access ended ${formatDateUK(new Date(a.endDate))}`;
      }
      if (a.windowState === 'pending' && a.startDate) {
        return `Access starts ${formatDateUK(new Date(a.startDate))}`;
      }
      return a.arrivedAt ? 'Active' : 'Invited';
    case 'INVITED':
      return 'Awaiting approval';
    case 'SUSPENDED':
      return 'Suspended';
    case 'REMOVED':
      return 'Removed from project';
    default:
      return a.status;
  }
}

/** Badge colours, keyed on the same split so the two never disagree. */
export function assignmentStatusClass(a: AssignmentLabelInput): string {
  switch (a.status) {
    case 'ACTIVE':
      // Outside its window an assignment grants nothing: say so in the colour
      // used for everything else that stops a worker at the gate.
      if (a.windowState === 'expired') return 'bg-danger-50 text-danger-700';
      if (a.windowState === 'pending') return 'bg-hivis-500/10 text-ink-muted';
      // Invited-but-not-yet-arrived is deliberately NEUTRAL, not green. Green
      // says "on the project"; they have not turned up yet.
      return a.arrivedAt ? 'bg-safe-50 text-safe-700' : 'bg-surface-sunken text-ink-muted';
    case 'INVITED':
      return 'bg-hivis-500/10 text-ink-muted';
    case 'SUSPENDED':
      return 'bg-danger-50 text-danger-700';
    default:
      return 'bg-surface-sunken text-ink-muted';
  }
}
