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
        placeholder: 'endpoint=https://<resource>.communication.azure.com/;accesskey=…',
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
      'Sends SMS via Twilio. Provided as an example of adding a third-party provider (send() implementation is a stub until enabled).',
    fields: [
      {
        key: 'accountSid',
        label: 'Account SID',
        type: 'text',
        secret: false,
        required: true,
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      },
      {
        key: 'authToken',
        label: 'Auth token',
        type: 'password',
        secret: true,
        required: true,
        help: 'Stored encrypted.',
      },
      {
        key: 'from',
        label: 'Sender number',
        type: 'tel',
        secret: false,
        required: true,
        placeholder: '+441234567890',
      },
    ],
    supportsTest: true,
  },
];

export function getSmsProviderDescriptor(id: string): SmsProviderDescriptor | undefined {
  return SMS_PROVIDERS.find((p) => p.id === id);
}

export const isKnownSmsProvider = (id: string) =>
  SMS_PROVIDERS.some((p) => p.id === id);
