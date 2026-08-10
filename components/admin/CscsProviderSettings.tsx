'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CscsConfigView } from '@/services/cscs/cscsConfigService';

/**
 * SC-001 — Admin → Settings → Integrations → CSCS Smart Check.
 *
 * Sits with SMS and AI because it is the same kind of thing: a third-party
 * credential that the platform calls out to. Organisation policy lives in
 * Platform Settings; infrastructure credentials live here.
 *
 * NOTHING HERE IS A PLACEHOLDER. The provider choice is read by
 * resolveCscsProvider() on the next verification, and the save path REFUSES to
 * select Smart Check without credentials — a screen claiming verification is
 * live while every check fails would be the same defect as a switch with no
 * enforcement behind it, wearing a different hat.
 */
export function CscsProviderSettings({
  config,
  canManage,
}: {
  config: CscsConfigView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [activeProvider, setActiveProvider] = useState(config.activeProvider);
  const [verificationEnabled, setVerificationEnabled] = useState(
    config.verificationEnabled,
  );
  const [apiUrl, setApiUrl] = useState(config.smartCheckApiUrl);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    if (!canManage) return;
    setBusy(true);
    setErrors({});
    setMsg(null);
    try {
      const res = await fetch('/api/admin/settings/cscs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          activeProvider,
          verificationEnabled,
          smartCheckApiUrl: apiUrl,
          smartCheckApiKey: apiKey,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        if (data?.errors) setErrors(data.errors as Record<string, string>);
        setMsg({
          ok: false,
          text: data?.error ?? 'Could not save the configuration.',
        });
        return;
      }
      setApiKey('');
      setMsg({ ok: true, text: 'CSCS Smart Check configuration saved.' });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: 'Network problem. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  const selected = config.providers.find((p) => p.id === activeProvider);

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">CSCS Smart Check</h2>
          <p className="mt-0.5 text-sm text-ink-subtle">
            How worker card numbers are verified. Applies to every card captured
            during onboarding or profile updates.
          </p>
        </div>
        {config.needsCredentials ? (
          <span className="rounded-full bg-hivis-400/25 px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-inset ring-hivis-500">
            Credentials required
          </span>
        ) : null}
      </div>

      {/* States what is actually running, and where the choice came from. An
          integrations screen that cannot tell you which provider is live is how
          a mock survives unnoticed in production. */}
      <p className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        Currently verifying with{' '}
        <span className="font-semibold text-ink">
          {selected?.name ?? config.activeProvider}
        </span>
        {config.source === 'database'
          ? ' (set here).'
          : config.source === 'environment'
            ? ' (set by an environment variable).'
            : ' (platform default).'}
      </p>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink">Provider</span>
          <select
            value={activeProvider}
            disabled={!canManage || busy}
            onChange={(e) => setActiveProvider(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
          >
            {config.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {selected ? (
            <span className="mt-1 block text-xs text-ink-subtle">
              {selected.description}
            </span>
          ) : null}
          {errors.activeProvider ? (
            <span className="mt-1 block text-xs text-danger-700">
              {errors.activeProvider}
            </span>
          ) : null}
        </label>

        <label className="flex items-start justify-between gap-4 border-t border-line pt-4">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              Verification enabled
            </span>
            <span className="block text-xs text-ink-subtle">
              When off, no card is checked and the worker&rsquo;s typed details
              stand. Distinct from a provider that is configured but failing.
            </span>
          </span>
          <input
            type="checkbox"
            checked={verificationEnabled}
            disabled={!canManage || busy}
            onChange={(e) => setVerificationEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-line text-brand-600 disabled:opacity-50"
          />
        </label>

        <fieldset className="border-t border-line pt-4">
          <legend className="text-sm font-medium text-ink">
            Smart Check partner credentials
          </legend>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Issued by CSCS on partner approval. Required before the Smart Check
            provider can be selected.
          </p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">API URL</span>
              <input
                type="url"
                value={apiUrl}
                placeholder="https://api.cscssmartcheck.co.uk"
                disabled={!canManage || busy}
                onChange={(e) => setApiUrl(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
              />
              {errors.smartCheckApiUrl ? (
                <span className="mt-1 block text-xs text-danger-700">
                  {errors.smartCheckApiUrl}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">
                API key{' '}
                {config.apiKeySet ? (
                  <span className="font-normal text-ink-subtle">
                    — stored. Leave blank to keep it.
                  </span>
                ) : null}
              </span>
              <input
                type="password"
                value={apiKey}
                autoComplete="new-password"
                placeholder={config.apiKeySet ? '••••••••' : ''}
                disabled={!canManage || busy}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
              />
            </label>
          </div>
        </fieldset>
      </div>

      {msg ? (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            msg.ok
              ? 'bg-safe-50 text-safe-700'
              : 'bg-danger-50 text-danger-700'
          }`}
        >
          {msg.text}
        </p>
      ) : null}

      {canManage ? (
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="mt-4 rounded-xl bg-safe-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-safe-600 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save CSCS settings'}
        </button>
      ) : null}
    </div>
  );
}
