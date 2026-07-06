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

type TypeSetting = { enabled: boolean; channels: Record<NotificationChannelKey, boolean> };
type Settings = Record<string, TypeSetting>;

const asObject = (json: unknown): Record<string, unknown> =>
  json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};

/** Effective setting for a type: stored value falls back to the catalogue default. */
function effectiveType(key: string, stored: Record<string, unknown>): TypeSetting {
  const desc = getNotificationTypeDescriptor(key)!;
  const raw = asObject(stored[key]);
  const rawChannels = asObject(raw.channels);
  const channels = {} as Record<NotificationChannelKey, boolean>;
  for (const ch of NOTIFICATION_CHANNELS) {
    const v = rawChannels[ch.key];
    channels[ch.key] = typeof v === 'boolean' ? v : desc.defaultChannels[ch.key];
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : desc.defaultEnabled,
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
    { enabled?: boolean; channels?: Partial<Record<NotificationChannelKey, boolean>> }
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
      enabled: typeof provided.enabled === 'boolean' ? provided.enabled : t.defaultEnabled,
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
    update: { settings, updatedByAdminId: admin.adminId, updatedByName: admin.name },
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
  return (Object.keys(t.channels) as NotificationChannelKey[]).filter((c) => t.channels[c]);
}
