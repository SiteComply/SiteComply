import { SendSmsInput, SendSmsResult, SmsProvider } from './SmsProvider';

/**
 * Development-only SMS provider. Instead of sending a real text it logs the
 * message to the server console, so the OTP flow is fully exercisable locally
 * without an Azure Communication Services account. Never selected in production.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';

  async send({ to, message }: SendSmsInput): Promise<SendSmsResult> {
    // eslint-disable-next-line no-console
    console.warn(
      `\n────────── [MOCK SMS] ──────────\n` +
        `To:      ${to}\n` +
        `Message: ${message}\n` +
        `────────────────────────────────\n`,
    );
    return { messageId: `mock-${Date.now()}` };
  }
}
