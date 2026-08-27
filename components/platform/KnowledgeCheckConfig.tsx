'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  knowledgeQuestionCategoryLabel,
  QUESTIONS_PER_ATTEMPT_MIN,
  QUESTIONS_PER_ATTEMPT_MAX,
  KNOWLEDGE_CHECK_DEFAULTS,
} from '@/services/knowledgeChecks/knowledgeCheckConstants';

export interface KcConfigInitial {
  enabled: boolean;
  questionsPerAttempt: number;
  requireManagerApproval: boolean;
  unavailablePolicy: 'SKIP_FLAGGED' | 'BLOCK';
}

export interface KcQuestion {
  id: string;
  category: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  sourceRef: string | null;
  explanation: string | null;
  active: boolean;
  flagCount: number;
}

export interface KcPreview {
  status: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  questionCount: number;
  questions: KcQuestion[];
  stale: boolean;
}

/**
 * Site Details → Knowledge check (SC-005). Lets a site manager enable the AI
 * knowledge check for the site, tune it, preview the generated bank (with the
 * correct answers), regenerate, approve a pending bank, and withdraw questions
 * workers have flagged. All writes go through the platform API then refresh.
 */
export function KnowledgeCheckConfig({
  siteId,
  canEdit,
  initial,
  preview,
}: {
  siteId: string;
  canEdit: boolean;
  initial: KcConfigInitial;
  preview: KcPreview;
}) {
  const router = useRouter();
  const toast = useToast();
  const [cfg, setCfg] = useState<KcConfigInitial>(initial);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [showQuestions, setShowQuestions] = useState(false);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/platform/sites/${siteId}/knowledge-check`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, error: data.error as string | undefined };
  }

  async function saveConfig() {
    setBusy(true);
    try {
      const r = await post({
        action: 'config',
        config: {
          knowledgeCheckEnabled: cfg.enabled,
          questionsPerAttempt: cfg.questionsPerAttempt,
          requireManagerApproval: cfg.requireManagerApproval,
          unavailablePolicy: cfg.unavailablePolicy,
        },
      });
      if (!r.ok) {
        toast.error(r.error ?? 'Could not save.');
        return;
      }
      toast.success('Knowledge check settings saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const r = await post({ action: 'regenerate' });
      if (!r.ok) {
        toast.error(r.error ?? 'Could not regenerate.');
        return;
      }
      toast.success('Questions regenerated.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      const r = await post({ action: 'approve' });
      if (!r.ok) {
        toast.error(r.error ?? 'Could not approve.');
        return;
      }
      toast.success('Questions published to workers.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleQuestion(q: KcQuestion) {
    setRowBusy(q.id);
    try {
      const res = await fetch(
        `/api/platform/knowledge-check/questions/${q.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: !q.active }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not update the question.');
        return;
      }
      toast.success(q.active ? 'Question withdrawn.' : 'Question restored.');
      router.refresh();
    } finally {
      setRowBusy(null);
    }
  }

  const pendingApproval =
    preview.status === 'READY' &&
    !preview.approvedAt &&
    cfg.requireManagerApproval;
  const flaggedCount = preview.questions.filter((q) => q.flagCount > 0).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        A short AI-generated quiz at the end of this site’s induction. Questions
        are generated from this site’s induction content and emergency
        information; workers must answer all correctly to check in.
      </p>

      {/* Settings */}
      <div className="space-y-3 rounded-lg border border-line p-3">
        <ToggleRow
          label="Knowledge check enabled"
          hint="Off by default. Turn on to require the quiz for this site."
          checked={cfg.enabled}
          disabled={!canEdit || busy}
          onChange={(v) => setCfg((c) => ({ ...c, enabled: v }))}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              Questions per check
            </p>
            <p className="text-xs text-ink-subtle">
              {QUESTIONS_PER_ATTEMPT_MIN}–{QUESTIONS_PER_ATTEMPT_MAX} (default{' '}
              {KNOWLEDGE_CHECK_DEFAULTS.questionsPerAttempt}).
            </p>
          </div>
          <input
            type="number"
            min={QUESTIONS_PER_ATTEMPT_MIN}
            max={QUESTIONS_PER_ATTEMPT_MAX}
            disabled={!canEdit || busy}
            value={cfg.questionsPerAttempt}
            onChange={(e) =>
              setCfg((c) => ({
                ...c,
                questionsPerAttempt: Number(e.target.value),
              }))
            }
            className="w-20 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>
        <ToggleRow
          label="Require my approval before questions go live"
          hint="When on, newly generated questions stay hidden from workers until you publish them."
          checked={cfg.requireManagerApproval}
          disabled={!canEdit || busy}
          onChange={(v) => setCfg((c) => ({ ...c, requireManagerApproval: v }))}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              If questions aren’t ready
            </p>
            <p className="text-xs text-ink-subtle">
              What happens if the AI can’t produce questions at check-in.
            </p>
          </div>
          <select
            disabled={!canEdit || busy}
            value={cfg.unavailablePolicy}
            onChange={(e) =>
              setCfg((c) => ({
                ...c,
                unavailablePolicy: e.target.value as 'SKIP_FLAGGED' | 'BLOCK',
              }))
            }
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="SKIP_FLAGGED">
              Let the worker check in (recommended)
            </option>
            <option value="BLOCK">Block check-in until ready</option>
          </select>
        </div>
        {canEdit && (
          <Button onClick={saveConfig} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        )}
      </div>

      {/* Bank status + actions */}
      <div className="space-y-2 rounded-lg border border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">Question bank</span>
          <BankBadge preview={preview} />
          {preview.provider && (
            <span className="text-xs text-ink-subtle">
              {preview.provider}
              {preview.model ? ` · ${preview.model}` : ''}
            </span>
          )}
        </div>
        {preview.error && (
          <p className="text-xs text-danger-600">Last error: {preview.error}</p>
        )}
        {preview.stale && (
          <p className="text-xs text-ink-subtle">
            No questions generated for the current induction content yet.
          </p>
        )}
        {flaggedCount > 0 && (
          <p className="text-xs font-medium text-hivis-600">
            {flaggedCount} question{flaggedCount === 1 ? '' : 's'} flagged by
            workers — review below.
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={regenerate} disabled={busy}>
              {busy
                ? 'Working…'
                : preview.questionCount > 0
                  ? 'Regenerate'
                  : 'Generate now'}
            </Button>
            {pendingApproval && (
              <Button onClick={approve} disabled={busy}>
                Publish to workers
              </Button>
            )}
            {preview.questions.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => setShowQuestions((s) => !s)}
                disabled={busy}
              >
                {showQuestions
                  ? 'Hide questions'
                  : `Preview ${preview.questionCount} questions`}
              </Button>
            )}
          </div>
        )}

        {showQuestions && (
          <ul className="mt-2 space-y-3">
            {preview.questions.map((q, i) => (
              <li
                key={q.id}
                className={cn(
                  'rounded-lg border p-3',
                  q.active
                    ? 'border-line bg-surface'
                    : 'border-line bg-surface-sunken opacity-70',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {knowledgeQuestionCategoryLabel(q.category)}
                  </span>
                  {q.flagCount > 0 && (
                    <span className="whitespace-nowrap rounded-full bg-hivis-400/25 px-2 py-0.5 text-xs font-semibold text-ink">
                      {q.flagCount} flag{q.flagCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {!q.active && (
                    <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                      Withdrawn
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold text-ink">
                  {i + 1}. {q.prompt}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {q.options.map((o) => (
                    <li
                      key={o.id}
                      className={cn(
                        o.id === q.correctOptionId
                          ? 'font-semibold text-safe-700'
                          : 'text-ink-muted',
                      )}
                    >
                      {o.id === q.correctOptionId ? '✓ ' : '• '}
                      {o.text}
                    </li>
                  ))}
                </ul>
                {q.sourceRef && (
                  <p className="mt-1 text-xs text-ink-subtle">
                    Source: {q.sourceRef}
                  </p>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-50"
                    disabled={rowBusy === q.id}
                    onClick={() => toggleQuestion(q)}
                  >
                    {q.active ? 'Withdraw question' : 'Restore question'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BankBadge({ preview }: { preview: KcPreview }) {
  if (!preview.status) {
    return (
      <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink-subtle">
        Not generated
      </span>
    );
  }
  if (preview.status === 'READY' && preview.approvedAt) {
    return (
      <span className="whitespace-nowrap rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
        Live · {preview.questionCount} questions
      </span>
    );
  }
  if (preview.status === 'READY') {
    return (
      <span className="whitespace-nowrap rounded-full bg-hivis-400/25 px-2 py-0.5 text-xs font-semibold text-ink">
        Awaiting approval
      </span>
    );
  }
  if (preview.status === 'GENERATING') {
    return (
      <span className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
        Generating…
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-700">
      Failed
    </span>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-safe-500' : 'bg-line',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
