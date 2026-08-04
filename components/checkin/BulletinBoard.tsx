'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
 * (SC-002), the Worker Dashboard and the Bulletins page. Renders each active,
 * not-yet-read bulletin as a card with a "New" badge and an "I've read this"
 * button; acknowledging a bulletin records the read and dismisses the card. Only
 * bulletins the worker hasn't read are passed in.
 *
 * ACKNOWLEDGING REFRESHES THE SERVER STATE, not just this list. Dismissing the
 * card locally was only ever half the update: everything else on the page that
 * describes the same bulletin is server-rendered, so it stayed stale until the
 * worker reloaded. Measured on /worker/bulletins with two unread bulletins —
 * after acknowledging one, the card went, but "Already read" stayed empty and the
 * navigation still counted the bulletin as unread ("Bulletins 2"). The bulletin
 * had not disappeared so much as fallen out of both lists.
 *
 * So a successful acknowledgement now does both: the card goes immediately
 * (optimistic, so the tap feels instant on a phone with poor signal), and
 * `router.refresh()` re-renders the server components so the read state, the
 * "Already read" list and the unread badge all catch up without a reload.
 *
 * The refresh re-renders; it does not re-submit. The acknowledgement endpoint is
 * unchanged and is idempotent, so nothing here can record a second read.
 */
export function BulletinBoard({
  bulletins,
}: {
  bulletins: WorkerBulletinView[];
}) {
  // Acknowledged ids, not a copy of the list. A snapshot taken once from props
  // would ignore whatever the refresh comes back with, so a bulletin published
  // while the worker was on the page could never appear — and a refresh now
  // happens on every acknowledgement.
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const items = bulletins.filter((b) => !acknowledged.includes(b.id));

  if (items.length === 0) return null;

  function dismiss(id: string) {
    setAcknowledged((ids) => (ids.includes(id) ? ids : [...ids, id]));
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
  const router = useRouter();
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
      // Order matters: hide the card first so the tap is acknowledged instantly,
      // then ask the server for the rest of the page. Only on success — a failed
      // acknowledgement must leave the card exactly where it was.
      onRead();
      router.refresh();
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
