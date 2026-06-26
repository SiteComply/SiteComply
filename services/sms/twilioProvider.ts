import {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
  SmsSendError,
} from './SmsProvider';

/**
 * Twilio SMS provider — STUB / alternative.
 *
 * Left as a deliberate extension point to show the provider abstraction works
 * for more than one gateway. To enable: add the `twilio` package, set
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM, and implement send()
 * (the commented body below is the shape it would take).
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  async send(_input: SendSmsInput): Promise<SendSmsResult> {
    // const client = twilio(
    //   requireEnv('TWILIO_ACCOUNT_SID'),
    //   requireEnv('TWILIO_AUTH_TOKEN'),
    // );
    // const msg = await client.messages.create({
    //   from: requireEnv('TWILIO_SMS_FROM'),
    //   to: _input.to,
    //   body: _input.message,
    // });
    // return { messageId: msg.sid };
    throw new SmsSendError(
      'Twilio provider is not implemented. Set SMS_PROVIDER to "acs" or "mock".',
    );
  }
}
