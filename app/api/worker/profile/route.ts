import { NextRequest, NextResponse } from 'next/server';
import { CscsCardType } from '@prisma/client';
import {
  getWorkerSession,
  createWorkerSessionToken,
  setWorkerSessionCookie,
} from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';
import { upsertWorkerProfile } from '@/services/workers/workerService';
import { isValidCscsCardNumber, normaliseCscsCardNumber } from '@/lib/cscs';
import { verifyCscsCard } from '@/services/cscs/cscsVerificationService';
import type { CscsVerificationResult } from '@/services/cscs';
import {
  uploadCardImage,
  deleteCardImage,
  isAllowedCardImageType,
  CARD_IMAGE_MAX_BYTES,
} from '@/services/cscs/cardImageStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProfileFields {
  fullName: string;
  company: string;
  cscsCardNumber: string;
  cscsCardType: string;
  cscsExpiry: string; // ISO date (YYYY-MM-DD) from the date input
}

/** Read the profile fields (+ optional card image) from JSON or multipart form. */
async function readBody(
  req: NextRequest,
): Promise<{ fields: ProfileFields; image: File | null } | null> {
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const str = (k: string) => String(form.get(k) ?? '').trim();
      const imageEntry = form.get('cscsCardImage');
      const image =
        imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
      return {
        fields: {
          fullName: str('fullName'),
          company: str('company'),
          cscsCardNumber: str('cscsCardNumber'),
          cscsCardType: str('cscsCardType'),
          cscsExpiry: str('cscsExpiry'),
        },
        image,
      };
    }
    const json = (await req.json()) as Partial<ProfileFields>;
    return {
      fields: {
        fullName: (json.fullName ?? '').trim(),
        company: (json.company ?? '').trim(),
        cscsCardNumber: (json.cscsCardNumber ?? '').trim(),
        cscsCardType: (json.cscsCardType ?? '').trim(),
        cscsExpiry: (json.cscsExpiry ?? '').trim(),
      },
      image: null,
    };
  } catch {
    return null;
  }
}

const bad = (error: string, status = 400) =>
  NextResponse.json({ ok: false, error }, { status });

/**
 * POST /api/worker/profile
 * Saves the verified worker's name/company and optional CSCS/ECS card. When a
 * card number is supplied it is verified against the CSCS Smart Check service
 * (SC-001) and, where valid, the verified grade/expiry/holder and competency
 * records are stored against the worker. An uploaded/photographed card image is
 * kept in private blob storage. Refreshes the session cookie with the workerId.
 * Requires a valid worker session from the SMS step.
 */
export async function POST(req: NextRequest) {
  const session = getWorkerSession();
  if (!session) {
    return bad('Your session has expired. Please verify again.', 401);
  }

  const body = await readBody(req);
  if (!body) return bad('Invalid request.');
  const { fields, image } = body;

  if (fields.fullName.length < 2) return bad('Please enter your full name.');
  if (fields.company.length < 2) return bad('Please enter your company name.');

  // Optional CSCS card type.
  let cscsCardType: CscsCardType | null = null;
  if (fields.cscsCardType) {
    if (!(fields.cscsCardType in CscsCardType)) {
      return bad('Unrecognised CSCS card type.');
    }
    cscsCardType = fields.cscsCardType as CscsCardType;
  }

  // Optional expiry (date-only).
  let cscsExpiry: Date | null = null;
  if (fields.cscsExpiry) {
    const d = new Date(fields.cscsExpiry);
    if (Number.isNaN(d.getTime()))
      return bad('Enter a valid CSCS card expiry date.');
    cscsExpiry = d;
  }

  // Card number — accept numerical or alphanumeric (SC-001).
  let cardNumber: string | null = null;
  if (fields.cscsCardNumber) {
    if (!isValidCscsCardNumber(fields.cscsCardNumber)) {
      return bad('Enter a valid CSCS/ECS card number.');
    }
    cardNumber = normaliseCscsCardNumber(fields.cscsCardNumber);
  }

  // Validate an attached card image up-front (best-effort storage happens later).
  if (image) {
    if (!isAllowedCardImageType(image.type)) {
      return bad('Card image must be a JPG, PNG, WEBP or HEIC photo.');
    }
    if (image.size > CARD_IMAGE_MAX_BYTES) {
      return bad('Card image is too large (max 8 MB).');
    }
  }

  // Verify against CSCS Smart Check when we have a usable card number.
  let verification: CscsVerificationResult | null = null;
  if (cardNumber) {
    // workerId is passed where known so the audit row links to the worker. On
    // FIRST profile save the worker does not exist yet, so the row is written
    // unlinked rather than not written — an attempt that produced a competency
    // record has to be auditable even when it created the worker.
    verification = await verifyCscsCard({
      cardNumber,
      holderName: fields.fullName,
      cardTypeHint: cscsCardType,
      expiryHint: cscsExpiry,
      workerId: session.workerId ?? null,
    });
  }

  // Resolve the persisted card/competency fields. Verified data is authoritative;
  // otherwise we keep what the worker entered.
  const verified = verification?.verified === true;
  const resolvedCardType =
    verified && verification?.cardType ? verification.cardType : cscsCardType;
  const resolvedExpiry =
    verified && verification?.expiry ? verification.expiry : cscsExpiry;

  const worker = await upsertWorkerProfile(session.mobile, {
    fullName: fields.fullName,
    company: fields.company,
    cscsCardNumber: cardNumber,
    cscsCardType: resolvedCardType,
    cscsExpiry: resolvedExpiry,
    cscsScheme: verification?.scheme ?? null,
    cscsVerified: verified,
    cscsVerificationStatus: verification?.status ?? null,
    cscsVerifiedAt: verification ? verification.checkedAt : null,
    cscsHolderName: verification?.holderName ?? null,
    cscsQualifications: verification?.qualifications ?? null,
  });

  // Store the card image (best-effort — never blocks the check-in flow).
  if (image) {
    try {
      const buffer = Buffer.from(await image.arrayBuffer());
      const previousPath = worker.cscsCardImagePath;
      const blobPath = await uploadCardImage(worker.id, buffer, image.type);
      await prisma.worker.update({
        where: { id: worker.id },
        data: { cscsCardImagePath: blobPath },
      });
      if (previousPath && previousPath !== blobPath) {
        await deleteCardImage(previousPath);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[CSCS card image] upload failed:', error);
    }
  }

  // Refresh the session so it now carries the workerId.
  const { workerSessionTtlSeconds } = await getAuthRuntimeConfig();
  setWorkerSessionCookie(
    createWorkerSessionToken({
      mobile: session.mobile,
      workerId: worker.id,
      ttlSeconds: workerSessionTtlSeconds,
    }),
    workerSessionTtlSeconds,
  );

  return NextResponse.json({
    ok: true,
    worker: { fullName: worker.fullName, company: worker.company },
    verification: verification
      ? {
          status: verification.status,
          verified: verification.verified,
          scheme: verification.scheme ?? null,
          holderName: verification.holderName ?? null,
          message: verification.message,
          qualifications: verification.qualifications ?? [],
        }
      : null,
  });
}
