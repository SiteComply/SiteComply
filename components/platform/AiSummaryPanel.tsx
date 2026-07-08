'use client';

import { useState } from 'react';
import { formatDateTimeUK } from '@/lib/datetime';

interface SummaryOutput {
  headline: string;
  executiveSummary: string;
  keyRisks: string[];
  positiveObservations: string[];
  recommendedActions: string[];
  priorityFocus: string[];
}

interface Loaded {
  summary: SummaryOutput;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
}

/**
 * "Generate AI summary" panel (AI Summaries Phase 1c). Rendered on a report /
 * audit / register page ONLY when the feature flag is on AND the viewer is in the
 * pilot role allow-list (checked server-side before this renders). Posts to the
 * summary API, which re-enforces RBAC + site-scoping upstream of the model.
 *
 * Every result is clearly labelled as AI-generated with a "verify against the
 * report" disclaimer.
 */
export function AiSummaryPanel({
  targetType,
  targetKey,
  filters,
}: {
  targetType: string;
  targetKey?: string;
  filters?: { from?: string; to?: string; sites?: string[] };
}) {
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch('/api/platform/ai/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetKey, filters }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'The summary could not be generated. Please try again.');
        return;
      }
      setLoaded({
        summary: data.summary,
        cached: !!data.cached,
        provider: data.provider ?? 'ai',
        model: data.model ?? '',
        generatedAt: data.generatedAt ?? new Date().toISOString(),
      });
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-brand-200 bg-brand-50/40 p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            AI
          </span>
          <h2 className="text-base font-semibold text-ink">AI executive summary</h2>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? 'Generating…' : loaded ? 'Regenerate' : 'Generate AI summary'}
        </button>
      </div>

      {!loaded && !error && !busy && (
        <p className="mt-3 text-sm text-ink-muted">
          Generate a concise, AI-written executive summary of this data. It is
          produced from the same figures shown here and should always be checked
          against the report.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      )}

      {loaded && (
        <div className="mt-4 space-y-4">
          <p className="text-base font-semibold text-ink">{loaded.summary.headline}</p>

          {loaded.summary.executiveSummary && (
            <p className="text-sm text-ink">{loaded.summary.executiveSummary}</p>
          )}

          {loaded.summary.positiveObservations.length > 0 && (
            <Block title="Strengths & achievements" items={loaded.summary.positiveObservations} />
          )}
          {loaded.summary.keyRisks.length > 0 && (
            <Block title="Key risks" items={loaded.summary.keyRisks} />
          )}
          {loaded.summary.recommendedActions.length > 0 && (
            <Block title="Recommended actions" items={loaded.summary.recommendedActions} />
          )}
          {loaded.summary.priorityFocus.length > 0 && (
            <Block title="Priority focus areas" items={loaded.summary.priorityFocus} ordered />
          )}

          <p className="border-t border-brand-200 pt-3 text-xs text-ink-subtle">
            ⚠︎ AI-generated from this report’s data — always verify against the
            underlying report before acting. Generated {formatDateTimeUK(loaded.generatedAt)}
            {` · ${loaded.provider}`}
            {loaded.cached ? ' · from cache' : ''}.
          </p>
        </div>
      )}
    </section>
  );
}

function Block({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: string[];
  ordered?: boolean;
}) {
  const listClass = `mt-1 space-y-1 pl-5 text-sm text-ink ${
    ordered ? 'list-decimal' : 'list-disc'
  }`;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </h3>
      {ordered ? (
        <ol className={listClass}>
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      ) : (
        <ul className={listClass}>
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
