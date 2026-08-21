'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type {
  AiProviderDescriptor,
  AiProviderField,
} from '@/services/ai/aiProviderCatalog';
import { AI_ELIGIBLE_ROLES } from '@/services/ai/aiProviderCatalog';
import type { AiConfigView } from '@/services/ai/aiConfigService';
import { formatDateTimeUK } from '@/lib/datetime';

/**
 * Provider-agnostic AI configuration screen (Admin → Settings → Integrations).
 * Mirrors the SMS screen: the provider list and their fields are driven by the
 * catalogue descriptors, so new providers appear with no UI changes. Adds the
 * AI feature settings — enabled flag, allowed roles and usage caps — plus a
 * per-provider status indicator. Secret values are write-only (blank = keep
 * existing) and never leave the server.
 */
export function AiProviderSettings({
  providers,
  config,
  canManage = true,
}: {
  providers: AiProviderDescriptor[];
  config: AiConfigView;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(config.enabled);
  const [active, setActive] = useState(config.activeProvider);
  const [roles, setRoles] = useState<string[]>(config.allowedRoles);
  const [daily, setDaily] = useState(
    config.dailyPerUser == null ? '' : String(config.dailyPerUser),
  );
  const [monthly, setMonthly] = useState(
    config.monthlyGlobal == null ? '' : String(config.monthlyGlobal),
  );
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

  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | undefined>();

  const desc = providers.find((p) => p.id === active)!;
  const activeConfigured = config.providerConfigured[active] ?? false;
  const activeSource = config.providerConfiguredSource?.[active] ?? 'none';

  function setField(key: string, val: string) {
    setValues((v) => ({ ...v, [active]: { ...v[active], [key]: val } }));
  }

  function toggleRole(value: string) {
    setRoles((r) => (r.includes(value) ? r.filter((x) => x !== value) : [...r, value]));
  }

  async function save() {
    if (!canManage) return;
    setBusy(true);
    setErrors({});
    setSavedMsg(undefined);
    setSaveErr(undefined);
    try {
      const res = await fetch('/api/admin/settings/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          activeProvider: active,
          settings: values,
          allowedRoles: roles,
          dailyPerUser: daily.trim() === '' ? null : Number(daily),
          monthlyGlobal: monthly.trim() === '' ? null : Number(monthly),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        setSaveErr(
          data.errors
            ? 'Fix the highlighted fields — the active provider must be configured to enable AI.'
            : data.error ?? 'Could not save. Please try again.',
        );
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
      const res = await fetch('/api/admin/settings/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: active, settings: values[active] }),
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
      {/* Feature status + enable toggle */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">AI summaries</h2>
            <p className="mt-0.5 text-sm text-ink-subtle">
              Generates concise, PII-safe summaries on reports, audits and the
              actions register. Off by default; enabling requires a configured
              provider.
            </p>
          </div>
          <StatusPill
            ok={enabled && activeConfigured}
            warn={enabled && !activeConfigured}
            label={
              enabled
                ? activeConfigured
                  ? 'Enabled'
                  : 'Enabled — provider not configured'
                : 'Disabled'
            }
          />
        </div>
        <label className="mt-4 flex items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-line text-brand-600"
          />
          <span className="text-sm font-medium text-ink">Enable AI summaries</span>
        </label>
      </section>

      {/* Active provider selector */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">AI provider</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          The model gateway used to generate summaries. Changes take effect
          immediately once saved.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {providers.map((p) => {
            const on = p.id === active;
            const configured = config.providerConfigured[p.id] ?? false;
            const configuredSource = config.providerConfiguredSource?.[p.id] ?? 'none';
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
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  {p.fields.length > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        configured
                          ? 'bg-safe-50 text-safe-700'
                          : 'bg-surface-sunken text-ink-subtle',
                      )}
                    >
                      {configured
                        ? configuredSource === 'environment'
                          ? 'Configured (environment)'
                          : configuredSource === 'mixed'
                            ? 'Configured (mixed)'
                            : 'Configured'
                        : 'Not configured'}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-ink-subtle">{p.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Provider configuration (dynamic from the descriptor) */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Configuration — {desc.name}</h2>
        {(activeSource === 'environment' || activeSource === 'mixed') && (
          <p className="mt-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            {activeSource === 'environment'
              ? 'This provider is currently configured by server environment settings, which is why the fields below are blank. It is working — leave them blank to keep using those settings.'
              : 'Some values below come from server environment settings and are shown blank. Saved values here take precedence over them.'}
          </p>
        )}
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
      </section>

      {/* Feature settings — allowed roles + usage caps */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Feature settings</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Who can request summaries and how heavily the feature may be used.
        </p>

        <div className="mt-4">
          <span className="block text-sm font-semibold text-ink">Allowed roles</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {AI_ELIGIBLE_ROLES.map((r) => (
              <label
                key={r.value}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={roles.includes(r.value)}
                  onChange={() => toggleRole(r.value)}
                  className="h-4 w-4 rounded border-line text-brand-600"
                />
                <span className="text-ink">{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">Daily limit per user</span>
            <input
              type="number"
              min={1}
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              placeholder="Default (20)"
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <span className="text-xs text-ink-subtle">Blank uses the system default.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">Monthly limit (organisation)</span>
            <input
              type="number"
              min={1}
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="Default (1000)"
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <span className="text-xs text-ink-subtle">Blank uses the system default.</span>
          </label>
        </div>
      </section>

      {/* Save + feedback */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        {saveErr && (
          <p className="mb-3 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
            {saveErr}
          </p>
        )}
        {savedMsg && (
          <p className="mb-3 rounded-lg border border-safe-500 bg-safe-50 px-3 py-2 text-sm font-medium text-safe-700">
            {savedMsg}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
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
            Sends a tiny completion using the settings above (unsaved secret
            fields fall back to the stored value). This may incur a provider
            charge.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={test}
              disabled={testBusy || !canManage}
              className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60"
            >
              {testBusy ? 'Testing…' : 'Test connection'}
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

function StatusPill({ ok, warn, label }: { ok: boolean; warn: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
        ok
          ? 'bg-safe-50 text-safe-700'
          : warn
            ? 'bg-surface-sunken text-hivis-600'
            : 'bg-surface-sunken text-ink-subtle',
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          ok ? 'bg-safe-500' : warn ? 'bg-hivis-500' : 'bg-ink-subtle',
        )}
      />
      {label}
    </span>
  );
}

function Field({
  field,
  value,
  stored,
  error,
  onChange,
}: {
  field: AiProviderField;
  value: string;
  stored: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  const common = cn(
    'w-full rounded-xl border bg-surface px-3 py-2 text-sm text-ink',
    error ? 'border-danger-500' : 'border-line',
  );
  const placeholder =
    field.secret && stored ? '•••••••• (stored — leave blank to keep)' : field.placeholder;
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">
        {field.label}
        {field.required && <span className="text-danger-600"> *</span>}
      </label>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={common}
      />
      {error ? (
        <p className="text-sm font-medium text-danger-600">{error}</p>
      ) : field.help ? (
        <p className="text-xs text-ink-subtle">{field.help}</p>
      ) : null}
    </div>
  );
}
