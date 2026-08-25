import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { TABLE_TOOLBAR_CLASS } from '@/components/platform/TableSurface';
import {
  WorkSurface,
  RailDetail,
  selectedRowClass,
  resolveSelected,
} from '@/components/platform/WorkSurface';
import { formatDateTimeUK } from '@/lib/datetime';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';
import { WorkerAccessManager } from '@/components/platform/WorkerAccessManager';
import {
  listSiteAssignments,
  canManageWorkerAccess,
  canSetEnforcement,
  listSiteRequirements,
} from '@/services/workerAccess/workerAssignmentService';

export const dynamic = 'force-dynamic';

const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  INVITED: 'Invited, not yet approved',
  ACTIVE: 'Approved',
  SUSPENDED: 'Suspended',
  REMOVED: 'Removed from project',
};

/** Platform → Site Details — Workers tab: on-site now + recent check-ins. */
export default async function SiteWorkersPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { item?: string; invite?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!permits(viewer.role, 'checkins', 'view')) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const detail = await getSiteDetailForViewer(viewer, params.id);
  if (!detail) notFound();

  const { currentWorkers, recentSubmissions } = detail;

  // SC-023 — project access. Null when the site is out of scope, which the
  // existing detail loader has already handled.
  const access = canManageWorkerAccess(viewer.role)
    ? await listSiteAssignments(viewer, params.id)
    : null;
  // SC-023 Phase 3 — requirements with live "who would be blocked" counts.
  const requirements = canManageWorkerAccess(viewer.role)
    ? ((await listSiteRequirements(viewer, params.id)) ?? [])
    : [];

  /**
   * UX REFRESH PHASE 5c — one project roster.
   *
   * "Current workers on site" and "Recent check-ins" were two panels because
   * they are two queries — and they showed THE SAME PEOPLE. On a quiet site the
   * identical worker appeared in both, which is the structure telling on itself:
   * organised by data source rather than by the question a manager is asking,
   * which is "who is on my project, and are they allowed to be?"
   *
   * One row per PERSON now, keyed on workerId, with a derived state. The
   * duplicate disappears by construction rather than by a rule.
   *
   * PERMISSIONS ARE NOT MERGED, ONLY ROWS. Check-in facts come from `detail`,
   * which the page already gates on checkins:view. Assignment facts come from
   * `access`, which is null unless canManageWorkerAccess — so a viewer without
   * that capability sees a roster built from check-ins alone, with no assignment
   * column and no hint that one exists.
   */
  const byWorker = new Map<
    string,
    {
      id: string;
      workerId: string;
      name: string;
      company: string;
      checkedInAt: Date | null;
      checkedOutAt: Date | null;
      lastVisitStatus: string | null;
      assignment: (typeof access extends null ? never : any) | null;
    }
  >();

  const put = (workerId: string, name: string, company: string) => {
    const existing = byWorker.get(workerId);
    if (existing) return existing;
    const row = {
      id: `worker:${workerId}`,
      workerId,
      name,
      company,
      checkedInAt: null as Date | null,
      checkedOutAt: null as Date | null,
      lastVisitStatus: null as string | null,
      assignment: null as any,
    };
    byWorker.set(workerId, row);
    return row;
  };

  // Open check-ins first: being on site now outranks every other fact about a
  // person, because it is the one that matters in an evacuation.
  for (const w of currentWorkers) {
    const row = put(w.workerId, w.fullName, w.company);
    row.checkedInAt = w.checkedInAt;
  }
  for (const sub of recentSubmissions) {
    const row = put(sub.workerId, sub.workerName, sub.company);
    if (!row.checkedInAt) {
      row.checkedInAt = sub.checkedInAt;
      row.checkedOutAt = sub.checkedOutAt ?? null;
      row.lastVisitStatus = sub.status;
    }
  }
  for (const a of access?.rows ?? []) {
    const row = put(a.workerId, a.workerName, a.company);
    row.assignment = a;
  }

  const ROSTER_STATE_ORDER = [
    'on-site',
    'checked-out',
    'assigned',
    'invited',
    'suspended',
    'removed',
    'seen',
  ] as const;
  type RosterState = (typeof ROSTER_STATE_ORDER)[number];

  const rosterState = (r: {
    checkedInAt: Date | null;
    checkedOutAt: Date | null;
    assignment: { status: string } | null;
  }): RosterState => {
    if (r.checkedInAt && !r.checkedOutAt) return 'on-site';
    if (r.assignment) {
      const st = r.assignment.status;
      if (st === 'SUSPENDED') return 'suspended';
      if (st === 'REMOVED') return 'removed';
      if (st === 'INVITED') return 'invited';
      if (r.checkedOutAt) return 'checked-out';
      return 'assigned';
    }
    return r.checkedOutAt ? 'checked-out' : 'seen';
  };

  const ROSTER_STATE_LABEL: Record<RosterState, string> = {
    'on-site': 'On site now',
    'checked-out': 'Checked out',
    assigned: 'Assigned, not present',
    invited: 'Invited',
    suspended: 'Suspended',
    removed: 'Removed',
    seen: 'Checked in previously',
  };
  const ROSTER_STATE_TONE: Record<RosterState, string> = {
    'on-site': 'bg-safe-50 text-safe-700',
    'checked-out': 'border border-line bg-surface-sunken text-ink-muted',
    assigned: 'bg-brand-50 text-brand-700',
    invited: 'bg-hivis-400/25 text-ink',
    suspended: 'bg-danger-50 text-danger-700',
    removed: 'border border-line bg-surface-sunken text-ink-subtle',
    seen: 'border border-line bg-surface-sunken text-ink-subtle',
  };

  const roster = [...byWorker.values()]
    .map((r) => ({ ...r, state: rosterState(r) }))
    .sort((a, b) => {
      const s =
        ROSTER_STATE_ORDER.indexOf(a.state) -
        ROSTER_STATE_ORDER.indexOf(b.state);
      if (s !== 0) return s;
      const at = a.checkedInAt?.getTime() ?? 0;
      const bt = b.checkedInAt?.getTime() ?? 0;
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name);
    });

  const selectedWorker = resolveSelected(searchParams?.item, roster);
  const workersPath = `/platform/dashboard/sites/${params.id}/workers`;

  // ONE invite path. The toolbar button is a link that sets ?invite=1, which
  // opens WorkerAccessManager's invite DIALOG directly. The access disclosure
  // is deliberately left alone: the invite workflow no longer lives inside it,
  // so there is nothing to scroll to and nothing to expand. Same URL-parameter
  // pattern this page already uses for row selection, so the link stays
  // shareable and the back button still works.
  const canInvite = canManageWorkerAccess(viewer.role) && access !== null;
  const autoOpenInvite = searchParams?.invite === '1' && canInvite;
  const inviteHref = `${workersPath}?${new URLSearchParams({
    ...(searchParams?.item ? { item: searchParams.item } : {}),
    invite: '1',
  }).toString()}`;

  return (
    <PlatformShell>
      <SiteDetailHeader viewer={viewer} siteId={params.id} active="workers" />

      {/* UX REFRESH PHASE 10 — see WorkSurface: no selection, no rail, so the
          "Roster" title never rendered. */}
      <WorkSurface
        toolbar={
          canInvite ? (
            /* The roster answers "who is on my project"; inviting is the direct
               continuation of that thought, so the action lives with the list
               rather than behind the access disclosure below. */
            /* TABLE_TOOLBAR_CLASS makes this the table's own control strip —
               recessed fill, bottom rule, standard padding — so the row is
               attached to the roster instead of floating above it. items-center
               overrides the class's items-end (meant for filter forms with
               labels) so the button is centred on the heading's line. */
            <div
              className={cn(
                TABLE_TOOLBAR_CLASS,
                'w-full items-center justify-between',
              )}
            >
              <span className="text-sm font-semibold text-ink">
                Workers on this project
              </span>
              {/* Solid green — inviting is a positive primary action — but at
                  listing dimensions: px-3 py-1.5, rounded-lg, and NO
                  touch-target. That utility sets min-h/min-w 3.25rem, which was
                  overriding the padding and holding the button at 52px tall
                  while stopping it hugging its label; the convention listing
                  actions (NotificationsList, PendingPhotos, AuditFindingsPanel)
                  omit it for exactly this reason. Colour carries the emphasis
                  so the footprint does not have to. */}
              <Link
                href={inviteHref}
                className="inline-flex shrink-0 items-center rounded-lg bg-safe-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-safe-600/20 hover:bg-safe-600"
              >
                Invite Worker
              </Link>
            </div>
          ) : undefined
        }
        railTitle="Worker"
        railEmpty="Select someone to see their site record."
        rail={
          selectedWorker && (
            <>
              <p className="text-base font-semibold text-ink">
                {selectedWorker.name}
              </p>
              <p className="mb-2 text-sm text-ink-subtle">
                {selectedWorker.company}
              </p>
              <dl>
                <RailDetail
                  label="State"
                  value={ROSTER_STATE_LABEL[selectedWorker.state]}
                />
                <RailDetail
                  label="Last check-in"
                  value={
                    selectedWorker.checkedInAt
                      ? formatDateTimeUK(selectedWorker.checkedInAt)
                      : 'Never checked in here'
                  }
                />
                {selectedWorker.checkedInAt && (
                  <RailDetail
                    label="Checked out"
                    value={
                      selectedWorker.checkedOutAt
                        ? formatDateTimeUK(selectedWorker.checkedOutAt)
                        : '— still on site'
                    }
                  />
                )}
                {selectedWorker.lastVisitStatus && (
                  <RailDetail
                    label="Last induction"
                    value={
                      selectedWorker.lastVisitStatus === 'COMPLIANT'
                        ? 'Compliant'
                        : 'Incomplete'
                    }
                  />
                )}
                {/* Assignment facts appear only when the viewer may manage
                    access — the roster is built from whichever sources they are
                    entitled to, never a merge of permissions. */}
                {selectedWorker.assignment && (
                  <>
                    <RailDetail
                      label="Project access"
                      value={
                        ASSIGNMENT_STATUS_LABEL[
                          selectedWorker.assignment.status
                        ] ?? selectedWorker.assignment.status
                      }
                    />
                    {selectedWorker.assignment.role && (
                      <RailDetail
                        label="Role on site"
                        value={String(selectedWorker.assignment.role)
                          .toLowerCase()
                          .replace(/_/g, ' ')}
                      />
                    )}
                    {selectedWorker.assignment.endDate && (
                      <RailDetail
                        label="Access until"
                        value={`${formatDateTimeUK(
                          selectedWorker.assignment.endDate,
                        )}${
                          selectedWorker.assignment.expiringSoon
                            ? ' · expiring soon'
                            : ''
                        }`}
                      />
                    )}
                    {selectedWorker.assignment.invitationCode && (
                      <RailDetail
                        label="Invitation code"
                        value={
                          <span className="font-mono">
                            {selectedWorker.assignment.invitationCode}
                          </span>
                        }
                      />
                    )}
                  </>
                )}
              </dl>
              <Link
                href={`/platform/dashboard/workers/${selectedWorker.workerId}`}
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
              >
                View worker record →
              </Link>
            </>
          )
        }
      >
        {roster.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            Nobody has checked in to this project yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Worker</th>
                  <th className="px-5 py-2.5 font-medium">Company</th>
                  <th className="px-5 py-2.5 font-medium">State</th>
                  <th className="px-5 py-2.5 font-medium">Last check-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {roster.map((r) => {
                  const isSelected = selectedWorker?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={selectedRowClass(isSelected)}
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`${workersPath}?item=${encodeURIComponent(r.id)}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-ink-muted">{r.company}</td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                            ROSTER_STATE_TONE[r.state],
                          )}
                        >
                          {ROSTER_STATE_LABEL[r.state]}
                        </span>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-ink-muted">
                        {r.checkedInAt ? formatDateTimeUK(r.checkedInAt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </WorkSurface>

      {/* The roster above answers "who is on my project". This is where you
          CHANGE that — invite, approve, suspend, transfer, set enforcement and
          requirements. It sits behind a disclosure so the page shows ONE people
          list by default; before this it rendered a second list of the same
          workers directly beneath the first. */}
      {access ? (
        <details className="group mt-4 rounded-xl border border-line bg-surface shadow-card">
          <summary className="touch-target cursor-pointer list-none px-4 py-3 text-sm font-bold text-ink marker:content-none">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="text-ink-subtle transition-transform group-open:rotate-90"
              >
                ›
              </span>
              Manage project access
              <span className="font-normal text-ink-subtle">
                ({access.rows.length} assigned
                {access.enforced ? ' · controlled access ON' : ''})
              </span>
            </span>
            <span className="mt-0.5 block pl-5 text-xs font-normal text-ink-subtle">
              Invite and approve workers, set access windows, and choose what a
              worker must satisfy before they can check in.
            </span>
          </summary>
          <div className="border-t border-line p-4">
            <WorkerAccessManager
              siteId={params.id}
              enforced={access.enforced}
              rows={access.rows}
              canManage={canManageWorkerAccess(viewer.role)}
              autoOpenInvite={autoOpenInvite}
              canSetEnforcement={canSetEnforcement(viewer.role)}
              otherSites={viewer.sites
                .filter((x) => x.id !== params.id && x.status === 'ACTIVE')
                .map((x) => ({ id: x.id, name: x.name }))}
              requirements={requirements}
            />
          </div>
        </details>
      ) : null}
    </PlatformShell>
  );
}
