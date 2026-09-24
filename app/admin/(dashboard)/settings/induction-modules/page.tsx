import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { InductionModulesSection } from '@/components/platform/InductionModulesSection';
import { moduleRowsForEditor } from '@/services/inductionModules/moduleRows';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Induction modules — FULLY MANAGEABLE, and deliberately so.
 *
 * ── THIS IS NOT THE COMPANY/NOTIFICATIONS PATTERN ─────────────────────────
 *
 * The two read-only mirrors in this folder exist because they were once second
 * EDITORS of a singleton row: two surfaces wrote the same values under different
 * permissions with no shared rule layer, and neither showed what the other had
 * done. The fix was to retire the writes.
 *
 * Company modules are a different shape and must not be confused with that. There
 * is one service, one approval workflow, one audit trail and one action dispatcher
 * (`moduleActions.ts`) which this page and the Induction Videos page both call.
 * Nothing is duplicated: this is a second front door onto one system, not a second
 * writer of one row. The owner's decision is that an Admin Centre administrator
 * has authority equivalent to a Platform Director for company-level content.
 *
 * ── THE SAME COMPONENT, NOT A COPY OF IT ──────────────────────────────────
 *
 * `InductionModulesSection` is the editor used by Induction Videos, rendered here
 * with the Admin endpoint. If the editor gains a field, both places gain it, and
 * they cannot disagree about what a module says.
 *
 * OWNER and ADMIN manage; VIEWER reads. That mirrors `ADMIN_WRITE_ROLES`
 * everywhere else in the Admin Centre rather than inventing a rule for this page,
 * and the service refuses a VIEWER again regardless of what this page renders.
 */
export default async function AdminInductionModulesPage() {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const manages = adminCanManage(session.role);
  const rows = await moduleRowsForEditor();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/settings"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Induction modules</h1>
        <p className="text-ink-muted">
          The standard content every operative hears on every project, written
          once and included in every site’s induction alongside that project’s own
          hazards and arrangements.
        </p>
      </header>

      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        These are the same modules managed in{' '}
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
    </div>
  );
}
