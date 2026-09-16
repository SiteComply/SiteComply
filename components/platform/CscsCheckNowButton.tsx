'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Run one real CSCS Smart Check for this operative, now.
 *
 * FOR VALIDATING THE INTEGRATION against a real card without switching the live
 * provider for everyone. It always reaches CSCS, whatever provider is
 * configured, so the label says so plainly rather than leaving an admin to
 * wonder whether they just exercised the mock.
 *
 * The result is a real verification and is recorded as one — the page is
 * refreshed so the competency panel above reflects it, instead of showing a
 * stale record beside a fresh answer.
 */
export function CscsCheckNowButton({ workerId }: { workerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    { ok: boolean; text: string } | null
  >(null);

  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/platform/workers/${workerId}/cscs-check`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (!data) {
        setOutcome({ ok: false, text: 'No response from the server.' });
        return;
      }
      if (!data.ok) {
        setOutcome({ ok: false, text: data.error ?? 'The check could not run.' });
        return;
      }
      const r = data.result;
      setOutcome({
        ok: r.verified === true,
        // Everything needed to compare against the card in the worker's hand:
        // what the scheme says the card IS, not merely whether a call succeeded.
        text: `${r.status}${r.verified ? ' — verified' : ''}. ${
          r.holderName ? `Name on card: ${r.holderName}. ` : ''
        }${r.cardType ? `Type: ${r.cardType}. ` : ''}${
          r.scheme ? `Scheme: ${r.scheme}. ` : ''
        }${r.message ?? ''}`.trim(),
      });
      router.refresh();
    } catch {
      setOutcome({ ok: false, text: 'The check could not be completed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:bg-surface-sunken disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Check this card with CSCS now'}
      </button>
      <p className="mt-1.5 text-xs text-ink-subtle">
        Sends this operative&rsquo;s scheme, surname and card number to CSCS Smart
        Check and records the answer. Runs against CSCS even while the platform
        is set to the test provider.
      </p>
      {outcome && (
        <div
          role="status"
          aria-live="polite"
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${
            outcome.ok
              ? 'bg-safe-50 text-safe-700'
              : 'bg-hivis-400/20 text-ink ring-1 ring-inset ring-hivis-500'
          }`}
        >
          {outcome.text}
        </div>
      )}
    </div>
  );
}
