import { prisma } from '@/lib/prisma';
import type { AzureAdminIdentity } from '@/services/auth/adminAuth';

/**
 * Admin record operations. An Admin is created on first SSO login (mapped from
 * the Azure AD object id) and updated on subsequent logins.
 */

/**
 * Create or update the Admin for an Azure AD identity and stamp last login.
 * The very first admin to sign in becomes the OWNER; later ones default to ADMIN.
 */
export async function upsertAdminFromAzure(identity: AzureAdminIdentity) {
  const existingCount = await prisma.admin.count();
  return prisma.admin.upsert({
    where: { azureObjectId: identity.azureObjectId },
    update: {
      email: identity.email,
      displayName: identity.displayName,
      lastLoginAt: new Date(),
    },
    create: {
      azureObjectId: identity.azureObjectId,
      email: identity.email,
      displayName: identity.displayName,
      role: existingCount === 0 ? 'OWNER' : 'ADMIN',
      lastLoginAt: new Date(),
    },
  });
}

export function getAdminById(id: string) {
  return prisma.admin.findUnique({ where: { id } });
}
