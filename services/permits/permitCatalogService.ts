import { prisma } from '@/lib/prisma';
import type { PermitQuestion } from '@/services/permits/permitFlow';
import { disabledPermitTypeIds } from '@/services/siteServices/siteServiceAvailability';

/**
 * Read side of the data-driven permit-type catalogue (SC-009). The worker request
 * UI is generic over these rows, so new permit types/questions need no code.
 *
 * SC-021: every read is now SITE-SCOPED. The catalogue is organisation-wide but
 * availability is per site, so a worker on a site where hot works were switched
 * off never sees that type. `siteId` is REQUIRED rather than optional — an
 * optional parameter would let a caller silently fall back to the unfiltered
 * list, which is precisely the bug SC-021 exists to fix.
 */

export interface PermitTypeSummary {
  id: string;
  key: string;
  name: string;
  iconKey: string;
  description: string | null;
}

export interface PermitTypeWithQuestions extends PermitTypeSummary {
  questions: PermitQuestion[];
}

/** Available permit types for a site's "request a permit" picker, in order. */
export async function listActivePermitTypes(
  siteId: string,
): Promise<PermitTypeSummary[]> {
  const disabled = await disabledPermitTypeIds(siteId);
  const rows = await prisma.permitType.findMany({
    where: { active: true, id: { notIn: [...disabled] } },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      key: true,
      name: true,
      iconKey: true,
      description: true,
    },
  });
  return rows;
}

/** A site's available permit types with their ordered questions (request form). */
export async function listActivePermitTypesWithQuestions(
  siteId: string,
): Promise<PermitTypeWithQuestions[]> {
  const disabled = await disabledPermitTypeIds(siteId);
  const rows = await prisma.permitType.findMany({
    where: { active: true, id: { notIn: [...disabled] } },
    orderBy: { order: 'asc' },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  return rows.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    iconKey: t.iconKey,
    description: t.description,
    questions: t.questions.map((q) => ({
      id: q.id,
      label: q.label,
      helpText: q.helpText,
      type: q.type,
      required: q.required,
    })),
  }));
}

/** One permit type available to a site, with its ordered questions. */
export async function getPermitTypeWithQuestions(
  permitTypeId: string,
  siteId: string,
): Promise<PermitTypeWithQuestions | null> {
  const disabled = await disabledPermitTypeIds(siteId);
  if (disabled.has(permitTypeId)) return null;
  const t = await prisma.permitType.findFirst({
    where: { id: permitTypeId, active: true },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  if (!t) return null;
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    iconKey: t.iconKey,
    description: t.description,
    questions: t.questions.map((q) => ({
      id: q.id,
      label: q.label,
      helpText: q.helpText,
      type: q.type,
      required: q.required,
    })),
  };
}
