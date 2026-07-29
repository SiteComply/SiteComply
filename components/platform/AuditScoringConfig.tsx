'use client';

import { useMemo, useState } from 'react';
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

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------------- Column 1 — configuration ---------------- */}
        <div className="space-y-4">
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
                    className={`flex h-full flex-col items-center gap-2 rounded-lg border p-3 text-center transition ${
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
          </Card>

          {method === 'CUSTOM' && (
            <Card
              title="Score Bands"
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
                              ? { ...b, minScore: Number(e.target.value) || 0 }
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
                              ? { ...b, maxScore: Number(e.target.value) || 0 }
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
            </Card>
          )}

          <Card
            title="Question Scoring Rules"
            hint="Choose how individual questions are scored"
          >
            <div className="grid grid-cols-2 gap-2">
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
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-sunken p-3 text-xs text-ink-muted">
              <PlatformIcon
                name="info"
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
              />
              Set the rule for each question below — mandatory questions must be
              passed for the audit to pass, whatever the overall score.
            </p>
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
                No sections yet. Add one to weight this audit&apos;s questions.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                      <th className="pb-2 font-medium">Section</th>
                      <th className="pb-2 text-right font-medium">Weight</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((section, idx) => (
                      <tr key={section.id} className="border-t border-line">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ backgroundColor: chartColour(idx) }}
                            />
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
                                // A visible field: the borderless variant this
                                // started as read as static text, so users could
                                // not tell the name was editable.
                                className={`w-full rounded-lg border bg-surface px-2 py-1.5 text-sm font-medium text-ink ${
                                  sectionIssues[section.id]
                                    ? 'border-danger-500'
                                    : 'border-line'
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
                        <td className="py-2 text-right">
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
                        <td className="py-2 text-right font-medium text-ink">
                          {Math.round(
                            sectionAvailablePoints(
                              section.weightPercent,
                              totalPossible,
                            ),
                          )}{' '}
                          pts
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveSection(idx, -1)}
                              disabled={idx === 0}
                              className="rounded px-1 text-ink-subtle hover:text-ink disabled:opacity-30"
                              aria-label={`Move ${section.name || 'section'} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSection(idx, 1)}
                              disabled={idx === sections.length - 1}
                              className="rounded px-1 text-ink-subtle hover:text-ink disabled:opacity-30"
                              aria-label={`Move ${section.name || 'section'} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSection(section.id)}
                              className="rounded px-1 text-ink-subtle hover:text-danger-600"
                              aria-label={`Remove ${section.name || 'section'}`}
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line font-semibold">
                      <td className="py-2 text-ink">Total</td>
                      <td
                        className={`py-2 text-right ${
                          total === 100 ? 'text-safe-700' : 'text-danger-600'
                        }`}
                      >
                        {total}%
                      </td>
                      <td className="py-2 text-right text-ink">
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

          <Card
            title={`Questions (${questionCount})`}
            hint="Assign each question to a section and choose how it scores"
          >
            {items.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                This audit has no checklist items yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id} className="py-3">
                    <p className="text-sm font-medium text-ink">{item.label}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
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

        {/* ---------------- Column 3 — live feedback ---------------- */}
        <div className="space-y-4">
          <Card
            title="Score Preview"
            hint="This is how the scoring will work for this audit"
          >
            <div className="rounded-lg border border-safe-500/40 bg-safe-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-safe-700">
                    Passing Score
                  </p>
                  <p className="text-3xl font-bold text-safe-700">
                    {asPercent ? `${passPercent}%` : `${passing} pts`}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {passing} out of {totalPossible} points
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-safe-500 px-2.5 py-1 text-xs font-semibold text-white">
                  <PlatformIcon name="check" className="h-3.5 w-3.5" />
                  Pass
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-subtle">
              {method === 'PASS_FAIL'
                ? 'Every scorable question must pass for the audit to pass.'
                : method === 'CUSTOM'
                  ? 'Scores map onto the named bands you define.'
                  : 'Scores are calculated automatically as the audit is completed.'}
            </p>
          </Card>

          <Card title="Score Breakdown">
            {slices.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                Add sections to see the breakdown.
              </p>
            ) : (
              <ScoreBreakdownDonut
                slices={slices}
                totalPoints={totalPossible}
              />
            )}
          </Card>

          <Card title="Scoring Rules">
            <ul className="space-y-2 text-sm">
              <SummaryRow icon="grid" label={`${sections.length} Sections`} />
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
              Scores are calculated automatically in real time as audits are
              completed.
            </p>
          </Card>
        </div>
      </div>

      <p className="text-xs text-ink-subtle">
        Scoring for{' '}
        <span className="font-medium text-ink-muted">{auditTitle}</span>
      </p>
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-ink-subtle">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
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
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-subtle">{hint}</p>}
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
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-subtle">{hint}</p>}
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
