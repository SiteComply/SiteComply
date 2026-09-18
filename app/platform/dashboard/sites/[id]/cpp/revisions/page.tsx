import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { getCppDraft } from '@/services/sites/cppService';
import { getRevisionState } from '@/services/sites/cppRevisionService';
import { formatDateTimeUK } from '@/lib/datetime';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * CPP document control Phase A — revision history.
 *
 * Every revision the site has ever had, openable. A superseded revision is NOT
 * hidden or greyed into uselessness: being able to read what the plan said on a
 * given date is the entire reason the feature exists, and that is the version
 * that matters after an incident.
 */
export default async function CppRevisionsPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  const cpp = await getCppDraft(viewer, params.id);
  if (!cpp) notFound();

  const state = await getRevisionState(viewer, params.id, cpp);
  if (!state) notFound();

  // The append-only trail, read alongside the revisions it belongs to.
  const events = await prisma.cppRevisionEvent.findMany({
    where: { revision: { jobSiteId: params.id } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      action: true,
      note: true,
      actorName: true,
      createdAt: true,
      revision: { select: { version: true } },
    },
  });

  const base = `/platform/dashboard/sites/${cpp.site.id}/cpp`;

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: cpp.site.name, href: `/platform/dashboard/sites/${cpp.site.id}` },
          { label: 'Construction Phase Plan', href: base },
          { label: 'Revision history' },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Revision history</h1>
          <p className="text-sm text-ink-muted">
            {state.revisions.length === 0
              ? 'No revisions have been taken for this site.'
              : `${state.revisions.length} revision${state.revisions.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <Link
          href={base}
          className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
        >
          Back to the plan
        </Link>
      </div>

      {state.revisions.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
          <p className="text-sm text-ink">
            The Construction Phase Plan for this site is a working draft
            assembled from current information.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Taking a revision freezes it as a dated, versioned document that can
            be issued and referred back to.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {state.revisions.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">
                    Revision {r.version}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Prepared {formatDateTimeUK(r.preparedAt)} by{' '}
                    {r.preparedByName}
                    {r.issuedAt
                      ? ` · Issued ${formatDateTimeUK(r.issuedAt)}${r.issuedByName ? ` by ${r.issuedByName}` : ''}`
                      : ''}
                    {r.supersededAt
                      ? ` · Superseded ${formatDateTimeUK(r.supersededAt)}`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                      r.status === 'ISSUED'
                        ? 'bg-safe-50 text-safe-700'
                        : r.status === 'SUPERSEDED'
                          ? 'bg-surface-sunken text-ink-muted'
                          : 'bg-hivis-500/15 text-ink'
                    }`}
                  >
                    {r.status === 'ISSUED'
                      ? 'In force'
                      : r.status === 'SUPERSEDED'
                        ? 'Superseded'
                        : 'Draft'}
                  </span>
                  <Link
                    href={`${base}?revision=${r.id}`}
                    className="touch-target rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
                  >
                    Open
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {events.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-bold text-ink">Audit trail</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Append-only. Entries are never edited or removed.
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 px-4 py-2 text-sm">
                <span className="font-semibold text-ink">
                  Revision {e.revision.version}
                </span>
                <span className="text-ink">
                  {e.action === 'CREATED'
                    ? 'created'
                    : e.action === 'ISSUED'
                      ? 'issued'
                      : e.action === 'SUPERSEDED'
                        ? 'superseded'
                        : e.action.toLowerCase()}
                </span>
                <span className="text-ink-muted">
                  by {e.actorName} · {formatDateTimeUK(e.createdAt)}
                </span>
                {e.note && (
                  <span className="w-full text-xs text-ink-subtle">{e.note}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PlatformShell>
  );
}
