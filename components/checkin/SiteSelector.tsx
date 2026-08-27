'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';

export interface SelectableSite {
  id: string;
  name: string;
  jobReference: string;
  town: string;
  postcode: string;
  /**
   * Access state, when access is enforced anywhere in this list. Absent means
   * nothing enforces, so no site can be distinguished from another and no
   * badges are shown at all.
   */
  access?:
    | { state: 'blocked'; short: string }
    | { state: 'granted' }
    | { state: 'unknown' };
}

const SELECTED_KEY = 'sitecomply.checkin.siteId';

/**
 * Site selection step. A searchable list of large, tappable cards showing the
 * site name and job reference — one tap takes the worker straight into that
 * site's induction. Search filters by name, job reference or town so big
 * contractors with many sites stay manageable on a phone.
 *
 * Sites the worker has no access to are SHOWN, not hidden, and stay tappable.
 * Hiding them would leave a worker who should have been invited staring at a
 * list that silently omits their site with nothing to act on; the label tells
 * them what to ask their site manager for. Tapping through still reaches the
 * site page, which runs the full check, states the reason in full and owns the
 * final word — the list carries a short label only, so the screen stays
 * scannable and the red is a chip rather than three paragraphs.
 *
 * Usable sites sort to the top, with a divider before the rest: a worker with
 * NO usable site then sees an empty top group, which is itself the message.
 */
export function SiteSelector({ sites }: { sites: SelectableSite[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? sites
      : sites.filter((s) =>
          [s.name, s.jobReference, s.town, s.postcode]
            .join(' ')
            .toLowerCase()
            .includes(q),
        );
    // Usable first, blocked after; the server's alphabetical order is kept
    // within each group, so the list a worker learned does not reshuffle.
    return [
      ...matched.filter((s) => s.access?.state !== 'blocked'),
      ...matched.filter((s) => s.access?.state === 'blocked'),
    ];
  }, [query, sites]);

  // Only worth a divider when the list actually splits.
  const firstBlockedId = filtered.find((s) => s.access?.state === 'blocked')?.id;
  const anyUsable = filtered.some((s) => s.access?.state !== 'blocked');

  function choose(id: string) {
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* non-fatal */
    }
    router.push(`/check-in/site/${id}`);
  }

  return (
    <div className="space-y-4">
      {sites.length > 3 && (
        <TextField
          label="Find your site"
          type="search"
          inputMode="search"
          placeholder="Search by name, reference or town"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-ink-muted">
          {sites.length === 0
            ? 'There are no active sites to check in to yet. Please speak to the site manager.'
            : 'No sites match your search.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((site) => (
            <li key={site.id}>
              {site.id === firstBlockedId && anyUsable && (
                <p className="mb-2 mt-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-subtle">
                  Not available to you
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                </p>
              )}
              <button
                type="button"
                onClick={() => choose(site.id)}
                className={
                  site.access?.state === 'blocked'
                    ? 'touch-target flex w-full items-start justify-between gap-3 rounded-xl border border-line bg-surface-sunken p-4 text-left shadow-card transition-colors hover:bg-surface'
                    : 'touch-target flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50 active:bg-brand-100'
                }
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-semibold text-ink">
                      {site.name}
                    </span>
                    {site.access?.state === 'blocked' && (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-700">
                        No access
                      </span>
                    )}
                    {/* Only claimed where the assignment check WAS the whole
                        check — a site with requirements carries no badge. */}
                    {site.access?.state === 'granted' && (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
                        Access Granted
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-subtle">
                    Ref {site.jobReference} · {site.town}
                  </span>
                  {/* Short label, and deliberately NOT red: the chip above
                      already carries the signal, and three red paragraphs made
                      the screen read as an error report. The full sentence
                      lives on the site page. */}
                  {site.access?.state === 'blocked' && (
                    <span className="mt-1.5 block text-sm text-ink-subtle">
                      {site.access.short}
                    </span>
                  )}
                </span>
                <span
                  className={
                    site.access?.state === 'blocked'
                      ? 'shrink-0 text-2xl text-ink-subtle'
                      : 'shrink-0 text-2xl text-brand-600'
                  }
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
