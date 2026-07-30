import type { PrismaClient } from '@prisma/client';

/**
 * The seeded starter Audit Template library (SC-013). DATA — a small set of
 * standard audit formats every organisation gets on day one. Editable/extendable
 * via the template library UI (these are marked isSystem). `seedAuditTemplates`
 * upserts by name and rewrites items, so it is safe to re-run on every deploy.
 * Historic audits are unaffected (an audit copies items at creation time).
 */

type SeverityKey = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type CategoryKey =
  | 'SAFETY'
  | 'ENVIRONMENTAL'
  | 'QUALITY'
  | 'DOCUMENTATION'
  | 'OTHER';

interface SeedItem {
  label: string;
  helpText?: string;
  category: CategoryKey;
  defaultSeverity?: SeverityKey;
}

interface SeedTemplate {
  name: string;
  description: string;
  items: SeedItem[];
}

export const AUDIT_TEMPLATE_LIBRARY: SeedTemplate[] = [
  {
    name: 'Site Safety Inspection',
    description:
      'A general site safety walkaround covering access, welfare, PPE and site controls.',
    items: [
      {
        label: 'Site access and egress are safe and controlled',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Edge protection and barriers are in place where required',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Scaffolding is tagged and in good condition',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Fire points and extinguishers are present and unobstructed',
        category: 'SAFETY',
        defaultSeverity: 'MEDIUM',
      },
      {
        label: 'First aid provision and signage are adequate',
        category: 'SAFETY',
        defaultSeverity: 'MEDIUM',
      },
      {
        label: 'Welfare facilities are clean and adequately stocked',
        category: 'ENVIRONMENTAL',
        defaultSeverity: 'LOW',
      },
      {
        label: 'Emergency procedures and assembly points are displayed',
        category: 'DOCUMENTATION',
        defaultSeverity: 'MEDIUM',
      },
    ],
  },
  {
    name: 'Housekeeping',
    description: 'Cleanliness, storage and waste management across the site.',
    items: [
      {
        label: 'Walkways and stairs are clear of obstructions and trip hazards',
        category: 'SAFETY',
        defaultSeverity: 'MEDIUM',
      },
      {
        label: 'Materials are stored safely and tidily',
        category: 'QUALITY',
        defaultSeverity: 'LOW',
      },
      {
        label: 'Waste is segregated and skips are not overfilled',
        category: 'ENVIRONMENTAL',
        defaultSeverity: 'LOW',
      },
      {
        label:
          'Spill kits are available where needed and spills are cleaned up',
        category: 'ENVIRONMENTAL',
        defaultSeverity: 'MEDIUM',
      },
      {
        label: 'Cables and leads are managed to prevent trip hazards',
        category: 'SAFETY',
        defaultSeverity: 'MEDIUM',
      },
      {
        label: 'Work areas are left clean and tidy at the end of tasks',
        category: 'QUALITY',
        defaultSeverity: 'LOW',
      },
    ],
  },
  {
    name: 'PPE Compliance',
    description:
      'Provision, condition and correct use of personal protective equipment.',
    items: [
      {
        label: 'All operatives are wearing a hard hat',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'All operatives are wearing hi-vis clothing',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Safety footwear is worn by everyone on site',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label:
          'Task-specific PPE (gloves, eye/ear protection) is worn where required',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'PPE is in good condition and correctly fitted',
        category: 'QUALITY',
        defaultSeverity: 'MEDIUM',
      },
      {
        label: 'Spare PPE is available for visitors and replacements',
        category: 'DOCUMENTATION',
        defaultSeverity: 'LOW',
      },
    ],
  },
  // --- SC-020: the recurring compliance activities shown in the REV-1
  // Compliance Calendar example. In Phase 1 the schedulable unit IS an audit
  // template, so these double as the calendar's activity types. Deliberately
  // short checklists — a Daily Safe Start that takes ten minutes gets done; a
  // thirty-item one gets skipped.
  {
    name: 'Daily Safe Start',
    description:
      'Short start-of-shift check before work begins — the daily activity in the compliance calendar.',
    items: [
      {
        label: 'Work area is safe to start and free of new hazards',
        category: 'SAFETY',
      },
      { label: 'Everyone on the task has the correct PPE', category: 'SAFETY' },
      {
        label: 'Permits and RAMS for today\u2019s work are in place',
        category: 'DOCUMENTATION',
      },
      {
        label: 'Plant and equipment for today has been checked',
        category: 'SAFETY',
      },
      {
        label: 'Emergency arrangements briefed to the team',
        category: 'SAFETY',
      },
    ],
  },
  {
    name: 'Fire Point Check',
    description:
      'Weekly check of fire points, extinguishers, alarms and escape routes.',
    items: [
      {
        label: 'Fire points are present, signed and unobstructed',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Extinguishers are in date and seals intact',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Alarm / call points are operational',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Escape routes are clear and signed',
        category: 'SAFETY',
        defaultSeverity: 'CRITICAL',
      },
      {
        label: 'Assembly point signage is visible and correct',
        category: 'SAFETY',
      },
    ],
  },
  {
    name: 'Scaffold Inspection',
    description:
      'Statutory scaffold inspection — record and tag. Required at least every 7 days and after alteration or bad weather.',
    items: [
      {
        label: 'Scafftag present, current and signed',
        category: 'DOCUMENTATION',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Base plates, sole boards and footings sound',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Guardrails, toe boards and brick guards complete',
        category: 'SAFETY',
        defaultSeverity: 'CRITICAL',
      },
      {
        label: 'Ties, bracing and couplers secure',
        category: 'SAFETY',
        defaultSeverity: 'CRITICAL',
      },
      {
        label: 'Platforms fully boarded, clean and free of debris',
        category: 'SAFETY',
      },
      {
        label: 'Safe access (ladders / stair towers) in place',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'No unauthorised alterations since the last inspection',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
    ],
  },
  {
    name: 'MEWP Inspection',
    description:
      'Mobile elevating work platform pre-use and periodic checks, including LOLER paperwork.',
    items: [
      {
        label: 'LOLER thorough examination certificate in date',
        category: 'DOCUMENTATION',
        defaultSeverity: 'CRITICAL',
      },
      {
        label: 'Pre-use inspection recorded by the operator',
        category: 'DOCUMENTATION',
      },
      {
        label: 'Operator holds a valid IPAF (or equivalent) card',
        category: 'DOCUMENTATION',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Harness and lanyard in date and worn where required',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Controls, emergency lowering and alarms function',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      {
        label: 'Ground conditions and exclusion zone suitable',
        category: 'SAFETY',
      },
      {
        label: 'Rescue plan in place and understood',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
    ],
  },
  {
    name: 'Welfare Inspection',
    description:
      'Weekly welfare check — Schedule 2 CDM 2015 facilities in a clean and usable state.',
    items: [
      {
        label: 'Toilets clean, stocked and in working order',
        category: 'SAFETY',
      },
      {
        label: 'Washing facilities with hot and cold water available',
        category: 'SAFETY',
      },
      { label: 'Drinking water available and signed', category: 'SAFETY' },
      {
        label: 'Rest area clean, heated and adequate for numbers',
        category: 'SAFETY',
      },
      { label: 'Drying room / changing facilities usable', category: 'SAFETY' },
      {
        label: 'First aid provision stocked and signed',
        category: 'SAFETY',
        defaultSeverity: 'HIGH',
      },
      { label: 'Waste removed and area tidy', category: 'ENVIRONMENTAL' },
    ],
  },
  {
    name: 'Toolbox Talk',
    description:
      'Supervisor-delivered briefing, recorded as a scheduled activity. SC-018 removed the toolbox-talk question from the worker induction precisely because these are delivered separately — this is where they belong.',
    items: [
      {
        label: 'Topic covered and relevant to current works',
        category: 'DOCUMENTATION',
      },
      {
        label: 'Attendance recorded',
        category: 'DOCUMENTATION',
        defaultSeverity: 'MEDIUM',
      },
      { label: 'Questions raised were answered', category: 'DOCUMENTATION' },
      { label: 'Actions arising have been raised', category: 'DOCUMENTATION' },
    ],
  },
];

/** Idempotently seed/refresh the starter audit templates. */
export async function seedAuditTemplates(
  prisma: PrismaClient,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < AUDIT_TEMPLATE_LIBRARY.length; i++) {
    const t = AUDIT_TEMPLATE_LIBRARY[i];
    const existing = await prisma.auditTemplate.findFirst({
      where: { name: t.name, isSystem: true },
      select: { id: true },
    });
    const tpl = existing
      ? await prisma.auditTemplate.update({
          where: { id: existing.id },
          data: { description: t.description, order: i, active: true },
          select: { id: true },
        })
      : await prisma.auditTemplate.create({
          data: {
            name: t.name,
            description: t.description,
            order: i,
            isSystem: true,
            active: true,
            createdByName: 'SiteComply',
          },
          select: { id: true },
        });
    await prisma.auditTemplateItem.deleteMany({
      where: { templateId: tpl.id },
    });
    await prisma.auditTemplateItem.createMany({
      data: t.items.map((it, idx) => ({
        templateId: tpl.id,
        label: it.label,
        helpText: it.helpText ?? null,
        category: it.category,
        defaultSeverity: it.defaultSeverity ?? null,
        order: idx,
      })),
    });
    n++;
  }
  return n;
}
