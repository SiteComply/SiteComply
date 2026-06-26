import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ChecklistBuilder,
  type BuilderItemData,
} from '@/components/admin/ChecklistBuilder';
import { getSiteById } from '@/services/sites/adminSiteService';
import { getCurrentChecklist } from '@/services/checklists/adminChecklistService';
import { UK_INDUCTION_TEMPLATE } from '@/services/checklists/ukInductionTemplate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Per-site induction & compliance checklist builder. Loads the current version's
 * items and the UK template as plain data for the client builder. Edits drive
 * the worker induction immediately (versioned to preserve historic check-ins).
 */
export default async function ChecklistBuilderPage({
  params,
}: {
  params: { id: string };
}) {
  const site = await getSiteById(params.id);
  if (!site) notFound();

  const current = await getCurrentChecklist(params.id);
  const version = current?.version ?? 1;

  const hasSubmissions = current
    ? (await prisma.submission.count({
        where: { jobSiteId: params.id, checklistVersion: current.version },
      })) > 0
    : false;

  const initialItems: BuilderItemData[] = (current?.items ?? []).map((i) => ({
    label: i.label,
    helpText: i.helpText ?? '',
    type: i.type,
    required: i.required,
  }));

  const template: BuilderItemData[] = UK_INDUCTION_TEMPLATE.map((t) => ({
    label: t.label,
    helpText: t.helpText ?? '',
    type: t.type,
    required: t.required,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/sites"
          className="text-sm font-semibold text-brand-700"
        >
          ← Back to job sites
        </Link>
        <h1 className="text-2xl font-bold text-ink">Induction checklist</h1>
        <p className="text-ink-muted">
          {site.name} · {site.jobReference}
        </p>
      </header>

      <ChecklistBuilder
        siteId={site.id}
        currentVersion={version}
        hasSubmissions={hasSubmissions}
        initialItems={initialItems}
        template={template}
      />
    </div>
  );
}
