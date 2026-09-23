import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { InductionWizard } from '@/components/checkin/InductionWizard';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getActiveSiteWithChecklist } from '@/services/sites/siteService';
import { canWorkerCheckIn } from '@/services/workerAccess/workerAssignmentService';
import { getInductionSignatureRequired } from '@/services/inductionSignature/signatureService';
import type { FlowItem } from '@/services/checklists/inductionFlow';
import { getInductionBriefing } from '@/services/induction/inductionBriefingService';
import { companyForAssignment } from '@/services/companies/siteCompanyService';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — step 4: the digital induction itself.
 *
 * Loads the site's current checklist server-side and hands plain, serialisable
 * items to the client wizard, which renders one question per screen.
 */
export default async function InductionPage({
  params,
}: {
  params: { siteId: string };
}) {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) redirect('/check-in/details');

  const site = await getActiveSiteWithChecklist(params.siteId);
  if (!site) redirect('/check-in/site');

  // Same gate as the landing page, so arriving here by URL cannot walk past it.
  // Redirect rather than repeat the message: the landing page owns the wording,
  // so there is one place to change it and one place to read it.
  const access = await canWorkerCheckIn(worker.id, site.id);
  if (!access.allowed) redirect(`/check-in/site/${site.id}`);

  // Map Prisma items to the wizard's plain shape (nothing server-only crosses).
  const items: FlowItem[] = (site.checklist?.items ?? []).map((i) => ({
    id: i.id,
    label: i.label,
    helpText: i.helpText,
    type: i.type,
    required: i.required,
  }));

  // SC-011: does this site require a digital signature to complete the induction?
  // Their employer on this project: the briefing links their company's RAMS and
  // anything site-wide, never another contractor's.
  const siteCompany = await companyForAssignment(worker.id, site.id);
  const [signatureRequired, briefing] = await Promise.all([
    getInductionSignatureRequired(site.id),
    // The site briefing, shown before the acknowledgements that refer to it.
    // Built only from data already held; nothing new is asked of the manager.
    getInductionBriefing(site.id, site.name, siteCompany?.id ?? null),
  ]);

  return (
    <AppShell>
      <Steps current="Induction" />
      <InductionWizard
        siteId={site.id}
        siteName={site.name}
        items={items}
        workerName={worker.fullName}
        inductionVersion={site.checklist?.version ?? 1}
        signatureRequired={signatureRequired}
        briefing={briefing}
      />
    </AppShell>
  );
}
