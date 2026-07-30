/**
 * SC-020 Phase 1 — client-safe compliance scheduler constants.
 *
 * No Prisma/server imports, so the calendar, the legend, the schedule form and
 * the server-side generator all work from one set of definitions.
 */

export type FrequencyValue = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
export type AssigneeKindValue = 'USER' | 'WORKER' | 'ROLE';
export type OccurrenceStatusValue =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'MISSED';

export const FREQUENCIES: {
  value: FrequencyValue;
  label: string;
  hint: string;
}[] = [
  {
    value: 'DAILY',
    label: 'Daily',
    hint: 'Every day, or only on chosen weekdays.',
  },
  { value: 'WEEKLY', label: 'Weekly', hint: 'On chosen days each week.' },
  { value: 'MONTHLY', label: 'Monthly', hint: 'On a chosen day of the month.' },
  { value: 'CUSTOM', label: 'Custom', hint: 'Every N days.' },
];

/** ISO weekdays — 1 = Monday, matching the REV-1 calendar's Mon-first grid. */
export const WEEKDAYS: { value: number; short: string; label: string }[] = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
];

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatusValue, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  MISSED: 'Missed',
};

export const OCCURRENCE_STATUS_BADGE: Record<OccurrenceStatusValue, string> = {
  SCHEDULED: 'bg-surface-sunken text-ink-muted',
  IN_PROGRESS: 'bg-brand-50 text-brand-700',
  COMPLETED: 'bg-safe-50 text-safe-700',
  MISSED: 'bg-danger-50 text-danger-700',
};

/**
 * Activity-type colours reuse the SC-014 categorical chart palette
 * (--chart-1..6), which was validated for colourblind separation and lightness.
 * Assignment is by a STABLE key (the template id), never by position in a
 * filtered list — colour follows the activity type, so filtering the calendar
 * never repaints the survivors.
 */
const CHART_SLOTS = 6;

export function activityColour(templateId: string): string {
  let hash = 0;
  for (let i = 0; i < templateId.length; i++) {
    hash = (hash * 31 + templateId.charCodeAt(i)) % 100000;
  }
  return `rgb(var(--chart-${(hash % CHART_SLOTS) + 1}))`;
}

/** Max chips rendered in a calendar cell before a "+N more" link. */
export const MAX_CHIPS_PER_DAY = 3;

export const TIME_OPTIONS = [
  '06:00',
  '06:30',
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
];

export function isFrequency(v: string): v is FrequencyValue {
  return FREQUENCIES.some((f) => f.value === v);
}

export function isAssigneeKind(v: string): v is AssigneeKindValue {
  return v === 'USER' || v === 'WORKER' || v === 'ROLE';
}

/** "HH:MM" in 24h. */
export function isTimeOfDay(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
