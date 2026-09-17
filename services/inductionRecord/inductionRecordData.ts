import { ChecklistItemType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCompanyBranding, getCompanyLogo } from '@/services/company/companyConfigService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';
import { checkInReference } from '@/services/submissions/submissionService';
import { isRetiredInductionItem } from '@/services/checklists/inductionFlow';

/**
 * The induction record document — the data it needs, and nothing else.
 *
 * DELIBERATELY NARROW. A Submission carries far more than this: GPS coordinates
 * and accuracy, override provenance, knowledge-check question ids and per-answer
 * detail, attempt durations, CSCS qualification payloads. None of it is here.
 *
 * The document is compliance EVIDENCE shown to a client, an auditor or a
 * principal contractor, not a database export. Every field below earns its place
 * by answering a question such a reader actually asks: who was inducted, onto
 * which site, when, against which version, what did they agree to, did they pass
 * the check, and can I trace this record back. A field that only answers "what
 * else do you store?" is left out on purpose — adding it back should require the
 * same justification.
 */

export interface RecordAcknowledgement {
  label: string;
  confirmed: boolean;
}

export interface InductionRecordData {
  /** Deterministic, never stored — see documentReference(). */
  documentReference: string;
  checkInReference: string;
  generatedAt: Date;

  company: {
    name: string;
    tagline: string | null;
    primaryColor: string;
    logo: { bytes: Buffer; contentType: string } | null;
  };

  operative: {
    name: string;
    company: string;
    /** One summary line, or null when the operative holds no card record. */
    cscs: string | null;
  };

  site: {
    name: string;
    jobReference: string;
    address: string[];
    /** Named only where the site records one — the accountable party. */
    principalContractor: string | null;
  };

  induction: {
    completedAt: Date;
    version: number;
    /** Acknowledgement statements, verbatim, as the operative saw them. */
    acknowledgements: RecordAcknowledgement[];
    ppeCount: number;
    ppeConfirmed: boolean;
    siteRuleCount: number;
    gdprConsent: boolean;
    knowledgeCheck: 'passed' | 'not-required' | 'not-passed';
    knowledgeCheckCount: number | null;
    /**
     * Set when this check-in CARRIED FORWARD an earlier induction rather than
     * performing one. The document must say so: without it the record asserts an
     * induction that did not happen on the date printed at the top.
     */
    carriedForwardFrom: Date | null;
  };

  declaration: {
    accepted: boolean;
    text: string | null;
    signedName: string | null;
    signedAt: Date | null;
    /** Decoded signature image, when the operative drew one. */
    signatureImage: { bytes: Buffer; contentType: string } | null;
  };
}

/**
 * A stable, human-quotable reference for the document itself.
 *
 * DERIVED, NOT STORED, and deterministic: a reprint in six months produces the
 * same string, so a reference quoted in correspondence always resolves. Built
 * from the site's job reference, the induction date and the tail of the
 * submission id — the same tail the check-in reference uses, so the two are
 * visibly related on the page.
 */
export function documentReference(
  jobReference: string,
  completedAt: Date,
  submissionId: string,
): string {
  const site = (jobReference || 'SITE').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const d = completedAt;
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `SC-IND-${site || 'SITE'}-${yy}${mm}${dd}-${submissionId.slice(-6).toUpperCase()}`;
}

/** Mask a card number for a document that leaves the building. */
function maskCard(cardNumber: string): string {
  const s = cardNumber.trim();
  if (s.length <= 4) return '••••';
  return `•••• ${s.slice(-4)}`;
}

/**
 * The operative's competency, as ONE line or not at all.
 *
 * A card that has not been verified is reported as unverified rather than
 * omitted: a reader who sees a CSCS line is entitled to know how much weight it
 * carries, and silence would read as "no card" when the truth is "not checked".
 */
function cscsSummary(w: {
  cscsCardNumber: string | null;
  cscsScheme: string | null;
  cscsExpiry: Date | null;
  cscsVerified: boolean;
}): string | null {
  if (!w.cscsCardNumber) return null;
  const parts = [w.cscsScheme || 'CSCS', maskCard(w.cscsCardNumber)];
  parts.push(w.cscsVerified ? 'Verified' : 'Not verified');
  if (w.cscsExpiry) {
    const e = w.cscsExpiry;
    parts.push(
      `Expires ${String(e.getUTCMonth() + 1).padStart(2, '0')}/${e.getUTCFullYear()}`,
    );
  }
  return parts.join(' · ');
}

/**
 * Assemble the record for one submission.
 *
 * Returns null when the submission does not exist. Access control is the
 * CALLER's job: the worker route scopes by workerId, the Platform route by
 * viewer site scope. Putting it here would mean two half-checks instead of one
 * real one at each entry point.
 */
export async function getInductionRecordData(
  submissionId: string,
): Promise<InductionRecordData | null> {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      worker: true,
      jobSite: { include: { cdmDutyHolders: true } },
      knowledgeCheckAttempt: true,
      inductionSource: { select: { checkedInAt: true } },
    },
  });
  if (!s) return null;

  // The exact checklist the operative answered — matched on the VERSION stored
  // against the submission, never the site's current one. This is what makes the
  // acknowledgements below a record of what was actually on screen.
  const checklist = await prisma.complianceChecklist.findFirst({
    where: { jobSiteId: s.jobSiteId, version: s.checklistVersion },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  const items = (checklist?.items ?? []).filter(
    (i) => !isRetiredInductionItem(i),
  );

  const answers = (s.answers ?? {}) as Record<string, unknown>;
  const acknowledgements: RecordAcknowledgement[] = items
    .filter((i) => i.type === ChecklistItemType.ACKNOWLEDGEMENT)
    .map((i) => ({ label: i.label, confirmed: answers[i.id] === true }));

  const ppe = items.filter((i) => i.type === ChecklistItemType.PPE_CONFIRM);
  const siteRules = items.filter((i) => i.type === ChecklistItemType.SITE_RULE);

  const [branding, logo] = await Promise.all([
    getCompanyBranding(),
    getCompanyLogo(),
  ]);

  const signatureImage = s.signatureBlobPath
    ? await downloadDocumentBlob(s.signatureBlobPath)
        .then((bytes) => (bytes ? { bytes, contentType: 'image/png' } : null))
        // A missing or unreadable signature blob must not fail the whole
        // document. The declaration block falls back to the typed name, and the
        // record is still a true statement of what was signed.
        .catch(() => null)
    : null;

  const address = [
    s.jobSite.addressLine1,
    s.jobSite.addressLine2,
    s.jobSite.town,
    s.jobSite.postcode,
  ].filter((x): x is string => Boolean(x && x.trim()));

  const kcAttempt = s.knowledgeCheckAttempt;
  const knowledgeCheck: InductionRecordData['induction']['knowledgeCheck'] =
    s.knowledgeCheckPassed
      ? 'passed'
      : s.knowledgeCheckSkipped
        ? 'not-required'
        : 'not-passed';

  return {
    documentReference: documentReference(
      s.jobSite.jobReference,
      s.checkedInAt,
      s.id,
    ),
    checkInReference: checkInReference(s.id),
    generatedAt: new Date(),
    company: {
      name: branding.companyName,
      tagline: branding.tagline,
      primaryColor: branding.primaryColor,
      logo,
    },
    operative: {
      name: s.worker.fullName,
      company: s.worker.company,
      cscs: cscsSummary(s.worker),
    },
    site: {
      name: s.jobSite.name,
      jobReference: s.jobSite.jobReference,
      address,
      principalContractor:
        s.jobSite.cdmDutyHolders?.principalContractor?.trim() || null,
    },
    induction: {
      completedAt: s.checkedInAt,
      version: s.checklistVersion,
      acknowledgements,
      ppeCount: ppe.length,
      ppeConfirmed: s.ppeConfirmed,
      siteRuleCount: siteRules.length,
      gdprConsent: s.gdprConsent,
      knowledgeCheck,
      knowledgeCheckCount: kcAttempt?.questionCount ?? null,
      carriedForwardFrom: s.inductionReused
        ? (s.inductionSource?.checkedInAt ?? null)
        : null,
    },
    declaration: {
      accepted: s.declarationAccepted,
      text: s.declarationText,
      signedName: s.signedName,
      signedAt: s.signedAt,
      signatureImage,
    },
  };
}
