'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';

export interface SiteFormValues {
  name: string;
  jobReference: string;
  status: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  postcode: string;
  fireAssemblyPoint: string;
  firstAiderName: string;
  firstAiderNumber: string;
  inductionContent: string;
}

type FieldErrors = Partial<Record<keyof SiteFormValues, string>>;

const EMPTY: SiteFormValues = {
  name: '',
  jobReference: '',
  status: 'ACTIVE',
  addressLine1: '',
  addressLine2: '',
  town: '',
  postcode: '',
  fireAssemblyPoint: '',
  firstAiderName: '',
  firstAiderNumber: '',
  inductionContent: '',
};

/**
 * Director-only create / edit form for a job site (Platform portal). Submits JSON
 * to POST /api/platform/sites (create) or PATCH /api/platform/sites/[id] (edit),
 * which is the authoritative validator; field errors it returns are shown inline.
 * On success the site's details page is opened. Styled to match Site Details
 * (card sections, brand primary action).
 */
export function SiteForm({
  mode,
  siteId,
  initial,
}: {
  mode: 'create' | 'edit';
  siteId?: string;
  initial?: Partial<SiteFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SiteFormValues>({
    ...EMPTY,
    ...initial,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function set<K extends keyof SiteFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);
    try {
      const res = await fetch(
        mode === 'create'
          ? '/api/platform/sites'
          : `/api/platform/sites/${siteId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else
          setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      const id = data.id ?? siteId;
      router.push(`/platform/dashboard/sites/${id}`);
      router.refresh();
    } catch {
      setFormError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      {formError && (
        <p
          role="alert"
          className="rounded-xl border border-danger-500 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
        >
          {formError}
        </p>
      )}

      <Section title="Site details">
        <TextField
          label="Site name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="e.g. Bannerman East — Phase 2"
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Job reference"
            value={values.jobReference}
            onChange={(e) => set('jobReference', e.target.value)}
            error={errors.jobReference}
            hint="Shown to workers, e.g. BNE-2026-014."
          />
          <Select
            label="Status"
            value={values.status}
            onChange={(e) => set('status', e.target.value)}
            error={errors.status}
            hint="Active sites are open for check-in; archived sites are hidden from workers."
          >
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </div>
      </Section>

      <Section title="Address">
        <TextField
          label="Address line 1"
          value={values.addressLine1}
          onChange={(e) => set('addressLine1', e.target.value)}
          error={errors.addressLine1}
        />
        <TextField
          label="Address line 2 (optional)"
          value={values.addressLine2}
          onChange={(e) => set('addressLine2', e.target.value)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Town or city"
            value={values.town}
            onChange={(e) => set('town', e.target.value)}
            error={errors.town}
          />
          <TextField
            label="Postcode"
            value={values.postcode}
            onChange={(e) => set('postcode', e.target.value)}
            error={errors.postcode}
            autoCapitalize="characters"
          />
        </div>
      </Section>

      <Section title="Emergency information (optional)">
        <TextField
          label="Fire assembly point"
          value={values.fireAssemblyPoint}
          onChange={(e) => set('fireAssemblyPoint', e.target.value)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="First aider name"
            value={values.firstAiderName}
            onChange={(e) => set('firstAiderName', e.target.value)}
          />
          <TextField
            label="First aider number"
            type="tel"
            value={values.firstAiderNumber}
            onChange={(e) => set('firstAiderNumber', e.target.value)}
          />
        </div>
      </Section>

      <Section title="Induction content (optional)">
        <Textarea
          label="Site induction"
          rows={5}
          value={values.inductionContent}
          onChange={(e) => set('inductionContent', e.target.value)}
          hint="Shown before the checklist — site overview, welfare, working hours, etc."
        />
      </Section>

      <div className="flex gap-3">
        <Button type="submit" variant="brand" disabled={busy}>
          {busy
            ? 'Saving…'
            : mode === 'create'
              ? 'Create site'
              : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            router.push(
              mode === 'edit' && siteId
                ? `/platform/dashboard/sites/${siteId}`
                : '/platform/dashboard/sites',
            )
          }
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
    <fieldset className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card">
      <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </legend>
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
          'touch-target w-full rounded-xl border bg-surface px-4 py-3 text-base text-ink',
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
