import {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
  SmsSendError,
} from './SmsProvider';

/**
 * Twilio SMS provider.
 *
 * Talks to the Twilio REST API directly with `fetch` rather than pulling in the
 * `twilio` SDK. The Messages endpoint is one form-encoded POST with Basic auth,
 * so the SDK would add a dependency and its transitive tree to a Linux B1 App
 * Service for no capability we need.
 *
 * Credentials arrive from the runtime SmsConfig (Admin → Settings →
 * Integrations), where the auth token is encrypted at rest, falling back to env
 * vars so a deployment can be configured either way.
 *
 * SENDER PRECEDENCE — Messaging Service, then number, then alphanumeric name:
 *  1. `messagingServiceSid` — preferred. Twilio then handles number pooling,
 *     opt-out (STOP) handling and sender selection, which is what a UK service
 *     number needs.
 *  2. `from` — a specific Twilio number.
 *  3. `senderName` — an alphanumeric sender ID. UK networks permit these, but
 *     they CANNOT RECEIVE REPLIES, so a worker cannot reply to an invitation and
 *     STOP cannot be honoured on that route. Last resort, and never chosen while
 *     a real number is configured.
 */

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TIMEOUT_MS = 15_000;

export interface TwilioSettings {
  accountSid?: string;
  authToken?: string;
  from?: string;
  messagingServiceSid?: string;
  senderName?: string;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(private readonly config: TwilioSettings = {}) {}

  private setting(key: keyof TwilioSettings, envVar: string): string {
    return (this.config[key] ?? process.env[envVar] ?? '').trim();
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const accountSid = this.setting('accountSid', 'TWILIO_ACCOUNT_SID');
    const authToken = this.setting('authToken', 'TWILIO_AUTH_TOKEN');
    const messagingServiceSid = this.setting(
      'messagingServiceSid',
      'TWILIO_MESSAGING_SERVICE_SID',
    );
    const from = this.setting('from', 'TWILIO_SMS_FROM');
    const senderName = this.setting('senderName', 'TWILIO_SENDER_NAME');

    if (!accountSid || !authToken) {
      throw new SmsSendError(
        'Twilio is not configured. Add the Account SID and Auth Token in Admin → Settings → Integrations.',
      );
    }
    if (!messagingServiceSid && !from && !senderName) {
      throw new SmsSendError(
        'Twilio has no sender configured. Add a Messaging Service SID or a sender number.',
      );
    }

    const body = new URLSearchParams({ To: input.to, Body: input.message });
    if (messagingServiceSid)
      body.set('MessagingServiceSid', messagingServiceSid);
    else if (from) body.set('From', from);
    else body.set('From', senderName);

    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          // Basic auth over TLS, per Twilio. Built per request and never logged.
          authorization: `Basic ${Buffer.from(
            `${accountSid}:${authToken}`,
          ).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      // Network failure or timeout. The message is deliberately generic: this
      // string can reach an admin screen and must never carry credentials.
      throw new SmsSendError('Could not reach Twilio. Check connectivity.', e);
    } finally {
      clearTimeout(abort);
    }

    const payload = (await res.json().catch(() => null)) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    } | null;

    if (!res.ok) {
      // Twilio's own message is surfaced because it is genuinely actionable
      // ("The From number is not a valid Twilio number") and never contains the
      // auth token. An HTTP status alone would send an admin hunting.
      const detail = payload?.message ?? `HTTP ${res.status}`;
      const code = payload?.code ? ` (Twilio ${payload.code})` : '';
      throw new SmsSendError(`Twilio rejected the message: ${detail}${code}`);
    }

    return { messageId: payload?.sid };
  }
}
