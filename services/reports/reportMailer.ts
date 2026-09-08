import { ConfidentialClientApplication, type Configuration } from '@azure/msal-node';

/**
 * Issue reports (Phase 2): the mail transport.
 *
 * Microsoft Graph `sendMail` as a daemon — client credentials against a
 * DEDICATED "SiteComply Mailer" app registration, deliberately not the one
 * behind Admin Centre sign-in (`AZURE_AD_*`). Two reasons: the mailbox lives in
 * a different tenant from the subscription, so it needs its own tenant id
 * anyway; and an application-permission Mail.Send grant is a much heavier thing
 * than a delegated sign-in scope — keeping it on its own registration means it
 * can be scoped, audited and revoked without touching who can log in.
 *
 * This file knows how to send an email and nothing about issue reports. Policy
 * — what to say, when to retry, what to record — is `reportDelivery.ts`.
 */

export interface MailerConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The mailbox that sends. Must be the one named in the Exchange access policy. */
  from: string;
  to: string[];
}

/**
 * Configuration is all-or-nothing and there is no default. Missing config means
 * DISABLED, not broken: reports still capture and store exactly as they do
 * today, and the delivery sweep records that it was switched off rather than
 * retrying forever against credentials that were never set. This is what lets
 * Phase 2 ship dark and be turned on by adding app settings.
 */
export function mailerConfig(): MailerConfig | null {
  const tenantId = process.env.REPORT_MAIL_TENANT_ID?.trim();
  const clientId = process.env.REPORT_MAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.REPORT_MAIL_CLIENT_SECRET?.trim();
  const from = process.env.REPORT_MAIL_FROM?.trim();
  const to = (process.env.REPORT_MAIL_TO ?? from ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (!tenantId || !clientId || !clientSecret || !from || to.length === 0) return null;
  return { tenantId, clientId, clientSecret, from, to };
}

export function mailerEnabled(): boolean {
  return mailerConfig() !== null;
}

const SCOPE = 'https://graph.microsoft.com/.default';

let cca: ConfidentialClientApplication | undefined;
let ccaKey = '';

function client(cfg: MailerConfig): ConfidentialClientApplication {
  // Keyed on the credentials so a settings change in the portal takes effect on
  // the next send rather than living on in a stale client for the process's life.
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  if (!cca || ccaKey !== key) {
    const config: Configuration = {
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        clientSecret: cfg.clientSecret,
      },
    };
    cca = new ConfidentialClientApplication(config);
    ccaKey = key;
  }
  return cca;
}

/** MSAL keeps its own token cache, so this is cheap to call per send. */
async function token(cfg: MailerConfig): Promise<string> {
  const result = await client(cfg).acquireTokenByClientCredential({ scopes: [SCOPE] });
  if (!result?.accessToken) {
    throw new MailError('Graph returned no access token.', false);
  }
  return result.accessToken;
}

/**
 * `retryable` is the whole point of this class: it decides whether the sweep
 * tries again in an hour or gives up. Throttling and outages are worth
 * retrying; a rejected secret or a missing consent grant will fail identically
 * every time and should stop consuming attempts.
 */
export class MailError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'MailError';
    this.retryable = retryable;
  }
}

export interface Mail {
  subject: string;
  html: string;
  text: string;
  /** Set when the reporter asked to be contacted, so a reply reaches them. */
  replyTo?: string | null;
}

const SEND_TIMEOUT_MS = 20_000;

export async function sendMail(mail: Mail): Promise<void> {
  const cfg = mailerConfig();
  if (!cfg) throw new MailError('Mail is not configured.', false);

  const accessToken = await token(cfg);

  const message: Record<string, unknown> = {
    subject: mail.subject,
    // HTML only: Graph takes one body. The plain-text rendering is kept for the
    // stored record and for anything that reads reports outside a mail client.
    body: { contentType: 'HTML', content: mail.html },
    toRecipients: cfg.to.map((address) => ({ emailAddress: { address } })),
  };
  if (mail.replyTo) {
    message.replyTo = [{ emailAddress: { address: mail.replyTo } }];
  }

  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    // A timeout or a socket error. Worth another go.
    throw new MailError(`Graph request failed: ${errText(err)}`, true);
  } finally {
    clearTimeout(abort);
  }

  // 202 Accepted, no body, is the success case.
  if (res.status === 202) return;

  const detail = (await res.text().catch(() => '')).slice(0, 400);

  // 401/403 are consent, secret or access-policy problems: identical next hour.
  // 429 and 5xx are worth retrying; Graph throttles hard and recovers.
  const retryable = res.status === 429 || res.status >= 500;
  throw new MailError(`Graph sendMail returned ${res.status}: ${detail}`, retryable);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
