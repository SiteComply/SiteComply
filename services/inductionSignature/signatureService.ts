import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  buildBlobPath,
  uploadDocumentBlob,
} from '@/services/documents/blobStorage';
import {
  INDUCTION_DECLARATION,
  SIGNED_NAME_MAX,
  SIGNATURE_MAX_BYTES,
  type SignatureTypeValue,
} from '@/services/inductionSignature/signatureConstants';

/**
 * Digital Induction Acceptance (SC-011) server helpers.
 *
 * Captures the worker's declaration acceptance + signature at induction
 * completion, storing a drawn signature as a private PNG blob (reusing the
 * Documents Azure Blob storage) and metadata inline on the Submission. WRITE-ONCE
 * — the caller (createCheckIn) only ever sets these on a fresh induction record.
 */

/** Whether the site requires a signature on a full induction. */
export async function getInductionSignatureRequired(
  siteId: string,
): Promise<boolean> {
  const cfg = await prisma.siteInductionConfig.findUnique({
    where: { jobSiteId: siteId },
    select: { inductionSignatureRequired: true },
  });
  return cfg?.inductionSignatureRequired ?? false;
}

export interface SignatureInput {
  type: SignatureTypeValue;
  /** The worker's name as signed. */
  name: string;
  /** For DRAWN: a data URL "data:image/png;base64,....". Ignored for TYPED. */
  dataUrl?: string;
}

/** Parse + validate an untrusted signature payload from the request body. */
export function parseSignatureInput(raw: unknown): SignatureInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type === 'DRAWN' || r.type === 'TYPED' ? r.type : null;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!type || name.length < 2) return null;
  const dataUrl = typeof r.dataUrl === 'string' ? r.dataUrl : undefined;
  if (type === 'DRAWN' && !dataUrl) return null;
  return { type, name: name.slice(0, SIGNED_NAME_MAX), dataUrl };
}

/** The signature/declaration fields to write onto a new Submission. */
export type SignatureRecord = Pick<
  Prisma.SubmissionUncheckedCreateInput,
  | 'declarationAccepted'
  | 'declarationText'
  | 'signedName'
  | 'signatureType'
  | 'signatureBlobPath'
  | 'signedAt'
>;

export type BuildSignatureResult =
  | { ok: true; record: SignatureRecord }
  | { ok: false; error: string };

/**
 * Validate + persist a signature, returning the fields to store on the
 * submission. A drawn PNG is uploaded to private blob storage; a typed signature
 * stores only the name. Declaration text is snapshotted for evidence.
 */
export async function buildSignatureRecord(
  siteId: string,
  input: SignatureInput,
): Promise<BuildSignatureResult> {
  const now = new Date();
  if (input.type === 'TYPED') {
    return {
      ok: true,
      record: {
        declarationAccepted: true,
        declarationText: INDUCTION_DECLARATION,
        signedName: input.name,
        signatureType: 'TYPED',
        signatureBlobPath: null,
        signedAt: now,
      },
    };
  }

  // DRAWN — decode the PNG data URL and store it privately.
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
    input.dataUrl ?? '',
  );
  if (!match) {
    return { ok: false, error: 'The signature image is invalid.' };
  }
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0 || buffer.length > SIGNATURE_MAX_BYTES) {
    return { ok: false, error: 'The signature image is too large.' };
  }
  const blobPath = buildBlobPath(siteId, 'induction-signature.png');
  await uploadDocumentBlob(blobPath, buffer, 'image/png');
  return {
    ok: true,
    record: {
      declarationAccepted: true,
      declarationText: INDUCTION_DECLARATION,
      signedName: input.name,
      signatureType: 'DRAWN',
      signatureBlobPath: blobPath,
      signedAt: now,
    },
  };
}
