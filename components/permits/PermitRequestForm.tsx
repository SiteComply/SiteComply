'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { WorkerIcon, type WorkerIconName } from '@/components/worker/icons';
import { cn } from '@/lib/cn';
import {
  areAnswersComplete,
  type PermitAnswers,
  type PermitQuestion,
} from '@/services/permits/permitFlow';
import {
  WORK_ACTIVITY_MAX,
  WORK_LOCATION_MAX,
} from '@/services/permits/permitConstants';

export interface RequestFormType {
  id: string;
  name: string;
  iconKey: string;
  description: string | null;
  questions: PermitQuestion[];
}

/**
 * Worker permit request form (SC-009). Pick a permit type, describe the work and
 * answer the type's questions, then submit. The question set is data-driven — this
 * component renders whatever questions the chosen type carries, so new permit
 * types need no code here.
 */
export function PermitRequestForm({
  types,
  initialTypeId,
}: {
  types: RequestFormType[];
  initialTypeId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [typeId, setTypeId] = useState<string | null>(
    initialTypeId && types.some((t) => t.id === initialTypeId)
      ? initialTypeId
      : null,
  );
  const [workActivity, setWorkActivity] = useState('');
  const [workLocation, setWorkLocation] = useState('');
  const [proposedStart, setProposedStart] = useState('');
  const [proposedFinish, setProposedFinish] = useState('');
  const [answers, setAnswers] = useState<PermitAnswers>({});
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const type = types.find((t) => t.id === typeId) ?? null;

  function setAnswer(id: string, value: PermitAnswers[string]) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  const coreOk = workActivity.trim().length >= 3;
  const questionsOk = type
    ? areAnswersComplete(type.questions, answers)
    : false;
  const canSubmit = Boolean(type) && coreOk && questionsOk;

  async function submit() {
    if (!type) return;
    if (!canSubmit) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/worker/permits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permitTypeId: type.id,
          workActivity,
          workLocation,
          proposedStart: proposedStart || null,
          proposedFinish: proposedFinish || null,
          answers,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? 'We couldn’t submit your permit. Please try again.',
        );
        return;
      }
      toast.success('Permit submitted for approval.');
      router.push(`/worker/permits/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  // Step 1 — pick a type.
  if (!type) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {types.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTypeId(t.id)}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-card hover:bg-surface-sunken"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <WorkerIcon
                name={t.iconKey as WorkerIconName}
                className="h-5 w-5"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">{t.name}</span>
              {t.description && (
                <span className="block text-xs text-ink-subtle">
                  {t.description}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    );
  }

  // Step 2 — details + questions.
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => setTypeId(null)}
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        ← Change permit type
      </button>

      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-4 shadow-card">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <WorkerIcon
            name={type.iconKey as WorkerIconName}
            className="h-5 w-5"
          />
        </span>
        <div>
          <p className="text-sm font-bold text-ink">{type.name}</p>
          {type.description && (
            <p className="text-xs text-ink-subtle">{type.description}</p>
          )}
        </div>
      </div>

      <Textarea
        label="Work activity"
        rows={2}
        maxLength={WORK_ACTIVITY_MAX}
        placeholder="Describe the work you’ll be doing."
        value={workActivity}
        error={
          showErrors && !coreOk
            ? 'Please describe the work activity.'
            : undefined
        }
        onChange={(e) => setWorkActivity(e.target.value)}
      />
      <TextField
        label="Work location"
        placeholder="e.g. Mezzanine level — Zone B"
        maxLength={WORK_LOCATION_MAX}
        value={workLocation}
        onChange={(e) => setWorkLocation(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Proposed start</span>
          <input
            type="datetime-local"
            value={proposedStart}
            onChange={(e) => setProposedStart(e.target.value)}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Proposed finish</span>
          <input
            type="datetime-local"
            value={proposedFinish}
            onChange={(e) => setProposedFinish(e.target.value)}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink"
          />
        </label>
      </div>

      {type.questions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-ink">Safety checks</h2>
          {type.questions.map((q) => (
            <QuestionField
              key={q.id}
              q={q}
              value={answers[q.id]}
              onChange={(v) => setAnswer(q.id, v)}
              showError={showErrors}
            />
          ))}
        </div>
      )}

      <Button fullWidth onClick={submit} disabled={busy}>
        {busy ? 'Submitting…' : 'Submit permit request'}
      </Button>
    </div>
  );
}

function QuestionField({
  q,
  value,
  onChange,
  showError,
}: {
  q: PermitQuestion;
  value: PermitAnswers[string] | undefined;
  onChange: (v: PermitAnswers[string]) => void;
  showError: boolean;
}) {
  const missing =
    showError &&
    q.required &&
    (q.type === 'ACKNOWLEDGEMENT'
      ? value !== true
      : q.type === 'YES_NO'
        ? value !== 'yes' && value !== 'no'
        : typeof value !== 'string' || value.trim() === '');

  if (q.type === 'ACKNOWLEDGEMENT') {
    return (
      <label
        className={cn(
          'flex items-start gap-3 rounded-xl border bg-surface p-4 shadow-card',
          missing ? 'border-danger-500' : 'border-line',
        )}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-safe-500"
        />
        <span className="text-sm text-ink">
          {q.label}
          {q.helpText && (
            <span className="mt-0.5 block text-xs text-ink-subtle">
              {q.helpText}
            </span>
          )}
        </span>
      </label>
    );
  }

  if (q.type === 'YES_NO') {
    return (
      <div
        className={cn(
          'rounded-xl border bg-surface p-4 shadow-card',
          missing ? 'border-danger-500' : 'border-line',
        )}
      >
        <p className="mb-2 text-sm font-semibold text-ink">{q.label}</p>
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold capitalize',
                value === opt
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-line bg-surface text-ink',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // TEXT / DATE
  return q.type === 'DATE' ? (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-ink">{q.label}</span>
      <input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'rounded-xl border bg-surface px-4 py-3 text-base text-ink',
          missing ? 'border-danger-500' : 'border-line',
        )}
      />
    </label>
  ) : (
    <TextField
      label={q.label}
      hint={q.helpText ?? undefined}
      value={typeof value === 'string' ? value : ''}
      error={missing ? 'This is required.' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
