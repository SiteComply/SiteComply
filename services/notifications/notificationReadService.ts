import { prisma } from '@/lib/prisma';

/**
 * Per-user read state for in-app notifications.
 *
 * Notifications are derived (e.g. document-expiry reminders) rather than stored,
 * so "read" is tracked by the presence of a NotificationRead row keyed by a
 * stable notification identity string. Absent row = unread. This is generic:
 * any future derived notification type reuses these helpers by minting its own
 * keys. Scope/RBAC is enforced by the caller (only mark keys the viewer can see).
 */

/** Which of the given notification keys the user has read (as a Set for O(1) lookup). */
export async function getReadNotificationKeys(
  userId: string,
  keys: string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await prisma.notificationRead.findMany({
    where: { userId, key: { in: keys } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

/** Mark a single notification read (row present) or unread (row removed). */
export async function setNotificationRead(
  userId: string,
  key: string,
  read: boolean,
): Promise<void> {
  if (read) {
    await prisma.notificationRead.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key },
      update: {},
    });
  } else {
    await prisma.notificationRead.deleteMany({ where: { userId, key } });
  }
}

/** Mark many notifications read in one go (skips ones already read). */
export async function markNotificationsRead(
  userId: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await prisma.notificationRead.createMany({
    data: keys.map((key) => ({ userId, key })),
    skipDuplicates: true,
  });
}
