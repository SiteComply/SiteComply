'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { WorkerIcon } from '@/components/worker/icons';
import { SignaturePad } from '@/components/checkin/SignaturePad';
import { INDUCTION_DECLARATION } from '@/services/inductionSignature/signatureConstants';
import type { SignatureInput } from '@/services/inductionSignature/signatureService';

/**
 * Accept & Sign (SC-011) — the formal final step of the induction. Two focused
 * screens: a declaration + induction summary the worker reviews, then a prominent
 * signature capture. Deliberately weightier than the surrounding wizard steps so
 * signing reads as a genuine acceptance, not a checkbox. On submit it hands the
 * captured signature back to the wizard, which records the check-in.
 */
export function AcceptSignStep({
  siteName,
  workerName,
  inductionVersion,
  knowledgeCheckPassed,
  busy,
  onSigned,
  onBack,
}: {
  siteName: string;
  workerName: string;
  inductionVersion: number;
  knowledgeCheckPassed: boolean;
  busy: boolean;
  onSigned: (signature: SignatureInput) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<'review' | 'sign'>('review');
  const [signature, setSignature] = useState<SignatureInput | null>(null);

  if (phase === 'review') {
    return (
      <div className="space-y-5">
        <header className="text-center">
          <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <WorkerIcon name="shield" className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold text-ink">Accept &amp; sign</h1>
          <p className="mt-1 text-ink-muted">
            Review the declaration and sign to complete your site induction.
          </p>
        </header>

        {/* Induction summary */}
        <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="border-b border-line bg-surface-sunken px-4 py-2.5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">
              Induction summary
            </h2>
          </div>
          <dl>
            <Row label="Site" value={siteName} />
            <Row label="Induction version" value={String(inductionVersion)} />
            <Row
              label="Knowledge check"
              value={knowledgeCheckPassed ? 'Passed' : 'Completed'}
              good={knowledgeCheckPassed}
            />
          </dl>
        </section>

        <div className="flex items-start gap-2.5 rounded-xl border border-safe-500/40 bg-safe-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 text-safe-600">
            <WorkerIcon name="shield" className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold text-safe-700">
            You have completed all induction sections
            {knowledgeCheckPassed ? ' and passed the knowledge check' : ''}.
          </p>
        </div>

        {/* Declaration — formal, prominent */}
        <section className="rounded-xl border-2 border-brand-200 bg-surface p-5 shadow-card">
          <h2 className="mb-2 text-base font-bold text-ink">Declaration</h2>
          <p className="text-sm leading-relaxed text-ink">
            {INDUCTION_DECLARATION}
          </p>
        </section>

        <div className="space-y-3">
          <Button size="lg" fullWidth onClick={() => setPhase('sign')}>
            Continue to sign →
          </Button>
          <button
            type="button"
            onClick={onBack}
            className="w-full py-2 text-sm font-semibold text-ink-muted hover:underline"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // Signature phase.
  return (
    <div className="space-y-5">
      <header className="text-center">
        <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <WorkerIcon name="clipboard" className="h-6 w-6" />
        </span>
        <h1 className="text-2xl font-bold text-ink">Provide your signature</h1>
        <p className="mt-1 text-ink-muted">
          Your signature confirms that you have read and accept this site
          induction.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <p className="mb-3 text-sm font-semibold text-ink">Please sign below</p>
        <SignaturePad workerName={workerName} onChange={setSignature} />
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-subtle">
          <WorkerIcon name="shield" className="h-3.5 w-3.5" />
          Your signature is securely stored and cannot be altered.
        </p>
      </section>

      <div className="space-y-3">
        <Button
          size="lg"
          fullWidth
          disabled={busy || !signature}
          onClick={() => signature && onSigned(signature)}
        >
          {busy ? 'Completing induction…' : 'Submit signature'}
        </Button>
        <button
          type="button"
          onClick={() => setPhase('review')}
          className="w-full py-2 text-sm font-semibold text-ink-muted hover:underline"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={`text-sm font-semibold ${good ? 'text-safe-700' : 'text-ink'}`}
      >
        {value}
      </dd>
    </div>
  );
}
