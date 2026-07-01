import { SectionPreview } from '@/components/platform/SectionPreview';

export const dynamic = 'force-dynamic';

export default function PlatformReportsPage() {
  return (
    <SectionPreview
      title="Reports"
      description="Scheduled and on-demand compliance reporting."
      icon="chart"
      module="reports"
    />
  );
}
