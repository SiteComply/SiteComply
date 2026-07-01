import { SectionPreview } from '@/components/platform/SectionPreview';

export const dynamic = 'force-dynamic';

export default function PlatformDocumentsPage() {
  return (
    <SectionPreview
      title="Documents"
      description="Method statements, risk assessments and site paperwork."
      icon="doc"
      module="documents"
    />
  );
}
