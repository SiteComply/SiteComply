/**
 * SMS provider abstraction.
 *
 * The OTP service talks only to this interface, so the underlying SMS gateway
 * (Azure Communication Services by default; Twilio as an alternative; a console
 * mock for local development) can be swapped via the SMS_PROVIDER env var with
 * no change to the auth logic.
 */
export interface SendSmsInput {
  /** Destination in E.164 format, e.g. +447700900123. */
  to: string;
  /** Message body. */
  message: string;
}

export interface SendSmsResult {
  /** Provider message id, where one is returned. */
  messageId?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

/** Thrown when an SMS cannot be delivered, to be handled gracefully upstream. */
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}
