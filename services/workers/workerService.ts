import { CscsCardType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Worker profile operations.
 *
 * A worker is keyed by their SMS-verified mobile (E.164). The identity step
 * creates the record on first check-in and updates it on return, so a recognised
 * worker's name/company/CSCS details pre-fill next time.
 */

export interface WorkerProfileInput {
  fullName: string;
  company: string;
  cscsCardNumber?: string | null;
  cscsCardType?: CscsCardType | null;
  cscsExpiry?: Date | null;
}

/** Fetch a worker by E.164 mobile, or null if not yet known. */
export function getWorkerByMobile(mobile: string) {
  return prisma.worker.findUnique({ where: { mobile } });
}

/**
 * Create or update the worker's profile for the given verified mobile.
 * Returns the persisted worker.
 */
export async function upsertWorkerProfile(
  mobile: string,
  input: WorkerProfileInput,
) {
  const fullName = input.fullName.trim();
  const company = input.company.trim();

  const data: Prisma.WorkerUncheckedCreateInput = {
    mobile,
    fullName,
    company,
    cscsCardNumber: input.cscsCardNumber?.trim() || null,
    cscsCardType: input.cscsCardType ?? null,
    cscsExpiry: input.cscsExpiry ?? null,
  };

  return prisma.worker.upsert({
    where: { mobile },
    create: data,
    update: {
      fullName,
      company,
      cscsCardNumber: data.cscsCardNumber,
      cscsCardType: data.cscsCardType,
      cscsExpiry: data.cscsExpiry,
    },
  });
}

/**
 * Erase a worker's personal data (UK GDPR right to erasure).
 *
 * We anonymise the personal identifiers rather than hard-deleting the worker, so
 * the site retains an anonymised proof-of-induction record (a legitimate
 * health & safety / CDM 2015 retention need) while no personal data remains. The
 * mobile is replaced with a unique tombstone to preserve the unique constraint
 * and prevent the number being re-linked. Also clears any active OTP challenges.
 */
export async function eraseWorkerPersonalData(workerId: string) {
  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) return null;

  await prisma.otpChallenge.deleteMany({ where: { mobile: worker.mobile } });

  return prisma.worker.update({
    where: { id: workerId },
    data: {
      fullName: 'Erased (UK GDPR)',
      company: 'Erased',
      mobile: `erased:${workerId}`,
      cscsCardNumber: null,
      cscsCardType: null,
      cscsExpiry: null,
    },
  });
}
