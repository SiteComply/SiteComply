'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';

export interface SiteFormValues {
  name: string;
  jobReference: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  postcode: string;
  inductionContent: string;
  fireAssemblyPoint: string;
  firstAiderName: string;
  firstAiderNumber: string;
}

type FieldErrors = Partial<Record<keyof SiteFormValues, string>>;

const EMPTY: SiteFormValues = {
  name: '',
  jobReference: '',
  addressLine1: '',
  addressLine2: '',
  town: '',
  postcode: '',
  inductionContent: '',
  fireAssemblyPoint: '',
  firstAiderName: '',
  firstAiderNumber: '',
};

/**
 * Create/edit form for a job site. Submits to the admin API, which is the
 * authoritative validator; field errors it returns are shown inline. British
 * English labels throughout.
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
  const toast = useToast();
  const [values, setValues] = useState<SiteFormValues>({
    ...EMPTY,
    ...initial,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  function set<K extends keyof SiteFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(
        mode === 'create' ? '/api/admin/sites' : `/api/admin/sites/${siteId}`,
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
      toast.success(mode === 'create' ? 'Site created.' : 'Changes saved.');
      router.push('/admin/sites');
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
      <Section title="Site details">
        <TextField
          label="Site name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <TextField
          label="Job reference"
          value={values.jobReference}
          onChange={(e) => set('jobReference', e.target.value)}
          error={errors.jobReference}
          hint="Shown to workers, e.g. BNE-2026-014."
        />
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
        <div className="grid gap-4 sm:grid-cols-2">
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

      <Section title="Emergency information">
        <TextField
          label="Fire assembly point (optional)"
          value={values.fireAssemblyPoint}
          onChange={(e) => set('fireAssemblyPoint', e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First aider name (optional)"
            value={values.firstAiderName}
            onChange={(e) => set('firstAiderName', e.target.value)}
          />
          <TextField
            label="First aider number (optional)"
            type="tel"
            value={values.firstAiderNumber}
            onChange={(e) => set('firstAiderNumber', e.target.value)}
          />
        </div>
      </Section>

      <Section title="Induction content">
        <Textarea
          label="Site induction (optional)"
          rows={5}
          value={values.inductionContent}
          onChange={(e) => set('inductionContent', e.target.value)}
          hint="Shown before the checklist — site overview, welfare, working hours, etc."
        />
      </Section>

      <div className="flex gap-3">
        <Button type="submit" size="lg" disabled={busy}>
          {busy
            ? 'Saving…'
            : mode === 'create'
              ? 'Create site'
              : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => router.push('/admin/sites')}
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
