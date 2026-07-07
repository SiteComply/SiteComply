/**
 * Notification catalogue (client-safe). Declares the platform notification types
 * and the delivery channels as DATA, so the admin Notifications screen renders
 * dynamically and future notification services consume the config without code
 * changes — adding a type or a channel is a catalogue entry only (mirrors the
 * SMS / AI provider catalogues).
 *
 * Delivery channels (email, SMS) are declared here ahead of implementation: an
 * admin can set the preference now and it applies automatically once the channel
 * ships. `available: false` marks a channel whose delivery is not built yet.
 */

export interface NotificationChannel {
  key: 'email' | 'sms';
  label: string;
  /** False until a real delivery integration for this channel is implemented. */
  available: boolean;
  help?: string;
}

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  {
    key: 'email',
    label: 'Email',
    available: false,
    help: 'Delivery not active yet — the preference is stored and applies when email launches.',
  },
  {
    key: 'sms',
    label: 'SMS',
    available: false,
    help: 'Delivery not active yet — the preference is stored and applies when SMS launches.',
  },
];

export type NotificationChannelKey = NotificationChannel['key'];

export interface NotificationTypeDescriptor {
  key: string;
  label: string;
  description: string;
  /** Master on/off default when no admin has saved a preference. */
  defaultEnabled: boolean;
  /** Per-channel default when no admin has saved a preference. */
  defaultChannels: Record<NotificationChannelKey, boolean>;
}

export const NOTIFICATION_TYPES: NotificationTypeDescriptor[] = [
  {
    key: 'platform_access_request',
    label: 'New platform access requests',
    description:
      'Someone requests access to the platform and is awaiting an admin decision. Also drives the in-app nav badge.',
    defaultEnabled: true,
    defaultChannels: { email: false, sms: false },
  },
  {
    key: 'overdue_actions',
    label: 'Overdue actions',
    description:
      'A corrective action has passed its due date without being completed.',
    defaultEnabled: true,
    defaultChannels: { email: false, sms: false },
  },
  {
    key: 'audit_reminders',
    label: 'Audit reminders',
    description:
      'Upcoming or outstanding audits that need attention across your sites.',
    defaultEnabled: true,
    defaultChannels: { email: false, sms: false },
  },
  {
    key: 'action_due_reminders',
    label: 'Action due reminders',
    description:
      'A corrective action is approaching its due date and may need attention.',
    defaultEnabled: true,
    defaultChannels: { email: false, sms: false },
  },
  {
    key: 'document_expiry',
    label: 'Document expiry reminders',
    description:
      'Site documents (certificates, insurance, permits) that are expiring soon — reminders at 30, 14 and 7 days — or have already expired.',
    defaultEnabled: true,
    defaultChannels: { email: false, sms: false },
  },
  {
    key: 'weekly_summary',
    label: 'Weekly summary',
    description:
      'A weekly digest of site activity, attendance and compliance across the organisation.',
    defaultEnabled: false,
    defaultChannels: { email: false, sms: false },
  },
];

export function getNotificationTypeDescriptor(
  key: string,
): NotificationTypeDescriptor | undefined {
  return NOTIFICATION_TYPES.find((t) => t.key === key);
}

export const isKnownNotificationType = (key: string) =>
  NOTIFICATION_TYPES.some((t) => t.key === key);
