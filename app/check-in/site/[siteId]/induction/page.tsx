import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { InductionWizard } from '@/components/checkin/InductionWizard';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getActiveSiteWithChecklist } from '@/services/sites/siteService';
import type { FlowItem } from '@/services/checklists/inductionFlow';

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

  // Map Prisma items to the wizard's plain shape (nothing server-only crosses).
  const items: FlowItem[] = (site.checklist?.items ?? []).map((i) => ({
    id: i.id,
    label: i.label,
    helpText: i.helpText,
    type: i.type,
    required: i.required,
  }));

  return (
    <AppShell>
      <Steps current="Induction" />
      <InductionWizard siteId={site.id} siteName={site.name} items={items} />
    </AppShell>
  );
}
