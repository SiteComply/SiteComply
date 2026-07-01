import { SectionPreview } from '@/components/platform/SectionPreview';

export const dynamic = 'force-dynamic';

export default function PlatformSubmissionsPage() {
  return (
    <SectionPreview
      title="Submissions"
      description="Check-in and induction records across all your sites."
      icon="clipboard"
      module="checkins"
    />
  );
}
