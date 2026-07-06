/**
 * AI provider catalogue (client-safe). Declares each AI provider and its
 * configuration fields as DATA, so the admin Integrations screen renders and
 * validates the form dynamically (mirrors the SMS provider catalogue). No
 * secrets live here — only field metadata. Adding a provider is a descriptor
 * entry + a provider send/complete implementation; the settings UI, storage,
 * encryption, validation and test flow need no changes.
 */

export type AiFieldType = 'text' | 'password';

export interface AiProviderField {
  key: string;
  label: string;
  type: AiFieldType;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface AiProviderDescriptor {
  id: string;
  name: string;
  description: string;
  fields: AiProviderField[];
  supportsTest: boolean;
}

export const AI_PROVIDERS: AiProviderDescriptor[] = [
  {
    id: 'mock',
    name: 'Mock (development)',
    description:
      'No model is called — a clearly-labelled placeholder summary is returned. Used for development and while Azure OpenAI is being provisioned.',
    fields: [],
    supportsTest: false,
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description:
      'Generates summaries via an Azure OpenAI Service resource (UK data residency). Requires an endpoint, a model deployment and a key.',
    fields: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        type: 'text',
        secret: false,
        required: true,
        placeholder: 'https://<resource>.openai.azure.com',
      },
      {
        key: 'deployment',
        label: 'Deployment name',
        type: 'text',
        secret: false,
        required: true,
        placeholder: 'gpt-4o-mini',
        help: 'The name of the model deployment in the resource.',
      },
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        secret: true,
        required: true,
        help: 'The resource key. Stored encrypted.',
      },
      {
        key: 'apiVersion',
        label: 'API version',
        type: 'text',
        secret: false,
        required: false,
        placeholder: '2024-08-01-preview',
      },
    ],
    supportsTest: true,
  },
];

export function getAiProviderDescriptor(id: string): AiProviderDescriptor | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

export const isKnownAiProvider = (id: string) =>
  AI_PROVIDERS.some((p) => p.id === id);

/** Roles that may be granted AI summary access (the feature-settings picker). */
export const AI_ELIGIBLE_ROLES: { value: string; label: string }[] = [
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'SITE_MANAGER', label: 'Site Manager' },
  { value: 'AUDITOR', label: 'Auditor' },
  { value: 'ENGINEER', label: 'Engineer' },
  { value: 'HS_CONSULTANT', label: 'H&S Consultant' },
  { value: 'PRINCIPAL_CONTRACTOR', label: 'Principal Contractor' },
  { value: 'CLIENT', label: 'Client' },
];
