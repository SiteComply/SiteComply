import type { PrismaClient } from '@prisma/client';

/**
 * The seeded Permit to Work catalogue (SC-009).
 *
 * This is DATA. New permit types (or new questions on a type) are added by
 * editing this list and re-running the idempotent seeder — no schema change and
 * no code change to the request/render/approve flow, which are all generic over
 * the catalogue. `seedPermitTypes` upserts each type by `key` and rewrites its
 * questions, so the seed can be re-run safely on every deploy. Historic permits
 * are unaffected because a permit snapshots each answered question's label + type
 * into `Permit.answers` at submission time.
 */

export type SeedQuestionType = 'ACKNOWLEDGEMENT' | 'YES_NO' | 'TEXT' | 'DATE';

export interface SeedQuestion {
  label: string;
  helpText?: string;
  type: SeedQuestionType;
  required?: boolean;
}

export interface SeedPermitType {
  key: string;
  name: string;
  referencePrefix: string;
  iconKey: string;
  description: string;
  questions: SeedQuestion[];
}

/** The REV-1 standard permit types (extensible — add entries here). */
export const PERMIT_CATALOG: SeedPermitType[] = [
  {
    key: 'HOT_WORKS',
    name: 'Hot Works',
    referencePrefix: 'HW',
    iconKey: 'fire',
    description:
      'Welding, cutting, grinding or any work producing heat, sparks or flame.',
    questions: [
      {
        label: 'A suitable fire extinguisher is available at the work location',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Combustible materials have been removed or protected',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label:
          'A fire watch will be maintained during the work and for 60 minutes after',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Gas cylinders (if used) are secured and in good condition',
        type: 'YES_NO',
        required: false,
      },
    ],
  },
  {
    key: 'ELECTRICAL_ISOLATION',
    name: 'Electrical Isolation',
    referencePrefix: 'EI',
    iconKey: 'alert',
    description: 'Isolating electrical circuits or equipment before work.',
    questions: [
      {
        label: 'The circuit has been isolated and locked off',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label:
          'The circuit has been proved dead with an approved voltage tester',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Isolation point / lock-off reference',
        helpText: 'e.g. DB-3, Circuit 12',
        type: 'TEXT',
      },
    ],
  },
  {
    key: 'WORKING_AT_HEIGHT',
    name: 'Working at Height',
    referencePrefix: 'WAH',
    iconKey: 'building',
    description:
      'Any work where a fall could cause injury (scaffold, MEWP, ladders, roofs).',
    questions: [
      {
        label: 'Access equipment has been inspected and tagged/certified',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Fall protection or edge protection is in place',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'An exclusion zone below the work has been established',
        type: 'YES_NO',
      },
    ],
  },
  {
    key: 'CONFINED_SPACES',
    name: 'Confined Spaces',
    referencePrefix: 'CS',
    iconKey: 'alert',
    description: 'Entry into tanks, chambers, ducts or other confined spaces.',
    questions: [
      {
        label: 'The atmosphere has been tested and is safe to enter',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'A rescue plan and a standby person are in place',
        type: 'ACKNOWLEDGEMENT',
      },
      { label: 'Continuous atmospheric monitoring is in use', type: 'YES_NO' },
    ],
  },
  {
    key: 'EXCAVATION',
    name: 'Excavation',
    referencePrefix: 'EX',
    iconKey: 'clipboard',
    description: 'Digging trenches, pits or other excavations.',
    questions: [
      {
        label: 'Underground services have been located and marked (CAT scan)',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'The excavation is supported or battered as required',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Approximate depth of excavation (m)',
        type: 'TEXT',
        required: false,
      },
    ],
  },
  {
    key: 'ROOF_ACCESS',
    name: 'Roof Access',
    referencePrefix: 'RA',
    iconKey: 'building',
    description:
      'Accessing a roof for inspection, maintenance or installation.',
    questions: [
      {
        label: 'The roof condition has been assessed as safe to access',
        type: 'ACKNOWLEDGEMENT',
      },
      { label: 'Fall protection is in place', type: 'ACKNOWLEDGEMENT' },
      { label: 'Weather conditions are suitable for the work', type: 'YES_NO' },
    ],
  },
  {
    key: 'LIVE_ELECTRICAL_WORKING',
    name: 'Live Electrical Working',
    referencePrefix: 'LEW',
    iconKey: 'alert',
    description: 'Working on or near live electrical conductors.',
    questions: [
      {
        label: 'Live working is justified and has been risk-assessed',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'A competent person and insulated tools are being used',
        type: 'ACKNOWLEDGEMENT',
      },
      { label: 'A second person is present', type: 'YES_NO' },
    ],
  },
  {
    key: 'BREAKING_GROUND',
    name: 'Breaking Ground',
    referencePrefix: 'BG',
    iconKey: 'clipboard',
    description:
      'Breaking ground or penetrating surfaces (drilling, coring, piling).',
    questions: [
      {
        label: 'Services have been located and marked before breaking ground',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Permit-to-dig checks have been completed',
        type: 'ACKNOWLEDGEMENT',
      },
      {
        label: 'Method of excavation / penetration',
        type: 'TEXT',
        required: false,
      },
    ],
  },
];

/**
 * Idempotently seed/refresh the permit-type catalogue. Upserts each type by
 * `key` and rewrites its questions to match this file. Safe to run repeatedly
 * (e.g. on every deploy).
 */
export async function seedPermitTypes(prisma: PrismaClient): Promise<number> {
  let n = 0;
  for (let i = 0; i < PERMIT_CATALOG.length; i++) {
    const t = PERMIT_CATALOG[i];
    const type = await prisma.permitType.upsert({
      where: { key: t.key },
      create: {
        key: t.key,
        name: t.name,
        referencePrefix: t.referencePrefix,
        iconKey: t.iconKey,
        description: t.description,
        order: i,
        active: true,
        isSystem: true,
      },
      update: {
        name: t.name,
        referencePrefix: t.referencePrefix,
        iconKey: t.iconKey,
        description: t.description,
        order: i,
      },
      select: { id: true },
    });
    // Rewrite questions to match the catalogue (answers are snapshotted on the
    // permit, so question-id churn never affects historic permits).
    await prisma.permitTypeQuestion.deleteMany({
      where: { permitTypeId: type.id },
    });
    await prisma.permitTypeQuestion.createMany({
      data: t.questions.map((q, qi) => ({
        permitTypeId: type.id,
        label: q.label,
        helpText: q.helpText ?? null,
        type: q.type,
        required: q.required ?? true,
        order: qi,
      })),
    });
    n++;
  }
  return n;
}
