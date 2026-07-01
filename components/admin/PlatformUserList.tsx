'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import {
  ROLE_LABELS,
  STATUS_LABELS,
  type PlatformRoleValue,
  type PlatformStatusValue,
} from '@/services/platformUsers/platformUserConstants';

export interface PlatformUserRow {
  id: string;
  name: string;
  company: string;
  email: string;
  mobile: string | null;
  role: PlatformRoleValue;
  status: PlatformStatusValue;
  siteCount: number;
}

type PendingAction = { id: string; action: 'disable' | 'remove' };

/**
 * Admin list of Platform Users with search, status badges and management
 * actions: approve (→ Active), disable (→ Disabled), enable, edit and remove.
 * Search matches name, company, email and role.
 */
export function PlatformUserList({ users }: { users: PlatformUserRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingAction | undefined>();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.company, u.email, ROLE_LABELS[u.role]]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query, users]);

  async function setStatus(id: string, status: PlatformStatusValue) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/platform-users/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/platform-users/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    if (pending.action === 'disable') await setStatus(pending.id, 'DISABLED');
    else await remove(pending.id);
    setPending(undefined);
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Search platform users"
        type="search"
        placeholder="Search by name, company, email or role"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          {users.length === 0
            ? 'No platform users yet. Add your first user to get started.'
            : 'No platform users match your search.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-ink">
                    {user.name}
                  </span>
                  <StatusBadge status={user.status} />
                  <RoleBadge role={user.role} />
                </div>
                <p className="mt-0.5 truncate text-sm text-ink-subtle">
                  {user.company} · {user.email}
                  {user.mobile ? ` · ${user.mobile}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {user.siteCount === 0
                    ? 'No sites assigned'
                    : `${user.siteCount} site${user.siteCount === 1 ? '' : 's'} assigned`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href={`/admin/platform-users/${user.id}`}
                  className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Edit
                </Link>

                {user.status !== 'ACTIVE' && (
                  <button
                    type="button"
                    disabled={busyId === user.id}
                    onClick={() => setStatus(user.id, 'ACTIVE')}
                    className="touch-target inline-flex items-center rounded-lg border border-safe-500 px-3 py-2 text-sm font-semibold text-safe-700 hover:bg-safe-50 disabled:opacity-50"
                  >
                    {user.status === 'PENDING' ? 'Approve' : 'Enable'}
                  </button>
                )}

                {user.status !== 'DISABLED' && (
                  <button
                    type="button"
                    disabled={busyId === user.id}
                    onClick={() => setPending({ id: user.id, action: 'disable' })}
                    className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                  >
                    Disable
                  </button>
                )}

                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => setPending({ id: user.id, action: 'remove' })}
                  className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== undefined}
        title={
          pending?.action === 'remove'
            ? 'Remove this platform user?'
            : 'Disable this platform user?'
        }
        message={
          pending?.action === 'remove'
            ? 'This permanently removes the user and their site assignments.'
            : 'They will not be able to sign in until re-enabled.'
        }
        confirmLabel={
          pending && busyId === pending.id
            ? 'Working…'
            : pending?.action === 'remove'
              ? 'Remove'
              : 'Disable'
        }
        cancelLabel="Cancel"
        confirmVariant="danger"
        busy={pending ? busyId === pending.id : false}
        onConfirm={confirmPending}
        onCancel={() => setPending(undefined)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: PlatformStatusValue }) {
  const styles: Record<PlatformStatusValue, string> = {
    ACTIVE: 'bg-safe-50 text-safe-700',
    PENDING: 'bg-hivis-400/20 text-hivis-600',
    DISABLED: 'border border-line bg-surface-sunken text-ink-muted',
  };
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        styles[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function RoleBadge({ role }: { role: PlatformRoleValue }) {
  return (
    <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
      {ROLE_LABELS[role]}
    </span>
  );
}
