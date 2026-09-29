'use client';

/**
 * ADDING A LIBRARY VIDEO.
 *
 * ── WHY THIS IS ITS OWN COMPONENT ─────────────────────────────────────────
 *
 * The index is a list; creating is a different job with its own rules, and it had
 * grown to half the file. Separating it also means it can be RENDERED in a test:
 * inside the list it only appeared after a click, so no static render could reach it
 * and the checks that mattered most here could not be written.
 *
 * ── THE ORDER OF THE QUESTIONS IS THE POINT ───────────────────────────────
 *
 * When SiteComply is producing the video, the company module is asked FIRST and fills
 * in the title. It used to be the last field, and the result was a video called
 * "Company introduction" produced from PPE expectations — because the picker hid every
 * module without issued wording, and PPE was the only one that had any. An unissued
 * module is now listed and marked instead of hidden, because "issue that first" is a
 * useful instruction and an absence is not.
 */

import { useState } from 'react';
import Link from 'next/link';
import { LIBRARY_CATEGORIES } from '@/services/inductionVideo/libraryTaxonomy';

export interface CreatableModule {
  id: string;
  title: string;
  slug: string;
  category: string;
  /** Has issued wording. Without it nothing can be produced from this module. */
  hasIssued: boolean;
}

export interface LibraryDraft {
  slug: string;
  title: string;
  description: string;
  placement: string;
  category: string;
  moduleId: string;
  provenance: 'UPLOADED' | 'GENERATED';
}

export const EMPTY_LIBRARY_DRAFT: LibraryDraft = {
  slug: '', title: '', description: '', placement: 'COMPANY_BAND',
  category: 'OTHER', moduleId: '', provenance: 'UPLOADED',
};

/** The running order, shown so somebody choosing a placement can see what it means. */
const BANDS = [
  { key: 'OPENING', title: 'Opening', when: 'Before the site welcome — the first thing an operative sees.' },
  { key: 'COMPANY_BAND', title: 'Company standards', when: 'After the site information, before the site rules.' },
  { key: 'CLOSING', title: 'Closing', when: 'At the end, before sign-off.' },
] as const;

/**
 * A sensible library category for a module, so choosing one fills it in rather than
 * leaving everything under "Other". The two taxonomies are deliberately different —
 * a module is categorised for the induction's running order, a library video for
 * finding things — so this maps, and falls back when it genuinely cannot tell.
 */
export function categoryForModule(moduleCategory?: string, slug?: string): string {
  const bySlug: Record<string, string> = {
    COMPANY_INTRODUCTION: 'COMPANY_CULTURE',
    PPE_EXPECTATIONS: 'PPE',
    BEHAVIOURAL_STANDARDS: 'BEHAVIOUR',
    ACCIDENT_REPORTING: 'REPORTING',
    HOUSEKEEPING: 'HOUSEKEEPING',
    MANUAL_HANDLING: 'MANUAL_HANDLING',
    ENVIRONMENTAL_AWARENESS: 'ENVIRONMENT',
  };
  if (slug && bySlug[slug]) return bySlug[slug];
  const byCategory: Record<string, string> = {
    BEHAVIOUR: 'BEHAVIOUR', ENVIRONMENT: 'ENVIRONMENT', REPORTING: 'REPORTING',
  };
  return (moduleCategory && byCategory[moduleCategory]) || 'OTHER';
}

/**
 * Fill in what the chosen module implies, WITHOUT overwriting anything typed.
 *
 * The module IS the video, so its title is the video's title and its subject the
 * video's subject. That is what stops a video called "Company introduction" being
 * produced from PPE wording, which is what the old field ordering quietly allowed.
 *
 * Blank fields only. Somebody who has already typed a title meant it, and having the
 * form overwrite their words would be worse than leaving them to fix a mismatch.
 *
 * Pure and exported because it is a RULE, not markup: a static render never fires an
 * onChange, so inside the component it could not be tested at all.
 */
export function applyModuleToDraft(draft: LibraryDraft, module?: CreatableModule): LibraryDraft {
  return {
    ...draft,
    moduleId: module?.id ?? '',
    title: draft.title.trim() ? draft.title : (module?.title ?? ''),
    slug: draft.slug.trim() ? draft.slug : (module?.slug ?? ''),
    category:
      draft.category !== 'OTHER'
        ? draft.category
        : categoryForModule(module?.category, module?.slug),
  };
}

export function LibraryCreatePanel({
  modules,
  modulesHref,
  busy,
  onCreate,
  initialDraft = EMPTY_LIBRARY_DRAFT,
}: {
  modules: CreatableModule[];
  /** This tier's Company modules page, for the "write one first" route out. */
  modulesHref: string;
  busy: boolean;
  onCreate: (draft: LibraryDraft) => void;
  /** Where the form starts. Defaults to blank and uploaded. */
  initialDraft?: LibraryDraft;
}) {
  const [draft, setDraft] = useState<LibraryDraft>(initialDraft);
  const setProvenanceChoice = (provenance: 'UPLOADED' | 'GENERATED') =>
    setDraft((d) => ({ ...d, provenance }));
  const chosenModule = modules.find((m) => m.id === draft.moduleId) ?? null;

  /**
   * Choosing the module fills in everything it can.
   *
   * The module IS the video, so its title is the video's title. Filling it in is not
   * a convenience: it is what stops a video called "Company introduction" being
   * produced from PPE wording. Only ever fills BLANK fields — somebody who has
   * already typed a title meant it.
   */
  function pickModule(moduleId: string) {
    setDraft((d) => applyModuleToDraft(d, modules.find((x) => x.id === moduleId)));
  }

  return (
<section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-card">
      <h3 className="text-sm font-bold text-ink">Where will the video come from?</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setProvenanceChoice('UPLOADED')}
          className={`rounded-lg border p-3 text-left ${
            draft.provenance === 'UPLOADED'
              ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300'
              : 'border-line bg-surface hover:border-brand-300'
          }`}
        >
          <p className="text-sm font-bold text-ink">I have footage</p>
          <p className="mt-1 text-xs text-ink-muted">
            Filmed elsewhere and exported as a video file. You will upload it and a caption
            file on the next screen.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setProvenanceChoice('GENERATED')}
          className={`rounded-lg border p-3 text-left ${
            draft.provenance === 'GENERATED'
              ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300'
              : 'border-line bg-surface hover:border-brand-300'
          }`}
        >
          <p className="text-sm font-bold text-ink">SiteComply produces it</p>
          <p className="mt-1 text-xs text-ink-muted">
            Generated from a Company Module: its approved wording becomes the narration,
            word for word. The module stays the source of truth — to change the video you
            edit the module and produce it again, so there is never a second version of the
            same content.
          </p>
        </button>
      </div>

      {/*
        * ── THE MODULE COMES FIRST WHEN SITECOMPLY IS PRODUCING IT ──────────
        *
        * It used to be the last field, under the title, and the effect was a
        * video called "Company introduction" generated from PPE expectations —
        * which is what the picker offered, because it was the only module with
        * issued wording and the rest were hidden.
        *
        * Choosing the module first, and letting it fill in the title, makes the
        * relationship the right way round: the module is what the video IS, and
        * the asset is where it gets stored.
        */}
      {draft.provenance === 'GENERATED' && (
        <div className="mt-4 rounded-lg border border-brand-300 bg-surface p-3">
          <label className="text-xs font-semibold text-ink">
            Which company module is this video?
            <select
              value={draft.moduleId}
              onChange={(e) => pickModule(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
            >
              <option value="">Choose the module whose wording becomes the video…</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                  {m.hasIssued ? '' : '  — not issued yet'}
                </option>
              ))}
            </select>
          </label>
          {modules.length === 0 ? (
            <p className="mt-2 rounded-lg border border-hivis-200 bg-hivis-50 px-3 py-2 text-xs text-hivis-800">
              There are no company modules yet. A produced video is made from a module’s
              approved wording, so write one first in{' '}
              <Link href={modulesHref}
                className="font-semibold underline">Company modules</Link>.
            </p>
          ) : chosenModule && !chosenModule.hasIssued ? (
            <p className="mt-2 rounded-lg border border-hivis-200 bg-hivis-50 px-3 py-2 text-xs text-hivis-800">
              <span className="font-semibold">“{chosenModule.title}” has no issued wording yet.</span>{' '}
              The video is made from that wording word for word, so write and issue the module
              first in{' '}
              <Link href={modulesHref}
                className="font-semibold underline">Company modules</Link>. You can still add
              the library video now and produce it afterwards.
            </p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">
              Its approved wording becomes the narration, unchanged, and the written module is
              left out of the induction so nobody is told the same thing twice.
            </p>
          )}
        </div>
      )}

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
        {draft.provenance === 'UPLOADED' && (
        <label className="sm:col-span-2 text-xs font-semibold text-ink">
          Does it cover a company module? (optional)
          <select
            value={draft.moduleId}
            onChange={(e) => setDraft({ ...draft, moduleId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
          >
            <option value="">No — it plays alongside the modules</option>
            {/* Only an ISSUED module can be stood in for: an unissued one reaches
                nobody, so there would be nothing to displace. */}
            {modules.filter((m) => m.hasIssued).map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-ink-subtle">
            If it does, the written module is left out of the induction so an operative is not
            told the same thing twice.
          </span>
        </label>
        )}
      </div>
      <button
        type="button"
        disabled={
          busy ||
          draft.title.trim().length < 3 ||
          draft.slug.trim().length < 3 ||
          (draft.provenance === 'GENERATED' && !draft.moduleId)
        }
        onClick={() => onCreate(draft)}
        className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy
          ? 'Adding…'
          : draft.provenance === 'GENERATED'
            ? 'Add and produce the video'
            : 'Add and upload footage'}
      </button>
    </section>
  );
}
