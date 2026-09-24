import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { AdminInductionVideoWorkspace } from '@/components/admin/AdminInductionVideoWorkspace';
import { InductionModulesSection } from '@/components/platform/InductionModulesSection';
import { moduleRowsForEditor } from '@/services/inductionModules/moduleRows';
import { inductionVideoHref } from '@/services/inductionVideo/inductionVideoAreas';

export const dynamic = 'force-dynamic';

/**
 * Admin → Induction videos → Company modules — fully manageable.
 *
 * ── ONE SYSTEM SEEN TWICE ─────────────────────────────────────────────────
 *
 * The same modules as the Platform's Company modules area: one service, one
 * approval workflow, one audit trail, one action dispatcher, one editor component.
 * A change made here IS a change there — not a copy that has to be kept in step.
 * The audit trail records which tier it came from.
 *
 * This is NOT the read-only pattern of Admin → Settings → Company and
 * Notifications. Those were second EDITORS of one singleton row with no shared
 * rule layer, and the fix was to retire their writes. Here there is a shared rule
 * layer, which is the whole reason two front doors are safe.
 *
 * ── PREVIOUSLY A SETTINGS ITEM ────────────────────────────────────────────
 *
 * It lived at /admin/settings/induction-modules for a few hours, which read as a
 * miscellaneous setting rather than part of the induction video product. That URL
 * now redirects here.
 *
 * OWNER and ADMIN manage; VIEWER reads. That mirrors ADMIN_WRITE_ROLES everywhere
 * else in this tier, and the service refuses a VIEWER again regardless of what
 * this page renders.
 */
export default async function AdminInductionModulesPage() {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const manages = adminCanManage(session.role);
  const rows = await moduleRowsForEditor();

  return (
    <AdminInductionVideoWorkspace active="modules">
      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        These are the same modules managed in the Platform under{' '}
        <span className="font-semibold text-ink">
          Induction videos → Company modules
        </span>
        , not a copy of them. A change made here applies to every project’s
        induction, and the history records that it came from the Admin Centre.
        {!manages && ' Your role can view these but not change them.'}
      </p>

      <InductionModulesSection
        modules={rows}
        canDraft={manages}
        canIssue={manages}
        endpoint="/api/admin/induction-modules"
      />

      <p className="text-xs text-ink-subtle">
        Project-by-project decisions — leaving a module out of one site, or
        changing its wording there — are made against that project in the Platform,
        where the departure is visible next to the script it affects. The same area
        in the Platform is at{' '}
        <code className="rounded bg-surface-sunken px-1">
          {inductionVideoHref('PLATFORM', 'modules')}
        </code>
        .
      </p>
    </AdminInductionVideoWorkspace>
  );
}
