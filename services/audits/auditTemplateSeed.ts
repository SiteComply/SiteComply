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
