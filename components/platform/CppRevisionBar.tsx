'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/components/ui/Dialog';
import { SignaturePad } from '@/components/checkin/SignaturePad';
import type { SignatureInput } from '@/services/inductionSignature/signatureService';
import {
  CPP_STAGES,
  recommendNextAction,
  type CppReadiness,
} from '@/services/sites/cppWorkflow';

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
  approverName,
  declaration,
  readiness,
  setupHref,
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
  /** Pre-filled into the signature. The person about to approve. */
  approverName: string;
  /** Snapshotted onto the revision, so it is shown before it is accepted. */
  declaration: string;
  /** Outstanding content, so gaps travel with the decision to issue. */
  readiness: CppReadiness;
  /** Where "complete the outstanding sections" leads. */
  setupHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [signature, setSignature] = useState<SignatureInput | null>(null);
  const [accepted, setAccepted] = useState(false);

  async function act(
    action: 'create' | 'issue' | 'discard',
    revisionId?: string,
    sig?: SignatureInput | null,
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/cpp-revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, revisionId, signature: sig ?? undefined }),
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
            ? `Revision ${data.version} approved and issued.`
            : 'Draft discarded.',
      );
      setApproving(false);
      setPreparing(false);
      setSignature(null);
      setAccepted(false);
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const base = `/platform/dashboard/sites/${siteId}/cpp`;

  /*
   * ONE recommended action, computed from the real state. The bar used to report
   * facts and offer a row of equally-weighted buttons, leaving the user to infer
   * what mattered. See cppWorkflow for the ordering and why it is that order.
   */
  const flow = recommendNextAction({
    issued: issued ? { version: issued.version } : null,
    draft: draft ? { version: draft.version } : null,
    drift,
    readiness,
    canCreate,
    canIssue,
  });

  const activeStage = CPP_STAGES.findIndex((st) => st.key === flow.stage);

  function runPrimary() {
    if (flow.primary?.kind === 'APPROVE_AND_ISSUE') return setApproving(true);
    // Preparing over a plan with holes asks first. Never blocks — see cppWorkflow.
    if (flow.gaps.length > 0) return setPreparing(true);
    return act('create');
  }

  return (
    <div className="mb-4 print:hidden">
      <div
        className={`rounded-xl border bg-surface p-4 shadow-card ${
          flow.tone === 'ATTENTION'
            ? 'border-hivis-500/50'
            : flow.tone === 'GOOD'
              ? 'border-safe-500/40'
              : 'border-line'
        }`}
      >
        {/* THE STAGE INDICATOR. The three states are not obvious from the
            controls, and a user needs to see where the plan sits before they can
            judge what to do about it. */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {CPP_STAGES.map((st, i) => {
            const done = i < activeStage;
            const current = i === activeStage;
            return (
              <li key={st.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    current
                      ? 'bg-brand-600 text-white'
                      : done
                        ? 'bg-safe-500 text-white'
                        : 'bg-surface-sunken text-ink-subtle ring-1 ring-line'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={`text-xs ${current ? 'font-bold text-ink' : 'text-ink-muted'}`}
                >
                  {st.label}
                  <span className="sr-only">
                    {current ? ' — current stage' : done ? ' — done' : ' — not yet reached'}
                  </span>
                </span>
                {i < CPP_STAGES.length - 1 && (
                  <span aria-hidden className="h-px w-6 bg-line" />
                )}
              </li>
            );
          })}
        </ol>

        <p className="mt-3 text-sm font-semibold text-ink">{flow.headline}</p>
        {flow.detail && (
          <p className="mt-0.5 text-sm text-ink-muted">{flow.detail}</p>
        )}

        {/* Drift, folded into the flow rather than sitting in its own box. The
            changed sections are behind a disclosure: the COUNT is the decision,
            the list is the detail. */}
        {drift?.changed && drift.changedSections.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-brand-700">
              Which sections changed?
            </summary>
            <ul className="mt-1 list-inside list-disc text-xs text-ink-muted">
              {drift.changedSections.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-ink-subtle">
              The issued revision is unchanged and remains the version in force.
            </p>
          </details>
        )}

        {/* ONE primary action, with everything else demoted. */}
        {(flow.primary || flow.secondary) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {flow.primary &&
              (flow.primary.kind === 'COMPLETE_CONTENT' ? (
                <Link
                  href={setupHref}
                  className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  {flow.primary.label}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={runPrimary}
                  className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? 'Working…' : flow.primary.label}
                </button>
              ))}
            {flow.secondary && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  flow.secondary!.kind === 'NONE' && draft
                    ? act('discard', draft.id)
                    : flow.gaps.length > 0
                      ? setPreparing(true)
                      : act('create')
                }
                className="text-sm font-medium text-ink-subtle hover:underline disabled:opacity-50"
              >
                {flow.secondary.label}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Secondary row: which document you are reading, and the history. Quieter
          than the recommended action, but never hidden. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link
          href={base}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            viewing.kind === 'LIVE'
              ? 'border-brand-600 bg-brand-50 text-brand-700'
              : 'border-line text-ink-muted hover:bg-surface-sunken'
          }`}
        >
          Working draft
        </Link>
        {issued && (
          <Link
            href={`${base}?revision=${issued.id}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              viewing.kind === 'REVISION' && viewing.version === issued.version
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-line text-ink-muted hover:bg-surface-sunken'
            }`}
          >
            Issued (Rev {issued.version})
          </Link>
        )}
        <Link
          href={`${base}/revisions`}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken"
        >
          Revision history
        </Link>
      </div>

      {/* PREPARING OVER GAPS. Asks, never refuses — a Principal Contractor may
          legitimately issue an early plan and revise it as work proceeds. */}
      {preparing && (
        <Dialog
          open
          onClose={() => setPreparing(false)}
          busy={busy}
          titleId="cpp-prepare-title"
          className="max-w-md"
        >
          <div className="p-5">
            <h2 id="cpp-prepare-title" className="text-base font-bold text-ink">
              Prepare a revision with information outstanding?
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              A revision is a dated snapshot of the plan exactly as it stands now.
              Anything still outstanding will be outstanding in the issued plan.
            </p>
            <ul className="mt-2 list-inside list-disc rounded-lg border border-hivis-500/40 bg-hivis-500/10 p-3 text-sm text-ink">
              {flow.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => act('create')}
                className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Prepare it anyway'}
              </button>
              <Link
                href={setupHref}
                className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
              >
                Complete the sections first
              </Link>
            </div>
          </div>
        </Dialog>
      )}

      {/* APPROVAL. Issuing IS the approval, so there is no unsigned route to it:
          an issued plan with no named approver would be the blank-lines-and-a-pen
          problem again, only harder to notice because it would look official. */}
      {approving && draft && (
        <Dialog
          open
          onClose={() => setApproving(false)}
          busy={busy}
          titleId="cpp-approve-title"
          className="max-w-lg"
        >
          <div className="p-5">
            <h2 id="cpp-approve-title" className="text-base font-bold text-ink">
              Approve and issue Revision {draft.version}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              This becomes the version in force for this project. It cannot be
              edited afterwards — a change is made by issuing a further revision.
            </p>

            {/* THE GAPS, ON THE SAME SCREEN AS THE SIGNATURE. Somebody about to
                sign "in my judgement it is suitable and sufficient" should not
                have to remember what was outstanding. It does not block — see
                cppWorkflow — it just refuses to let them sign blind. */}
            {flow.gaps.length > 0 && (
              <div className="mt-3 rounded-lg border border-hivis-500/40 bg-hivis-500/10 p-3">
                <p className="text-sm font-semibold text-ink">
                  This plan still has information outstanding
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
                  {flow.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 rounded-lg border border-line bg-surface-sunken p-3 text-sm text-ink">
              {declaration}
            </p>

            <label className="mt-3 flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>I confirm the declaration above.</span>
            </label>

            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Signature
              </p>
              <SignaturePad defaultName={approverName} onChange={setSignature} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !accepted || !signature}
                onClick={() => act('issue', draft.id, signature)}
                className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Issuing…' : 'Approve and issue'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setApproving(false)}
                className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
