import { EvidenceGallery } from '@/components/platform/EvidenceGallery';
import type { EvidenceView } from '@/services/actions/actionEvidenceService';

/**
 * Evidence (photos / documents) attached to an action — a thin wrapper around the
 * shared <EvidenceGallery> so Action and Finding evidence look and behave alike.
 * Anyone who can see the action sees the list and can view/download; roles with
 * the actions "edit" permission can upload and remove.
 */
export function ActionEvidencePanel({
  actionId,
  evidence,
  canManage,
}: {
  actionId: string;
  evidence: EvidenceView[];
  canManage: boolean;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <EvidenceGallery
        basePath={`/api/platform/actions/${actionId}/evidence`}
        evidence={evidence}
        canManage={canManage}
      />
    </section>
  );
}
