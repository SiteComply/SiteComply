import {
  ConfidentialClientApplication,
  type Configuration,
} from '@azure/msal-node';
import { appConfig, requireEnv } from '@/lib/config';

/**
 * Microsoft Azure AD (Entra ID) admin SSO, via MSAL confidential client.
 *
 * Admins sign in with their Microsoft work account. We request the OpenID
 * scopes, exchange the authorization code server-side, and map the Azure object
 * id (oid) to an Admin record on first login.
 *
 * When Azure AD isn't configured (local development), the auth routes fall back
 * to a dev sign-in — see isAzureAdConfigured(). Real Azure config always wins.
 */

export const ADMIN_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

export function isAzureAdConfigured(): boolean {
  return Boolean(
    process.env.AZURE_AD_TENANT_ID &&
      process.env.AZURE_AD_CLIENT_ID &&
      process.env.AZURE_AD_CLIENT_SECRET,
  );
}

export function adminRedirectUri(): string {
  return (
    process.env.AZURE_AD_REDIRECT_URI ??
    `${appConfig.baseUrl}/api/admin/auth/callback`
  );
}

let cca: ConfidentialClientApplication | undefined;

function client(): ConfidentialClientApplication {
  if (!cca) {
    const config: Configuration = {
      auth: {
        clientId: requireEnv('AZURE_AD_CLIENT_ID'),
        authority: `https://login.microsoftonline.com/${requireEnv('AZURE_AD_TENANT_ID')}`,
        clientSecret: requireEnv('AZURE_AD_CLIENT_SECRET'),
      },
    };
    cca = new ConfidentialClientApplication(config);
  }
  return cca;
}

/** Build the Microsoft authorization URL to redirect the admin to. */
export function getAuthCodeUrl(state: string): Promise<string> {
  return client().getAuthCodeUrl({
    scopes: ADMIN_SCOPES,
    redirectUri: adminRedirectUri(),
    state,
  });
}

export interface AzureAdminIdentity {
  azureObjectId: string;
  email: string;
  displayName: string;
}

/** Exchange the authorization code for tokens and extract the admin identity. */
export async function acquireAdminIdentity(
  code: string,
): Promise<AzureAdminIdentity> {
  const result = await client().acquireTokenByCode({
    code,
    scopes: ADMIN_SCOPES,
    redirectUri: adminRedirectUri(),
  });

  const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
  const azureObjectId =
    (claims.oid as string) ?? result.account?.homeAccountId ?? '';
  const email =
    (claims.preferred_username as string) ??
    (claims.email as string) ??
    result.account?.username ??
    '';
  const displayName =
    (claims.name as string) ?? result.account?.name ?? 'Administrator';

  if (!azureObjectId) {
    throw new Error('Azure AD did not return an object id for this account.');
  }
  return { azureObjectId, email, displayName };
}

/** Microsoft sign-out URL that ends the session at the IdP, then returns. */
export function azureLogoutUrl(postLogoutRedirect: string): string {
  const tenant = process.env.AZURE_AD_TENANT_ID ?? 'common';
  return (
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout` +
    `?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirect)}`
  );
}
