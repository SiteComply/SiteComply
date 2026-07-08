'use client';

import { useState } from 'react';
import { formatDateTimeUK, formatDateUK, formatTimeUK } from '@/lib/datetime';
import { aiSummaryTargetLabel } from '@/services/ai/aiConstants';

interface SummaryOutput {
  headline: string;
  executiveSummary: string;
  positiveObservations: string[];
  keyRisks: string[];
  recommendedActions: string[];
  priorityFocus: string[];
}

interface Loaded {
  summary: SummaryOutput;
  cached: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  /** Set when viewing a stored past summary rather than a fresh generation. */
  historical?: { generatedByName: string | null; promptVersion: string };
}

interface HistoryItem {
  id: string;
  createdAt: string;
  generatedByName: string | null;
  provider: string;
  model: string;
  promptVersion: string;
}

interface HistoryState {
  items: HistoryItem[];
  page: number;
  pageCount: number;
  total: number;
}

/**
 * "Generate AI summary" panel (AI Summaries Phase 1c) + summary history browser.
 * Rendered on a report / audit / register page ONLY when the feature flag is on
 * AND the viewer is in the pilot role allow-list (checked server-side before this
 * renders). All fetches re-enforce RBAC + site-scoping upstream of the model.
 *
 * "View history" lists previously generated summaries for THIS report/record
 * (generation date, who generated it, provider, prompt version) and opens any of
 * them read-only — without spending a generation.
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

  const [history, setHistory] = useState<HistoryState | undefined>();
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | undefined>();

  function historyQuery(page: number): string {
    const p = new URLSearchParams();
    p.set('targetType', targetType);
    if (targetKey) p.set('targetKey', targetKey);
    if (filters?.from) p.set('from', filters.from);
    if (filters?.to) p.set('to', filters.to);
    if (filters?.sites && filters.sites.length) p.set('sites', filters.sites.join(','));
    p.set('page', String(page));
    return p.toString();
  }

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

  async function openHistory(page = 1) {
    setHistoryBusy(true);
    setHistoryError(undefined);
    try {
      const res = await fetch(`/api/platform/ai/summary/history?${historyQuery(page)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setHistoryError(data.error ?? 'History could not be loaded.');
        setHistory({ items: [], page: 1, pageCount: 1, total: 0 });
        return;
      }
      setHistory({
        items: data.items ?? [],
        page: data.page ?? page,
        pageCount: data.pageCount ?? 1,
        total: data.total ?? 0,
      });
    } catch {
      setHistoryError('Network problem. Please try again.');
      setHistory({ items: [], page: 1, pageCount: 1, total: 0 });
    } finally {
      setHistoryBusy(false);
    }
  }

  async function openHistoricalItem(id: string) {
    setHistoryBusy(true);
    setHistoryError(undefined);
    try {
      const res = await fetch(`/api/platform/ai/summary/history/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setHistoryError(data.error ?? 'This summary could not be opened.');
        return;
      }
      setLoaded({
        summary: data.summary,
        cached: false,
        provider: data.provider ?? 'ai',
        model: data.model ?? '',
        generatedAt: data.createdAt ?? new Date().toISOString(),
        historical: {
          generatedByName: data.generatedByName ?? null,
          promptVersion: data.promptVersion ?? '',
        },
      });
      setHistory(undefined); // collapse the list; show the opened summary
    } catch {
      setHistoryError('Network problem. Please try again.');
    } finally {
      setHistoryBusy(false);
    }
  }

  const showingHistory = history !== undefined;

  return (
    <section className="mb-6 rounded-xl border border-brand-200 bg-brand-50/40 p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            AI
          </span>
          <h2 className="text-base font-semibold text-ink">AI executive summary</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (showingHistory ? setHistory(undefined) : openHistory(1))}
            disabled={historyBusy || busy}
            className="rounded-xl border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm hover:bg-brand-50 disabled:opacity-60"
          >
            {historyBusy ? 'Loading…' : showingHistory ? 'Hide history' : 'View history'}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
          >
            {busy ? 'Generating…' : loaded ? 'Regenerate' : 'Generate AI summary'}
          </button>
        </div>
      </div>

      {!loaded && !error && !busy && !showingHistory && (
        <p className="mt-3 text-sm text-ink-muted">
          Generate a concise, AI-written executive summary of this data, or view
          previously generated summaries. Summaries are produced from the same
          figures shown here and should always be checked against the report.
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

      {showingHistory && (
        <HistoryList
          state={history!}
          label={aiSummaryTargetLabel(targetType)}
          busy={historyBusy}
          error={historyError}
          onOpen={openHistoricalItem}
          onPage={openHistory}
        />
      )}

      {loaded && !showingHistory && (
        <div className="mt-4 space-y-4">
          {loaded.historical && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs text-ink-muted">
              <span>
                Historical summary — generated {formatDateTimeUK(loaded.generatedAt)}
                {loaded.historical.generatedByName ? ` by ${loaded.historical.generatedByName}` : ''}
                {` · ${loaded.provider} · prompt ${loaded.historical.promptVersion}`}
              </span>
              <button
                type="button"
                onClick={() => openHistory(1)}
                className="font-semibold text-brand-700 hover:underline"
              >
                ← Back to history
              </button>
            </div>
          )}

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

function HistoryList({
  state,
  label,
  busy,
  error,
  onOpen,
  onPage,
}: {
  state: HistoryState;
  label: string;
  busy: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-ink">
        Previous summaries — {label}
      </h3>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      )}

      {!error && state.items.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          No summaries have been generated for this report yet.
        </p>
      )}

      {state.items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {state.items.map((it, i) => (
            <HistoryRow
              key={it.id}
              item={it}
              latest={state.page === 1 && i === 0}
              busy={busy}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}

      {state.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-ink-subtle">
            Page {state.page} of {state.pageCount} · {state.total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPage(state.page - 1)}
              disabled={busy || state.page <= 1}
              className="rounded-lg border border-brand-200 px-3 py-1.5 font-medium text-brand-700 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => onPage(state.page + 1)}
              disabled={busy || state.page >= state.pageCount}
              className="rounded-lg border border-brand-200 px-3 py-1.5 font-medium text-brand-700 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  item,
  latest,
  busy,
  onOpen,
}: {
  item: HistoryItem;
  latest: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <li>
      <div
        className={`group overflow-hidden rounded-xl border transition-colors ${
          latest
            ? 'border-brand-300 bg-brand-50/70'
            : 'border-brand-100 bg-white hover:border-brand-300'
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          disabled={busy}
          aria-label={`Open AI summary generated on ${formatDateUK(item.createdAt)} at ${formatTimeUK(
            item.createdAt,
          )}`}
          className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{formatDateUK(item.createdAt)}</span>
              <span className="text-sm tabular-nums text-ink-muted">{formatTimeUK(item.createdAt)}</span>
              {latest && (
                <span className="inline-flex items-center rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Latest
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-xs text-ink-muted">
              Generated by {item.generatedByName ?? 'Unknown user'}
            </span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5 shrink-0 text-brand-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 4l6 6-6 6" />
          </svg>
        </button>
        <div className="border-t border-brand-100/70 px-4 py-2">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="text-xs font-medium text-ink-subtle hover:text-ink-muted"
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
          {showDetails && (
            <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs text-ink-muted">
              <dt className="font-medium text-ink-subtle">AI provider</dt>
              <dd>{item.provider}</dd>
              <dt className="font-medium text-ink-subtle">Model</dt>
              <dd>{item.model || '—'}</dd>
              <dt className="font-medium text-ink-subtle">Prompt version</dt>
              <dd>{item.promptVersion}</dd>
            </dl>
          )}
        </div>
      </div>
    </li>
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
