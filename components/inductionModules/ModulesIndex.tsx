'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// The catalogue is a plain data table with no Prisma in it, so a client component
// may import it by value — see moduleCatalogue.ts, and the guard that pins it.
import {
  MODULE_CATALOGUE,
  OPTIONAL_MODULE_CATALOGUE,
} from '@/services/inductionModules/moduleCatalogue';
import type { ModuleRow } from '@/services/inductionModules/moduleRows';

/**
 * THE COMPANY MODULES, AS A LIST YOU CAN SCAN.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * Every module used to render its entire narration here, plus an inline edit form
 * and an inline issue form. Seven modules is about 2,400 words before a single
 * click, and the page grew with the catalogue — so the commonest task, finding the
 * one module you came for, got harder every time somebody added content.
 *
 * The wording now lives on `modules/[moduleId]`. A row's job is only to help you
 * pick: what state it is in, whether anybody hears it, how many projects get it,
 * and what stands in for it.
 *
 * ── THE STATE THAT MATTERS IS STILL FIRST ─────────────────────────────────
 *
 * A module with no issued revision reaches nobody, however carefully it is written.
 * That is the safety property of the whole design, so it stays the most prominent
 * thing in the row — a derived chip from `moduleStatus`, shared with the detail
 * page so the two cannot word it differently.
 *
 * ── `basePath`, NOT A LINK BUILDER ────────────────────────────────────────
 *
 * Each tier passes the string its module pages live under and this joins the id to
 * it. A `href={(id) => …}` callback here is what took the Library index down in
 * production: a function cannot cross the server/client boundary, and Next throws
 * at render rather than at build.
 */

const TONE: Record<string, string> = {
  good: 'bg-safe-50 text-safe-700 border-safe-200',
  working: 'bg-brand-50 text-brand-700 border-brand-200',
  attention: 'bg-hivis-400/15 text-ink border-hivis-500/50',
  neutral: 'bg-surface-sunken text-ink-muted border-line',
};

export function ModulesIndex({
  modules,
  canDraft,
  canIssue,
  endpoint,
  basePath,
  libraryBasePath,
}: {
  modules: ModuleRow[];
  canDraft: boolean;
  canIssue: boolean;
  /**
   * Which front door this is: the Platform route or the Admin Centre route. Both
   * accept identical bodies and run identical actions through one dispatcher — only
   * the realm the caller is authenticated in differs.
   */
  endpoint: string;
  /** This tier's module pages, e.g. /platform/dashboard/induction-videos/modules. */
  basePath: string;
  /** This tier's library asset pages, for the video that stands in for a module. */
  libraryBasePath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [onlyNeedsWork, setOnlyNeedsWork] = useState(false);

  async function call(body: Record<string, unknown>, key: string) {
    if (busy) return null;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return null;
      }
      router.refresh();
      return data as Record<string, unknown>;
    } catch {
      setError('Network problem. Please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const retiredCount = modules.filter((m) => !m.active).length;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return modules.filter((m) => {
      if (!m.active && !showRetired) return false;
      if (onlyNeedsWork && m.status.reachesOperatives) return false;
      if (!needle) return true;
      return (
        m.title.toLowerCase().includes(needle) || m.slug.toLowerCase().includes(needle)
      );
    });
  }, [modules, q, showRetired, onlyNeedsWork]);

  /*
   * ── A CATALOGUE THAT GREW AFTER YOU SEEDED IT ─────────────────────────────
   *
   * The seed button used to render only when there were NONE, so a company that had
   * already seeded could never receive a module added to the set later. That is
   * exactly what happened when Company Introduction joined it: production held six
   * of seven, nothing in the product could create the seventh, and somebody building
   * a "Company Introduction" library video was left choosing PPE expectations as its
   * source.
   *
   * Offering it at any time is safe: it matches on slug, skips what exists and never
   * touches wording somebody has written.
   */
  const missing = MODULE_CATALOGUE.filter((c) => !modules.some((m) => m.slug === c.slug));
  /*
   * AVAILABLE, NOT MISSING. Optional modules are never counted as a gap - a company
   * that declines manual handling must not be nagged about it forever - but a module
   * can be created by no other route than a catalogue entry, so the offer has to
   * exist somewhere. One quiet line under the list, not a banner.
   */
  const available = OPTIONAL_MODULE_CATALOGUE.filter(
    (c) => !modules.some((m) => m.slug === c.slug),
  );

  if (modules.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 shadow-card">
        <h2 className="text-sm font-bold text-ink">No induction modules yet</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Induction modules are the standard content every operative hears on every
          project — a company introduction, PPE expectations, behavioural standards,
          accident and near-miss reporting, housekeeping, manual handling and
          environmental awareness. They are written once here and included in every
          site’s induction alongside that project’s own hazards and arrangements.
        </p>
        {canIssue ? (
          <>
            <button
              type="button"
              onClick={() => call({ action: 'seed' }, 'seed')}
              disabled={busy !== null}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy === 'seed'
                ? 'Creating…'
                : `Create the ${MODULE_CATALOGUE.length} standard modules`}
            </button>
            <p className="mt-2 text-xs text-ink-subtle">
              They are created as <strong>drafts</strong> with suggested wording.
              Nothing reaches an induction until you have read each one and issued it.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-subtle">A Director can create the standard set.</p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger-700">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {missing.length > 0 && canIssue && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 shadow-card">
          <h2 className="text-sm font-bold text-ink">
            {missing.length === 1
              ? 'One standard module is missing'
              : `${missing.length} standard modules are missing`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            {missing.map((m) => m.title).join(', ')} —{' '}
            {missing.length === 1 ? 'it is' : 'they are'} part of the standard set and not
            yet in your catalogue. Adding{' '}
            {missing.length === 1 ? 'it creates a draft' : 'them creates drafts'} only:
            nothing you have already written is touched, and nothing reaches an induction
            until it is issued.
          </p>
          <button
            type="button"
            onClick={() => call({ action: 'seed' }, 'seed')}
            disabled={busy !== null}
            className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {busy === 'seed' ? 'Adding…' : `Add ${missing.length === 1 ? 'it' : 'them'} to my modules`}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Company modules</h2>
            <p className="text-xs text-ink-subtle">
              Standard wording included in every project’s induction. Open one to read
              or change what it says.
            </p>
          </div>
          <label htmlFor="module-search" className="ml-auto text-xs font-semibold text-ink">
            <span className="sr-only">Search modules</span>
          </label>
          <input
            id="module-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a module"
            className="w-44 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <label className="flex items-center gap-2 text-xs font-semibold text-ink">
            <input
              type="checkbox"
              checked={onlyNeedsWork}
              onChange={(e) => setOnlyNeedsWork(e.target.checked)}
            />
            Not live only
          </label>
          {retiredCount > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-ink">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
              />
              Show retired ({retiredCount})
            </label>
          )}
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                Module
              </th>
              <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                Status
              </th>
              <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                Included
              </th>
              <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                Subject
              </th>
              <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                Used on
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <Link
                    href={`${basePath}/${m.id}`}
                    className="text-sm font-bold text-brand-700 hover:underline"
                  >
                    {m.title}
                  </Link>
                  {m.standsInFor && (
                    <div className="mt-0.5 text-xs text-ink-muted">
                      A library video stands in for this
                    </div>
                  )}
                  {m.replacesSceneType && !m.standsInFor && (
                    <div className="mt-0.5 text-xs text-ink-subtle">
                      Left out where a project records its own arrangement
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {/*
                    * ONE FACT, ONE PLACE. There was a "Reaches nobody" line under this
                    * chip; the label now says "not live" itself, so repeating it was
                    * two things to read where one would do.
                    */}
                  <span
                    className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[m.status.tone]}`}
                  >
                    {m.status.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-ink-muted">
                  {m.mandatory
                    ? 'Every site'
                    : m.defaultIncluded
                      ? 'On by default'
                      : 'Off by default'}
                </td>
                <td className="px-4 py-3 text-sm text-ink-muted">{m.category}</td>
                <td className="px-4 py-3 text-sm text-ink-muted">
                  {m.status.reachesOperatives ? (
                    <>
                      {m.usage.onProjects} of {m.usage.totalProjects} projects
                      {m.usage.excludedBy > 0 && (
                        <div className="text-xs text-ink-subtle">
                          {m.usage.excludedBy} left it out
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-ink-subtle">No projects</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {shown.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-muted">
            No module matches what you are looking for.
          </p>
        )}
        <div className="border-t border-line px-4 py-2 text-xs text-ink-subtle">
          {shown.length} of {modules.length} shown
          {!canDraft && ' · your role can read these but not change them'}
        </div>
        {available.length > 0 && canIssue && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-sunken px-4 py-2 text-xs">
            <span className="text-ink-muted">
              Also available:{' '}
              <span className="font-semibold text-ink">
                {available.map((c) => c.title).join(', ')}
              </span>{' '}
              — training content, not part of the standard induction set.
            </span>
            {available.map((c) => (
              <button
                key={c.slug}
                type="button"
                disabled={busy !== null}
                onClick={() => call({ action: 'addCatalogueModule', slug: c.slug }, `add-${c.slug}`)}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                {busy === `add-${c.slug}` ? 'Adding…' : `Add ${c.title}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
