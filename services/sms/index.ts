import { SmsProvider } from './SmsProvider';
import { MockSmsProvider } from './mockProvider';
import { AcsSmsProvider } from './acsProvider';
import { TwilioSmsProvider } from './twilioProvider';

export type { SmsProvider, SendSmsInput, SendSmsResult } from './SmsProvider';
export { SmsSendError } from './SmsProvider';

let cached: SmsProvider | undefined;

/**
 * Resolve the configured SMS provider from the SMS_PROVIDER env var.
 * Defaults to the console mock in development so the OTP flow works out of the
 * box, and to Azure Communication Services otherwise.
 */
export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  const choice =
    process.env.SMS_PROVIDER?.toLowerCase() ??
    (process.env.NODE_ENV === 'production' ? 'acs' : 'mock');

  switch (choice) {
    case 'acs':
      cached = new AcsSmsProvider();
      break;
    case 'twilio':
      cached = new TwilioSmsProvider();
      break;
    case 'mock':
      cached = new MockSmsProvider();
      break;
    default:
      throw new Error(
        `Unknown SMS_PROVIDER "${choice}". Use "acs", "twilio" or "mock".`,
      );
  }
  return cached;
}
