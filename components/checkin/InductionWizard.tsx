'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  buildInductionSteps,
  type InductionSection,
  isSiteRulesAck,
  isStepComplete,
  type FlowItem,
  type InductionAnswers,
  type InductionVideoStepInfo,
} from '@/services/checklists/inductionFlow';
import { KnowledgeCheck } from '@/components/checkin/KnowledgeCheck';
import { BriefingStep } from '@/components/checkin/BriefingStep';
import { InductionVideoStep } from '@/components/checkin/InductionVideoStep';
import type { BriefingScreen } from '@/services/induction/inductionBriefing';
import {
  LocationCheck,
  type ConfirmLocation,
} from '@/components/checkin/LocationCheck';
import { AcceptSignStep } from '@/components/checkin/AcceptSignStep';
import type { SignatureInput } from '@/services/inductionSignature/signatureService';
import type {
  ClientQuestion,
  ReviewContent,
} from '@/services/knowledgeChecks/attemptService';

interface InductionWizardProps {
  siteId: string;
  siteName: string;
  items: FlowItem[];
  workerName: string;
  inductionVersion: number;
  /** SC-011: whether this site requires a digital signature to complete. */
  signatureRequired: boolean;
  /** The site briefing, read before any acknowledgement. Empty = none. */
  briefing?: BriefingScreen[];
  /** The published induction video, when the project has one. */
  video?: InductionVideoStepInfo | null;
}

// One stable empty value, so a site with no briefing does not rebuild the steps
// on every render.
const NO_BRIEFING: BriefingScreen[] = [];

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
 * Submitting the completed induction writes the check-in record and then hands
 * off to the Worker Dashboard (SC-003), the worker's landing page while on site.
 */
export function InductionWizard({
  siteId,
  siteName,
  items,
  workerName,
  inductionVersion,
  signatureRequired,
  briefing = NO_BRIEFING,
  video = null,
}: InductionWizardProps) {
  const router = useRouter();
  const toast = useToast();
  /*
   * WATCHED IS SERVER STATE, held here so the step's completion rule can see it
   * without rebuilding the flow from the network. It starts as whatever the
   * server already knew - an operative who watched it and came back does not
   * watch it again.
   */
  const [videoWatched, setVideoWatched] = useState(video?.completed ?? false);
  const steps = useMemo(
    () =>
      buildInductionSteps(
        items,
        briefing,
        video ? { ...video, completed: videoWatched } : null,
      ),
    [items, briefing, video, videoWatched],
  );
  const storageKey = `sitecomply.induction.${siteId}`;

  const [answers, setAnswers] = useState<InductionAnswers>({});
  const [gdprConsent, setGdprConsent] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [showError, setShowError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  // SC-005: the AI knowledge check runs as a final phase after the checklist,
  // before the check-in is recorded. `kc` holds the started attempt when a check
  // is required for this site; null means we're still in the checklist phase.
  const [kc, setKc] = useState<{
    attemptId: string;
    questions: ClientQuestion[];
    review: ReviewContent;
    answered: Record<string, boolean>;
  } | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  // SC-011: the Accept & Sign step runs after the knowledge check (when the site
  // requires a signature), before the location check. `signing` shows the step;
  // `signature`/`kcPassed` are captured for the check-in POST + the summary.
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<SignatureInput | null>(null);
  const [kcPassed, setKcPassed] = useState(false);
  // SC-007: the GPS Location Check runs as the final phase before the check-in is
  // recorded (it resolves immediately on sites without GPS validation).
  const [locating, setLocating] = useState(false);

  // After the induction (+ knowledge check) is complete: go to Accept & Sign when
  // the site requires a signature, otherwise straight to the location check.
  function proceedAfterInduction() {
    if (signatureRequired) setSigning(true);
    else setLocating(true);
  }

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
    // Final checklist step complete → run the SC-005 knowledge check (if the
    // site has one), then record the check-in.
    setShowError(false);
    setBusy(true);
    try {
      const res = await fetch('/api/worker/knowledge-check/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error('We couldn’t start the knowledge check. Please try again.');
        return;
      }
      if (data.state === 'ready') {
        setKc({
          attemptId: data.attemptId,
          questions: data.questions,
          review: data.review,
          answered: data.answered ?? {},
        });
        return;
      }
      if (data.state === 'blocked') {
        setBlockedMessage(
          data.message ?? 'The knowledge check isn’t ready yet.',
        );
        return;
      }
      // not_required — no knowledge check → Accept & Sign (or location).
      proceedAfterInduction();
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  // Record the check-in server-side (re-validated there: SC-005 gate + SC-007
  // GPS gate). `location` comes from the Location Check phase (null on GPS-off
  // sites).
  async function submitCheckIn(location: ConfirmLocation = null) {
    setBusy(true);
    try {
      const res = await fetch('/api/worker/submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          answers,
          gdprConsent,
          location,
          signature,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? 'We couldn’t record your check-in. Please try again.',
        );
        return;
      }
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* non-fatal */
      }
      toast.success('You’re checked in.');
      // SC-011: a signed induction lands on its formal completion record;
      // otherwise (SC-003) straight to the Worker Dashboard.
      if (signature && data.submissionId) {
        router.push(`/worker/inductions/${data.submissionId}?completed=1`);
      } else {
        router.push('/worker/dashboard');
      }
    } catch {
      toast.error('Network problem. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  // SC-007 GPS Location Check — the final phase before the check-in is recorded.
  if (locating) {
    return (
      <LocationCheck
        siteId={siteId}
        siteName={siteName}
        busy={busy}
        onConfirmed={(location) => submitCheckIn(location)}
      />
    );
  }

  // SC-011 Accept & Sign — the formal signature step (when the site requires it).
  if (signing) {
    return (
      <AcceptSignStep
        siteName={siteName}
        workerName={workerName}
        inductionVersion={inductionVersion}
        knowledgeCheckPassed={kcPassed}
        busy={busy}
        onSigned={(sig) => {
          setSignature(sig);
          setSigning(false);
          setLocating(true);
        }}
        onBack={() => setSigning(false)}
      />
    );
  }

  // SC-005 knowledge-check phase — replaces the checklist UI once started.
  if (kc) {
    return (
      <KnowledgeCheck
        siteName={siteName}
        attemptId={kc.attemptId}
        questions={kc.questions}
        review={kc.review}
        answered={kc.answered}
        onPassed={() => {
          setKcPassed(true);
          proceedAfterInduction();
        }}
      />
    );
  }

  if (blockedMessage) {
    return (
      <div className="space-y-4 py-6 text-center">
        <h2 className="text-xl font-bold text-ink">
          Knowledge check not ready
        </h2>
        <p className="text-ink-muted">{blockedMessage}</p>
        <Button size="lg" onClick={() => setBlockedMessage(null)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col">
      {/* Sub-progress within the induction */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-subtle">
          <span>{siteName}</span>
          <span>
            Step {stepIndex + 1} of {total}
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
            rules={step.rules}
            confirmed={answers[step.item.id] === true}
            onToggle={() =>
              setAnswer(
                step.item.id,
                answers[step.item.id] === true ? false : true,
              )
            }
          />
        )}

        {step.kind === 'section' && (
          <SectionStep
            section={step.section}
            items={step.items}
            rules={step.rules}
            answers={answers}
            onToggle={(id) => setAnswer(id, answers[id] === true ? false : true)}
          />
        )}

        {step.kind === 'briefing' && <BriefingStep screen={step.screen} />}

        {step.kind === 'video' && (
          <InductionVideoStep
            siteId={siteId}
            video={step.video}
            onWatched={() => {
              setShowError(false);
              setVideoWatched(true);
            }}
            briefingFallback={
              step.briefing.length > 0 ? (
                <div className="space-y-6">
                  {step.briefing.map((screen) => (
                    <BriefingStep key={screen.key} screen={screen} />
                  ))}
                </div>
              ) : undefined
            }
          />
        )}

        {step.kind === 'rules' && <RulesOnlyStep items={step.items} />}

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
            {step.kind === 'video'
              ? 'Please watch the induction video through to continue.'
              : step.kind === 'ppe'
              ? 'Please confirm all required PPE to continue.'
              : step.kind === 'gdpr'
                ? 'Please give your consent to continue.'
                : step.kind === 'section'
                  ? 'Please confirm each item to continue.'
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

/**
 * SITE RULES LIBRARY — the site's rules, shown with the acknowledgement that
 * covers them.
 *
 * Plainly listed, never behind a "show rules" disclosure. Someone is about to
 * agree they have read these; hiding them one tap away would make that agreement
 * a formality, and the whole reason the rule set lives next to the tick is so
 * "the site rules" names something the person can actually see.
 *
 * Nothing here is interactive. There is no tick, no row to press, no answer
 * stored — by design. One acknowledgement covers the set.
 */
function SiteRulesPanel({ items }: { items: FlowItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Site rules
      </p>
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={item.id} className="flex gap-3">
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-bold text-ink-muted"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="flex-1">
              <span className="block font-medium text-ink">{item.label}</span>
              {item.helpText && (
                <span className="mt-0.5 block text-sm text-ink-muted">
                  {item.helpText}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The rules with no acknowledgement to sit under, because the site removed or
 * reworded it. Shown rather than dropped, and honest about what it is: read-only,
 * with nothing to agree to. See buildInductionSteps.
 */
function RulesOnlyStep({ items }: { items: FlowItem[] }) {
  return (
    <div className="space-y-4">
      <StepHeading>Site rules</StepHeading>
      <p className="text-ink-muted">
        Please read the rules for this site before you continue.
      </p>
      <SiteRulesPanel items={items} />
    </div>
  );
}

function AcknowledgementStep({
  label,
  helpText,
  rules,
  confirmed,
  onToggle,
}: {
  label: string;
  helpText?: string | null;
  /** Site rules covered by THIS acknowledgement, shown above the tick. */
  rules?: FlowItem[];
  confirmed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeading>{label}</StepHeading>
      {helpText && <p className="text-ink-muted">{helpText}</p>}
      {rules && rules.length > 0 && <SiteRulesPanel items={rules} />}
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

function SectionStep({
  section,
  items,
  rules,
  answers,
  onToggle,
}: {
  section: InductionSection;
  items: FlowItem[];
  /**
   * Site rules covered by the site-rules acknowledgement in THIS section. Shown
   * directly beneath that row rather than at the foot of the screen: a section
   * holds three separate statements, and rules parked under the last of them
   * would read as belonging to whichever one they happen to follow.
   */
  rules?: FlowItem[];
  answers: InductionAnswers;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeading>{section.heading}</StepHeading>
      <p className="text-ink-muted">{section.intro}</p>
      {/* Owner Review Item 14 — one row per acknowledgement, each still ticked
          on its own. The row treatment is the PPE screen's, which has been a
          grouped screen since it shipped; the difference is that an
          acknowledgement carries help text, so each row has room for it. */}
      <ul className="space-y-3">
        {items.map((item) => {
          const confirmed = answers[item.id] === true;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                aria-pressed={confirmed}
                className={cn(
                  'touch-target flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors',
                  confirmed
                    ? 'border-safe-600 bg-safe-50'
                    : 'border-line bg-surface hover:border-brand-200',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold',
                    confirmed
                      ? 'border-safe-600 bg-safe-600 text-white'
                      : 'border-ink-subtle text-transparent',
                  )}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-ink">
                    {item.label}
                  </span>
                  {item.helpText && (
                    <span className="mt-1 block text-sm text-ink-muted">
                      {item.helpText}
                    </span>
                  )}
                </span>
                {!item.required && (
                  <span className="shrink-0 text-xs font-medium text-ink-subtle">
                    Optional
                  </span>
                )}
              </button>
              {rules && rules.length > 0 && isSiteRulesAck(item) && (
                <div className="mt-3">
                  <SiteRulesPanel items={rules} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
