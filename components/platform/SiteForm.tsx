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
  firstAiderLocation: string;
  nearestHospital: string;
  emergencyNumber: string;
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
  firstAiderLocation: '',
  nearestHospital: '',
  emergencyNumber: '',
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
  configTemplates = [],
}: {
  mode: 'create' | 'edit';
  siteId?: string;
  initial?: Partial<SiteFormValues>;
  /** SC-021 Phase 2 — optional configuration template applied on creation. */
  configTemplates?: { id: string; name: string; category: string }[];
}) {
  const router = useRouter();
  const [configTemplateId, setConfigTemplateId] = useState('');
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
          // Only sent on create — applying a template is a creation-time
          // convenience, and an edit must never silently reconfigure a live site.
          body: JSON.stringify(
            mode === 'create' && configTemplateId
              ? { ...values, configTemplateId }
              : values,
          ),
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

        {/* SC-021 Phase 2 — configure a repeated project type at the moment of
            creation, so the site is right before anyone sees it wrong. Optional:
            leaving it blank keeps every permit and inspection available, which is
            the default behaviour. */}
        {mode === 'create' && configTemplates.length > 0 ? (
          <Select
            label="Configuration template (optional)"
            value={configTemplateId}
            onChange={(e) => setConfigTemplateId(e.target.value)}
            hint="Sets which permits and inspections apply to this project. Leave blank to make everything available, and change it later from the site."
          >
            <option value="">No template — everything available</option>
            {configTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : null}
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
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="First aider location"
            value={values.firstAiderLocation}
            onChange={(e) => set('firstAiderLocation', e.target.value)}
            hint="Where to find them, e.g. Site Office."
          />
          <TextField
            label="Site emergency number"
            type="tel"
            value={values.emergencyNumber}
            onChange={(e) => set('emergencyNumber', e.target.value)}
            hint="Leave blank to show 999."
          />
        </div>
        <TextField
          label="Nearest A&E"
          value={values.nearestHospital}
          onChange={(e) => set('nearestHospital', e.target.value)}
          hint="e.g. City Hospital — 2.4 miles. Shown on the Worker Dashboard."
        />
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
