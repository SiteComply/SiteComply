'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';

const DESCRIPTION_MAX = 2000;
const DESCRIPTION_MIN = 10;

type ReportType = 'BUG' | 'FEEDBACK' | 'SUGGESTION';

const TYPES: { value: ReportType; label: string; hint: string; icon: 'flag' | 'idea' }[] = [
  { value: 'BUG', label: 'Bug or problem', hint: 'Something is broken or behaving wrongly', icon: 'flag' },
  { value: 'FEEDBACK', label: 'Feedback', hint: 'How something works for you', icon: 'flag' },
  { value: 'SUGGESTION', label: 'Suggestion', hint: 'An idea for an improvement', icon: 'idea' },
];

/**
 * One glyph for the whole feature: the entry point and both "raise something"
 * chips use the same flag, by decision, so the control and the workflow behind
 * it read as one thing.
 *
 * The cost, recorded because it is not obvious from the code: Bug and Feedback
 * are now told apart by their LABELS ALONE. If the icons should differentiate
 * the types again, give Feedback back a speech bubble — that is the only change
 * needed.
 */
const PATHS: Record<'flag' | 'idea', string> = {
  flag: 'M5 21V4M5 5h13l-2.6 4L18 13H5',
  idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V15h8v-1.5A6 6 0 0 0 12 3z',
};

function TypeIcon({ name, className }: { name: 'flag' | 'idea'; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export interface ReportContext {
  pagePath: string;
  pageTitle: string | null;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /** Worker portal only — which site's configuration produced the behaviour. */
  activeSiteId?: string | null;
  activeSiteName?: string | null;
}

/**
 * The report form.
 *
 * ONE REQUIRED FIELD. Everything else is captured for the reporter, because a
 * report that takes twenty seconds gets written and one that takes two minutes
 * does not.
 *
 * The page, device and session context is still captured and sent — it is what
 * makes a report actionable — but it is no longer LISTED in the dialog. That
 * panel was removed as clutter; the trade-off is that the reporter no longer
 * sees what travels with their report before sending it.
 */
export function ReportIssueDialog({
  open,
  onClose,
  context,
  canBeContacted,
  portal,
}: {
  open: boolean;
  onClose: () => void;
  context: ReportContext | null;
  /** False for workers — we hold a mobile for them, not an email address. */
  canBeContacted: boolean;
  /**
   * Which experience this report is being filed from. Sent to the server so it
   * reads the matching session rather than guessing by cookie precedence, which
   * mis-attributed reports for anyone holding two sessions at once. It selects
   * a cookie; it does not grant identity.
   */
  portal: 'PLATFORM' | 'ADMIN' | 'WORKER';
}) {
  const [type, setType] = useState<ReportType>('BUG');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const tooShort = description.trim().length < DESCRIPTION_MIN;

  function reset() {
    setType('BUG');
    setDescription('');
    setContact(false);
    setError(null);
    setReference(null);
  }

  function close() {
    if (busy) return;
    onClose();
    // Cleared after the dialog has gone so the reset is not visible mid-close.
    setTimeout(reset, 200);
  }

  async function submit() {
    setError(null);
    if (tooShort) {
      setError(`Please add a little more detail — at least ${DESCRIPTION_MIN} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `portal` last so a future field on ReportContext cannot shadow it —
        // the server chooses which session to trust from this value.
        body: JSON.stringify({ type, description, contactRequested: contact, ...context, portal }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setReference(data.reference as string);
    } catch {
      setError('Network problem. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  // --- sent ---------------------------------------------------------------
  if (reference) {
    return (
      <Dialog open onClose={close} titleId="report-sent-title" className="max-w-md">
        <div className="p-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-safe-50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
              strokeLinecap="round" strokeLinejoin="round"
              className="h-6 w-6 text-safe-700" aria-hidden="true">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <h2 id="report-sent-title" className="text-lg font-bold text-ink">
            Thanks — report sent
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Your reference is{' '}
            <span className="font-semibold text-ink">{reference}</span>. We have
            the details of this page, so there is nothing else you need to send.
          </p>
          <div className="mt-5">
            <Button variant="brand" size="md" fullWidth onClick={close}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // --- form ---------------------------------------------------------------
  return (
    <Dialog open onClose={close} busy={busy} titleId="report-title" className="max-w-lg">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id="report-title" className="text-base font-bold text-ink">
          Report an issue
        </h2>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="Close"
          className="touch-target -mr-2 inline-flex items-center justify-center rounded-lg px-2 text-ink-subtle hover:bg-surface-sunken"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="px-5 py-4">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-ink-muted">
            What kind of report is this?
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => {
              const active = type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-line bg-surface hover:bg-surface-sunken',
                  )}
                >
                  <TypeIcon name={t.icon} className={cn('h-5 w-5', active ? 'text-brand-600' : 'text-ink-subtle')} />
                  <span className={cn('text-[11.5px] font-bold leading-tight', active ? 'text-ink' : 'text-ink-muted')}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {TYPES.find((t) => t.value === type)?.hint}
          </p>
        </fieldset>

        <div className="mt-4">
          <label htmlFor="report-description" className="block text-xs font-semibold text-ink-muted">
            What happened?
          </label>
          <p id="report-help" className="mt-1 text-xs text-ink-subtle">
            Please provide as much detail as possible about the bug, feedback or suggestion.
          </p>
          <textarea
            id="report-description"
            rows={5}
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            // No placeholder: it would repeat the guidance line directly above,
            // and a placeholder disappears the moment someone starts typing —
            // which is when guidance is worth having.
            // Both the guidance and the counter, in that order — the guidance is
            // the useful half and a screen reader should hear it first.
            aria-describedby="report-help report-count"
            className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20"
          />
          <p id="report-count" className="mt-1 text-right text-xs text-ink-subtle">
            {description.length} / {DESCRIPTION_MAX}
          </p>
        </div>

        {canBeContacted && (
          <label className="mt-3 flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={contact}
              onChange={(e) => setContact(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs text-ink-muted">
              Contact me about this. We will only get in touch if we need more detail.
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="md" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="md" fullWidth onClick={submit} disabled={busy}>
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
