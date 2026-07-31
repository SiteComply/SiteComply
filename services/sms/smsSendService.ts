import { prisma } from '@/lib/prisma';
import { resolveSmsProvider, SmsSendError } from '@/services/sms';

/**
 * The audited send path — every outbound SMS goes through here.
 *
 * One choke point so three guarantees hold for all messages rather than
 * per-caller: the master switch is honoured, the attempt is logged whether it
 * succeeded or failed, and the message BODY is never persisted.
 *
 * Bodies carry one-time sign-in codes and invitation codes. Storing them would
 * turn the audit table into a credential store and defeat the point of a
 * one-time code, so the log records what was sent and to whom — never what it
 * said.
 */

export type SmsPurpose = 'OTP' | 'WORKER_INVITE' | 'TEST' | 'OTHER';

export interface AuditedSendInput {
  to: string;
  message: string;
  purpose: SmsPurpose;
  /** Set when the recipient is a known worker, so erasure reaches the log row. */
  workerId?: string | null;
  jobSiteId?: string | null;
  /** Who triggered it, where a person did. */
  actorName?: string | null;
}

export type AuditedSendResult =
  | { ok: true; messageId?: string; provider: string }
  | { ok: false; error: string; provider: string; disabled?: boolean };

/**
 * Mask a destination for logging: keep the country/prefix and last four digits.
 *
 * Enough for support to confirm the right person was messaged, without copying
 * a full personal number into a second table that outlives the Worker record.
 */
export function maskNumber(to: string): string {
  const trimmed = (to ?? '').trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 5)}****${trimmed.slice(-4)}`;
}

/** Whether outbound sending is switched on (master switch, default on). */
export async function isSmsSendingEnabled(): Promise<boolean> {
  const row = await prisma.smsConfig.findUnique({
    where: { id: 'sms' },
    select: { sendingEnabled: true },
  });
  return row?.sendingEnabled ?? true;
}

export async function sendAuditedSms(
  input: AuditedSendInput,
): Promise<AuditedSendResult> {
  const provider = await resolveSmsProvider();

  // The master switch is checked HERE rather than in each caller, so it cannot
  // be forgotten by a future one. A suppressed message is still logged — an
  // absent record would make "we never sent it" and "sending was off"
  // indistinguishable afterwards.
  if (!(await isSmsSendingEnabled())) {
    await log(input, provider.name, false, 'Outbound SMS is switched off.');
    return {
      ok: false,
      error: 'Outbound SMS is switched off in Admin → Settings → Integrations.',
      provider: provider.name,
      disabled: true,
    };
  }

  try {
    const res = await provider.send({ to: input.to, message: input.message });
    await log(input, provider.name, true, null, res.messageId);
    return { ok: true, messageId: res.messageId, provider: provider.name };
  } catch (e) {
    const error =
      e instanceof SmsSendError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Unknown error sending SMS.';
    await log(input, provider.name, false, error);
    return { ok: false, error, provider: provider.name };
  }
}

async function log(
  input: AuditedSendInput,
  provider: string,
  ok: boolean,
  error: string | null,
  messageId?: string,
): Promise<void> {
  // Logging must never break a send. A failure to record is worth knowing about
  // but is not a reason to fail a sign-in code the user is waiting for.
  try {
    await prisma.smsMessageLog.create({
      data: {
        purpose: input.purpose,
        toMasked: maskNumber(input.to),
        workerId: input.workerId ?? null,
        jobSiteId: input.jobSiteId ?? null,
        provider,
        messageId: messageId ?? null,
        ok,
        error: error?.slice(0, 500) ?? null,
        actorName: input.actorName ?? null,
      },
    });
  } catch (e) {
    console.error('Failed to write SMS audit log', e);
  }
}

export interface SmsLogRow {
  id: string;
  purpose: string;
  toMasked: string;
  provider: string;
  messageId: string | null;
  ok: boolean;
  error: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** Recent outbound SMS, newest first, for the admin screen. */
export async function listRecentSms(take = 50): Promise<SmsLogRow[]> {
  return prisma.smsMessageLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      purpose: true,
      toMasked: true,
      provider: true,
      messageId: true,
      ok: true,
      error: true,
      actorName: true,
      createdAt: true,
    },
  });
}

/** Send counts for the last 30 days, so cost is visible before it is a bill. */
export async function smsUsageSummary(): Promise<{
  last30Days: number;
  failed30Days: number;
  byPurpose: { purpose: string; count: number }[];
}> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rows, failed] = await Promise.all([
    prisma.smsMessageLog.groupBy({
      by: ['purpose'],
      where: { createdAt: { gte: since }, ok: true },
      _count: { _all: true },
    }),
    prisma.smsMessageLog.count({
      where: { createdAt: { gte: since }, ok: false },
    }),
  ]);
  return {
    last30Days: rows.reduce((n, r) => n + r._count._all, 0),
    failed30Days: failed,
    byPurpose: rows.map((r) => ({ purpose: r.purpose, count: r._count._all })),
  };
}
