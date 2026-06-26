import { SmsClient } from '@azure/communication-sms';
import {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
  SmsSendError,
} from './SmsProvider';
import { requireEnv } from '@/lib/config';

/**
 * Azure Communication Services SMS provider — the default for production.
 *
 * Requires:
 *   ACS_CONNECTION_STRING  — the ACS resource connection string
 *   ACS_SMS_SENDER         — a provisioned sender number in E.164 form
 *
 * The client is created lazily on first send so the app can boot without ACS
 * configured (e.g. when running the worker flow against the mock provider).
 */
export class AcsSmsProvider implements SmsProvider {
  readonly name = 'acs';
  private client?: SmsClient;
  private sender?: string;

  private getClient(): { client: SmsClient; sender: string } {
    if (!this.client || !this.sender) {
      this.client = new SmsClient(requireEnv('ACS_CONNECTION_STRING'));
      this.sender = requireEnv('ACS_SMS_SENDER');
    }
    return { client: this.client, sender: this.sender };
  }

  async send({ to, message }: SendSmsInput): Promise<SendSmsResult> {
    try {
      const { client, sender } = this.getClient();
      const [result] = await client.send({
        from: sender,
        to: [to],
        message,
      });

      if (!result?.successful) {
        throw new SmsSendError(
          `ACS rejected the message (HTTP ${result?.httpStatusCode}).`,
        );
      }
      return { messageId: result.messageId };
    } catch (error) {
      if (error instanceof SmsSendError) throw error;
      throw new SmsSendError(
        'Failed to send SMS via Azure Communication Services.',
        error,
      );
    }
  }
}
