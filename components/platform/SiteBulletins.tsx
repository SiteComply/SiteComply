'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  BULLETIN_CATEGORIES,
  BULLETIN_CATEGORY_BADGE,
  bulletinCategoryLabel,
  BULLETIN_TITLE_MAX,
  BULLETIN_BODY_MAX,
  type BulletinCategoryValue,
} from '@/services/bulletins/bulletinConstants';

export interface BulletinRow {
  id: string;
  category: string;
  title: string | null;
  body: string;
  active: boolean;
  publishedAtLabel: string;
  createdByName: string | null;
  readCount: number;
}

/**
 * Site Daily Bulletins manager (SC-002). Lists a site's bulletins and — for roles
 * with the right permission — lets managers publish a new one, archive/retract or
 * re-activate, and delete. All writes go through /api/platform/bulletins and then
 * refresh the server component so the list re-renders from the source of truth.
 */
export function SiteBulletins({
  siteId,
  bulletins,
  canPublish,
  canManage,
}: {
  siteId: string;
  bulletins: BulletinRow[];
  canPublish: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<BulletinCategoryValue>('NOTICE');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch('/api/platform/bulletins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobSiteId: siteId, category, title, body }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else toast.error(data.error ?? 'Could not publish the bulletin.');
        return;
      }
      toast.success('Bulletin published.');
      setTitle('');
      setBody('');
      setCategory('NOTICE');
      setShowForm(false);
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string, active: boolean) {
    setRowBusy(id);
    try {
      const res = await fetch(`/api/platform/bulletins/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not update the bulletin.');
        return;
      }
      toast.success(active ? 'Bulletin re-activated.' : 'Bulletin archived.');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(id: string) {
    setRowBusy(id);
    try {
      const res = await fetch(`/api/platform/bulletins/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not delete the bulletin.');
        return;
      }
      toast.success('Bulletin deleted.');
      setDeleteId(null);
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {bulletins.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          No bulletins published for this site.
        </p>
      ) : (
        <ul className="space-y-3">
          {bulletins.map((b) => (
            <li
              key={b.id}
              className={cn(
                'rounded-lg border p-3',
                b.active
                  ? 'border-line bg-surface'
                  : 'border-line bg-surface-sunken opacity-70',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                    BULLETIN_CATEGORY_BADGE[
                      b.category as BulletinCategoryValue
                    ] ?? 'bg-surface-sunken text-ink-subtle',
                  )}
                >
                  {bulletinCategoryLabel(b.category)}
                </span>
                {!b.active && (
                  <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                    Archived
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-ink-subtle">
                  {b.readCount} read
                </span>
              </div>
              {b.title && (
                <p className="mt-2 text-sm font-semibold text-ink">{b.title}</p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {b.body}
              </p>
              <p className="mt-2 text-xs text-ink-subtle">
                Published {b.publishedAtLabel}
                {b.createdByName ? ` · ${b.createdByName}` : ''}
              </p>
              {canManage && (
                <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold">
                  <button
                    type="button"
                    className="text-brand-700 hover:underline disabled:opacity-50"
                    disabled={rowBusy === b.id}
                    onClick={() => setActive(b.id, !b.active)}
                  >
                    {b.active ? 'Archive' : 'Re-activate'}
                  </button>
                  <button
                    type="button"
                    className="text-danger-600 hover:underline disabled:opacity-50"
                    disabled={rowBusy === b.id}
                    onClick={() => setDeleteId(b.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPublish &&
        (showForm ? (
          <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-4">
            <div className="space-y-1.5">
              <label
                htmlFor="bulletinCategory"
                className="block text-sm font-semibold text-ink"
              >
                Category
              </label>
              <select
                id="bulletinCategory"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as BulletinCategoryValue)
                }
              >
                {BULLETIN_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label="Title (optional)"
              maxLength={BULLETIN_TITLE_MAX}
              placeholder="e.g. Second floor works"
              value={title}
              error={errors.title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              label="Message"
              rows={3}
              maxLength={BULLETIN_BODY_MAX}
              placeholder="e.g. Gas actuated nail guns in use on the second floor. Ear defenders mandatory within this area."
              value={body}
              error={errors.body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={publish} disabled={busy}>
                {busy ? 'Publishing…' : 'Publish bulletin'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setErrors({});
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="touch-target inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600"
            onClick={() => setShowForm(true)}
          >
            <span aria-hidden="true">＋</span> Publish bulletin
          </button>
        ))}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete this bulletin?"
        message="This permanently removes the bulletin and its read history. This cannot be undone."
        confirmLabel={rowBusy ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        busy={rowBusy !== null}
        onConfirm={() => deleteId && remove(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
