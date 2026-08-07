'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/components/platform/Panel';
import { useToast } from '@/components/ui/Toast';
import type { PlatformCompanyProfileView } from '@/services/company/companyConfigService';

/**
 * Settings → Company profile & branding.
 *
 * Four regions in one workspace — Company profile, Branding, Document
 * defaults, Close-out pack branding — through the shared `Panel`, so this
 * reads like the rest of Settings rather than inventing its own chrome.
 *
 * Same construction as Authentication & Access: a sticky action bar leading
 * the workspace, because this page is long and a Save that has scrolled out of
 * sight is the problem the bar exists to solve. A Project Manager sees every
 * control disabled and the notice in that same slot, so "can I change this" is
 * answered in one place for both roles.
 *
 * Logos upload immediately rather than staging with the rest of the form. A
 * file upload is its own transaction — it either landed or it did not — and
 * pretending a 2 MB blob is pending alongside a text field would mean a Save
 * that is sometimes instant and sometimes not.
 */
export function CompanyProfileSettings({
  profile,
  canEdit,
}: {
  profile: PlatformCompanyProfileView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    companyName: profile.companyName,
    registrationNumber: profile.registrationNumber,
    vatNumber: profile.vatNumber,
    primaryContactName: profile.primaryContactName,
    primaryEmail: profile.primaryEmail,
    primaryPhone: profile.primaryPhone,
    website: profile.website,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    addressTown: profile.addressTown,
    addressPostcode: profile.addressPostcode,
    tagline: profile.tagline,
    primaryColor: profile.primaryColor,
    accentColor: profile.accentColor,
    disclaimer: profile.disclaimer,
    reportFooter: profile.reportFooter,
    packIncludeCompanyInfo: profile.packIncludeCompanyInfo,
    packIncludeLogo: profile.packIncludeLogo,
    packIncludePrintLogo: profile.packIncludePrintLogo,
    packIncludeStandardDetails: profile.packIncludeStandardDetails,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice(null);
    setError(null);
    setFieldErrors((e) => {
      if (!e[k as string]) return e;
      const next = { ...e };
      delete next[k as string];
      return next;
    });
  };

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      const res = await fetch('/api/platform/company-profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        if (data?.errors) {
          setFieldErrors(data.errors as Record<string, string>);
          setError('Some details need attention.');
        } else {
          setError(data?.error ?? 'Could not save these settings.');
        }
        return;
      }
      setNotice('Company profile and branding saved.');
      toast.success('Company profile and branding saved.');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-sunken px-1 py-3">
          <p className="text-xs text-ink-subtle">
            {profile.updatedByName && profile.updatedAt
              ? `Last changed by ${profile.updatedByName} on ${new Date(
                  profile.updatedAt,
                ).toLocaleDateString('en-GB')}.`
              : 'Not yet configured — the values shown are the platform defaults.'}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save company profile'}
          </button>
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-muted">
          You can see these settings but not change them. Only a Director can
          change company details, logos or document wording.
        </p>
      )}
      {error ? (
        <p className="rounded-lg border border-danger-500/40 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-safe-500/40 bg-safe-50 px-4 py-2 text-sm text-safe-700">
          {notice}
        </p>
      ) : null}

      <Panel
        title="Company profile"
        hint="Who the organisation is. Used on close-out packs and generated documents."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company name"
            value={form.companyName}
            error={fieldErrors.companyName}
            disabled={!canEdit}
            onChange={(v) => set('companyName', v)}
          />
          <Field
            label="Primary contact"
            value={form.primaryContactName}
            error={fieldErrors.primaryContactName}
            disabled={!canEdit}
            onChange={(v) => set('primaryContactName', v)}
          />
          <Field
            label="Company registration number"
            value={form.registrationNumber}
            error={fieldErrors.registrationNumber}
            disabled={!canEdit}
            onChange={(v) => set('registrationNumber', v)}
          />
          <Field
            label="VAT number"
            value={form.vatNumber}
            error={fieldErrors.vatNumber}
            disabled={!canEdit}
            onChange={(v) => set('vatNumber', v)}
          />
          <Field
            label="Primary email"
            type="email"
            value={form.primaryEmail}
            error={fieldErrors.primaryEmail}
            disabled={!canEdit}
            onChange={(v) => set('primaryEmail', v)}
          />
          <Field
            label="Primary phone"
            type="tel"
            value={form.primaryPhone}
            error={fieldErrors.primaryPhone}
            disabled={!canEdit}
            onChange={(v) => set('primaryPhone', v)}
          />
          <Field
            label="Website"
            value={form.website}
            error={fieldErrors.website}
            disabled={!canEdit}
            onChange={(v) => set('website', v)}
          />
        </div>

        {/* The support pair is shown but NOT editable here. It already appears
            on close-out packs and answers a different question — who a worker
            calls for help, rather than who the company is. Surfacing it stops
            someone filling in the primary contact expecting the pack footer to
            change. */}
        <div className="mt-4 rounded-lg border border-line bg-surface-sunken px-3 py-2">
          <p className="text-xs font-semibold text-ink-muted">
            Support contact (shown on packs)
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {profile.supportEmail || profile.supportPhone
              ? `${profile.supportEmail || '—'} · ${profile.supportPhone || '—'}`
              : 'Not set.'}{' '}
            This is who a worker contacts for help, which is a different thing
            from the primary contact above. It is not changed here.
          </p>
        </div>

        <fieldset className="mt-4 border-t border-line pt-4">
          <legend className="sr-only">Registered address</legend>
          <p className="mb-3 text-sm font-medium text-ink">Registered address</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Address line 1"
              value={form.addressLine1}
              error={fieldErrors.addressLine1}
              disabled={!canEdit}
              onChange={(v) => set('addressLine1', v)}
            />
            <Field
              label="Address line 2"
              value={form.addressLine2}
              error={fieldErrors.addressLine2}
              disabled={!canEdit}
              onChange={(v) => set('addressLine2', v)}
            />
            <Field
              label="Town or city"
              value={form.addressTown}
              error={fieldErrors.addressTown}
              disabled={!canEdit}
              onChange={(v) => set('addressTown', v)}
            />
            <Field
              label="Postcode"
              value={form.addressPostcode}
              error={fieldErrors.addressPostcode}
              disabled={!canEdit}
              onChange={(v) => set('addressPostcode', v)}
            />
          </div>
        </fieldset>
      </Panel>

      <Panel
        title="Branding"
        hint="Logos and colours applied to generated documents."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <LogoField
            label="Company logo"
            hint="Shown on screen and on colour documents. PNG, JPEG, WEBP or GIF, up to 2 MB."
            kind="screen"
            has={profile.hasLogo}
            version={profile.logoVersion}
            src="/api/company/logo"
            canEdit={canEdit}
          />
          <LogoField
            label="Print logo"
            hint="Used where the colour logo will not reproduce — mono or high-contrast marks work best."
            kind="print"
            has={profile.hasPrintLogo}
            version={profile.printLogoVersion}
            src="/api/company/print-logo"
            canEdit={canEdit}
          />
        </div>
        <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <Field
            label="Tagline"
            value={form.tagline}
            error={fieldErrors.tagline}
            disabled={!canEdit}
            onChange={(v) => set('tagline', v)}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Primary colour"
              value={form.primaryColor}
              error={fieldErrors.primaryColor}
              disabled={!canEdit}
              onChange={(v) => set('primaryColor', v)}
            />
            <Field
              label="Accent colour"
              value={form.accentColor}
              error={fieldErrors.accentColor}
              disabled={!canEdit}
              onChange={(v) => set('accentColor', v)}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Document defaults"
        hint="Standard wording applied to generated documents and exports."
      >
        <Area
          label="Company disclaimer"
          hint="Replaces the built-in wording on close-out packs. Leave blank to keep the standard disclaimer."
          value={form.disclaimer}
          error={fieldErrors.disclaimer}
          disabled={!canEdit}
          onChange={(v) => set('disclaimer', v)}
        />
        <Area
          label="Report footer"
          hint="Appears at the foot of generated reports and exports."
          value={form.reportFooter}
          error={fieldErrors.reportFooter}
          disabled={!canEdit}
          onChange={(v) => set('reportFooter', v)}
        />
      </Panel>

      <Panel
        title="Close-out pack branding"
        hint="What generated close-out packs include by default."
      >
        <Toggle
          label="Include company information"
          hint="Company name, registered address and contact details on the pack cover."
          checked={form.packIncludeCompanyInfo}
          disabled={!canEdit}
          onChange={(v) => set('packIncludeCompanyInfo', v)}
        />
        <Toggle
          label="Include company logo"
          hint="The colour logo, on screen and in colour exports."
          checked={form.packIncludeLogo}
          disabled={!canEdit}
          onChange={(v) => set('packIncludeLogo', v)}
        />
        <Toggle
          label="Include print logo"
          hint="The print mark on generated PDFs. Falls back to the company logo when no print logo is set."
          checked={form.packIncludePrintLogo}
          disabled={!canEdit}
          onChange={(v) => set('packIncludePrintLogo', v)}
        />
        <Toggle
          label="Include standard company details"
          hint="Registration and VAT numbers, and the document defaults above."
          checked={form.packIncludeStandardDetails}
          disabled={!canEdit}
          onChange={(v) => set('packIncludeStandardDetails', v)}
        />
        <p className="mt-2 text-xs text-ink-subtle">
          These are defaults for packs generated from now on. A pack that has
          already been generated is a record of what was handed over and is not
          changed by this.
        </p>
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  error,
  disabled,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60 ${
          error ? 'border-danger-500' : 'border-line'
        }`}
      />
      {error ? (
        <span className="mt-1 block text-xs text-danger-700">{error}</span>
      ) : null}
    </label>
  );
}

function Area({
  label,
  hint,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="mb-4 block last:mb-0">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-0.5 block text-xs text-ink-subtle">{hint}</span>
      <textarea
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60 ${
          error ? 'border-danger-500' : 'border-line'
        }`}
      />
      {error ? (
        <span className="mt-1 block text-xs text-danger-700">{error}</span>
      ) : null}
    </label>
  );
}

/**
 * A logo slot. Uploads and removals go straight to the server — see the note at
 * the top of this file on why these are not staged with the form.
 */
function LogoField({
  label,
  hint,
  kind,
  has,
  version,
  src,
  canEdit,
}: {
  label: string;
  hint: string;
  kind: 'screen' | 'print';
  has: boolean;
  version: number | null;
  src: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = `/api/platform/company-profile/logo?kind=${kind}`;

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(href, { method: 'POST', body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? 'Could not upload that image.');
        return;
      }
      toast.success(`${label} updated.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(href, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? 'Could not remove that image.');
        return;
      }
      toast.success(`${label} removed.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-surface-sunken">
          {has ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${src}?v=${version ?? 0}`}
              alt={`${label} preview`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-[11px] text-ink-subtle">None set</span>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-sunken">
              {busy ? 'Working…' : has ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = '';
                }}
              />
            </label>
            {has ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {err ? <p className="mt-2 text-xs text-danger-700">{err}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? 'bg-brand-600' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
