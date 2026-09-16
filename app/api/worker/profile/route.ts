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
import { withClosedProjectHandling } from '@/lib/routeErrors';
import { isKnownScheme } from '@/services/cscs/schemes';
import { composeFullName } from '@/services/workers/workerName';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProfileFields {
  /** Given name. The display name is derived from this plus the surname. */
  firstName: string;
  /** Family name, captured separately. Never derived from fullName. */
  surname: string;
  company: string;
  cscsCardNumber: string;
  cscsCardType: string;
  /** Smart Check scheme id, chosen from CSCS_SCHEMES. Never free text. */
  cscsSchemeId: string;
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
          firstName: str('firstName'),
          surname: str('surname'),
          company: str('company'),
          cscsCardNumber: str('cscsCardNumber'),
          cscsCardType: str('cscsCardType'),
          cscsSchemeId: str('cscsSchemeId'),
          cscsExpiry: str('cscsExpiry'),
        },
        image,
      };
    }
    const json = (await req.json()) as Partial<ProfileFields>;
    return {
      fields: {
        firstName: (json.firstName ?? '').trim(),
        surname: (json.surname ?? '').trim(),
        company: (json.company ?? '').trim(),
        cscsCardNumber: (json.cscsCardNumber ?? '').trim(),
        cscsCardType: (json.cscsCardType ?? '').trim(),
        cscsSchemeId: (json.cscsSchemeId ?? '').trim(),
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
async function POSTHandler(req: NextRequest) {
  const session = getWorkerSession();
  if (!session) {
    return bad('Your session has expired. Please verify again.', 401);
  }

  const body = await readBody(req);
  if (!body) return bad('Invalid request.');
  const { fields, image } = body;

  /*
   * BOTH PARTS, because the display name is derived from them.
   *
   * fullName is no longer typed - it is composed here - so an empty part would
   * produce a half-formed name on every report and signed document that reads
   * it. Asked separately rather than split, for the same reason the surname is:
   * "the last word" is wrong for compound surnames and for names written
   * family-name-first.
   */
  if (fields.firstName.length < 1) return bad('Please enter your first name.');

  /*
   * THE SURNAME FOLLOWS THE CARD, NOT THE NAME.
   *
   * It is only needed to look a card up, so only a card obliges it. Requiring it
   * of everyone would have made a display-name refactor into a new question at
   * every site gate for operatives who hold no card and never will.
   *
   * A worker who gives only a first name appears on the register by that name.
   * That is their answer to the question asked, and a returning worker's
   * existing name survives untouched: openingFirstName hands back the WHOLE
   * stored name when no surname is known, so saving without edits recomposes
   * exactly what was there before.
   */
  const cardIntent =
    Boolean(fields.cscsCardNumber.trim()) || Boolean(fields.cscsSchemeId.trim());
  if (cardIntent && fields.surname.trim().length < 1) {
    return bad('Please enter your surname so your card can be checked.');
  }

  const fullName = composeFullName(fields.firstName, fields.surname);
  if (fullName.length < 2) return bad('Please enter your name.');
  if (fields.company.length < 2) return bad('Please enter your company name.');

  /*
   * A CARD NUMBER OBLIGES A SURNAME AND A SCHEME.
   *
   * CSCS Smart Check identifies a card by scheme + surname + serial. Without
   * all three the lookup cannot run, so a card captured without them is a card
   * that can never be verified - and the operative is never told why.
   *
   * Required only WHEN A CARD IS GIVEN. An operative with no card is not asked
   * for either, because neither is needed for anything else. Enforced here as
   * well as in the form: the form can be bypassed, and this is the boundary that
   * decides what gets stored.
   */
  if (fields.cscsCardNumber.trim()) {
    if (!isKnownScheme(fields.cscsSchemeId)) {
      return bad('Please choose the scheme that issued your card.');
    }
  }

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

  /*
   * The scheme id is only ever one we published in the picker.
   *
   * An id that is not in CSCS_SCHEMES is dropped rather than sent: a made-up
   * scheme produces a lookup that fails, and a failed lookup shown to an
   * operative reads as a rejected card. Silently ignoring it leaves the worker
   * unverified, which is the honest outcome for a value we do not recognise.
   */
  const schemeId = isKnownScheme(fields.cscsSchemeId) ? fields.cscsSchemeId : '';

  // Verify against CSCS Smart Check when we have a usable card number.
  let verification: CscsVerificationResult | null = null;
  if (cardNumber) {
    // workerId is passed where known so the audit row links to the worker. On
    // FIRST profile save the worker does not exist yet, so the row is written
    // unlinked rather than not written — an attempt that produced a competency
    // record has to be auditable even when it created the worker.
    verification = await verifyCscsCard({
      cardNumber,
      // V2.6 looks a card up by scheme + surname + registration number. Both are
      // passed through as given: the provider refuses an incomplete lookup
      // rather than improvising one, which is what keeps a missing surname from
      // being reported to an operative as a rejected card.
      surname: fields.surname?.trim() || null,
      schemeId: schemeId || null,
      holderName: fullName,
      cardTypeHint: cscsCardType,
      expiryHint: cscsExpiry,
      workerId: session.workerId ?? null,
      // Only used to honour the exempt test account. Every other mobile takes
      // the live provider exactly as before.
      mobile: session.mobile,
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
    fullName,
    firstName: fields.firstName.trim(),
    surname: fields.surname.trim() || null,
    company: fields.company,
    cscsCardNumber: cardNumber,
    cscsSchemeId: schemeId || null,
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

export const POST = withClosedProjectHandling(POSTHandler);
