import { ChecklistItemType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Admin checklist (induction) builder operations, with versioning.
 *
 * Versioning rule: a checklist is edited in place UNTIL a worker has checked in
 * against it. Once submissions exist for the current version, saving creates a
 * NEW version (incremented) with the edited items, leaving the previous version
 * and its items intact. Submissions store the integer version they answered, so
 * historic check-ins always map back to the exact content the worker agreed to.
 */

export interface ChecklistItemInput {
  label?: string;
  helpText?: string | null;
  type?: string;
  required?: boolean;
}

export interface ValidatedItem {
  label: string;
  helpText: string | null;
  type: ChecklistItemType;
  required: boolean;
}

export type ChecklistErrors =
  | { ok: true; items: ValidatedItem[] }
  | { ok: false; error: string };

const VALID_TYPES = Object.values(ChecklistItemType) as string[];

/** Validate & normalise the submitted items (order comes from array position). */
export function validateChecklistItems(
  items: ChecklistItemInput[] | undefined,
): ChecklistErrors {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Add at least one checklist item.' };
  }
  if (items.length > 50) {
    return { ok: false, error: 'A checklist can have at most 50 items.' };
  }

  const validated: ValidatedItem[] = [];
  for (const [index, item] of items.entries()) {
    const label = (item.label ?? '').trim();
    if (label.length < 2) {
      return { ok: false, error: `Item ${index + 1} needs a label.` };
    }
    if (!item.type || !VALID_TYPES.includes(item.type)) {
      return { ok: false, error: `Item ${index + 1} has an invalid type.` };
    }
    validated.push({
      label,
      helpText: (item.helpText ?? '')?.toString().trim() || null,
      type: item.type as ChecklistItemType,
      required: item.required !== false,
    });
  }
  return { ok: true, items: validated };
}

/** The site's current (latest-version) checklist with ordered items. */
export async function getCurrentChecklist(siteId: string) {
  return prisma.complianceChecklist.findFirst({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    include: { items: { orderBy: { order: 'asc' } } },
  });
}

export interface SaveChecklistResult {
  version: number;
  newVersion: boolean;
}

/**
 * Save the edited checklist for a site. Creates a new version if the current one
 * already has submissions; otherwise edits the current version in place.
 */
export async function saveChecklist(
  siteId: string,
  items: ValidatedItem[],
): Promise<SaveChecklistResult> {
  const current = await getCurrentChecklist(siteId);

  const itemCreates = items.map((item, index) => ({
    label: item.label,
    helpText: item.helpText,
    type: item.type,
    required: item.required,
    order: index,
  }));

  // No checklist yet → create version 1.
  if (!current) {
    await prisma.complianceChecklist.create({
      data: {
        jobSiteId: siteId,
        title: 'Site induction & compliance checklist',
        version: 1,
        items: { create: itemCreates },
      },
    });
    return { version: 1, newVersion: true };
  }

  const submissionCount = await prisma.submission.count({
    where: { jobSiteId: siteId, checklistVersion: current.version },
  });

  // Current version is untouched by workers → edit in place.
  if (submissionCount === 0) {
    await prisma.$transaction([
      prisma.checklistItem.deleteMany({ where: { checklistId: current.id } }),
      prisma.complianceChecklist.update({
        where: { id: current.id },
        data: { items: { create: itemCreates } },
      }),
    ]);
    return { version: current.version, newVersion: false };
  }

  // Workers have checked in against this version → publish a new version.
  const nextVersion = current.version + 1;
  await prisma.complianceChecklist.create({
    data: {
      jobSiteId: siteId,
      title: current.title,
      version: nextVersion,
      items: { create: itemCreates },
    },
  });
  return { version: nextVersion, newVersion: true };
}
