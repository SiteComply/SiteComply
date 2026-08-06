'use client';

import { useMemo, useState } from 'react';
import { Panel } from '@/components/platform/Panel';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlatformIcon } from '@/components/platform/icons';
import {
  ScoreBreakdownDonut,
  chartColour,
  type DonutSlice,
} from '@/components/platform/ScoreBreakdownDonut';
import {
  QUESTION_RULES,
  SCORING_METHODS,
  type ScoringMethodValue,
  type QuestionScoringRuleValue,
} from '@/services/audits/scoringConstants';
import {
  sectionAvailablePoints,
  validateScoringConfig,
  weightTotal,
  type ScoringConfig,
} from '@/services/audits/scoringMath';

export interface ScoringSectionDraft {
  id: string;
  name: string;
  weightPercent: number;
}

export interface ScoringItemDraft {
  id: string;
  label: string;
  sectionId: string | null;
  scoringRule: QuestionScoringRuleValue;
  points: number;
  mandatory: boolean;
}

export interface ScoreBandDraft {
  label: string;
  minScore: number;
  maxScore: number;
}

/**
 * SC-014 Audit Scoring configuration screen. Deliberately mirrors the REV-1
 * mockup's information architecture: a three-column layout with configuration on
 * the left, section weightings in the middle and live feedback on the right.
 *
 * Every figure on the right is derived from `scoringMath` — the SAME module the
 * server uses to score the audit — so the preview can never disagree with the
 * stored result.
 */
export function AuditScoringConfig({
  auditId,
  auditTitle,
  initial,
}: {
  auditId: string;
  auditTitle: string;
  initial: {
    scoringEnabled: boolean;
    scoringMethod: ScoringMethodValue;
    totalPossibleScore: number;
    passingScore: number;
    showAsPercentage: boolean;
    roundScores: boolean;
    sections: ScoringSectionDraft[];
    items: ScoringItemDraft[];
    scoreBands: ScoreBandDraft[];
  };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.scoringEnabled);
  const [method, setMethod] = useState<ScoringMethodValue>(
    initial.scoringMethod,
  );
  const [totalPossible, setTotalPossible] = useState(
    initial.totalPossibleScore,
  );
  const [passing, setPassing] = useState(initial.passingScore);
  const [asPercent, setAsPercent] = useState(initial.showAsPercentage);
  const [rounded, setRounded] = useState(initial.roundScores);
  const [sections, setSections] = useState<ScoringSectionDraft[]>(
    initial.sections,
  );
  const [items, setItems] = useState<ScoringItemDraft[]>(initial.items);
  const [bands, setBands] = useState<ScoreBandDraft[]>(initial.scoreBands);
  /**
   * Which workspace is on screen. The benchmark's scoring screen ENDS at
   * "Configure Questions →" — the per-question editor is somewhere else. This is
   * that somewhere else, without leaving the form: both views are the same
   * component and the same state, so Save Scoring still saves everything at once
   * and nothing about the workflow, the permissions or the payload changes.
   * Presentation only: it decides what is rendered, never what is stored.
   */
  const [view, setView] = useState<'scoring' | 'questions'>('scoring');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  const config: ScoringConfig = {
    method,
    totalPossibleScore: totalPossible,
    passingScore: passing,
    showAsPercentage: asPercent,
    roundScores: rounded,
  };

  const issues = useMemo(
    () =>
      validateScoringConfig(
        config,
        sections.map((s, idx) => ({ ...s, order: idx })),
        items.map((i) => ({ ...i, result: null })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [method, totalPossible, passing, asPercent, rounded, sections, items],
  );

  /** Per-row name problems, keyed by section id — drives the inline row error. */
  const sectionIssues = issues.sections ?? {};

  const total = Math.round(
    weightTotal(sections.map((s, i) => ({ ...s, order: i }))),
  );
  const passPercent =
    totalPossible > 0 ? Math.round((passing / totalPossible) * 100) : 0;

  const slices: DonutSlice[] = sections.map((s) => ({
    id: s.id,
    label: s.name || 'Untitled section',
    percent: s.weightPercent,
    points: Math.round(sectionAvailablePoints(s.weightPercent, totalPossible)),
  }));

  const questionCount = items.length;
  const weightedCount = items.filter(
    (i) => i.scoringRule === 'WEIGHTED',
  ).length;
  const mandatoryCount = items.filter((i) => i.mandatory).length;

  const itemsInSection = (sectionId: string) =>
    items.filter((i) => i.sectionId === sectionId).length;

  function moveSection(index: number, delta: number) {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSections(next);
  }

  /**
   * New sections are named "Section 1", "Section 2"… so a freshly added row is
   * valid immediately and the user renames rather than fills in a blank. Skips
   * names already taken, so adding after a delete doesn't duplicate.
   */
  function nextSectionName(): string {
    const taken = new Set(sections.map((s) => s.name.trim()));
    let n = sections.length + 1;
    while (taken.has(`Section ${n}`)) n += 1;
    return `Section ${n}`;
  }

  function addSection() {
    setSections([
      ...sections,
      {
        id: `new-${sections.length}`,
        name: nextSectionName(),
        weightPercent: 0,
      },
    ]);
  }

  function removeSection(id: string) {
    setSections(sections.filter((s) => s.id !== id));
    setItems(
      items.map((i) => (i.sectionId === id ? { ...i, sectionId: null } : i)),
    );
  }

  function distributeEvenly() {
    if (sections.length === 0) return;
    const base = Math.floor(100 / sections.length);
    const remainder = 100 - base * sections.length;
    setSections(
      sections.map((s, idx) => ({
        ...s,
        weightPercent: base + (idx < remainder ? 1 : 0),
      })),
    );
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/platform/audits/${auditId}/scoring`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoringEnabled: enabled,
          scoringMethod: method,
          totalPossibleScore: totalPossible,
          passingScore: passing,
          showAsPercentage: asPercent,
          roundScores: rounded,
          sections: sections.map((s) => ({
            id: s.id.startsWith('new-') ? undefined : s.id,
            name: s.name,
            weightPercent: s.weightPercent,
          })),
          items: items.map((i) => ({
            id: i.id,
            sectionId: i.sectionId,
            scoringRule: i.scoringRule,
            points: i.points,
            mandatory: i.mandatory,
          })),
          scoreBands: method === 'CUSTOM' ? bands : [],
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage({
          tone: 'error',
          text: data.error ?? 'Could not save scoring.',
        });
      } else {
        setMessage({ tone: 'ok', text: 'Scoring saved.' });
        router.refresh();
      }
    } catch {
      setMessage({ tone: 'error', text: 'Could not save scoring.' });
    } finally {
      setSaving(false);
    }
  }

  const blocked = Object.keys(issues).length > 0;

  return (
    <div className="space-y-4">
      {/* Header actions — mirrors the mockup's "Preview Audit" + "Save Scoring". */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">Audit Scoring</h1>
          <p className="text-sm text-ink-muted">
            Configure how this audit is scored
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/platform/dashboard/audits/${auditId}`}
            className="touch-target inline-flex items-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Preview Audit
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={saving || blocked}
            className="touch-target inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlatformIcon name="doc" className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save Scoring'}
          </button>
        </div>
      </div>

      {/* Say WHY Save is disabled — a greyed-out button with the problem further
          down the page was the original complaint. */}
      {blocked && (
        <p className="rounded-lg border border-hivis-500/40 bg-hivis-500/10 px-4 py-2 text-sm text-ink-muted">
          <span className="font-semibold text-ink">
            Save Scoring is disabled:
          </span>{' '}
          {issues.sections
            ? Object.values(issues.sections)[0]
            : (issues.weights ??
              issues.totalPossibleScore ??
              issues.passingScore ??
              issues.items)}
        </p>
      )}

      {message && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-2 text-sm ${
            message.tone === 'ok'
              ? 'border-safe-500/40 bg-safe-50 text-safe-700'
              : 'border-danger-500/40 bg-danger-50 text-danger-700'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* NOT three equal columns. Measured off the SC-014 benchmark, its columns
          run roughly 30 / 36 / 31 of the content width — Section Weightings is
          the WIDEST of the three, and that is what makes it read as the primary
          workspace rather than the middle of three widgets. Equal thirds gave
          the column that needs width most (an editable name, a weight, a points
          total and three controls per row) exactly as much as the one that needs
          it least, so section names truncated to "Site Access & Se…".

          minmax(0,…) on every track is deliberate: an `fr` track's default
          minimum is min-content, so a long section name or a wide legend row
          would otherwise push the track — and the page — wider than the screen
          instead of truncating inside it. */}
      {view === 'scoring' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,4.3fr)_minmax(0,3.1fr)]">
          {/* ---------------- Column 1 — configuration ---------------- */}
          <div className="space-y-4">
            {/* Method, options, bands and question rules were four cards stacked
              down this column. They are all the same subject — how this audit
              scores, decided before a single question is touched — so they are
              now one panel with labelled groups. Same controls, same order,
              three fewer borders competing with the work in column two. */}
            {/* TWO cards, as the benchmark draws them — "Scoring Method" then
              "Scoring Options". Phase 2 merged these into a single "Scoring
              Setup" panel to cut the box count, which was right for a column of
              unrelated cards but wrong here: they are two steps of one task and
              the benchmark gives each its own heading. Merged, the column read
              as one long form field. */}
            <Card
              title="Scoring Method"
              hint="Choose how you want to score this audit"
            >
              <div className="grid grid-cols-3 gap-2">
                {SCORING_METHODS.map((m) => {
                  const active = method === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMethod(m.value)}
                      aria-pressed={active}
                      className={`flex h-full flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center transition ${
                        active
                          ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                          : 'border-line bg-surface hover:bg-surface-sunken'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                          active
                            ? 'border-brand-600 bg-brand-600'
                            : 'border-ink-subtle'
                        }`}
                      >
                        {active && (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </span>
                      <PlatformIcon
                        name={
                          m.icon === 'percent'
                            ? 'percent'
                            : m.icon === 'shield'
                              ? 'shield'
                              : 'sliders'
                        }
                        className={`h-5 w-5 ${active ? 'text-brand-700' : 'text-ink-subtle'}`}
                      />
                      <span className="text-xs font-semibold text-ink">
                        {m.label}
                      </span>
                      <span className="text-[11px] leading-tight text-ink-subtle">
                        {m.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card title="Scoring Options">
              <div>
                <Field
                  label="Total Possible Score"
                  hint="Set the maximum score available for this audit"
                  error={issues.totalPossibleScore}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={totalPossible}
                      onChange={(e) =>
                        setTotalPossible(Number(e.target.value) || 0)
                      }
                      className="w-24 rounded-lg border border-line px-3 py-2 text-sm text-ink"
                    />
                    <span className="text-sm text-ink-subtle">pts</span>
                  </div>
                </Field>

                <Field
                  label="Passing Score"
                  hint="Minimum score required to pass"
                  error={issues.passingScore}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={passing}
                      onChange={(e) => setPassing(Number(e.target.value) || 0)}
                      className="w-24 rounded-lg border border-line px-3 py-2 text-sm text-ink"
                    />
                    <span className="text-sm text-ink-subtle">
                      pts ({passPercent}%)
                    </span>
                  </div>
                </Field>

                <Toggle
                  checked={asPercent}
                  onChange={setAsPercent}
                  label="Show score as percentage"
                  hint="Display the final score as a percentage"
                />
                <Toggle
                  checked={rounded}
                  onChange={setRounded}
                  label="Round scores"
                  hint="Round scores to the nearest whole number"
                />
                <Toggle
                  checked={enabled}
                  onChange={setEnabled}
                  label="Enable scoring for this audit"
                  hint="Off by default — the audit keeps its manual score until enabled"
                />
              </div>

              {method === 'CUSTOM' && (
                <Group
                  label="Score bands"
                  hint="Name the ranges this audit's score maps onto"
                >
                  <div className="space-y-2">
                    {bands.map((band, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: chartColour(idx) }}
                        />
                        <input
                          value={band.label}
                          onChange={(e) =>
                            setBands(
                              bands.map((b, i) =>
                                i === idx ? { ...b, label: e.target.value } : b,
                              ),
                            )
                          }
                          placeholder="Band name"
                          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm"
                        />
                        <input
                          type="number"
                          value={band.minScore}
                          onChange={(e) =>
                            setBands(
                              bands.map((b, i) =>
                                i === idx
                                  ? {
                                      ...b,
                                      minScore: Number(e.target.value) || 0,
                                    }
                                  : b,
                              ),
                            )
                          }
                          className="w-16 rounded-lg border border-line px-2 py-1.5 text-sm"
                          aria-label="Minimum score"
                        />
                        <input
                          type="number"
                          value={band.maxScore}
                          onChange={(e) =>
                            setBands(
                              bands.map((b, i) =>
                                i === idx
                                  ? {
                                      ...b,
                                      maxScore: Number(e.target.value) || 0,
                                    }
                                  : b,
                              ),
                            )
                          }
                          className="w-16 rounded-lg border border-line px-2 py-1.5 text-sm"
                          aria-label="Maximum score"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setBands(bands.filter((_, i) => i !== idx))
                          }
                          className="text-sm text-ink-subtle hover:text-danger-600"
                          aria-label={`Remove band ${band.label || idx + 1}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setBands([
                          ...bands,
                          { label: '', minScore: 0, maxScore: 100 },
                        ])
                      }
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      + Add band
                    </button>
                  </div>
                </Group>
              )}
            </Card>
          </div>

          {/* ---------------- Column 2 — section weightings ---------------- */}
          <div className="space-y-4">
            <Card
              title="Section Weightings"
              hint="Set how much each section contributes to the overall score"
            >
              {sections.length === 0 ? (
                <p className="text-sm text-ink-subtle">
                  No sections yet. Add one to weight this audit&apos;s
                  questions.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      {/* Fixed widths on the three trailing columns so weights and
                        points align in a column down the table, as they do in
                        the benchmark. Left to `auto` they were re-measured per
                        row against the longest section name. */}
                      {/* Sentence case, as the benchmark writes them — and as the
                        Actions and Permits registers already write their own
                        column headers. The uppercase micro-caps here were the
                        odd one out in the portal. */}
                      <tr className="border-b border-line text-left text-xs text-ink-subtle">
                        <th className="pb-2.5 font-medium">Section</th>
                        <th className="w-20 pb-2.5 text-right font-medium">
                          Weight
                        </th>
                        <th className="w-16 pb-2.5 text-right font-medium">
                          Total
                        </th>
                        <th className="w-16 pb-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((section, idx) => (
                        <tr
                          key={section.id}
                          className="group/row border-t border-line"
                        >
                          <td className="py-3 pr-2">
                            <div className="flex items-center gap-2">
                              {/* The benchmark numbers its sections; this screen
                                also has to tie each row to its donut segment.
                                Carrying those as two elements — a swatch AND an
                                ordinal — cost ~28px of a column whose scarcest
                                resource is width, and the section name paid for
                                it. One coloured chip does both jobs.

                                Presentation only: the number is the row's
                                position, which is the order already on screen,
                                and nothing new is stored. */}
                              <span
                                aria-hidden="true"
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold tabular-nums text-white"
                                style={{ backgroundColor: chartColour(idx) }}
                              >
                                {idx + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <input
                                  value={section.name}
                                  onChange={(e) =>
                                    setSections(
                                      sections.map((s) =>
                                        s.id === section.id
                                          ? { ...s, name: e.target.value }
                                          : s,
                                      ),
                                    )
                                  }
                                  placeholder="Section name"
                                  aria-label={`Name for section ${idx + 1}`}
                                  aria-invalid={
                                    sectionIssues[section.id] ? true : undefined
                                  }
                                  // Six bordered boxes down the column made the
                                  // weightings read as a form; the benchmark's
                                  // rows read as a table. A borderless variant was
                                  // tried once and reverted because nobody could
                                  // tell the name was editable — so this is the
                                  // middle ground rather than a repeat of that
                                  // mistake: a quiet tinted field at rest, which
                                  // takes a real border on hover and on focus. It
                                  // still looks like something you can type in,
                                  // without drawing a box around every row.
                                  className={`w-full rounded-lg border bg-transparent px-2 py-1 text-sm font-semibold text-ink transition-colors hover:border-line hover:bg-surface focus:border-brand-500 focus:bg-surface focus:outline-none ${
                                    sectionIssues[section.id]
                                      ? 'border-danger-500'
                                      : 'border-transparent'
                                  }`}
                                />
                                {sectionIssues[section.id] && (
                                  <p className="mt-0.5 px-1 text-xs font-medium text-danger-600">
                                    {sectionIssues[section.id]}
                                  </p>
                                )}
                                <span className="px-1 text-xs text-ink-subtle">
                                  {itemsInSection(section.id)} questions
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={section.weightPercent}
                                onChange={(e) =>
                                  setSections(
                                    sections.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            weightPercent:
                                              Number(e.target.value) || 0,
                                          }
                                        : s,
                                    ),
                                  )
                                }
                                className="w-16 rounded-lg border border-line px-2 py-1 text-right text-sm"
                                aria-label={`${section.name || 'Section'} weight`}
                              />
                              <span className="text-ink-subtle">%</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap py-3 text-right font-semibold tabular-nums text-ink">
                            {Math.round(
                              sectionAvailablePoints(
                                section.weightPercent,
                                totalPossible,
                              ),
                            )}{' '}
                            pts
                          </td>
                          <td className="py-3 pl-2 text-right">
                            {/* Reorder and remove are row PLUMBING, not the data
                              the table exists to show — three glyphs per row at
                              full contrast competed with the weights. They stay
                              permanently visible and keyboard-reachable (hiding
                              them until hover would strand touch users); only
                              their contrast drops, lifting on hover or when
                              anything inside takes focus. */}
                            <div className="flex items-center justify-end gap-0.5 text-ink-subtle/50 transition-colors focus-within:text-ink-subtle group-hover/row:text-ink-subtle">
                              <button
                                type="button"
                                onClick={() => moveSection(idx, -1)}
                                disabled={idx === 0}
                                className="rounded px-1 hover:text-ink disabled:opacity-30"
                                aria-label={`Move ${section.name || 'section'} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveSection(idx, 1)}
                                disabled={idx === sections.length - 1}
                                className="rounded px-1 hover:text-ink disabled:opacity-30"
                                aria-label={`Move ${section.name || 'section'} down`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSection(section.id)}
                                className="rounded px-1 hover:text-danger-600"
                                aria-label={`Remove ${section.name || 'section'}`}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* The benchmark's total is the table's conclusion, set apart
                      by a heavier rule and carrying real weight — it is the one
                      figure that says whether the weighting adds up. */}
                    <tfoot>
                      <tr className="border-t-2 border-ink/15 text-sm font-bold">
                        <td className="pt-3 text-ink">Total</td>
                        <td
                          className={`pt-3 text-right tabular-nums ${
                            total === 100 ? 'text-safe-700' : 'text-danger-600'
                          }`}
                        >
                          {total}%
                        </td>
                        <td className="whitespace-nowrap pt-3 text-right tabular-nums text-ink">
                          {totalPossible} pts
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {issues.weights && (
                <p className="mt-2 text-xs font-medium text-danger-600">
                  {issues.weights}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={addSection}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  + Add section
                </button>
                {sections.length > 0 && (
                  <button
                    type="button"
                    onClick={distributeEvenly}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    Distribute evenly
                  </button>
                )}
              </div>
            </Card>
          </div>

          {/* ---------------- Column 3 — live feedback ----------------
            One contextual summary rather than three separate readouts, and it
            sticks to the top of the viewport: the point of this column is to
            answer "what does what I just changed add up to?", which is no use
            once you have scrolled past it into the questions list.

            The grid item spans both rows and is left to stretch; the sticky
            element is the div INSIDE it. A sticky box only travels within its
            own containing block, so a sticky grid item sized to its own content
            has nowhere to go and silently does nothing. */}
          <div className="lg:col-start-3 lg:row-span-3 lg:row-start-1">
            {/* Content-sized, NOT stretched to the full column height. Stretching
              it was tried: the benchmark's review column is full because its
              CONTENT fills it, whereas ours has less to say, so a stretched
              panel just drew a tall white box with air in the bottom third —
              the same sparseness in a heavier frame. Page background below a
              finished panel reads as finished; an empty panel reads as missing.
              Sticky so it stays with you when the question editor is expanded. */}
            <div className="space-y-4 lg:sticky lg:top-6">
              <Card
                title="Score Preview"
                hint="This is how the scoring will work for this audit"
              >
                {/* NOTHING TO SCORE IS NOT A PASS.
                This panel used to render green with a "Pass" pill whatever the
                audit contained — so an audit with no questions showed a
                confident "80% · Pass". That is a verdict, and there is no
                verdict to give: the threshold is configuration, not a result,
                and presenting it as one invites someone to read an empty audit
                as a passing one.
                The same numbers are shown either way. Only the framing changes:
                neutral and labelled as a target until there is something to
                score against. */}
                {questionCount === 0 ? (
                  <div className="rounded-lg border border-line bg-surface-sunken p-4">
                    <p className="text-sm font-semibold text-ink-subtle">
                      Pass mark, once set up
                    </p>
                    <p className="text-3xl font-bold text-ink-muted">
                      {asPercent ? `${passPercent}%` : `${passing} pts`}
                    </p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {passing} out of {totalPossible} points
                    </p>
                    <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                      This audit has no questions, so there is nothing to score
                      yet. The pass mark above is ready and will apply as soon
                      as it has some.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-safe-500/40 bg-safe-50 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-safe-700">
                          Passing Score
                        </p>
                        {/* The hero figure of the panel, at the benchmark's weight.
                          At text-3xl it sat level with the section headings and
                          read as another row of the summary. */}
                        <p className="mt-0.5 text-4xl font-bold leading-none tracking-tight text-safe-700">
                          {asPercent ? `${passPercent}%` : `${passing} pts`}
                        </p>
                        <p className="mt-2 text-xs text-ink-muted">
                          {passing} out of {totalPossible} points
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-safe-500 px-2.5 py-1 text-xs font-semibold text-white">
                        <PlatformIcon name="check" className="h-3.5 w-3.5" />
                        Pass
                      </span>
                    </div>
                  </div>
                )}
                {/* Only the method-SPECIFIC note survives here. On the percentage
                  method this line read "Scores are calculated automatically as
                  the audit is completed" while the blue callout at the foot of
                  the same panel said "Scores are calculated automatically in
                  real time as audits are completed" — the same sentence twice,
                  a few hundred pixels apart. The callout is the one the
                  benchmark draws, so it stays and this defers to it. */}
                {(method === 'PASS_FAIL' || method === 'CUSTOM') && (
                  <p className="mt-3 text-xs text-ink-subtle">
                    {method === 'PASS_FAIL'
                      ? 'Every scorable question must pass for the audit to pass.'
                      : 'Scores map onto the named bands you define.'}
                  </p>
                )}

                <Group label="Score Breakdown">
                  {slices.length === 0 ? (
                    // An empty state that says what the panel is FOR, not just what
                    // is missing. "Add sections to see the breakdown" tells you the
                    // button to press; it does not tell you why you would want to,
                    // which is the question someone configuring scoring for the first
                    // time is actually asking.
                    <div className="text-sm text-ink-subtle">
                      <p>
                        Sections divide an audit into parts — access, welfare,
                        plant — and this shows how much of the total score each
                        part carries.
                      </p>
                      <p className="mt-2">
                        {questionCount === 0
                          ? 'Available once this audit has questions to group.'
                          : 'Every question currently counts towards one overall score.'}
                      </p>
                    </div>
                  ) : (
                    <ScoreBreakdownDonut
                      slices={slices}
                      totalPoints={totalPossible}
                    />
                  )}
                </Group>

                <Group label="Scoring Rules">
                  {/* A column of zeros reads as data — as though the audit had been
                measured and found to contain nothing. One line first says which
                it is, so the numbers below are read as a starting point rather
                than a result. The rows themselves are unchanged and become
                meaningful the moment anything is added. */}
                  {questionCount === 0 && (
                    <p className="mb-3 text-xs text-ink-muted">
                      Nothing configured yet — this summary fills in as
                      questions and sections are added.
                    </p>
                  )}
                  <ul className="space-y-2.5 text-sm">
                    <SummaryRow
                      icon="grid"
                      label={`${sections.length} Sections`}
                    />
                    <SummaryRow
                      icon="clipboard"
                      label={`${questionCount} Questions`}
                    />
                    <SummaryRow
                      icon="weight"
                      label={`${weightedCount} Weighted Questions`}
                    />
                    <SummaryRow
                      icon="alert"
                      label={`${mandatoryCount} Mandatory Questions`}
                      tone="text-hivis-600"
                    />
                    <SummaryRow
                      icon="percent"
                      label={`Passing Score: ${passPercent}%`}
                    />
                  </ul>
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-xs text-ink-muted">
                    <PlatformIcon
                      name="info"
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
                    />
                    Scores are calculated automatically in real time as audits
                    are completed.
                  </p>
                </Group>
              </Card>
            </div>
          </div>

          {/* Question scoring rules is a legend for the whole audit, not a step in
            the left-hand column — and the SC-014 benchmark places it exactly
            here, as a wide band under the two working columns with its four
            tiles in one row. In a third-width column those tiles stacked 2×2
            and read as four more widgets. */}
          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <Card
              title="Question Scoring Rules"
              hint="Choose how individual questions are scored"
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {QUESTION_RULES.map((rule) => (
                  <div
                    key={rule.value}
                    className="rounded-lg border border-line bg-surface p-3"
                  >
                    <div className="flex items-center gap-2">
                      <PlatformIcon
                        name={
                          rule.icon === 'weight'
                            ? 'weight'
                            : rule.icon === 'check'
                              ? 'check'
                              : rule.icon === 'alert'
                                ? 'alert'
                                : 'info'
                        }
                        className={`h-4 w-4 ${
                          rule.value === 'MANDATORY'
                            ? 'text-hivis-600'
                            : rule.value === 'PASS_FAIL'
                              ? 'text-safe-600'
                              : rule.value === 'INFO_ONLY'
                                ? 'text-brand-600'
                                : 'text-ink-muted'
                        }`}
                      />
                      <span className="text-xs font-semibold text-ink">
                        {rule.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-tight text-ink-subtle">
                      {rule.description}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-ink-muted">
                      {rule.value === 'MANDATORY'
                        ? `${mandatoryCount} in this audit`
                        : `${items.filter((i) => i.scoringRule === rule.value).length} in this audit`}
                    </p>
                  </div>
                ))}
              </div>
              {/* THE HAND-OFF, where the benchmark puts it: a footer bar on this
                card, not a fifth panel below it. The standalone "Questions"
                card was the clearest signal that this screen was a dashboard
                with an editor bolted underneath. */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken p-3">
                <p className="flex min-w-0 items-start gap-2 text-xs text-ink-muted">
                  <PlatformIcon
                    name="info"
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
                  />
                  {issues.items
                    ? issues.items
                    : 'You can set the rule for each question when configuring the audit content.'}
                </p>
                <button
                  type="button"
                  onClick={() => setView('questions')}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                    issues.items
                      ? 'border-danger-500 text-danger-600 hover:bg-danger-50'
                      : 'border-brand-500 text-brand-700 hover:bg-brand-50'
                  }`}
                >
                  Configure Questions
                  <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-xs tabular-nums text-brand-700">
                    {questionCount}
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------- Secondary workspace — Configure Questions ----------
          The per-question editor, at full width, reached from the hand-off on
          the Question Scoring Rules card. It is the SAME component and the same
          state as the scoring workspace, so Save Scoring still writes everything
          in one request and no permission, workflow or payload changes; only
          which of the two is on screen. */}
      {view === 'questions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setView('scoring')}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken hover:text-ink"
            >
              <span aria-hidden="true">←</span> Back to scoring
            </button>
            <p className="text-xs text-ink-subtle">
              Changes here are saved with{' '}
              <span className="font-medium text-ink-muted">Save Scoring</span>.
            </p>
          </div>
          <Card
            title={`Configure Questions (${questionCount})`}
            hint="Assign each question to a section and choose how it scores"
          >
            {items.length === 0 ? (
              // THE ROOT OF THE EMPTY SCREEN, and it was the one thing the page
              // did not explain. Checklist items are copied from an audit
              // template when the audit is created; an audit started from
              // scratch has none and can never be scored, however carefully the
              // rest of this screen is filled in. Saying only "no checklist
              // items yet" leaves someone configuring points and pass marks that
              // will never apply to anything.
              <div className="text-sm text-ink-subtle">
                <p className="font-medium text-ink-muted">
                  This audit has no questions to score.
                </p>
                <p className="mt-2">
                  Questions come from the audit template an audit is created
                  from, and are copied in at that point. This audit was started
                  from scratch, so there are none to weight or mark mandatory.
                </p>
                <p className="mt-2">
                  Everything you set here will be kept, and will apply if this
                  audit gains questions.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  // Question and its controls on ONE line now there is width
                  // for it: 36 questions each taking two lines was half the
                  // reason this screen felt endless. Wraps back to two lines
                  // below lg, where the controls need the room.
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
                  >
                    <p className="min-w-[16rem] flex-1 text-sm font-medium text-ink">
                      {item.label}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={item.sectionId ?? ''}
                        onChange={(e) =>
                          setItems(
                            items.map((i) =>
                              i.id === item.id
                                ? { ...i, sectionId: e.target.value || null }
                                : i,
                            ),
                          )
                        }
                        className="rounded-lg border border-line px-2 py-1.5 text-xs"
                        aria-label={`Section for ${item.label}`}
                      >
                        <option value="">Ungrouped</option>
                        {sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name || 'Untitled section'}
                          </option>
                        ))}
                      </select>

                      <select
                        value={item.scoringRule}
                        onChange={(e) =>
                          setItems(
                            items.map((i) =>
                              i.id === item.id
                                ? {
                                    ...i,
                                    scoringRule: e.target
                                      .value as QuestionScoringRuleValue,
                                  }
                                : i,
                            ),
                          )
                        }
                        className="rounded-lg border border-line px-2 py-1.5 text-xs"
                        aria-label={`Scoring rule for ${item.label}`}
                      >
                        <option value="WEIGHTED">Weighted</option>
                        <option value="PASS_FAIL">Pass / Fail</option>
                        <option value="INFO_ONLY">Information only</option>
                      </select>

                      <label className="flex items-center gap-1 text-xs text-ink-muted">
                        Points
                        <input
                          type="number"
                          min={0}
                          value={item.points}
                          onChange={(e) =>
                            setItems(
                              items.map((i) =>
                                i.id === item.id
                                  ? {
                                      ...i,
                                      points: Number(e.target.value) || 0,
                                    }
                                  : i,
                              ),
                            )
                          }
                          className="w-16 rounded-lg border border-line px-2 py-1 text-xs"
                          disabled={item.scoringRule === 'INFO_ONLY'}
                        />
                      </label>

                      <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                        <input
                          type="checkbox"
                          checked={item.mandatory}
                          onChange={(e) =>
                            setItems(
                              items.map((i) =>
                                i.id === item.id
                                  ? { ...i, mandatory: e.target.checked }
                                  : i,
                              ),
                            )
                          }
                          className="h-4 w-4 rounded border-line"
                        />
                        Mandatory
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {issues.items && (
              <p className="mt-2 text-xs font-medium text-danger-600">
                {issues.items}
              </p>
            )}
          </Card>
        </div>
      )}

      <p className="text-xs text-ink-subtle">
        Scoring for{' '}
        <span className="font-medium text-ink-muted">{auditTitle}</span>
      </p>
    </div>
  );
}

/**
 * UX REFRESH PHASE 2 — this local helper WAS the pattern the brief points at as
 * the target, so it became the shared `Panel` primitive rather than being
 * redesigned. The name is kept so its call sites below are untouched, and the
 * rendered result is identical: this screen is a benchmark and must not move.
 */
function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // One step up from the shared default: in the benchmark each column heading
  // clearly out-ranks the labelled groups beneath it, which is what makes three
  // panels read as one scoring system rather than three cards. At the shared
  // 14px the heading sat level with its own contents.
  //
  // The size token is written ONLY in the JSX below, never in this comment —
  // the deploy guard greps for it, and a comment that quotes the thing being
  // asserted is how a guard comes to pass on prose while the code is gone.
  return (
    <Panel title={title} hint={hint} titleSize="md">
      {children}
    </Panel>
  );
}

/**
 * A labelled region INSIDE a panel. Both side columns were stacks of cards
 * where every card was a facet of one subject; a rule and a label separate them
 * just as clearly as a border does, without adding another box to the count.
 */
function Group({
  label,
  hint,
  first,
  children,
}: {
  label: string;
  hint?: string;
  /** First group in a panel — no leading rule, the panel heading already sits above it. */
  first?: boolean;
  children: React.ReactNode;
}) {
  // The benchmark writes these as real sub-headings — "Scoring Method", "Score
  // Breakdown", "Scoring Rules" — in sentence case at reading size, not as
  // uppercase micro-labels. At 11px uppercase they read as form-field captions,
  // which flattened each column into an undifferentiated list; at 14px semibold
  // in ink they sit clearly below the 16px panel title and clearly above the
  // body, giving the three-tier hierarchy the mock-up has.
  return (
    <div className={first ? undefined : 'mt-3.5 border-t border-line pt-3.5'}>
      <p className="text-sm font-semibold text-ink">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug text-ink">{label}</p>
        {hint && <p className="text-xs leading-snug text-ink-subtle">{hint}</p>}
        {error && (
          <p className="text-xs font-medium text-danger-600">{error}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug text-ink">{label}</p>
        {hint && <p className="text-xs leading-snug text-ink-subtle">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-brand-600' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  tone = 'text-ink-subtle',
}: {
  icon: 'grid' | 'clipboard' | 'weight' | 'alert' | 'percent';
  label: string;
  tone?: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <PlatformIcon name={icon} className={`h-4 w-4 shrink-0 ${tone}`} />
      <span className="text-ink-muted">{label}</span>
    </li>
  );
}
