import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { getFindingForViewer } from '@/services/audits/findingService';
import {
  uploadDocumentBlob,
  downloadDocumentBlob,
  deleteDocumentBlob,
} from '@/services/documents/blobStorage';
import type { EvidenceView } from '@/services/actions/actionEvidenceService';

/**
 * Evidence (photos / documents) attached to an audit finding.
 *
 * A direct mirror of the Action evidence feature — same private blob container
 * (under a `findings/<findingId>/` prefix), same validation, same EvidenceView
 * shape — so the UI and behaviour stay consistent. Every operation is site-scoped
 * through the parent audit (getFindingForViewer resolves `audit.jobSiteId ∈
 * siteIds`), and role checks (audits "view" to download, "edit" to upload/delete)
 * live in the routes; the site boundary is enforced here as defence in depth.
 */

export { validateEvidenceFile } from '@/services/actions/actionEvidenceService';

function buildEvidenceBlobPath(findingId: string, fileName: string): string {
  const safe = (fileName || 'evidence')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-80);
  return `findings/${findingId}/${randomUUID()}-${safe}`;
}

function toView(e: {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedByName: string | null;
  createdAt: Date;
}): EvidenceView {
  return {
    id: e.id,
    fileName: e.fileName,
    mimeType: e.mimeType,
    size: e.size,
    isImage: e.mimeType.startsWith('image/'),
    uploadedByName: e.uploadedByName,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Evidence for a finding, newest first. Callers must have resolved scope first. */
export async function listFindingEvidence(
  findingId: string,
): Promise<EvidenceView[]> {
  const rows = await prisma.findingEvidence.findMany({
    where: { findingId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

/** Evidence for many findings at once (audit detail page), grouped by findingId. */
export async function listEvidenceForFindings(
  findingIds: string[],
): Promise<Record<string, EvidenceView[]>> {
  const out: Record<string, EvidenceView[]> = {};
  if (findingIds.length === 0) return out;
  const rows = await prisma.findingEvidence.findMany({
    where: { findingId: { in: findingIds } },
    orderBy: { createdAt: 'desc' },
  });
  for (const r of rows) {
    (out[r.findingId] ??= []).push(toView(r));
  }
  return out;
}

export async function addFindingEvidence(
  viewer: PlatformViewer,
  findingId: string,
  file: { buffer: Buffer; fileName: string; mimeType: string; size: number },
): Promise<{ ok: true; id: string } | { ok: false; reason: 'not_found' }> {
  const finding = await getFindingForViewer(viewer, findingId);
  if (!finding) return { ok: false, reason: 'not_found' };

  const blobPath = buildEvidenceBlobPath(findingId, file.fileName);
  await uploadDocumentBlob(blobPath, file.buffer, file.mimeType);

  const created = await prisma.findingEvidence.create({
    data: {
      findingId,
      blobPath,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      uploadedByUserId: viewer.id,
      uploadedByName: viewer.name,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Resolve one evidence record for download — only if its finding is in scope. */
export async function getFindingEvidenceForViewer(
  viewer: PlatformViewer,
  findingId: string,
  evidenceId: string,
) {
  if (viewer.siteIds.length === 0) return null;
  return prisma.findingEvidence.findFirst({
    where: {
      id: evidenceId,
      findingId,
      finding: { audit: { jobSiteId: { in: viewer.siteIds } } },
    },
  });
}

export async function deleteFindingEvidence(
  viewer: PlatformViewer,
  findingId: string,
  evidenceId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
  const ev = await getFindingEvidenceForViewer(viewer, findingId, evidenceId);
  if (!ev) return { ok: false, reason: 'not_found' };
  await deleteDocumentBlob(ev.blobPath);
  await prisma.findingEvidence.delete({ where: { id: ev.id } });
  return { ok: true };
}
