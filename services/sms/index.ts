import { SmsProvider } from './SmsProvider';
import { MockSmsProvider } from './mockProvider';
import { AcsSmsProvider } from './acsProvider';
import { TwilioSmsProvider } from './twilioProvider';
import { getActiveSmsProviderConfig } from './smsConfigService';

export type { SmsProvider, SendSmsInput, SendSmsResult } from './SmsProvider';
export { SmsSendError } from './SmsProvider';

let cached: SmsProvider | undefined;

/**
 * Construct a provider by id with explicit settings (from the runtime SmsConfig
 * or a test). Providers fall back to env when a setting is absent.
 */
export function buildSmsProvider(
  providerId: string,
  settings: Record<string, string> = {},
): SmsProvider {
  switch (providerId.toLowerCase()) {
    case 'acs':
      return new AcsSmsProvider({
        connectionString: settings.connectionString,
        senderNumber: settings.senderNumber,
      });
    case 'twilio':
      return new TwilioSmsProvider({
        accountSid: settings.accountSid,
        authToken: settings.authToken,
        from: settings.from,
        messagingServiceSid: settings.messagingServiceSid,
        senderName: settings.senderName,
      });
    case 'mock':
      return new MockSmsProvider();
    default:
      throw new Error(
        `Unknown SMS provider "${providerId}". Use "acs", "twilio" or "mock".`,
      );
  }
}

/**
 * Resolve the active SMS provider from the runtime SmsConfig (Admin → Settings →
 * Integrations), falling back to the SMS_PROVIDER env var (+ env credentials)
 * when no config row exists. Read fresh each time so admin changes take effect
 * immediately. This is what the OTP flow uses.
 */
export async function resolveSmsProvider(): Promise<SmsProvider> {
  const active = await getActiveSmsProviderConfig();
  if (active) return buildSmsProvider(active.providerId, active.settings);

  const envChoice =
    process.env.SMS_PROVIDER?.toLowerCase() ??
    (process.env.NODE_ENV === 'production' ? 'acs' : 'mock');
  return buildSmsProvider(envChoice);
}

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
