/**
 * Client-safe Documents module constants (category option list + labels, and
 * upload limits). Kept free of any Prisma / server imports so the server service
 * and the client upload/edit form share one source of truth. The string values
 * match the Prisma `DocumentCategory` enum members exactly.
 */

export type DocumentCategoryValue =
  | 'RAMS'
  | 'INSURANCE'
  | 'CERTIFICATE'
  | 'GENERAL';

/**
 * Selectable document categories, in display order, with human labels.
 *
 * Deliberately kept to four broad buckets — expand only if a genuine business
 * requirement emerges. RAMS also covers method statements; CERTIFICATE covers
 * training/plant/other certificates; GENERAL covers permits, toolbox talks and
 * anything else.
 */
export const DOCUMENT_CATEGORIES: {
  value: DocumentCategoryValue;
  label: string;
}[] = [
  { value: 'RAMS', label: 'RAMS' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'CERTIFICATE', label: 'Certificates' },
  { value: 'GENERAL', label: 'General Documents' },
];

const CATEGORY_LABELS = new Map(
  DOCUMENT_CATEGORIES.map((c) => [c.value, c.label]),
);

/** Human label for a category value (falls back to the raw value). */
export function documentCategoryLabel(value: string): string {
  return CATEGORY_LABELS.get(value as DocumentCategoryValue) ?? value;
}

export function isDocumentCategory(v: string): v is DocumentCategoryValue {
  return CATEGORY_LABELS.has(v as DocumentCategoryValue);
}

/** Maximum upload size (bytes). Kept comfortably under App Service request limits. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Accepted upload content types — the common document/image formats used for
 * site paperwork. Enforced on the server; also used for the file input's
 * `accept` attribute.
 */
export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

/** Human hint listing accepted formats, for the upload form. */
export const ACCEPTED_DOCUMENTS_HINT =
  'PDF, images (JPG/PNG/HEIC/WebP), Word, Excel or plain text — up to 20 MB.';

/** Format a byte count for display, e.g. "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

// --- Deletion ---------------------------------------------------------------

/**
 * Roles permitted to permanently DELETE a document (metadata + blob). Deletion is
 * a destructive management action, so it is an explicit allow-list rather than the
 * broad "edit" permission: Engineer can create and edit documents but must not be
 * able to destroy others' compliance records (RAMS, insurance, certificates).
 * Mirrors the audit delete allow-list.
 */
export const DOCUMENT_DELETE_ROLES = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'SITE_MANAGER',
  'HS_CONSULTANT',
  'PRINCIPAL_CONTRACTOR',
] as const;

export function canDeleteDocument(role: string): boolean {
  return (DOCUMENT_DELETE_ROLES as readonly string[]).includes(role);
}

// --- Expiry tracking --------------------------------------------------------

/** A document is "expiring soon" within this many days of its expiry date. */
export const EXPIRING_SOON_DAYS = 30;

export type DocumentExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'NONE';

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Classify a document by its expiry date, comparing whole UTC days so the result
 * is stable regardless of time-of-day. Null expiry → NONE (does not expire).
 * EXPIRED once the date has passed; EXPIRING_SOON from today up to +30 days.
 */
export function documentExpiryStatus(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): DocumentExpiryStatus {
  if (!expiresAt) return 'NONE';
  const exp = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(exp.getTime())) return 'NONE';
  const today = utcDay(now);
  const expDay = utcDay(exp);
  const soon = today + EXPIRING_SOON_DAYS * DAY_MS;
  if (expDay < today) return 'EXPIRED';
  if (expDay <= soon) return 'EXPIRING_SOON';
  return 'VALID';
}

export const DOCUMENT_EXPIRY_LABEL: Record<DocumentExpiryStatus, string> = {
  VALID: 'Valid',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
  NONE: 'No expiry',
};

export const DOCUMENT_EXPIRY_BADGE: Record<DocumentExpiryStatus, string> = {
  VALID: 'bg-safe-50 text-safe-700',
  EXPIRING_SOON: 'bg-hivis-400/25 text-ink',
  EXPIRED: 'bg-danger-50 text-danger-700',
  NONE: 'bg-surface-sunken text-ink-subtle',
};

export type DocumentExpiryFilter = 'valid' | 'expiring' | 'expired' | 'none';

/** The selectable expiry filters — all four states. Labels reuse the badge
 *  labels so the filter and the badges always read identically. */
export const DOCUMENT_EXPIRY_FILTERS: { value: DocumentExpiryFilter; label: string }[] = [
  { value: 'valid', label: DOCUMENT_EXPIRY_LABEL.VALID },
  { value: 'expiring', label: DOCUMENT_EXPIRY_LABEL.EXPIRING_SOON },
  { value: 'expired', label: DOCUMENT_EXPIRY_LABEL.EXPIRED },
  { value: 'none', label: DOCUMENT_EXPIRY_LABEL.NONE },
];

export const isDocumentExpiryFilter = (v: string): v is DocumentExpiryFilter =>
  v === 'valid' || v === 'expiring' || v === 'expired' || v === 'none';
