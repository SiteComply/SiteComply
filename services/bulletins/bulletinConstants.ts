/**
 * Client-safe Daily Bulletin constants (SC-002): category option list, labels
 * and badge styles, plus text limits. Kept free of any Prisma / server imports so
 * the server service and the client forms/cards share one source of truth. The
 * string values match the Prisma `BulletinCategory` enum members exactly.
 */

export type BulletinCategoryValue = 'NOTICE' | 'ANNOUNCEMENT' | 'SAFETY_ALERT';

/** Categories with human labels, in the order shown in the publish form. */
export const BULLETIN_CATEGORIES: {
  value: BulletinCategoryValue;
  label: string;
}[] = [
  { value: 'NOTICE', label: 'Site notice' },
  { value: 'ANNOUNCEMENT', label: 'Announcement' },
  { value: 'SAFETY_ALERT', label: 'Safety alert' },
];

const CATEGORY_LABELS = new Map(
  BULLETIN_CATEGORIES.map((c) => [c.value, c.label]),
);

export function bulletinCategoryLabel(value: string): string {
  return CATEGORY_LABELS.get(value as BulletinCategoryValue) ?? value;
}

export function isBulletinCategory(v: string): v is BulletinCategoryValue {
  return CATEGORY_LABELS.has(v as BulletinCategoryValue);
}

/** Tailwind classes for a category badge, by category. */
export const BULLETIN_CATEGORY_BADGE: Record<BulletinCategoryValue, string> = {
  NOTICE: 'bg-brand-50 text-brand-700',
  ANNOUNCEMENT: 'bg-surface-sunken text-ink-subtle',
  SAFETY_ALERT: 'bg-hivis-400/25 text-ink',
};

export const BULLETIN_TITLE_MAX = 120;
export const BULLETIN_BODY_MAX = 2000;
