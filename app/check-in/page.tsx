import { redirect } from 'next/navigation';
import { CheckInForm } from '@/components/checkin/CheckInForm';
import { getWorkerContext } from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker check-in entry (SC-004 recognition).
 *
 * If the worker still has a valid session AND an open check-in, they are already
 * on site — send them straight to their Worker Dashboard rather than back through
 * SMS verification. Identity stays gated by OTP: this only skips it for a worker
 * whose session is still valid and who is genuinely checked in. Everyone else
 * gets the normal verify-your-mobile flow.
 */
export default async function CheckInPage() {
  const context = await getWorkerContext();
  if (context) redirect('/worker/dashboard');

  return <CheckInForm />;
}
