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
