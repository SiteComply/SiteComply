import { SectionPreview } from '@/components/platform/SectionPreview';

export const dynamic = 'force-dynamic';

export default function PlatformActionsPage() {
  return (
    <SectionPreview
      title="Actions"
      description="Outstanding tasks and follow-ups that need your attention."
      icon="bolt"
      module="actions"
    />
  );
}
