'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  buildInductionSteps,
  isStepComplete,
  type FlowItem,
  type InductionAnswers,
} from '@/services/checklists/inductionFlow';

interface InductionWizardProps {
  siteId: string;
  siteName: string;
  items: FlowItem[];
}

interface PersistedState {
  answers: InductionAnswers;
  gdprConsent: boolean;
  stepIndex: number;
}

/**
 * The digital induction. Renders the site's checklist dynamically, one question
 * (or the PPE group) per screen, with big touch targets, required-item
 * enforcement and a progress indicator. Progress is saved to localStorage so a
 * dropped connection or accidental reload doesn't lose the worker's place.
 *
 * Submitting the completed induction (writing the check-in record) is wired up
 * in Stage 6; here, completion hands off to the confirmation route.
 */
export function InductionWizard({
  siteId,
  siteName,
  items,
}: InductionWizardProps) {
  const router = useRouter();
  const toast = useToast();
  const steps = useMemo(() => buildInductionSteps(items), [items]);
  const storageKey = `sitecomply.induction.${siteId}`;

  const [answers, setAnswers] = useState<InductionAnswers>({});
  const [gdprConsent, setGdprConsent] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [showError, setShowError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  // Restore any saved progress for this site.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const s = JSON.parse(saved) as Partial<PersistedState>;
        if (s.answers) setAnswers(s.answers);
        if (typeof s.gdprConsent === 'boolean') setGdprConsent(s.gdprConsent);
        if (
          typeof s.stepIndex === 'number' &&
          s.stepIndex >= 0 &&
          s.stepIndex < steps.length
        ) {
          setStepIndex(s.stepIndex);
        }
      }
    } catch {
      /* ignore malformed state */
    }
    setHydrated(true);
  }, [storageKey, steps.length]);

  // Persist progress after hydration so it survives a reload / lost signal.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ answers, gdprConsent, stepIndex }),
      );
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [answers, gdprConsent, stepIndex, hydrated, storageKey]);

  const step = steps[stepIndex];
  const total = steps.length;
  const complete = isStepComplete(step, answers, gdprConsent);
  const isLast = stepIndex === total - 1;

  function setAnswer(id: string, value: InductionAnswers[string]) {
    setShowError(false);
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  function back() {
    setShowError(false);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  async function next() {
    if (!complete) {
      setShowError(true);
      return;
    }
    if (!isLast) {
      setShowError(false);
      setStepIndex((i) => i + 1);
      return;
    }
    // Final step complete → record the check-in server-side (re-validated there).
    setBusy(true);
    try {
      const res = await fetch('/api/worker/submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, answers, gdprConsent }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? 'We couldn’t record your check-in. Please try again.',
        );
        return;
      }
      // Clear the saved draft now it's safely persisted.
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* non-fatal */
      }
      toast.success('You’re checked in.');
      router.push(`/check-in/confirmation/${data.submissionId}`);
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col">
      {/* Sub-progress within the induction */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-subtle">
          <span>{siteName}</span>
          <span>
            Check {stepIndex + 1} of {total}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${((stepIndex + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1">
        {step.kind === 'acknowledgement' && (
          <AcknowledgementStep
            label={step.item.label}
            helpText={step.item.helpText}
            confirmed={answers[step.item.id] === true}
            onToggle={() =>
              setAnswer(
                step.item.id,
                answers[step.item.id] === true ? false : true,
              )
            }
          />
        )}

        {step.kind === 'yesno' && (
          <YesNoStep
            label={step.item.label}
            helpText={step.item.helpText}
            value={
              answers[step.item.id] === 'yes'
                ? 'yes'
                : answers[step.item.id] === 'no'
                  ? 'no'
                  : undefined
            }
            onSelect={(v) => setAnswer(step.item.id, v)}
          />
        )}

        {step.kind === 'ppe' && (
          <PpeStep
            items={step.items}
            answers={answers}
            onToggle={(id) =>
              setAnswer(id, answers[id] === true ? false : true)
            }
          />
        )}

        {step.kind === 'gdpr' && (
          <GdprStep
            consented={gdprConsent}
            onToggle={() => {
              setShowError(false);
              setGdprConsent((c) => !c);
            }}
          />
        )}

        {showError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-danger-500 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
          >
            {step.kind === 'ppe'
              ? 'Please confirm all required PPE to continue.'
              : step.kind === 'gdpr'
                ? 'Please give your consent to continue.'
                : 'Please answer this to continue.'}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 mt-6 flex gap-3 bg-surface-sunken py-4">
        {stepIndex > 0 && (
          <Button variant="secondary" size="lg" onClick={back} disabled={busy}>
            Back
          </Button>
        )}
        <Button size="lg" fullWidth onClick={next} disabled={busy}>
          {busy ? 'Please wait…' : isLast ? 'Complete check-in' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------- step components ---------------------------- */

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-bold leading-snug text-ink">{children}</h2>
  );
}

function ConfirmToggle({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        'touch-target flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors',
        checked
          ? 'border-safe-600 bg-safe-50'
          : 'border-line bg-surface hover:border-brand-200',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold',
          checked
            ? 'border-safe-600 bg-safe-600 text-white'
            : 'border-ink-subtle text-transparent',
        )}
        aria-hidden="true"
      >
        ✓
      </span>
      <span className="font-semibold text-ink">{label}</span>
    </button>
  );
}

function AcknowledgementStep({
  label,
  helpText,
  confirmed,
  onToggle,
}: {
  label: string;
  helpText?: string | null;
  confirmed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeading>{label}</StepHeading>
      {helpText && <p className="text-ink-muted">{helpText}</p>}
      <ConfirmToggle
        checked={confirmed}
        label="I confirm and acknowledge"
        onToggle={onToggle}
      />
    </div>
  );
}

function YesNoStep({
  label,
  helpText,
  value,
  onSelect,
}: {
  label: string;
  helpText?: string | null;
  value?: 'yes' | 'no';
  onSelect: (v: 'yes' | 'no') => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeading>{label}</StepHeading>
      {helpText && <p className="text-ink-muted">{helpText}</p>}
      <div className="grid grid-cols-2 gap-3">
        {(['yes', 'no'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            aria-pressed={value === opt}
            className={cn(
              'touch-target rounded-xl border-2 py-4 text-lg font-semibold capitalize transition-colors',
              value === opt
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-line bg-surface text-ink hover:border-brand-200',
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function PpeStep({
  items,
  answers,
  onToggle,
}: {
  items: FlowItem[];
  answers: InductionAnswers;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeading>Confirm your PPE</StepHeading>
      <p className="text-ink-muted">
        Tap each item you have with you and are wearing on site.
      </p>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onToggle(item.id)}
              aria-pressed={answers[item.id] === true}
              className={cn(
                'touch-target flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors',
                answers[item.id] === true
                  ? 'border-safe-600 bg-safe-50'
                  : 'border-line bg-surface hover:border-brand-200',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold',
                  answers[item.id] === true
                    ? 'border-safe-600 bg-safe-600 text-white'
                    : 'border-ink-subtle text-transparent',
                )}
                aria-hidden="true"
              >
                ✓
              </span>
              <span className="flex-1 font-semibold text-ink">
                {item.label}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs font-medium',
                  item.required ? 'text-danger-600' : 'text-ink-subtle',
                )}
              >
                {item.required ? 'Required' : 'Optional'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GdprStep({
  consented,
  onToggle,
}: {
  consented: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeading>Data protection &amp; consent</StepHeading>
      <div className="space-y-2 rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
        <p>
          SiteComply records your name, company, mobile number and the answers
          you give here so the site can meet its health &amp; safety and CDM
          2015 duties and know who is on site in an emergency.
        </p>
        <p>
          We keep this only as long as needed for site safety and compliance
          records, and handle it in line with the{' '}
          <strong className="text-ink">
            UK GDPR and Data Protection Act 2018
          </strong>
          . You can ask the site administrator to access or delete your details.
        </p>
        <p>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-700"
          >
            Read the full privacy notice
          </a>
        </p>
      </div>
      <ConfirmToggle
        checked={consented}
        label="I have read the above and consent to my details being recorded."
        onToggle={onToggle}
      />
    </div>
  );
}
