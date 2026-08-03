import { prisma } from '@/lib/prisma';

/**
 * SC-025 — the completion checklist.
 *
 * Three severities, because the requirement asks for three distinct things:
 *
 *   BLOCK       must be resolved before closure. Closure is refused.
 *   WARN        may be overridden, but the override is RECORDED against the
 *               closure event with its count at that moment.
 *   UNAVAILABLE the platform cannot answer this. Shown as unavailable rather
 *               than silently passing — a checklist that quietly omits a
 *               requirement looks identical to one that met it.
 *
 * BLOCK is deliberately narrow: workers still checked in, and permits still
 * live. Both are safety-critical rather than administrative — a fire register
 * that lists three people on a closed site is wrong in a way that an open
 * corrective action is not, and a live permit authorises work on a project
 * that no longer accepts records of it.
 */

export type ChecklistSeverity = 'BLOCK' | 'WARN' | 'UNAVAILABLE';

export interface ChecklistItem {
  key: string;
  label: string;
  severity: ChecklistSeverity;
  /** Outstanding count. Null when the platform cannot answer. */
  count: number | null;
  /** True when there is nothing outstanding. */
  satisfied: boolean;
  /** What the user must do, shown only when unsatisfied. */
  detail: string;
  /** Why the platform cannot answer — UNAVAILABLE items only. */
  unavailableReason?: string;
}

export interface ClosureChecklist {
  items: ChecklistItem[];
  /** Unsatisfied BLOCK items. Non-empty means closure is refused. */
  blockers: ChecklistItem[];
  /** Unsatisfied WARN items — overridable, but recorded. */
  warnings: ChecklistItem[];
  canClose: boolean;
}

/**
 * Build the checklist for a project.
 *
 * Counts only — no personal data — so the result is safe to render, log and
 * snapshot onto the closure event.
 */
export async function buildClosureChecklist(
  siteId: string,
): Promise<ClosureChecklist> {
  const [
    workersOnSite,
    livePermits,
    openActions,
    overdueInspections,
    outstandingTasks,
    expiredDocuments,
    closeOutPacks,
  ] = await Promise.all([
    // BLOCK — an open check-in with no check-out means the fire register still
    // says this person is on site.
    prisma.submission.count({
      where: { jobSiteId: siteId, checkedOutAt: null },
    }),
    // BLOCK — a permit that is still live authorises work.
    prisma.permit.count({
      where: {
        jobSiteId: siteId,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
      },
    }),
    prisma.action.count({
      where: { jobSiteId: siteId, status: { not: 'COMPLETED' } },
    }),
    // Overdue scheduled inspections: due in the past and not finished.
    prisma.complianceOccurrence.count({
      where: {
        schedule: { jobSiteId: siteId },
        dueAt: { lt: new Date() },
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
    }),
    // Still-to-do scheduled work of any due date.
    prisma.complianceOccurrence.count({
      where: {
        schedule: { jobSiteId: siteId },
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
    }),
    // "Missing documents" is not directly answerable — there is no required-document
    // register. Expired documents ARE answerable and are the nearest true signal.
    prisma.document.count({
      where: { jobSiteId: siteId, expiresAt: { lt: new Date() } },
    }),
    prisma.closeOutPack.count({ where: { jobSiteId: siteId } }),
  ]);

  const items: ChecklistItem[] = [
    {
      key: 'workers_on_site',
      label: 'Workers still checked in',
      severity: 'BLOCK',
      count: workersOnSite,
      satisfied: workersOnSite === 0,
      detail:
        'Everyone must be checked out before the project closes, or the site register will still show them on site.',
    },
    {
      key: 'active_permits',
      label: 'Active permits to work',
      severity: 'BLOCK',
      count: livePermits,
      satisfied: livePermits === 0,
      detail:
        'Close or cancel every live permit. A permit left open authorises work on a closed project.',
    },
    {
      key: 'open_actions',
      label: 'Open corrective actions',
      severity: 'WARN',
      count: openActions,
      satisfied: openActions === 0,
      detail:
        'These will stay open and become read-only. Recorded against the closure.',
    },
    {
      key: 'overdue_inspections',
      label: 'Overdue inspections',
      severity: 'WARN',
      count: overdueInspections,
      satisfied: overdueInspections === 0,
      detail:
        'Scheduled inspections past their due date that were never completed.',
    },
    {
      key: 'outstanding_tasks',
      label: 'Outstanding compliance tasks',
      severity: 'WARN',
      count: outstandingTasks,
      satisfied: outstandingTasks === 0,
      detail:
        'Scheduled work still to do. Generation stops when the project closes.',
    },
    {
      key: 'expired_documents',
      label: 'Expired documents',
      severity: 'WARN',
      count: expiredDocuments,
      satisfied: expiredDocuments === 0,
      detail:
        'Documents past their expiry date. SiteComply holds no register of which documents a project REQUIRES, so this cannot report genuinely missing ones.',
    },
    {
      key: 'close_out_pack',
      label: 'Close-out pack generated',
      severity: 'WARN',
      count: closeOutPacks === 0 ? 1 : 0,
      satisfied: closeOutPacks > 0,
      detail:
        'No close-out pack has been generated. A pack can still be generated after closure.',
    },
    {
      // Honest about the gap rather than passing silently — the same treatment
      // SC-024 gives this section in the close-out pack.
      key: 'incidents',
      label: 'Unresolved incidents',
      severity: 'UNAVAILABLE',
      count: null,
      satisfied: false,
      detail: 'Check your incident records outside SiteComply before closing.',
      unavailableReason:
        'SiteComply does not yet record incidents, so this cannot be checked.',
    },
  ];

  const blockers = items.filter((i) => i.severity === 'BLOCK' && !i.satisfied);
  const warnings = items.filter((i) => i.severity === 'WARN' && !i.satisfied);

  return { items, blockers, warnings, canClose: blockers.length === 0 };
}

/** The compact form snapshotted onto the closure event. */
export function warningSnapshot(
  warnings: ChecklistItem[],
): { key: string; label: string; count: number }[] {
  return warnings.map((w) => ({
    key: w.key,
    label: w.label,
    count: w.count ?? 0,
  }));
}
