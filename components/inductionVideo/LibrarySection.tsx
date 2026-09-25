'use client';

/**
 * THE LIBRARY INDEX: every reusable company video, and what it is doing.
 *
 * ── WHAT THIS IS FOR, SAID ON THE PAGE ────────────────────────────────────
 *
 * The Library is company footage that every project's induction can reuse, so the
 * same PPE briefing is not filmed or written twice. That sentence used to appear
 * only in the empty state, which meant the explanation vanished the moment somebody
 * added their first video.
 *
 * ── GROUPED BY WHERE IT PLAYS ─────────────────────────────────────────────
 *
 * This was a flat list with placement mentioned in a metadata line. Placement is the
 * thing that decides what an operative actually sees and in what order, so it is the
 * spine of the page instead of a footnote. Category answers the other question -
 * what is the video about - and drives the filters.
 *
 * ── THE ROW IS A SUMMARY, NOT A CONTROL PANEL ─────────────────────────────
 *
 * Uploading, issuing, retiring and settings live on the asset's own page. A row that
 * tried to do all of it could not do any of it properly, and there was nowhere to
 * put a player or the usage figures.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// Values from modules with no Prisma in them: a value import from a service that
// touches the database would ship the client to the browser, and tsc cannot see it.
import {
  LIBRARY_CATEGORIES,
  LIBRARY_PROVENANCE,
  categoryLabel,
  provenanceLabel,
} from '@/services/inductionVideo/libraryTaxonomy';
import { LIBRARY_STATUS_FILTERS, type LibraryStatus } from '@/services/inductionVideo/libraryStatus';

export interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  placement: string;
  category: string;
  provenance: string;
  status: LibraryStatus;
  usage: { onProjects: number; publishedInductions: number };
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  moduleTitle: string | null;
  issued: {
    version: number;
    issuedOn: string;
    issuedByName: string | null;
    issuedByRealm: string | null;
    durationLabel: string | null;
  } | null;
  draft: {
    id: string;
    version: number;
    preparedByName: string;
    ready: boolean;
    missing: string[];
    normaliseError: string | null;
  } | null;
}

/** The running order, which is also the grouping. */
const BANDS = [
  {
    key: 'OPENING',
    title: 'Opening',
    when: 'Before the site welcome — the first thing an operative sees.',
  },
  {
    key: 'COMPANY_BAND',
    title: 'Company standards',
    when: 'After the site information, before the site rules.',
  },
  { key: 'CLOSING', title: 'Closing', when: 'At the end, before sign-off.' },
] as const;

const TONE: Record<string, string> = {
  good: 'bg-safe-50 text-safe-700 border-safe-200',
  working: 'bg-hivis-50 text-hivis-700 border-hivis-200',
  attention: 'bg-hivis-50 text-hivis-700 border-hivis-200',
  bad: 'bg-danger-50 text-danger-700 border-danger-200',
  neutral: 'bg-surface-sunken text-ink-muted border-line',
};

export function LibrarySection({
  assets,
  modules,
  canDraft,
  canIssue,
  endpoint,
  totalProjects,
  basePath,
}: {
  assets: LibraryRow[];
  /** Company modules a video can stand in for. */
  modules: { id: string; title: string }[];
  canDraft: boolean;
  canIssue: boolean;
  /** This tier's library API. */
  endpoint: string;
  totalProjects: number;
  /**
   * This tier's Library URL, e.g. /platform/dashboard/induction-videos/library.
   *
   * A STRING, deliberately. This was a `detailHref: (id) => string` callback, and
   * that is not serialisable: a Server Component cannot hand a function to a
   * 'use client' component, so every request to this page threw before rendering a
   * thing. It type-checked and it built; only an authenticated render would have
   * caught it, and the deploy gate's smoke test gets a 307 at the login redirect.
   */
  basePath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [provenance, setProvenance] = useState('');
  const [status, setStatus] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [draft, setDraft] = useState({
    slug: '',
    title: '',
    description: '',
    placement: 'COMPANY_BAND',
    category: 'OTHER',
    moduleId: '',
  });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter((a) => {
      if (!showRetired && !a.active) return false;
      if (category && a.category !== category) return false;
      if (provenance && a.provenance !== provenance) return false;
      if (status && a.status.key !== status) return false;
      if (!needle) return true;
      return (
        a.title.toLowerCase().includes(needle) ||
        a.slug.toLowerCase().includes(needle) ||
        (a.description ?? '').toLowerCase().includes(needle) ||
        (a.moduleTitle ?? '').toLowerCase().includes(needle)
      );
    });
  }, [assets, q, category, provenance, status, showRetired]);

  const retiredCount = assets.filter((a) => !a.active).length;
  const filtered = Boolean(q.trim() || category || provenance || status);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...draft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That could not be added.');
        return;
      }
      // Straight to the video's own page, which is where footage and captions go.
      const id = (data as { assetId?: string }).assetId;
      if (id) router.push(`${basePath}/${id}`);
      else router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── WHAT THE LIBRARY IS. Stays on the page, not only when it is empty. ── */}
      <header className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">Company video library</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Reusable company footage that every project’s induction can include — a company
              introduction, PPE expectations, behavioural standards and so on. Filmed once,
              approved once, and used by every site, so the same briefing is never produced
              twice. Each video is versioned: a published induction keeps the revision it was
              made with.
            </p>
          </div>
          {canDraft && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              {adding ? 'Cancel' : 'Add a library video'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      {/* ── CREATION. The first question is the one that decides everything else. ── */}
      {adding && canDraft && (
        <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">Where will the video come from?</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-brand-300 bg-surface p-3">
              <p className="text-sm font-bold text-ink">I have footage</p>
              <p className="mt-1 text-xs text-ink-muted">
                Filmed elsewhere and exported as a video file. You will upload it and a caption
                file on the next screen.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface-sunken p-3">
              <p className="text-sm font-bold text-ink-muted">
                SiteComply produces it{' '}
                <span className="font-normal text-ink-subtle">— not available yet</span>
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                Generated from a Company Module: its approved wording becomes the narration, and
                the module stays the source of truth — you edit it there and regenerate rather
                than having two versions of the same content. This is being built next.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink">
              Title
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Company introduction"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-semibold text-ink">
              Short reference
              <input
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value.toUpperCase() })}
                placeholder="COMPANY_INTRO"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-semibold text-ink">
              What is it about?
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              >
                {LIBRARY_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink">
              Where does it play?
              <select
                value={draft.placement}
                onChange={(e) => setDraft({ ...draft, placement: e.target.value })}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              >
                {BANDS.map((b) => (
                  <option key={b.key} value={b.key}>{b.title} — {b.when}</option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2 text-xs font-semibold text-ink">
              Description (optional)
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              />
            </label>
            <label className="sm:col-span-2 text-xs font-semibold text-ink">
              Does it cover a company module? (optional)
              <select
                value={draft.moduleId}
                onChange={(e) => setDraft({ ...draft, moduleId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              >
                <option value="">No — it plays alongside the modules</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
              <span className="mt-1 block font-normal text-ink-subtle">
                If it does, the written module is left out of the induction so an operative is not
                told the same thing twice.
              </span>
            </label>
          </div>
          <button
            type="button"
            disabled={busy || draft.title.trim().length < 3 || draft.slug.trim().length < 3}
            onClick={() => void create()}
            className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add and upload footage'}
          </button>
        </section>
      )}

      {/* ── SEARCH AND FILTER ── */}
      {assets.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-3 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by title, reference or description…"
              className="min-w-[14rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
            >
              <option value="">Any subject</option>
              {LIBRARY_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <select
              value={provenance}
              onChange={(e) => setProvenance(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
            >
              <option value="">Uploaded or generated</option>
              {LIBRARY_PROVENANCE.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
            >
              <option value="">Any status</option>
              {LIBRARY_STATUS_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            {retiredCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(e) => setShowRetired(e.target.checked)}
                />
                Show retired ({retiredCount})
              </label>
            )}
          </div>
          {filtered && (
            <p className="mt-2 text-xs text-ink-subtle">
              Showing {shown.length} of {assets.length}.{' '}
              <button
                type="button"
                onClick={() => {
                  setQ(''); setCategory(''); setProvenance(''); setStatus('');
                }}
                className="font-semibold text-brand-700 hover:underline"
              >
                Clear filters
              </button>
            </p>
          )}
        </section>
      )}

      {assets.length === 0 && (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
          No library videos yet. Every project’s induction is currently built entirely from that
          project’s own information and the written company modules.
        </p>
      )}

      {/* ── GROUPED BY WHERE IT PLAYS ── */}
      {assets.length > 0 &&
        BANDS.map((band) => {
          const inBand = shown.filter((a) => a.placement === band.key);
          return (
            <section key={band.key} className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-bold text-ink">{band.title}</h3>
                <span className="text-xs text-ink-subtle">{band.when}</span>
                <span className="ml-auto text-xs font-semibold text-ink-muted">
                  {inBand.length} video{inBand.length === 1 ? '' : 's'}
                </span>
              </div>

              {inBand.length === 0 ? (
                <p className="mt-2 text-xs text-ink-subtle">
                  {filtered ? 'Nothing here matches the filters.' : 'Nothing plays here yet.'}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {inBand.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`${basePath}/${a.id}`}
                        className="block rounded-lg border border-line bg-surface-sunken p-3 hover:border-brand-300 hover:bg-brand-50/40"
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-bold text-ink">{a.title}</span>
                          <span className="text-xs text-ink-subtle">
                            {categoryLabel(a.category)} · {provenanceLabel(a.provenance)}
                          </span>
                          {a.mandatory && (
                            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                              Every project
                            </span>
                          )}
                          <span
                            className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[a.status.tone]}`}
                          >
                            {a.status.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-muted">
                          {a.status.reachesOperatives
                            ? `On ${a.usage.onProjects} of ${totalProjects} projects`
                            : 'Reaches nobody yet'}
                          {a.usage.publishedInductions > 0 &&
                            ` · in ${a.usage.publishedInductions} published induction${a.usage.publishedInductions === 1 ? '' : 's'}`}
                          {a.moduleTitle && ` · shown instead of “${a.moduleTitle}”`}
                          {a.issued?.durationLabel && ` · ${a.issued.durationLabel}`}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
    </div>
  );
}
