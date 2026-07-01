'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';

export interface AdminSiteRow {
  id: string;
  name: string;
  jobReference: string;
  town: string;
  postcode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  onSiteCount: number;
}

/**
 * Admin job-site list with search and archive/restore. Search matches name, job
 * reference, town or postcode.
 */
export function AdminSiteList({ sites }: { sites: AdminSiteRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | undefined>();
  const [archivingId, setArchivingId] = useState<string | undefined>();

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

  async function setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/sites/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function archiveConfirmed() {
    if (!archivingId) return;
    await setStatus(archivingId, 'ARCHIVED');
    setArchivingId(undefined);
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Search sites"
        type="search"
        placeholder="Search by name, reference, town or postcode"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          {sites.length === 0
            ? 'No sites yet. Create your first job site to get started.'
            : 'No sites match your search.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((site) => (
            <li
              key={site.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-ink">
                    {site.name}
                  </span>
                  <StatusBadge status={site.status} />
                </div>
                <p className="mt-0.5 text-sm text-ink-subtle">
                  Ref {site.jobReference} · {site.town}, {site.postcode}
                  {site.status === 'ACTIVE' && site.onSiteCount > 0 && (
                    <span className="ml-1 font-medium text-safe-700">
                      · {site.onSiteCount} on site now
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/admin/sites/${site.id}`}
                  className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={busyId === site.id}
                  onClick={() =>
                    site.status === 'ACTIVE'
                      ? setArchivingId(site.id)
                      : setStatus(site.id, 'ACTIVE')
                  }
                  className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                >
                  {site.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={archivingId !== undefined}
        title="Are you sure you want to archive this site?"
        confirmLabel={busyId === archivingId ? 'Archiving…' : 'Archive'}
        cancelLabel="Cancel"
        busy={busyId === archivingId}
        onConfirm={archiveConfirmed}
        onCancel={() => setArchivingId(undefined)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'ARCHIVED' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        status === 'ACTIVE'
          ? 'bg-safe-50 text-safe-700'
          : 'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {status === 'ACTIVE' ? 'Active' : 'Archived'}
    </span>
  );
}
