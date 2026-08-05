import { EvidenceGallery } from '@/components/platform/EvidenceGallery';
import { Panel } from '@/components/platform/Panel';
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
    // No surface of its own: this now sits INSIDE the action's record panel, and
    // a panel within a panel would put a border around a group that already has
    // a heading and a rule above it.
    <Panel tone="flat" padding="none">
      <EvidenceGallery
        basePath={`/api/platform/actions/${actionId}/evidence`}
        evidence={evidence}
        canManage={canManage}
      />
    </Panel>
  );
}
