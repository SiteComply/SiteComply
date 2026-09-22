import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { canWorkerCheckIn } from '@/services/workerAccess/workerAssignmentService';

/**
 * May the signed-in operative read this site's induction briefing?
 *
 * EXACTLY the induction page's own test: a worker session, a worker record,
 * and canWorkerCheckIn() for this site. The briefing's site map and RAMS are
 * read BEFORE check-in, so the checked-in-only routes used on the dashboard
 * cannot serve them - but nor may anyone the induction itself would turn away.
 */
export async function inductionReaderFor(
  siteId: string,
): Promise<{ workerId: string } | null> {
  const session = getWorkerSession();
  if (!session) return null;
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) return null;
  const access = await canWorkerCheckIn(worker.id, siteId);
  return access.allowed ? { workerId: worker.id } : null;
}
