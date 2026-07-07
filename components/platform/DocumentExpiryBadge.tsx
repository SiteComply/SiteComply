import {
  documentExpiryStatus,
  DOCUMENT_EXPIRY_LABEL,
  DOCUMENT_EXPIRY_BADGE,
} from '@/services/documents/documentConstants';
import { formatDateUK } from '@/lib/datetime';

/**
 * The single source of truth for how a document's expiry status is shown across
 * the Documents module (lists and detail pages). Renders exactly one of four
 * states — Valid, Expiring soon, Expired, No expiry — with identical sizing,
 * colour, padding and alignment everywhere, and never wraps to a second line.
 *
 * With `showDate`, the expiry date is shown directly beneath the badge for
 * documents that have one (No-expiry documents show the badge alone).
 */
export function DocumentExpiryBadge({
  expiresAt,
  now,
  showDate = false,
}: {
  expiresAt: Date | string | null;
  now?: Date;
  showDate?: boolean;
}) {
  const exp =
    expiresAt == null
      ? null
      : typeof expiresAt === 'string'
        ? new Date(expiresAt)
        : expiresAt;
  const status = documentExpiryStatus(exp, now);

  const badge = (
    <span
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${DOCUMENT_EXPIRY_BADGE[status]}`}
    >
      {DOCUMENT_EXPIRY_LABEL[status]}
    </span>
  );

  if (!showDate) return badge;

  return (
    <span className="flex flex-col items-start gap-0.5">
      {badge}
      {exp && status !== 'NONE' && (
        <span className="whitespace-nowrap text-xs text-ink-subtle">
          {formatDateUK(exp)}
        </span>
      )}
    </span>
  );
}
