'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';

interface FormValues {
  fullName: string;
  companyName: string;
  email: string;
  mobile: string;
  reason: string;
}

type FieldErrors = Partial<Record<keyof FormValues, string>>;

/**
 * Self-service Platform Access Request form. Submits to the public API, which is
 * the authoritative validator; field errors it returns are shown inline. On
 * success a confirmation replaces the form.
 */
export function AccessRequestForm({
  initialEmail = '',
  initialMobile = '',
}: {
  initialEmail?: string;
  initialMobile?: string;
}) {
  const [values, setValues] = useState<FormValues>({
    fullName: '',
    companyName: '',
    email: initialEmail,
    mobile: initialMobile,
    reason: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function set<K extends keyof FormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);
    try {
      const res = await fetch('/api/platform/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSubmitted(true);
        return;
      }
      if (data.errors) {
        setErrors(data.errors);
        setFormError('Please fix the highlighted fields and try again.');
      } else {
        setFormError(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setFormError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4 rounded-xl border border-safe-500 bg-safe-50 px-5 py-6 text-center">
        <h2 className="text-lg font-semibold text-ink">Request submitted</h2>
        <p className="text-sm text-ink-muted">
          Thanks — an administrator will review your request and set up your
          platform access. You’ll be able to sign in once it’s approved.
        </p>
        <Link href="/platform" className="inline-block font-semibold text-brand-700">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
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

      <TextField
        label="Full name"
        value={values.fullName}
        onChange={(e) => set('fullName', e.target.value)}
        error={errors.fullName}
        autoComplete="name"
      />
      <TextField
        label="Company name"
        value={values.companyName}
        onChange={(e) => set('companyName', e.target.value)}
        error={errors.companyName}
        autoComplete="organization"
      />
      <TextField
        label="Email address"
        type="email"
        inputMode="email"
        value={values.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
        autoComplete="email"
      />
      <TextField
        label="Mobile number"
        type="tel"
        inputMode="tel"
        value={values.mobile}
        onChange={(e) => set('mobile', e.target.value)}
        error={errors.mobile}
        autoComplete="tel"
        placeholder="07700 900123"
      />
      <Textarea
        label="Reason for access (optional)"
        rows={3}
        value={values.reason}
        onChange={(e) => set('reason', e.target.value)}
        error={errors.reason}
        hint="Tell us which sites or role you need access to."
      />

      <Button type="submit" size="lg" variant="brand" fullWidth disabled={busy}>
        {busy ? 'Submitting…' : 'Request access'}
      </Button>
    </form>
  );
}
