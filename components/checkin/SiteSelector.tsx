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
}

const SELECTED_KEY = 'sitecomply.checkin.siteId';

/**
 * Site selection step. A searchable list of large, tappable cards showing the
 * site name and job reference — one tap takes the worker straight into that
 * site's induction. Search filters by name, job reference or town so big
 * contractors with many sites stay manageable on a phone.
 */
export function SiteSelector({ sites }: { sites: SelectableSite[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) =>
      [s.name, s.jobReference, s.town, s.postcode]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query, sites]);

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
              <button
                type="button"
                onClick={() => choose(site.id)}
                className="touch-target flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50 active:bg-brand-100"
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold text-ink">
                    {site.name}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-subtle">
                    Ref {site.jobReference} · {site.town}
                  </span>
                </span>
                <span
                  className="shrink-0 text-2xl text-brand-600"
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
