import { prisma } from '@/lib/prisma';
import type { PermitQuestion } from '@/services/permits/permitFlow';

/**
 * Read side of the data-driven permit-type catalogue (SC-009). The worker request
 * UI is generic over these rows, so new permit types/questions need no code.
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

/** Active permit types for the "request a permit" picker, in display order. */
export async function listActivePermitTypes(): Promise<PermitTypeSummary[]> {
  const rows = await prisma.permitType.findMany({
    where: { active: true },
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

/** All active permit types with their ordered questions (for the request form). */
export async function listActivePermitTypesWithQuestions(): Promise<
  PermitTypeWithQuestions[]
> {
  const rows = await prisma.permitType.findMany({
    where: { active: true },
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

/** One active permit type with its ordered questions (for the request form). */
export async function getPermitTypeWithQuestions(
  permitTypeId: string,
): Promise<PermitTypeWithQuestions | null> {
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
