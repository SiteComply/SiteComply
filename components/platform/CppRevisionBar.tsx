'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

/**
 * CPP document control Phase A — the revision bar above the plan.
 *
 * Carries the three things a controlled document has to answer on sight: which
 * version is in force, whether what you are reading is that version, and whether
 * it still matches the site.
 *
 * Type-only coupling to the service (this is a client component and the service
 * reaches lib/prisma), so the shapes are declared here rather than imported.
 */
export interface RevisionBarSummary {
  id: string;
  version: number;
  status: 'DRAFT' | 'ISSUED' | 'SUPERSEDED';
  preparedByName: string;
  issuedByName: string | null;
  issuedAt: string | null;
}

export function CppRevisionBar({
  siteId,
  issued,
  draft,
  drift,
  viewing,
  canCreate,
  canIssue,
}: {
  siteId: string;
  issued: RevisionBarSummary | null;
  draft: RevisionBarSummary | null;
  /** Null when nothing is issued — nothing to drift from. */
  drift: { changed: boolean; changedSections: string[] } | null;
  /** What the reader is looking at right now. */
  viewing: { kind: 'LIVE' } | { kind: 'REVISION'; version: number; status: string };
  canCreate: boolean;
  canIssue: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function act(action: 'create' | 'issue' | 'discard', revisionId?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/cpp-revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, revisionId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; version?: number };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not complete that.');
        return;
      }
      toast.success(
        action === 'create'
          ? `Revision ${data.version} created as a draft.`
          : action === 'issue'
            ? `Revision ${data.version} issued.`
            : 'Draft discarded.',
      );
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const base = `/platform/dashboard/sites/${siteId}/cpp`;

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {issued
              ? `Revision ${issued.version} is the version in force`
              : 'No revision has been issued'}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {issued
              ? `Issued ${issued.issuedAt ? new Date(issued.issuedAt).toLocaleDateString('en-GB') : ''}${issued.issuedByName ? ` by ${issued.issuedByName}` : ''}.`
              : 'The plan below is a working draft assembled from current site information.'}
            {draft ? ` Revision ${draft.version} is open as a draft.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The switcher. Which document you are reading must never be a guess. */}
          <Link
            href={base}
            className={`touch-target rounded-lg border px-3 py-2 text-sm font-medium ${
              viewing.kind === 'LIVE'
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-line text-ink hover:bg-surface-sunken'
            }`}
          >
            Working draft
          </Link>
          {issued && (
            <Link
              href={`${base}?revision=${issued.id}`}
              className={`touch-target rounded-lg border px-3 py-2 text-sm font-medium ${
                viewing.kind === 'REVISION' && viewing.version === issued.version
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-line text-ink hover:bg-surface-sunken'
              }`}
            >
              Issued (Rev {issued.version})
            </Link>
          )}
          <Link
            href={`${base}/revisions`}
            className="touch-target rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            History
          </Link>
        </div>
      </div>

      {/* DRIFT. The reason this is worth having: a plan that no longer matches
          the site is the thing CDM asks a Principal Contractor to notice. It
          names the sections so the decision to revise is an informed one —
          software can detect a change, only a duty holder can judge whether it
          is material. */}
      {drift?.changed && (
        <div className="mt-3 rounded-lg border border-hivis-500/50 bg-hivis-500/10 p-3">
          <p className="text-sm font-semibold text-ink">
            Site information has changed since Revision {issued?.version} was
            issued
            {drift.changedSections.length > 0
              ? ` — ${drift.changedSections.length} section${drift.changedSections.length === 1 ? '' : 's'} differ`
              : ''}
            .
          </p>
          {drift.changedSections.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-ink-muted">
              {drift.changedSections.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-ink-muted">
            The issued revision is unchanged and remains the version in force.
            Issue a new revision when the change warrants it.
          </p>
        </div>
      )}

      {(canCreate || canIssue) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {canCreate && !draft && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act('create')}
              className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Create a revision from the current plan'}
            </button>
          )}
          {draft && canIssue && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act('issue', draft.id)}
              className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Issue Revision {draft.version}
            </button>
          )}
          {draft && canCreate && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act('discard', draft.id)}
              className="text-sm font-medium text-ink-subtle hover:underline disabled:opacity-50"
            >
              Discard draft
            </button>
          )}
          {draft && !canIssue && (
            <p className="text-xs text-ink-muted">
              Revision {draft.version} is ready to issue. Only a Director can
              issue a Construction Phase Plan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
