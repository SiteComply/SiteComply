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
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    severity: 'success' | 'warning' | 'error';
    title: string;
    detail: string;
    httpStatus?: number;
    durationMs: number;
  } | null>(null);

  /**
   * Test the credentials as typed, without saving.
   *
   * Deliberately does NOT save first. saveCscsConfig() refuses to select Smart
   * Check without working credentials, so testing has to come before saving or
   * the admin is stuck at the step this button exists to unblock.
   */
  async function testConnection() {
    if (!canManage) return;
    setTestBusy(true);
    setTestResult(null);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/settings/cscs/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          smartCheckApiUrl: apiUrl,
          smartCheckApiKey: apiKey, // blank → the stored key is used
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.result) {
        setTestResult({
          severity: 'error',
          title: 'The test could not be run.',
          detail: 'Please try again.',
          durationMs: 0,
        });
        return;
      }
      setTestResult(data.result);
    } catch {
      setTestResult({
        severity: 'error',
        title: 'Network problem.',
        detail: 'The test request did not leave the browser. Please try again.',
        durationMs: 0,
      });
    } finally {
      setTestBusy(false);
    }
  }

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

  // `selected` follows the DROPDOWN — it describes the option under the cursor,
  // which is what the description beneath the select should explain.
  const selected = config.providers.find((p) => p.id === activeProvider);

  // `live` follows the SAVED configuration — what is actually verifying cards
  // right now. config.activeProvider is the resolved runtime provider
  // (database, then environment, then the platform default).
  //
  // These were the same binding, so the banner named whatever was highlighted
  // in the dropdown while still attributing it to the saved source: picking
  // Smart Check without saving produced "Currently verifying with CSCS Smart
  // Check (platform default)" while the mock was still running. The banner
  // exists to stop a mock surviving unnoticed in production, so it has to
  // report what runs, never what someone is part-way through choosing.
  const live = config.providers.find((p) => p.id === config.activeProvider);

  // A stored key counts: the field is blank when a key is already held, and
  // "blank means keep the stored one" is the convention the API honours.
  const canTest =
    apiUrl.trim() !== '' && (apiKey.trim() !== '' || config.apiKeySet);

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
          <span className="whitespace-nowrap rounded-full bg-hivis-400/25 px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-inset ring-hivis-500">
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
          {live?.name ?? config.activeProvider}
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

        {/* Test connection.
            Only for a provider that actually connects to something — the mock
            never leaves the process, so a test there could only ever report a
            success that means nothing.

            Placed between the credentials and Save on purpose: that is the
            order the workflow runs in, because the save path refuses to select
            Smart Check until the credentials exist. */}
        {selected?.supportsTest ? (
          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-medium text-ink">Test connection</h3>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Sends one request to the partner API using the credentials above,
              including any you have not saved yet. No card is verified, no
              worker is involved and nothing is recorded against the CSCS
              report.
            </p>
            <button
              type="button"
              onClick={testConnection}
              disabled={testBusy || busy || !canManage || !canTest}
              className="mt-3 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:bg-surface-sunken disabled:opacity-60"
            >
              {testBusy ? 'Testing…' : 'Test connection'}
            </button>
            {!canTest && canManage ? (
              <span className="mt-2 block text-xs text-ink-subtle">
                Enter the API URL and key first.
              </span>
            ) : null}

            {testResult ? (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  testResult.severity === 'success'
                    ? 'bg-safe-50 text-safe-700'
                    : testResult.severity === 'warning'
                      ? 'bg-hivis-400/20 text-ink ring-1 ring-inset ring-hivis-500'
                      : 'bg-danger-50 text-danger-700'
                }`}
                role="status"
                aria-live="polite"
              >
                <p className="font-semibold">
                  {testResult.severity === 'success'
                    ? '✓ '
                    : testResult.severity === 'warning'
                      ? '! '
                      : '✗ '}
                  {testResult.title}
                </p>
                <p className="mt-1 text-xs">{testResult.detail}</p>
                <p className="mt-1 text-xs opacity-70">
                  {testResult.httpStatus
                    ? `HTTP ${testResult.httpStatus} · `
                    : ''}
                  {testResult.durationMs}ms
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
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
