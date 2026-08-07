import { prisma } from '@/lib/prisma';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  getNotificationTypeDescriptor,
  isKnownNotificationType,
  type NotificationChannelKey,
} from '@/services/notifications/notificationCatalog';

/**
 * Runtime notification configuration store (Admin → Settings → Notifications).
 * Mirrors the SMS / AI / Auth config stores: a singleton row holds per-type
 * enable toggles + per-channel delivery preferences, and the runtime getters
 * merge DB-over-catalogue-default so nothing breaks before a row exists.
 *
 * Every future notification service reads getNotificationRuntimeConfig() (or the
 * isNotificationEnabled / getNotificationChannels helpers), so honouring admin
 * preferences — and adding new types/channels — needs no code changes here.
 * No secrets, so nothing is encrypted; all values are safe for the admin client.
 */

const CONFIG_ID = 'notifications';

type TypeSetting = {
  enabled: boolean;
  channels: Record<NotificationChannelKey, boolean>;
};
type Settings = Record<string, TypeSetting>;

const asObject = (json: unknown): Record<string, unknown> =>
  json && typeof json === 'object' && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : {};

/** Effective setting for a type: stored value falls back to the catalogue default. */
function effectiveType(
  key: string,
  stored: Record<string, unknown>,
): TypeSetting {
  const desc = getNotificationTypeDescriptor(key)!;
  const raw = asObject(stored[key]);
  const rawChannels = asObject(raw.channels);
  const channels = {} as Record<NotificationChannelKey, boolean>;
  for (const ch of NOTIFICATION_CHANNELS) {
    const v = rawChannels[ch.key];
    channels[ch.key] =
      typeof v === 'boolean' ? v : desc.defaultChannels[ch.key];
  }
  return {
    enabled:
      typeof raw.enabled === 'boolean' ? raw.enabled : desc.defaultEnabled,
    channels,
  };
}

async function readRow() {
  return prisma.notificationConfig.findUnique({ where: { id: CONFIG_ID } });
}

export interface NotificationConfigView {
  /** Effective per-type settings, keyed by type key (all catalogue types present). */
  types: Settings;
  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SaveNotificationConfigInput {
  types?: Record<
    string,
    {
      enabled?: boolean;
      channels?: Partial<Record<NotificationChannelKey, boolean>>;
    }
  >;
}

function buildEffective(stored: Record<string, unknown>): Settings {
  const out: Settings = {};
  for (const t of NOTIFICATION_TYPES) out[t.key] = effectiveType(t.key, stored);
  return out;
}

/** Admin-safe view — the current effective settings for every catalogue type. */
export async function getNotificationConfigForAdmin(): Promise<NotificationConfigView> {
  const row = await readRow();
  return {
    types: buildEffective(asObject(row?.settings)),
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function saveNotificationConfig(
  input: SaveNotificationConfigInput,
  admin: { adminId: string; name: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const incoming = input.types ?? {};
  const settings: Settings = {};

  // Only persist known types/channels; coerce everything to booleans so a
  // malformed body can never corrupt the stored shape.
  for (const t of NOTIFICATION_TYPES) {
    const provided = incoming[t.key] ?? {};
    const channels = {} as Record<NotificationChannelKey, boolean>;
    for (const ch of NOTIFICATION_CHANNELS) {
      const v = provided.channels?.[ch.key];
      // Explicit boolean wins; an omitted channel keeps the catalogue default.
      channels[ch.key] = typeof v === 'boolean' ? v : t.defaultChannels[ch.key];
    }
    settings[t.key] = {
      // Explicit boolean wins; an omitted type keeps the catalogue default.
      enabled:
        typeof provided.enabled === 'boolean'
          ? provided.enabled
          : t.defaultEnabled,
      channels,
    };
  }

  // Reject a body that references no known types at all (likely malformed).
  const referencedKnown = Object.keys(incoming).some(isKnownNotificationType);
  if (Object.keys(incoming).length > 0 && !referencedKnown) {
    return { ok: false, error: 'No valid notification settings provided.' };
  }

  await prisma.notificationConfig.upsert({
    where: { id: CONFIG_ID },
    update: {
      settings,
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
    create: {
      id: CONFIG_ID,
      settings,
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
  });
  return { ok: true };
}

export interface NotificationRuntimeConfig {
  types: Settings;
}

/**
 * The merged runtime config (DB → catalogue default). Read fresh each call so
 * admin changes apply immediately. Every notification consumer reads this (or the
 * helpers below); adding a type/channel is a catalogue change only.
 */
export async function getNotificationRuntimeConfig(): Promise<NotificationRuntimeConfig> {
  const row = await readRow();
  return { types: buildEffective(asObject(row?.settings)) };
}

/** Convenience: is a notification type enabled at all? (master toggle) */
export async function isNotificationEnabled(typeKey: string): Promise<boolean> {
  if (!isKnownNotificationType(typeKey)) return false;
  const rc = await getNotificationRuntimeConfig();
  return rc.types[typeKey]?.enabled ?? false;
}

/** Convenience: the enabled delivery channels for a type (empty if disabled). */
export async function getNotificationChannels(
  typeKey: string,
): Promise<NotificationChannelKey[]> {
  if (!isKnownNotificationType(typeKey)) return [];
  const rc = await getNotificationRuntimeConfig();
  const t = rc.types[typeKey];
  if (!t || !t.enabled) return [];
  return (Object.keys(t.channels) as NotificationChannelKey[]).filter(
    (c) => t.channels[c],
  );
}

/* -------------------------------------------------------------------------- */
/* Reminder thresholds — organisation-wide, and actually read by the services  */
/* -------------------------------------------------------------------------- */

/**
 * How many days ahead a reminder starts appearing.
 *
 * These were hard-coded constants in the notification services
 * (ACTION_DUE_THRESHOLDS = [7, 3], DOCUMENT_EXPIRY_THRESHOLDS = [30, 14, 7]).
 * A settings screen that showed them without the services reading them would be
 * exactly the unenforced control this workspace exists to avoid, so the
 * services now read THIS and the built-in arrays are the fallback.
 *
 * Stored in the same `settings` JSON as the type toggles, under a reserved key.
 * The catalogue never contains a type called `__thresholds`, and the save path
 * only persists known type keys, so the two cannot collide.
 */
export const THRESHOLD_KEY = '__thresholds';

export const THRESHOLD_LIMITS = {
  actionDueDays: { default: 7, min: 1, max: 60 },
  documentExpiryDays: { default: 30, min: 1, max: 180 },
} as const;

export interface NotificationThresholds {
  /** Lead time for "action due soon". */
  actionDueDays: number;
  /** Lead time for "document expiring". */
  documentExpiryDays: number;
}

function clampThreshold(
  key: keyof typeof THRESHOLD_LIMITS,
  raw: unknown,
): number {
  const { default: def, min, max } = THRESHOLD_LIMITS[key];
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** The effective thresholds (stored → clamped → built-in default). */
export async function getNotificationThresholds(): Promise<NotificationThresholds> {
  const row = await readRow();
  const stored = asObject(asObject(row?.settings)[THRESHOLD_KEY]);
  return {
    actionDueDays: clampThreshold('actionDueDays', stored.actionDueDays),
    documentExpiryDays: clampThreshold(
      'documentExpiryDays',
      stored.documentExpiryDays,
    ),
  };
}

/**
 * The reminder offsets a service should use, widest first.
 *
 * Built from the configured lead time rather than stored as a list: the
 * services want "remind at 7 days, then at 3", and asking an administrator to
 * maintain a list of offsets is a worse question than asking how far ahead to
 * start. Offsets below the lead time are kept only where they fit, so a lead
 * time of 2 days does not produce [2, 3].
 */
export function reminderOffsets(leadDays: number, steps: number[]): number[] {
  const kept = steps.filter((s) => s < leadDays);
  return [leadDays, ...kept];
}

/* -------------------------------------------------------------------------- */
/* Platform (Director) surface — the OWNER of notification defaults           */
/* -------------------------------------------------------------------------- */

/**
 * Settings → Notifications, in the PLATFORM portal.
 *
 * ONLY WHAT IS ENFORCED APPEARS. The view is built from the catalogue, and the
 * catalogue now contains exactly the types that reach an enforcement point —
 * three entries that reached none (platform_access_request, audit_reminders,
 * weekly_summary) were removed rather than rendered as switches that changed
 * nothing.
 *
 * IN-APP IS THE ONLY CHANNEL, and the view says so rather than offering it as a
 * choice. The catalogue declares email and SMS ahead of implementation and the
 * row can store per-channel booleans, but NOTHING reads them to deliver — so
 * they are not surfaced. A delivery preference that delivers nothing is the
 * clearest possible case of a setting with no behaviour behind it.
 */
export interface PlatformNotificationTypeView {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface PlatformNotificationSettingsView {
  types: PlatformNotificationTypeView[];
  thresholds: NotificationThresholds;
  thresholdLimits: typeof THRESHOLD_LIMITS;
  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SavePlatformNotificationSettingsInput {
  types?: Record<string, boolean>;
  actionDueDays?: number | string;
  documentExpiryDays?: number | string;
}

export async function getPlatformNotificationSettings(): Promise<PlatformNotificationSettingsView> {
  const row = await readRow();
  const stored = asObject(row?.settings);
  return {
    types: NOTIFICATION_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      enabled: effectiveType(t.key, stored).enabled,
    })),
    thresholds: await getNotificationThresholds(),
    thresholdLimits: THRESHOLD_LIMITS,
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function savePlatformNotificationSettings(
  input: SavePlatformNotificationSettingsInput,
  user: { userId: string; name: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await readRow();
  const existing = asObject(row?.settings);
  const next: Record<string, unknown> = { ...existing };

  // Only KNOWN type keys are persisted. An unknown key would be a setting with
  // no consumer the moment it was written — the thing this release removed.
  for (const [key, value] of Object.entries(input.types ?? {})) {
    if (!isKnownNotificationType(key)) continue;
    const prev = asObject(existing[key]);
    next[key] = { ...prev, enabled: value === true };
  }

  next[THRESHOLD_KEY] = {
    actionDueDays: clampThreshold('actionDueDays', input.actionDueDays),
    documentExpiryDays: clampThreshold(
      'documentExpiryDays',
      input.documentExpiryDays,
    ),
  };

  await prisma.notificationConfig.upsert({
    where: { id: CONFIG_ID },
    update: {
      settings: next as object,
      updatedByUserId: user.userId,
      updatedByName: user.name,
    },
    create: {
      id: CONFIG_ID,
      settings: next as object,
      updatedByUserId: user.userId,
      updatedByName: user.name,
    },
  });
  return { ok: true };
}
