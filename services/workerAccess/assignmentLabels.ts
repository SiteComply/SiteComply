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
 * "Awaiting approval" survives only for a genuinely INVITED row, which now
 * arises in exactly three ways: re-inviting a suspended worker, re-inviting a
 * removed one, and a transfer in from another site.
 */
export interface AssignmentLabelInput {
  status: string;
  /** Set at the worker's FIRST check-in to this site. Null until then. */
  acceptedAt: Date | string | null;
}

export function assignmentStatusLabel(a: AssignmentLabelInput): string {
  switch (a.status) {
    case 'ACTIVE':
      return a.acceptedAt ? 'Active' : 'Invited';
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
      // Invited-but-not-yet-arrived is deliberately NEUTRAL, not green. Green
      // says "on the project"; they have not turned up yet.
      return a.acceptedAt ? 'bg-safe-50 text-safe-700' : 'bg-surface-sunken text-ink-muted';
    case 'INVITED':
      return 'bg-hivis-500/10 text-ink-muted';
    case 'SUSPENDED':
      return 'bg-danger-50 text-danger-700';
    default:
      return 'bg-surface-sunken text-ink-muted';
  }
}
