'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type {
  SmsProviderDescriptor,
  SmsProviderField,
} from '@/services/sms/providerCatalog';
import type { SmsConfigView } from '@/services/sms/smsConfigService';
import { formatDateTimeUK } from '@/lib/datetime';

/**
 * Provider-agnostic SMS configuration screen (Admin → Settings → Integrations).
 * The provider list and their fields are driven entirely by the catalogue
 * descriptors, so new providers appear here with no UI code changes. Secret
 * values are write-only (blank = keep existing) and never leave the server.
 */
export function SmsProviderSettings({
  providers,
  config,
  canManage = true,
}: {
  providers: SmsProviderDescriptor[];
  config: SmsConfigView;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState(config.activeProvider);
  // Full controlled value map: non-secrets prefilled, secrets start blank.
  const [values, setValues] = useState<Record<string, Record<string, string>>>(() => {
    const v: Record<string, Record<string, string>> = {};
    for (const p of providers) {
      v[p.id] = {};
      for (const f of p.fields) v[p.id][f.key] = f.secret ? '' : config.values[p.id]?.[f.key] ?? '';
    }
    return v;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState<string | undefined>();
  const [saveErr, setSaveErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | undefined>();

  const desc = providers.find((p) => p.id === active)!;

  function setField(key: string, val: string) {
    setValues((v) => ({ ...v, [active]: { ...v[active], [key]: val } }));
  }

  async function save() {
    if (!canManage) return;
    setBusy(true);
    setErrors({});
    setSavedMsg(undefined);
    setSaveErr(undefined);
    try {
      const res = await fetch('/api/admin/settings/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProvider: active, settings: values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else setSaveErr(data.error ?? 'Could not save. Please try again.');
        return;
      }
      setSavedMsg('Configuration saved.');
      // Clear entered secrets (now stored) and refresh the "stored" indicators.
      setValues((v) => {
        const next = { ...v, [active]: { ...v[active] } };
        for (const f of desc.fields) if (f.secret) next[active][f.key] = '';
        return next;
      });
      router.refresh();
    } catch {
      setSaveErr('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!canManage) return;
    setTestBusy(true);
    setTestResult(undefined);
    try {
      const res = await fetch('/api/admin/settings/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: active, to: testTo, settings: values[active] }),
      });
      const data = await res.json().catch(() => ({}));
      setTestResult({
        ok: !!data.ok,
        text: data.ok ? data.message ?? 'Test succeeded.' : data.error ?? 'Test failed.',
      });
    } catch {
      setTestResult({ ok: false, text: 'Network problem. Please try again.' });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Active provider selector */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Active SMS provider</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          The gateway used to send worker verification codes. Changes take effect
          immediately once saved.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {providers.map((p) => {
            const on = p.id === active;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActive(p.id)}
                className={cn(
                  'rounded-xl border p-3 text-left transition-colors',
                  on ? 'border-brand-500 bg-brand-50' : 'border-line hover:bg-surface-sunken',
                )}
              >
                <span className="block text-sm font-semibold text-ink">{p.name}</span>
                <span className="mt-0.5 block text-xs text-ink-subtle">{p.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Provider configuration (dynamic from the descriptor) */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Configuration — {desc.name}</h2>
        {desc.fields.length === 0 ? (
          <p className="mt-2 text-sm text-ink-subtle">
            This provider has no settings to configure.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {desc.fields.map((f) => (
              <Field
                key={f.key}
                field={f}
                value={values[active][f.key]}
                stored={!!config.secretSet[active]?.[f.key]}
                error={errors[f.key]}
                onChange={(v) => setField(f.key, v)}
              />
            ))}
          </div>
        )}

        {saveErr && (
          <p className="mt-3 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
            {saveErr}
          </p>
        )}
        {savedMsg && (
          <p className="mt-3 rounded-lg border border-safe-500 bg-safe-50 px-3 py-2 text-sm font-medium text-safe-700">
            {savedMsg}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy || !canManage}
            className="rounded-xl bg-safe-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-safe-600 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save configuration'}
          </button>
          {config.updatedAt && (
            <span className="text-xs text-ink-subtle">
              Last updated {formatDateTimeUK(config.updatedAt)}
              {config.updatedByName ? ` by ${config.updatedByName}` : ''}
            </span>
          )}
        </div>
      </section>

      {/* Test connectivity */}
      {desc.supportsTest && (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold text-ink">Test connectivity</h2>
          <p className="mt-0.5 text-sm text-ink-subtle">
            Send a test message using the settings above (unsaved secret fields
            fall back to the stored value). This may incur a provider charge.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink">Send test to</span>
              <input
                type="tel"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="07700 900123"
                className="w-56 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              onClick={test}
              disabled={testBusy || testTo.trim() === '' || !canManage}
              className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60"
            >
              {testBusy ? 'Testing…' : 'Send test message'}
            </button>
          </div>
          {testResult && (
            <p
              className={cn(
                'mt-3 rounded-lg border px-3 py-2 text-sm font-medium',
                testResult.ok
                  ? 'border-safe-500 bg-safe-50 text-safe-700'
                  : 'border-danger-500 bg-danger-50 text-danger-700',
              )}
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.text}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  stored,
  error,
  onChange,
}: {
  field: SmsProviderField;
  value: string;
  stored: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  const common = cn(
    'w-full rounded-xl border bg-surface px-3 py-2 text-sm text-ink',
    error ? 'border-danger-500' : 'border-line',
  );
  const placeholder = field.secret && stored ? '•••••••• (stored — leave blank to keep)' : field.placeholder;
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">
        {field.label}
        {field.required && <span className="text-danger-600"> *</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={common} />
      ) : (
        <input
          type={field.type === 'password' ? 'password' : field.type === 'tel' ? 'tel' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={common}
        />
      )}
      {error ? (
        <p className="text-sm font-medium text-danger-600">{error}</p>
      ) : field.help ? (
        <p className="text-xs text-ink-subtle">{field.help}</p>
      ) : null}
    </div>
  );
}
