'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface EditableScene {
  id: string;
  sceneType: string;
  heading: string;
  narration: string;
  required: boolean;
  sourceRefs: string[];
}

/**
 * Reviewing an induction script.
 *
 * A REVIEWER IS CHECKING FACTS, not prose. Each scene shows the fields its
 * narration was built from, so a sentence can be checked against the record
 * that produced it rather than taken on trust.
 *
 * A REQUIRED SCENE CANNOT BE REMOVED. The project's own records say it must be
 * in the induction; the button is absent rather than present-and-refusing, and
 * the service refuses it regardless.
 *
 * EDITING AFTER APPROVAL withdraws the approval. The page says so before the
 * edit rather than surprising the reviewer afterwards.
 */
export function ScriptEditor({
  videoId,
  status,
  canApprove,
  scenes,
}: {
  videoId: string;
  status: string;
  canApprove: boolean;
  scenes: EditableScene[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approved = status === 'SCRIPT_APPROVED';
  const published = status === 'PUBLISHED';
  const generating = status === 'SCRIPT_GENERATING';
  const readOnly = published || generating;

  async function call(body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/platform/induction-video/${videoId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return;
      }
      setDrafts({});
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (generating) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
        <p className="text-sm font-semibold text-ink">The script is being written.</p>
        <p className="mt-1 text-sm text-ink-muted">
          This runs in the background and usually takes under a minute. Refresh
          to see it.
        </p>
      </section>
    );
  }

  if (scenes.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
        <p className="text-sm text-ink-muted">There is no script on this version.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      {approved && (
        <p className="rounded-lg border border-safe-500/40 bg-safe-50 px-3 py-2 text-sm text-safe-700">
          This script is approved. Editing a scene returns it to review, because
          what was approved would no longer be what is here.
        </p>
      )}

      {scenes.map((scene) => {
        const draft = drafts[scene.id];
        const dirty = draft !== undefined && draft.trim() !== scene.narration.trim();
        return (
          <article key={scene.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-bold text-ink">{scene.heading}</h3>
              {scene.required ? (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  Required
                </span>
              ) : (
                <span className="text-xs text-ink-subtle">Optional</span>
              )}
              <span className="ml-auto text-xs text-ink-subtle">
                {scene.sourceRefs.length > 0
                  ? `From: ${scene.sourceRefs.join(', ')}`
                  : 'Standard wording'}
              </span>
            </div>

            <textarea
              value={draft ?? scene.narration}
              onChange={(e) => setDrafts((d) => ({ ...d, [scene.id]: e.target.value }))}
              rows={4}
              readOnly={readOnly}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink read-only:bg-surface-sunken"
            />

            {!readOnly && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!dirty || busy !== null}
                  onClick={() =>
                    call({ action: 'editScene', sceneId: scene.id, narration: draft }, scene.id)
                  }
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                >
                  {busy === scene.id ? 'Saving…' : 'Save scene'}
                </button>
                {dirty && (
                  <button
                    type="button"
                    onClick={() => setDrafts((d) => ({ ...d, [scene.id]: scene.narration }))}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    Undo
                  </button>
                )}
                {/* Absent, not disabled, for a required scene: the project's own
                    records put it there and no reviewer may take it out. */}
                {!scene.required && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => call({ action: 'removeScene', sceneId: scene.id }, `rm-${scene.id}`)}
                    className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-40"
                  >
                    Remove scene
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}

      {!published && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="text-sm text-ink-muted">
            {approved
              ? 'Approved and ready for the next stage.'
              : canApprove
                ? 'Approving records that you have read this script and accept it for this project.'
                : 'Only a Director or Site Manager may approve an induction script.'}
          </p>
          <button
            type="button"
            disabled={!canApprove || approved || busy !== null}
            onClick={() => call({ action: 'approve' }, 'approve')}
            className="ml-auto rounded-lg bg-safe-500 px-4 py-2 text-sm font-semibold text-white hover:bg-safe-600 disabled:opacity-40"
          >
            {busy === 'approve' ? 'Approving…' : approved ? 'Approved' : 'Approve script'}
          </button>
        </div>
      )}
    </section>
  );
}
