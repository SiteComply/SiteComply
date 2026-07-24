'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { bulletinCategoryLabel } from '@/services/bulletins/bulletinConstants';

export interface WorkerBulletinView {
  id: string;
  category: string;
  title: string | null;
  body: string;
  publishedAtLabel: string;
}

/**
 * Daily Bulletin board shown to a worker on the check-in confirmation screen
 * (SC-002). Renders each active, not-yet-read bulletin as a card with a "New"
 * badge and an "I've read this" button; acknowledging a bulletin records the read
 * and dismisses the card. Only bulletins the worker hasn't read are passed in.
 */
export function BulletinBoard({
  bulletins,
}: {
  bulletins: WorkerBulletinView[];
}) {
  const [items, setItems] = useState(bulletins);

  if (items.length === 0) return null;

  function dismiss(id: string) {
    setItems((list) => list.filter((b) => b.id !== id));
  }

  return (
    <section className="space-y-3" aria-label="Daily bulletins">
      {items.map((b) => (
        <BulletinCard key={b.id} bulletin={b} onRead={() => dismiss(b.id)} />
      ))}
    </section>
  );
}

function BulletinCard({
  bulletin,
  onRead,
}: {
  bulletin: WorkerBulletinView;
  onRead: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isSafety = bulletin.category === 'SAFETY_ALERT';

  async function acknowledge() {
    setBusy(true);
    try {
      const res = await fetch(`/api/worker/bulletins/${bulletin.id}/ack`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save. Please try again.');
        return;
      }
      onRead();
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-brand-200 bg-brand-50 shadow-card">
      <div className="flex items-center gap-2 border-b border-brand-200/70 px-4 py-2.5">
        <span aria-hidden="true" className="text-brand-700">
          {/* megaphone */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5a1 1 0 0 0 1.7-.7V7.2a1 1 0 0 0-1.7-.7L6 10H4a1 1 0 0 0-1 1Z" />
            <path d="M15 8a4 4 0 0 1 0 8" />
          </svg>
        </span>
        <span className="text-xs font-bold uppercase tracking-wide text-brand-700">
          Daily Bulletin
        </span>
        {isSafety && (
          <span className="rounded-full bg-hivis-400/30 px-2 py-0.5 text-[11px] font-semibold text-ink">
            {bulletinCategoryLabel(bulletin.category)}
          </span>
        )}
        <span className="ml-auto rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-semibold text-white">
          New
        </span>
      </div>

      <div className="flex gap-3 px-4 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
        >
          i
        </span>
        <div className="min-w-0 flex-1">
          {bulletin.title && (
            <p className="text-sm font-semibold text-ink">{bulletin.title}</p>
          )}
          <p className="whitespace-pre-wrap text-sm text-ink">
            {bulletin.body}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
        <span className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          Published: {bulletin.publishedAtLabel}
        </span>
        <button
          type="button"
          onClick={acknowledge}
          disabled={busy}
          className="touch-target rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'I’ve read this'}
        </button>
      </div>
    </div>
  );
}
