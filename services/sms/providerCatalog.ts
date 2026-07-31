/**
 * SMS provider catalogue (client-safe). Declares each provider and its
 * configuration fields as DATA, so the admin Integrations screen renders and
 * validates the form dynamically. No secrets live here — only field metadata.
 *
 * Adding a new provider is a two-step, config-first change:
 *   1. Add a descriptor entry here (defines the settings screen — no UI code).
 *   2. Add the provider's send() implementation + wire it in resolveSmsProvider.
 * The settings UI, storage, encryption, validation and test flow need NO change.
 */

export type SmsFieldType = 'text' | 'password' | 'tel' | 'textarea';

export interface SmsProviderField {
  key: string;
  label: string;
  type: SmsFieldType;
  /** Stored encrypted at rest and never returned to the client. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface SmsProviderDescriptor {
  id: string;
  name: string;
  description: string;
  fields: SmsProviderField[];
  /** Whether "Test connectivity" is meaningful for this provider. */
  supportsTest: boolean;
}

export const SMS_PROVIDERS: SmsProviderDescriptor[] = [
  {
    id: 'mock',
    name: 'Mock (development)',
    description:
      'No real texts are sent — verification codes are written to the server log. Used for development and while a real provider is being provisioned.',
    fields: [],
    supportsTest: false,
  },
  {
    id: 'acs',
    name: 'Azure Communication Services',
    description:
      'Sends SMS via an Azure Communication Services resource. Requires a provisioned, SMS-capable sender number attached to the resource.',
    fields: [
      {
        key: 'connectionString',
        label: 'Connection string',
        type: 'password',
        secret: true,
        required: true,
        placeholder:
          'endpoint=https://<resource>.communication.azure.com/;accesskey=…',
        help: 'The ACS resource connection string. Stored encrypted.',
      },
      {
        key: 'senderNumber',
        label: 'Sender number',
        type: 'tel',
        secret: false,
        required: true,
        placeholder: '+447860064971',
        help: 'A number owned by the resource, in E.164 format.',
      },
    ],
    supportsTest: true,
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description:
      'Sends SMS via the Twilio REST API. Used for worker invitations, access workflows and sign-in codes.',
    fields: [
      {
        key: 'accountSid',
        label: 'Account SID',
        type: 'text',
        secret: false,
        required: true,
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        help: 'From the Twilio console. Not a secret on its own, but pairs with the auth token.',
      },
      {
        key: 'authToken',
        label: 'Auth token',
        type: 'password',
        secret: true,
        required: true,
        help: 'Stored encrypted and never shown again. Leave blank to keep the current token.',
      },
      {
        key: 'messagingServiceSid',
        label: 'Messaging Service SID',
        type: 'text',
        secret: false,
        required: false,
        placeholder: 'MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        help: 'Preferred. Twilio then handles sender selection and STOP/opt-out handling for the UK number.',
      },
      {
        key: 'from',
        label: 'Sender number',
        type: 'tel',
        secret: false,
        required: false,
        placeholder: '+441234567890',
        help: 'Used when no Messaging Service SID is set. The SiteComply UK number.',
      },
      {
        key: 'senderName',
        label: 'Sender name (optional)',
        type: 'text',
        secret: false,
        required: false,
        placeholder: 'SiteComply',
        help: 'Alphanumeric sender ID. Last resort only — recipients CANNOT reply to it, so use the UK number for invitations.',
      },
    ],
    supportsTest: true,
  },
];

export function getSmsProviderDescriptor(
  id: string,
): SmsProviderDescriptor | undefined {
  return SMS_PROVIDERS.find((p) => p.id === id);
}

export const isKnownSmsProvider = (id: string) =>
  SMS_PROVIDERS.some((p) => p.id === id);
