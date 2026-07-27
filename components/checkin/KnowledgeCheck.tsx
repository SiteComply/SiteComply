'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type {
  ClientQuestion,
  ReviewContent,
} from '@/services/knowledgeChecks/attemptService';

/**
 * AI knowledge check (SC-005) — the mockup's end-of-induction check.
 *
 * Formative and pass-only: the worker must answer every sampled question
 * correctly, correcting wrong answers with the induction in front of them; there
 * is no fail-out. Grading is server-side (the correct option is never sent here),
 * so this component only ever learns "right / not yet". On completion it calls
 * `onPassed`, which records the check-in.
 */
export function KnowledgeCheck({
  siteName,
  attemptId,
  questions,
  review,
  answered,
  onPassed,
}: {
  siteName: string;
  attemptId: string;
  questions: ClientQuestion[];
  review: ReviewContent;
  answered: Record<string, boolean>;
  onPassed: () => void;
}) {
  const toast = useToast();
  const total = questions.length;

  const [correctSet, setCorrectSet] = useState<Set<string>>(
    () =>
      new Set(
        Object.entries(answered)
          .filter(([, c]) => c)
          .map(([id]) => id),
      ),
  );
  const firstUnanswered = useMemo(() => {
    const i = questions.findIndex((q) => !correctSet.has(q.id));
    return i === -1 ? total - 1 : i;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [idx, setIdx] = useState(firstUnanswered < 0 ? 0 : firstUnanswered);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'idle' | 'wrong' | 'correct'>(
    'idle',
  );
  const [explanation, setExplanation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const question = questions[idx];
  const remaining = total - correctSet.size;
  const isCurrentCorrect = correctSet.has(question.id);
  const isLastOutstanding =
    remaining <= 1 && (isCurrentCorrect || feedback === 'correct');

  async function grade() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/worker/knowledge-check/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          questionId: question.id,
          optionId: selected,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? 'Could not check your answer. Please try again.',
        );
        return;
      }
      if (data.correct) {
        setCorrectSet((s) => new Set(s).add(question.id));
        setFeedback('correct');
        setExplanation(data.explanation ?? null);
      } else {
        setFeedback('wrong');
        setExplanation(null);
      }
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    // Move to the next still-incorrect question, wrapping around.
    const order = [...questions.keys()];
    const after = order.slice(idx + 1).concat(order.slice(0, idx + 1));
    const nextIdx = after.find((i) => !correctSet.has(questions[i].id));
    if (nextIdx === undefined) return; // all correct — finish handles it
    setIdx(nextIdx);
    setSelected(null);
    setFeedback('idle');
    setExplanation(null);
  }

  async function finish() {
    setBusy(true);
    try {
      const res = await fetch('/api/worker/knowledge-check/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error('Could not finish the check. Please try again.');
        return;
      }
      if (data.passed) {
        onPassed();
      } else {
        // Server says some are still wrong — jump to the first outstanding.
        const remainingIds: string[] = data.remaining ?? [];
        const jump = questions.findIndex((q) => remainingIds.includes(q.id));
        toast.error(
          'Please answer the remaining questions correctly to finish.',
        );
        if (jump >= 0) {
          setIdx(jump);
          setSelected(null);
          setFeedback('idle');
        }
      }
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function flag() {
    try {
      await fetch('/api/worker/knowledge-check/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId, questionId: question.id }),
      });
      toast.success('Thanks — a manager will review this question.');
    } catch {
      /* non-fatal */
    }
  }

  const allCorrect = correctSet.size >= total;
  const answeredThis = feedback === 'correct' || isCurrentCorrect;

  return (
    <div className="flex min-h-[60vh] flex-col">
      <header className="flex flex-col items-center gap-2 py-2 text-center">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-safe-50 text-safe-600"
        >
          <BrainIcon />
        </span>
        <h1 className="text-2xl font-bold text-ink">Knowledge Check</h1>
        <p className="max-w-md text-sm text-ink-muted">
          These questions have been generated based on the content of your
          induction for{' '}
          <span className="font-semibold text-ink">{siteName}</span>.
        </p>
      </header>

      {/* Progress */}
      <div className="mb-4 mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-safe-500 transition-all"
            style={{ width: `${((total - remaining) / total) * 100}%` }}
          />
        </div>
        <p className="mt-1.5 text-center text-xs font-medium text-ink-subtle">
          Question {idx + 1} of {total}
        </p>
      </div>

      {/* Question card */}
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 rounded-md bg-safe-50 px-2 py-1 text-xs font-bold text-safe-700">
              Q{idx + 1}
            </span>
            <div>
              <h2 className="text-lg font-bold leading-snug text-ink">
                {question.prompt}
              </h2>
              <p className="mt-0.5 text-sm text-ink-subtle">
                Select the best answer.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowReview(true)}
            className="shrink-0 rounded-lg bg-brand-50 px-2.5 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-100"
          >
            Review induction section
          </button>
        </div>

        <ul className="mt-4 space-y-2.5">
          {question.options.map((opt) => {
            const isSel = selected === opt.id;
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  disabled={answeredThis}
                  onClick={() => {
                    setSelected(opt.id);
                    setFeedback('idle');
                  }}
                  aria-pressed={isSel}
                  className={cn(
                    'touch-target flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-colors',
                    answeredThis && isSel
                      ? 'border-safe-600 bg-safe-50'
                      : isSel
                        ? 'border-safe-600 bg-safe-50'
                        : 'border-line bg-surface hover:border-brand-200',
                    answeredThis && 'opacity-90',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                      isSel ? 'border-safe-600' : 'border-ink-subtle',
                    )}
                    aria-hidden="true"
                  >
                    {isSel && (
                      <span className="h-2.5 w-2.5 rounded-full bg-safe-600" />
                    )}
                  </span>
                  <span className="font-medium text-ink">{opt.text}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {feedback === 'wrong' && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-hivis-500 bg-hivis-400/15 px-4 py-3 text-sm font-medium text-ink"
          >
            That’s not right yet. Use “Review induction section”, then choose
            again — you can’t get it wrong permanently.
          </p>
        )}
        {answeredThis && (
          <p className="mt-3 rounded-xl border border-safe-500/40 bg-safe-50 px-4 py-3 text-sm text-safe-700">
            <span className="font-semibold">Correct.</span>
            {explanation ? ` ${explanation}` : ''}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between gap-3">
        {answeredThis ? (
          allCorrect ? (
            <Button size="lg" onClick={finish} disabled={busy}>
              {busy ? 'Finishing…' : 'Finish induction'}
            </Button>
          ) : (
            <Button size="lg" onClick={advance} disabled={busy}>
              Next question →
            </Button>
          )
        ) : (
          <Button size="lg" onClick={grade} disabled={busy || !selected}>
            {busy ? 'Checking…' : 'Check answer'}
          </Button>
        )}
        <button
          type="button"
          onClick={flag}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-subtle hover:text-ink"
        >
          <FlagIcon /> Flag question
        </button>
      </div>

      {/* Reassurance */}
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
        >
          i
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">
            Why we ask these questions
          </p>
          <p className="text-sm text-ink-muted">
            These questions help make sure you understand the important safety
            information for your safety and everyone else on site.
          </p>
        </div>
      </div>

      {/* Footer status */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-safe-500/40 bg-safe-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-safe-600">
            <CheckCircleIcon />
          </span>
          <div>
            <p className="text-sm font-bold text-safe-700">
              You must answer all questions correctly to complete your
              induction.
            </p>
            <p className="text-sm text-safe-700/80">
              You can review any incorrect answers before finishing.
            </p>
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-center">
          <div className="text-lg font-bold tabular-nums text-ink">
            {remaining}
          </div>
          <div className="text-[11px] text-ink-subtle">
            {remaining === 1 ? 'Question left' : 'Questions left'}
          </div>
        </div>
      </div>

      {showReview && (
        <ReviewModal
          title={question.sourceRef ?? 'Your induction'}
          review={review}
          onClose={() => setShowReview(false)}
        />
      )}
    </div>
  );
}

function ReviewModal({
  title,
  review,
  onClose,
}: {
  title: string;
  review: ReviewContent;
  onClose: () => void;
}) {
  const emergency: [string, string | null][] = [
    ['Fire assembly point', review.fireAssemblyPoint],
    ['First aider', review.firstAiderName],
    ['First aider location', review.firstAiderLocation],
    ['First aider number', review.firstAiderNumber],
    ['Nearest A&E', review.nearestHospital],
    ['Emergency number', review.emergencyNumber],
  ];
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-ink">
            Review: <span className="text-brand-700">{title}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-ink-subtle hover:bg-surface-sunken"
          >
            Close
          </button>
        </div>
        {review.inductionContent && (
          <p className="whitespace-pre-line text-sm text-ink-muted">
            {review.inductionContent}
          </p>
        )}
        <dl className="mt-3 space-y-1.5">
          {emergency
            .filter(([, v]) => Boolean(v))
            .map(([label, value]) => (
              <div key={label} className="text-sm">
                <dt className="inline font-semibold text-ink">{label}: </dt>
                <dd className="inline text-ink-muted">{value}</dd>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}

function BrainIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <path d="M9.5 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 9a2.5 2.5 0 0 0 1 2 2.5 2.5 0 0 0 1 4.5 2.5 2.5 0 0 0 4.5 1.5V4.5A2.5 2.5 0 0 0 9.5 4z" />
      <path d="M14.5 4A2.5 2.5 0 0 1 17 6.5 2.5 2.5 0 0 1 19 9a2.5 2.5 0 0 1-1 2 2.5 2.5 0 0 1-1 4.5 2.5 2.5 0 0 1-4.5 1.5" />
    </svg>
  );
}
function FlagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 21V4M5 4h11l-1.5 3L16 10H5" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5L16 9" />
    </svg>
  );
}
