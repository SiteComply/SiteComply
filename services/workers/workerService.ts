import { CscsCardType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deleteCardImage } from '@/services/cscs/cardImageStorage';
import type { CscsQualification } from '@/services/cscs';

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
  /** CSCS Smart Check verification outcome (SC-001), where a check was run. */
  cscsScheme?: string | null;
  cscsVerified?: boolean;
  cscsVerificationStatus?: string | null;
  cscsVerifiedAt?: Date | null;
  cscsHolderName?: string | null;
  cscsQualifications?: CscsQualification[] | null;
  /** Private blob path of an uploaded/photographed card image. */
  cscsCardImagePath?: string | null;
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

  // JSON competency list: store the array, or clear to a real DB NULL.
  const qualifications: Prisma.InputJsonValue | typeof Prisma.DbNull =
    input.cscsQualifications && input.cscsQualifications.length > 0
      ? (input.cscsQualifications as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;

  // Verification fields common to create/update. Only overwrite the card image
  // path when a new one was supplied, so a returning worker keeps their image.
  const verification = {
    cscsScheme: input.cscsScheme ?? null,
    cscsVerified: input.cscsVerified ?? false,
    cscsVerificationStatus: input.cscsVerificationStatus ?? null,
    cscsVerifiedAt: input.cscsVerifiedAt ?? null,
    cscsHolderName: input.cscsHolderName ?? null,
    cscsQualifications: qualifications,
    ...(input.cscsCardImagePath !== undefined
      ? { cscsCardImagePath: input.cscsCardImagePath }
      : {}),
  };

  const data: Prisma.WorkerUncheckedCreateInput = {
    mobile,
    fullName,
    company,
    cscsCardNumber: input.cscsCardNumber?.trim() || null,
    cscsCardType: input.cscsCardType ?? null,
    cscsExpiry: input.cscsExpiry ?? null,
    ...verification,
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
      ...verification,
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

  // Remove any uploaded card image from blob storage (best-effort).
  if (worker.cscsCardImagePath) {
    await deleteCardImage(worker.cscsCardImagePath);
  }

  return prisma.worker.update({
    where: { id: workerId },
    data: {
      fullName: 'Erased (UK GDPR)',
      company: 'Erased',
      mobile: `erased:${workerId}`,
      cscsCardNumber: null,
      cscsCardType: null,
      cscsExpiry: null,
      cscsScheme: null,
      cscsVerified: false,
      cscsVerificationStatus: null,
      cscsVerifiedAt: null,
      cscsHolderName: null,
      cscsQualifications: Prisma.DbNull,
      cscsCardImagePath: null,
    },
  });
}
