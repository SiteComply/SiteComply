import { SectionPreview } from '@/components/platform/SectionPreview';

export const dynamic = 'force-dynamic';

export default function PlatformAuditsPage() {
  return (
    <SectionPreview
      title="Audits"
      description="Site inspections and audit trails across your organisation."
      icon="shield"
      module="audits"
    />
  );
}
