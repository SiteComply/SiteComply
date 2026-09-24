import { prisma } from '@/lib/prisma';
import {
  getCompanyBranding,
  getCompanyLogo,
} from '@/services/company/companyConfigService';
import { effectiveStatus } from '@/services/permits/permitService';
import {
  permitStatusLabel,
  type PermitStatusValue,
} from '@/services/permits/permitConstants';
import type { AnsweredQuestion } from '@/services/permits/permitFlow';

/**
 * Everything the permit document says, gathered once.
 *
 * ── A PERMIT IS AN AUTHORISATION, SO THE DOCUMENT LEADS WITH ITS LIMITS ───
 *
 * An induction record says something happened. A permit says something MAY
 * happen - but only this work, only here, only between these times, and only on
 * these conditions. A permit-to-work printed without its window, or one that
 * looks approved after it has expired, is worse than no permit at all: it is a
 * piece of paper that says work is authorised when it is not.
 *
 * So the state is DERIVED at generation time by the same `effectiveStatus` the
 * screens use - an approved permit past its validUntil is EXPIRED here too -
 * and the document is stamped with the moment it was produced.
 *
 * ── ONE REFERENCE, THE ONE PEOPLE ALREADY QUOTE ───────────────────────────
 *
 * The induction record derives its own document reference because a check-in
 * has no human code. A permit already has one, printed on the screen and quoted
 * on site: "HW-260728-001". Inventing a second reference for the same object
 * would mean two numbers for one permit and a conversation about which is which.
 */

export interface PermitRecordAnswer {
  label: string;
  value: string;
  /** A "no" to a safety question is worth seeing at a glance. */
  negative: boolean;
}

export interface PermitRecordEvent {
  at: Date;
  what: string;
  who: string | null;
  note: string | null;
}

export interface PermitRecordData {
  /** The permit's own reference — not a second, invented one. */
  reference: string;
  generatedAt: Date;

  company: {
    name: string;
    tagline: string | null;
    primaryColor: string;
    logo: { bytes: Buffer; contentType: string } | null;
  };

  status: {
    value: PermitStatusValue;
    label: string;
    /** True only when the work is authorised AS THE DOCUMENT IS PRODUCED. */
    authorised: boolean;
    /** The one sentence a reader needs about whether work may proceed. */
    statement: string;
  };

  work: {
    permitTypeName: string;
    activity: string;
    location: string | null;
    proposedStart: Date | null;
    proposedFinish: Date | null;
  };

  validity: { from: Date | null; until: Date | null };

  operative: { name: string; company: string | null };

  site: {
    name: string;
    jobReference: string;
    address: string[];
    principalContractor: string | null;
  };

  conditions: PermitRecordAnswer[];

  authorisation: {
    submittedBy: string;
    submittedAt: Date;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    rejectedBy: string | null;
    rejectedAt: Date | null;
    rejectionReason: string | null;
    cancelledAt: Date | null;
    closedBy: string | null;
    closedAt: Date | null;
  };

  history: PermitRecordEvent[];
}

/** An answer as words, never a raw stored value. */
export function formatAnswer(a: AnsweredQuestion): PermitRecordAnswer {
  const v = a.value;
  if (typeof v === 'boolean') {
    return { label: a.label, value: v ? 'Yes' : 'No', negative: !v };
  }
  const text = String(v ?? '').trim();
  const lower = text.toLowerCase();
  return {
    label: a.label,
    // "Not answered" rather than an empty line: a blank on a permit reads as an
    // oversight by whoever printed it, which is the wrong thing to wonder about.
    value: text || 'Not answered',
    negative: lower === 'no' || lower === 'false',
  };
}

/**
 * What the document says about whether work may proceed.
 *
 * Written out in full for every state, because this is the sentence a reader
 * acts on. "Expired" alone invites "expired but still fine, surely?"
 */
function statement(status: PermitStatusValue, validUntil: Date | null): string {
  switch (status) {
    case 'APPROVED':
      return validUntil
        ? 'This work is authorised until the time shown below.'
        : 'This work is authorised.';
    case 'EXPIRED':
      return 'This permit has expired. The work it authorised may NOT continue under it.';
    case 'REJECTED':
      return 'This permit was refused. The work it describes is NOT authorised.';
    case 'CANCELLED':
      return 'This permit was cancelled. The work it describes is NOT authorised.';
    case 'CLOSED':
      return 'This permit has been closed. The work it authorised is complete.';
    case 'UNDER_REVIEW':
      return 'This permit is being reviewed. The work is NOT yet authorised.';
    default:
      return 'This permit is awaiting approval. The work is NOT yet authorised.';
  }
}

const EVENT_WORDS: Record<string, string> = {
  SUBMITTED: 'Requested',
  COMMENT: 'Comment',
  STATUS_CHANGE: 'Status changed',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
};

/**
 * Load one permit as a document.
 *
 * The CALLER decides who may see it — the worker route scopes by worker, the
 * platform route by the viewer's assigned sites — so this asks only for the
 * permit and never for a session.
 */
export async function loadPermitRecord(
  permitId: string,
  now = new Date(),
): Promise<PermitRecordData | null> {
  const permit = await prisma.permit.findUnique({
    where: { id: permitId },
    include: {
      activities: { orderBy: { createdAt: 'asc' } },
      worker: { select: { fullName: true, company: true } },
      jobSite: {
        select: {
          name: true,
          jobReference: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          postcode: true,
          // The accountable party lives on the CDM duty-holders record, not the
          // site row — the same place the induction record reads it from.
          cdmDutyHolders: { select: { principalContractor: true } },
        },
      },
    },
  });
  if (!permit) return null;

  const [branding, logo] = await Promise.all([
    getCompanyBranding(),
    getCompanyLogo(),
  ]);

  const value = effectiveStatus({
    status: permit.status,
    validUntil: permit.validUntil,
  });
  const answers = (permit.answers as unknown as AnsweredQuestion[]) ?? [];

  return {
    reference: permit.reference,
    generatedAt: now,
    company: {
      name: branding.companyName,
      tagline: branding.tagline ?? null,
      primaryColor: branding.primaryColor,
      logo,
    },
    status: {
      value,
      label: permitStatusLabel(value),
      authorised: value === 'APPROVED',
      statement: statement(value, permit.validUntil),
    },
    work: {
      permitTypeName: permit.permitTypeName,
      activity: permit.workActivity,
      location: permit.workLocation,
      proposedStart: permit.proposedStart,
      proposedFinish: permit.proposedFinish,
    },
    validity: { from: permit.validFrom, until: permit.validUntil },
    operative: {
      name: permit.worker.fullName,
      company: permit.worker.company ?? null,
    },
    site: {
      name: permit.jobSite.name,
      jobReference: permit.jobSite.jobReference,
      address: [
        permit.jobSite.addressLine1,
        permit.jobSite.addressLine2,
        permit.jobSite.town,
        permit.jobSite.postcode,
      ]
        .map((l) => (l ?? '').trim())
        .filter(Boolean),
      principalContractor:
        permit.jobSite.cdmDutyHolders?.principalContractor?.trim() || null,
    },
    conditions: answers.map(formatAnswer),
    authorisation: {
      submittedBy: permit.submittedByName,
      submittedAt: permit.submittedAt,
      reviewedBy: permit.reviewedByName,
      reviewedAt: permit.reviewedAt,
      approvedBy: permit.approvedByName,
      approvedAt: permit.approvedAt,
      rejectedBy: permit.rejectedByName,
      rejectedAt: permit.rejectedAt,
      rejectionReason: permit.rejectionReason,
      cancelledAt: permit.cancelledAt,
      closedBy: permit.closedByName,
      closedAt: permit.closedAt,
    },
    history: permit.activities.map((a) => ({
      at: a.createdAt,
      what: EVENT_WORDS[a.type] ?? a.type.replace(/_/g, ' ').toLowerCase(),
      who: a.authorName,
      note: a.note,
    })),
  };
}

/**
 * The filename a reader ends up with, and very likely files months later. It
 * has to say what the document is without being opened.
 */
export function permitRecordFilename(data: PermitRecordData): string {
  const safe = (v: string) =>
    v.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'permit';
  return `Permit-${safe(data.reference)}-${safe(data.site.name)}.pdf`;
}
