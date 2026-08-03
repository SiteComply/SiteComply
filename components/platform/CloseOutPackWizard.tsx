'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SectionAvailability } from '@/services/closeOut/closeOutService';

/**
 * SC-024 Phase 1 — the Project Close-Out Pack generator.
 *
 * Follows the REV-1 example: a three-step wizard, a selectable and reorderable
 * section list carrying live counts, and a live preview beside it showing the
 * cover page and the estimates.
 *
 * UNAVAILABLE SECTIONS ARE SHOWN, NOT HIDDEN. A handover pack that silently
 * omits incidents looks identical to a project that had none, and those are
 * very different statements to make to a client — so the row stays, disabled,
 * with the reason on it.
 */

const STEPS = [
  { n: 1, title: 'Select Content', sub: 'Choose the sections to include' },
  { n: 2, title: 'Personalise', sub: 'Review and customise' },
  { n: 3, title: 'Generate', sub: 'Preview and download' },
];

export function CloseOutPackWizard({
  siteId,
  siteName,
  jobReference,
  address,
  sections,
  preparedBy,
}: {
  siteId: string;
  siteName: string;
  jobReference: string;
  address: string;
  sections: SectionAvailability[];
  preparedBy: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [order, setOrder] = useState<string[]>(() => sections.map((s) => s.id));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.defaultSelected).map((s) => s.id)),
  );
  const [title, setTitle] = useState(`${siteName} — Project Close-Out Pack`);
  const [preparedFor, setPreparedFor] = useState('');

  const byId = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections],
  );
  const ordered = useMemo(
    () =>
      order
        .map((id) => byId.get(id as SectionAvailability['id']))
        .filter((s): s is SectionAvailability => Boolean(s)),
    [order, byId],
  );
  const chosen = ordered.filter((s) => selected.has(s.id) && s.available);
  const estimatedPages = chosen.reduce((n, s) => n + s.estimatedPages, 1);
  const photoCount = chosen.find((s) => s.id === 'PHOTOS_EVIDENCE')?.count ?? 0;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function move(id: string, delta: number) {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/close-out`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          preparedFor,
          sections: chosen.map((s, i) => ({ section: s.id, order: i })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not generate the pack.');
        return;
      }
      router.push(`/platform/dashboard/sites/${siteId}/close-out/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="rounded-2xl border border-line bg-surface p-5">
        {/* Step rail, as in the REV-1 example. */}
        <ol className="mb-6 flex flex-wrap gap-4">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                  step === s.n
                    ? 'bg-brand-600 text-white'
                    : step > s.n
                      ? 'bg-safe-500 text-white'
                      : 'bg-surface-sunken text-ink-muted'
                }`}
              >
                {s.n}
              </span>
              <span>
                <span
                  className={`block text-sm font-semibold ${step === s.n ? 'text-brand-700' : 'text-ink'}`}
                >
                  {s.title}
                </span>
                <span className="block text-xs text-ink-subtle">{s.sub}</span>
              </span>
            </li>
          ))}
        </ol>

        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        ) : null}

        {step === 1 ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-ink">
                  1. Select Content
                </h2>
                <p className="text-sm text-ink-muted">
                  Choose the sections you want to include in your close-out
                  pack.
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      new Set(
                        sections.filter((s) => s.available).map((s) => s.id),
                      ),
                    )
                  }
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="font-semibold text-danger-600 hover:underline"
                >
                  Clear all
                </button>
              </div>
            </div>

            <ul className="space-y-2">
              {ordered.map((s, i) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    s.available
                      ? 'border-line bg-surface'
                      : 'border-line bg-surface-sunken opacity-70'
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={s.label}
                    className="h-5 w-5 shrink-0 rounded border-line text-brand-600 disabled:opacity-40"
                    checked={selected.has(s.id) && s.available}
                    disabled={!s.available}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {s.label}
                      {!s.available ? (
                        <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                          Unavailable
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {s.available ? s.description : s.unavailableReason}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-ink-subtle">
                    {s.available ? `${s.count} ${s.unit}` : '—'}
                  </span>
                  {/* Reordering by buttons rather than drag: it works with a
                      keyboard and on a phone in a site office, which drag does
                      not. */}
                  <span className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label={`Move ${s.label} up`}
                      disabled={i === 0}
                      onClick={() => move(s.id, -1)}
                      className="px-1 text-xs text-ink-muted disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${s.label} down`}
                      disabled={i === ordered.length - 1}
                      onClick={() => move(s.id, 1)}
                      className="px-1 text-xs text-ink-muted disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
              Unavailable sections cannot be included — either SiteComply has no
              records of that type yet, or you do not have access to them on
              this project.
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={chosen.length === 0}
                onClick={() => setStep(2)}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Continue to Personalise →
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-base font-bold text-ink">2. Personalise</h2>
            <p className="mb-3 text-sm text-ink-muted">
              These appear on the cover page of the pack.
            </p>
            <label className="block text-sm font-medium text-ink">
              Pack title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-ink">
              Prepared for (optional)
              <input
                value={preparedFor}
                onChange={(e) => setPreparedFor(e.target.value)}
                placeholder="e.g. ABC Facilities Management"
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>

            <p className="mt-4 text-sm font-medium text-ink">
              {chosen.length} section{chosen.length === 1 ? '' : 's'} included,
              in this order:
            </p>
            <ol className="mt-1 list-decimal pl-5 text-sm text-ink-muted">
              {chosen.map((s) => (
                <li key={s.id}>
                  {s.label}{' '}
                  <span className="text-ink-subtle">
                    ({s.count} {s.unit})
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Continue to Generate →
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-base font-bold text-ink">3. Generate</h2>
            <p className="mb-3 text-sm text-ink-muted">
              Generating records this pack against the project as a new version.
              Nothing already generated is changed.
            </p>
            <ul className="mb-4 space-y-1 text-sm text-ink-muted">
              <li>
                <b className="text-ink">{chosen.length}</b> sections
              </li>
              <li>
                <b className="text-ink">~{estimatedPages}</b> estimated pages
              </li>
              {photoCount > 0 ? (
                <li>
                  <b className="text-ink">{photoCount}</b> photos
                </li>
              ) : null}
            </ul>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={busy || chosen.length === 0}
                onClick={generate}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Generating…' : 'Generate pack'}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* Live preview, as in the REV-1 example. */}
      <aside className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-base font-bold text-ink">Close-Out Pack Preview</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Compiled from the records already held for this project.
        </p>

        <div className="rounded-xl border border-line bg-surface-sunken p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            SiteComply
          </p>
          <p className="mt-2 text-sm font-bold uppercase text-ink">
            {siteName}
          </p>
          <p className="text-sm font-bold uppercase text-ink">
            Project Close-Out Pack
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs">
            <div>
              <p className="font-semibold text-ink">Project address</p>
              <p className="text-ink-muted">{address || '—'}</p>
            </div>
            <div>
              <p className="font-semibold text-ink">Job reference</p>
              <p className="text-ink-muted">{jobReference}</p>
            </div>
            <div>
              <p className="font-semibold text-ink">Prepared for</p>
              <p className="text-ink-muted">{preparedFor || '—'}</p>
            </div>
            <div>
              <p className="font-semibold text-ink">Prepared by</p>
              <p className="text-ink-muted">{preparedBy}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line px-3 py-2">
            <p className="text-lg font-bold text-ink">~{estimatedPages}</p>
            <p className="text-xs text-ink-muted">Estimated pages</p>
          </div>
          <div className="rounded-lg border border-line px-3 py-2">
            <p className="text-lg font-bold text-ink">{photoCount}</p>
            <p className="text-xs text-ink-muted">Photos</p>
          </div>
        </div>
        {/* The example shows a file-size estimate. Phase 1 prints from the
            browser and produces no server-side file, so a size figure would be
            invented — photo count is the honest equivalent. */}
      </aside>
    </div>
  );
}
