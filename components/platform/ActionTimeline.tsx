'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTimeUK } from '@/lib/datetime';
import { actionStatusLabel } from '@/services/actions/actionConstants';

export interface ActivityRow {
  id: string;
  type: 'CREATED' | 'COMMENT' | 'STATUS_CHANGE' | 'ASSIGNMENT';
  note: string | null;
  fromValue: string | null;
  toValue: string | null;
  authorName: string | null;
  createdAt: string; // ISO
}

/**
 * Activity timeline for an action: a chronological history of creation,
 * assignment, status changes and comments. Roles with the actions "edit"
 * permission can add an update (comment) at the bottom.
 */
export function ActionTimeline({
  actionId,
  activities,
  canComment,
}: {
  actionId: string;
  activities: ActivityRow[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function addComment() {
    if (body.trim() === '' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/actions/${actionId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setBody('');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not add your update. Please try again.');
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Activity
      </h2>

      {activities.length === 0 ? (
        <p className="text-sm text-ink-subtle">No activity yet.</p>
      ) : (
        <ol className="space-y-4">
          {activities.map((a) => (
            <li key={a.id} className="flex gap-3">
              <Dot type={a.type} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{a.authorName ?? 'Someone'}</span>{' '}
                  {describe(a)}
                </p>
                {a.note && (
                  <div className="mt-1 whitespace-pre-line rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">
                    {a.note}
                  </div>
                )}
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {formatDateTimeUK(a.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {canComment && (
        <div className="mt-5 border-t border-line pt-4">
          <label className="block text-sm font-semibold text-ink">Add an update</label>
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment or progress update…"
            className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {error && <p className="mt-1 text-sm font-medium text-danger-600">{error}</p>}
          <div className="mt-2">
            <button
              type="button"
              disabled={busy || body.trim() === ''}
              onClick={addComment}
              className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Posting…' : 'Add update'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function describe(a: ActivityRow): string {
  switch (a.type) {
    case 'CREATED':
      return 'created this action';
    case 'COMMENT':
      return 'added an update';
    case 'STATUS_CHANGE':
      return `changed status from ${actionStatusLabel(a.fromValue ?? '')} to ${actionStatusLabel(
        a.toValue ?? '',
      )}`;
    case 'ASSIGNMENT':
      return a.fromValue
        ? `reassigned from ${a.fromValue} to ${a.toValue ?? 'Unassigned'}`
        : `assigned this to ${a.toValue ?? 'Unassigned'}`;
    default:
      return 'updated this action';
  }
}

function Dot({ type }: { type: ActivityRow['type'] }) {
  const color =
    type === 'COMMENT'
      ? 'bg-brand-500'
      : type === 'STATUS_CHANGE'
        ? 'bg-safe-500'
        : type === 'ASSIGNMENT'
          ? 'bg-hivis-500'
          : 'bg-ink-subtle';
  return (
    <span className="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden>
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}
