import { ReactNode } from 'react';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';

export const dynamic = 'force-dynamic';

/**
 * Gate for the whole Platform dashboard area. Requires a signed-in, ACTIVE
 * platform user; otherwise redirects to Platform Login. Every page under here
 * then scopes its data to the viewer's accessible sites.
 */
export default async function PlatformDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePlatformViewer();
  return <>{children}</>;
}
