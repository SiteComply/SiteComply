'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  PLATFORM_ROLES,
  PLATFORM_STATUSES,
} from '@/services/platformUsers/platformUserConstants';

export interface PlatformUserFormValues {
  name: string;
  company: string;
  email: string;
  mobile: string;
  role: string;
  status: string;
  assignedSiteIds: string[];
}

export interface AssignableSite {
  id: string;
  name: string;
  jobReference: string;
}

type FieldErrors = Partial<Record<keyof PlatformUserFormValues, string>>;

const EMPTY: PlatformUserFormValues = {
  name: '',
  company: '',
  email: '',
  mobile: '',
  role: '',
  status: 'PENDING',
  assignedSiteIds: [],
};

/**
 * Create/edit form for a Platform User. Submits to the admin API, which is the
 * authoritative validator; field errors it returns are shown inline. New users
 * default to "Pending approval".
 */
export function PlatformUserForm({
  mode,
  userId,
  sites,
  initial,
}: {
  mode: 'create' | 'edit';
  userId?: string;
  sites: AssignableSite[];
  initial?: Partial<PlatformUserFormValues>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<PlatformUserFormValues>({
    ...EMPTY,
    ...initial,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  function set<K extends keyof PlatformUserFormValues>(
    key: K,
    value: PlatformUserFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function toggleSite(id: string) {
    setValues((v) => ({
      ...v,
      assignedSiteIds: v.assignedSiteIds.includes(id)
        ? v.assignedSiteIds.filter((s) => s !== id)
        : [...v.assignedSiteIds, id],
    }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(
        mode === 'create'
          ? '/api/admin/platform-users'
          : `/api/admin/platform-users/${userId}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.errors) {
          setErrors(data.errors);
          toast.error('Please fix the highlighted fields and try again.');
        } else {
          toast.error(data.error ?? 'Something went wrong. Please try again.');
        }
        return;
      }
      toast.success(
        mode === 'create' ? 'Platform user added.' : 'Changes saved.',
      );
      router.push('/admin/platform-users');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      <Section title="User details">
        <TextField
          label="Name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          autoComplete="name"
        />
        <TextField
          label="Company"
          value={values.company}
          onChange={(e) => set('company', e.target.value)}
          error={errors.company}
          autoComplete="organization"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            autoComplete="email"
            hint="Used for Platform Login (email method)."
          />
          <TextField
            label="Mobile (optional)"
            type="tel"
            inputMode="tel"
            value={values.mobile}
            onChange={(e) => set('mobile', e.target.value)}
            error={errors.mobile}
            autoComplete="tel"
            placeholder="07700 900123"
            hint="UK mobile — used for Platform Login (mobile method)."
          />
        </div>
      </Section>

      <Section title="Access">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Role"
            value={values.role}
            onChange={(e) => set('role', e.target.value)}
            error={errors.role}
          >
            <option value="" disabled>
              Select a role…
            </option>
            {PLATFORM_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Select
            label="Status"
            value={values.status}
            onChange={(e) => set('status', e.target.value)}
            error={errors.status}
            hint="New users are usually Pending until approved."
          >
            {PLATFORM_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </Section>

      <Section title="Assigned sites">
        {sites.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            No active sites to assign yet. Create a job site first.
          </p>
        ) : (
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Assigned sites</legend>
            {sites.map((site) => {
              const checked = values.assignedSiteIds.includes(site.id);
              return (
                <label
                  key={site.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors',
                    checked
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-line bg-surface hover:bg-surface-sunken',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                    checked={checked}
                    onChange={() => toggleSite(site.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">
                      {site.name}
                    </span>
                    <span className="block text-xs text-ink-subtle">
                      Ref {site.jobReference}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
      </Section>

      <div className="flex gap-3">
        <Button type="submit" size="lg" disabled={busy}>
          {busy
            ? 'Saving…'
            : mode === 'create'
              ? 'Add platform user'
              : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => router.push('/admin/platform-users')}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

function Select({
  label,
  hint,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <select
        aria-invalid={error ? true : undefined}
        className={cn(
          'touch-target w-full rounded-xl border bg-surface px-4 py-3 text-lg text-ink',
          error ? 'border-danger-500' : 'border-line',
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="text-sm font-medium text-danger-600">{error}</p>
      ) : hint ? (
        <p className="text-sm text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
