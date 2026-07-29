import { CscsCardType } from '@prisma/client';
import { CSCS_CARD_LABELS } from '@/lib/cscs';
import { formatDateUK } from '@/lib/datetime';

/**
 * Pre-induction CSCS competency status (SC-012). Uses the verified competency
 * record (SC-001) as the source of truth: a valid, in-date verified card shows a
 * small reassurance; a missing/unverified or expired card shows a PROMINENT
 * advisory warning before the worker starts the induction. Advisory only — it
 * never blocks check-in or induction in v1.
 */
export type CscsCompetency = 'verified' | 'expired' | 'unverified';

/** Derive the competency state from the worker's verified card record. */
export function workerCscsCompetency(worker: {
  cscsVerified: boolean;
  cscsExpiry: Date | null;
}): CscsCompetency {
  const expiryMs = worker.cscsExpiry ? worker.cscsExpiry.getTime() : null;
  const inDate = expiryMs === null || expiryMs >= Date.now();
  if (worker.cscsVerified && inDate) return 'verified';
  if (expiryMs !== null && expiryMs < Date.now()) return 'expired';
  return 'unverified';
}

export function CscsCompetencyBanner({
  status,
  scheme,
  cardType,
  expiry,
}: {
  status: CscsCompetency;
  scheme: string | null;
  cardType: CscsCardType | null;
  expiry: Date | null;
}) {
  if (status === 'verified') {
    const cardLabel = cardType ? CSCS_CARD_LABELS[cardType] : 'card';
    return (
      <section className="mb-4 flex items-start gap-3 rounded-xl border border-safe-500/40 bg-safe-50 p-4 shadow-card">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-safe-600 text-white"
        >
          ✓
        </span>
        <div>
          <h2 className="text-sm font-bold text-safe-700">
            CSCS card verified
          </h2>
          <p className="text-sm text-safe-700/90">
            Your {scheme ? `${scheme} ` : ''}
            {cardLabel} is verified
            {expiry ? ` and valid until ${formatDateUK(expiry)}` : ''}.
          </p>
        </div>
      </section>
    );
  }

  // expired / unverified — a prominent advisory warning.
  const expired = status === 'expired';
  return (
    <section className="mb-4 overflow-hidden rounded-xl border-2 border-hivis-500 bg-hivis-400/15 shadow-card">
      <div className="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hivis-500 text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
            <path d="M12 9.5v4" />
            <path d="M12 17h.01" />
          </svg>
        </span>
        <div>
          <h2 className="text-sm font-bold text-ink">
            {expired
              ? 'Your CSCS card has expired'
              : 'No verified CSCS card on your profile'}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {expired
              ? `Your card expired${expiry ? ` on ${formatDateUK(expiry)}` : ''}. Please renew it and speak to your site manager — you may be asked to show a valid card on site.`
              : 'We couldn’t confirm a valid CSCS/ECS card for you. Please speak to your site manager before starting work — you may be asked to show a valid card on site.'}
          </p>
        </div>
      </div>
    </section>
  );
}
