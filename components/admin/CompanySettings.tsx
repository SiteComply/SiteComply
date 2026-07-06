'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { CompanyConfigView } from '@/services/company/companyConfigService';
import { formatDateTimeUK } from '@/lib/datetime';

/**
 * Company settings screen (Admin → Settings → Company). Manages the company name,
 * support contacts, branding (colours + tagline) and the logo. Text/branding
 * fields save as JSON; the logo uploads separately as multipart to the existing
 * blob storage. Current values are shown pre-filled; no secrets are involved.
 */
export function CompanySettings({ config }: { config: CompanyConfigView }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(config.companyName);
  const [supportEmail, setSupportEmail] = useState(config.supportEmail);
  const [supportPhone, setSupportPhone] = useState(config.supportPhone);
  const [tagline, setTagline] = useState(config.tagline);
  const [primaryColor, setPrimaryColor] = useState(config.primaryColor);
  const [accentColor, setAccentColor] = useState(config.accentColor);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saveErr, setSaveErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Logo state — driven by the server view; bumped locally after upload/remove.
  const [hasLogo, setHasLogo] = useState(config.hasLogo);
  const [logoVersion, setLogoVersion] = useState(config.logoVersion ?? 0);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ ok: boolean; text: string } | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    setErrors({});
    setSavedMsg(undefined);
    setSaveErr(undefined);
    try {
      const res = await fetch('/api/admin/settings/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          supportEmail,
          supportPhone,
          tagline,
          primaryColor,
          accentColor,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        setSaveErr(data.errors ? 'Fix the highlighted fields.' : data.error ?? 'Could not save. Please try again.');
        return;
      }
      setSavedMsg('Company settings saved.');
      router.refresh();
    } catch {
      setSaveErr('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setLogoMsg(undefined);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/settings/company/logo', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setLogoMsg({ ok: false, text: data.error ?? 'Upload failed. Please try again.' });
        return;
      }
      setHasLogo(true);
      setLogoVersion(Date.now());
      setLogoMsg({ ok: true, text: 'Logo updated.' });
      router.refresh();
    } catch {
      setLogoMsg({ ok: false, text: 'Network problem. Please try again.' });
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setLogoMsg(undefined);
    try {
      const res = await fetch('/api/admin/settings/company/logo', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setLogoMsg({ ok: false, text: data.error ?? 'Could not remove the logo.' });
        return;
      }
      setHasLogo(false);
      setLogoMsg({ ok: true, text: 'Logo removed.' });
      router.refresh();
    } catch {
      setLogoMsg({ ok: false, text: 'Network problem. Please try again.' });
    } finally {
      setLogoBusy(false);
    }
  }

  const logoSrc = `/api/company/logo?v=${logoVersion}`;

  return (
    <div className="space-y-6">
      {/* Company profile */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Company profile</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Your organisation’s name and the support contacts shown to users.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Company name" value={companyName} onChange={setCompanyName} error={errors.companyName} placeholder="SiteComply" />
          <Field label="Support email" value={supportEmail} onChange={setSupportEmail} error={errors.supportEmail} placeholder="support@example.com" type="email" />
          <Field label="Support phone" value={supportPhone} onChange={setSupportPhone} error={errors.supportPhone} placeholder="+44 20 7946 0000" type="tel" />
          <Field label="Tagline" value={tagline} onChange={setTagline} error={errors.tagline} placeholder="Site compliance, simplified." />
        </div>
      </section>

      {/* Branding */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Branding</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Organisation colours used across branded surfaces.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ColorField label="Primary colour" value={primaryColor} onChange={setPrimaryColor} error={errors.primaryColor} />
          <ColorField label="Accent colour" value={accentColor} onChange={setAccentColor} error={errors.accentColor} />
        </div>
      </section>

      {/* Save profile/branding */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        {saveErr && (
          <p className="mb-3 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">{saveErr}</p>
        )}
        {savedMsg && (
          <p className="mb-3 rounded-lg border border-safe-500 bg-safe-50 px-3 py-2 text-sm font-medium text-safe-700">{savedMsg}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-xl bg-safe-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-safe-600 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          {config.updatedAt ? (
            <span className="text-xs text-ink-subtle">
              Last updated {formatDateTimeUK(config.updatedAt)}
              {config.updatedByName ? ` by ${config.updatedByName}` : ''}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">Using default company details.</span>
          )}
        </div>
      </section>

      {/* Logo — separate multipart upload */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Company logo</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Shown on branded surfaces. PNG, JPEG, WEBP, SVG or GIF, up to 2 MB.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-sunken">
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="Company logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-ink-subtle">No logo</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
              disabled={logoBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
              className="block text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-600"
            />
            {hasLogo && (
              <button
                type="button"
                onClick={removeLogo}
                disabled={logoBusy}
                className="self-start rounded-lg border border-danger-500 px-3 py-1.5 text-sm font-semibold text-danger-700 hover:bg-danger-50 disabled:opacity-60"
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
        {logoBusy && <p className="mt-3 text-sm text-ink-subtle">Working…</p>}
        {logoMsg && (
          <p
            className={cn(
              'mt-3 rounded-lg border px-3 py-2 text-sm font-medium',
              logoMsg.ok
                ? 'border-safe-500 bg-safe-50 text-safe-700'
                : 'border-danger-500 bg-danger-50 text-danger-700',
            )}
          >
            {logoMsg.ok ? '✓ ' : '✗ '}
            {logoMsg.text}
          </p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-xl border bg-surface px-3 py-2 text-sm text-ink',
          error ? 'border-danger-500' : 'border-line',
        )}
      />
      {error && <p className="text-sm font-medium text-danger-600">{error}</p>}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  // A valid 6-digit hex feeds the native colour picker; otherwise it shows grey.
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface p-0.5"
          aria-label={`${label} picker`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#38B54A"
          className={cn(
            'w-32 rounded-xl border bg-surface px-3 py-2 text-sm text-ink',
            error ? 'border-danger-500' : 'border-line',
          )}
        />
      </div>
      {error && <p className="text-sm font-medium text-danger-600">{error}</p>}
    </div>
  );
}
