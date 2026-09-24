import { ZipArchive } from 'archiver';
import { PassThrough, Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { viewerCan } from '@/services/platformUsers/effectivePermissions';
import {
  buildBlobPath,
  openDocumentBlobStream,
  uploadBlobStream,
} from '@/services/documents/blobStorage';
import { renderPack } from '@/services/closeOut/closeOutService';
import { PHOTO_LIMIT } from '@/services/closeOut/closeOutSections';
import { supersededDocumentIds } from '@/services/documents/supersededDocuments';
import {
  supersededEvidenceIdsForSite,
  excludeIds,
} from '@/services/annotations/supersededEvidenceQuery';
import { renderCloseOutPackPdf } from '@/services/closeOutPdf/renderCloseOutPack';
import { packPdfData } from '@/services/closeOutPdf/closeOutPackPdfData';

/**
 * SC-024 Phase 2 — the ZIP archive: the pack plus every original file.
 *
 * STREAMED END TO END. archiver pulls each blob as a stream and pipes straight
 * into the Azure upload, so the archive never exists in memory. Buffering even
 * a modest project would put hundreds of megabytes through a 1.75 GB App
 * Service one file at a time; this holds only the current chunk.
 *
 * The ceiling is enforced by COUNTING BYTES as they pass, not by trusting
 * recorded file sizes, and the pack RECORDS when it truncated. A handover
 * archive that silently drops files is worse than one that admits what is
 * missing — the client cannot tell the difference between "no photos" and
 * "photos omitted".
 *
 * There is no server-side PDF: the archive carries the pack as a self-contained
 * HTML file, which prints to PDF from any browser. That is the approach SC-019
 * Phase 2 set for the CPP and the one agreed for this phase.
 */

/** 250 MB, as agreed. */
export const ZIP_LIMIT_BYTES = 250 * 1024 * 1024;

export interface ArchiveResult {
  ok: boolean;
  blobPath?: string;
  sizeBytes?: number;
  fileCount?: number;
  truncated?: boolean;
  error?: string;
}

interface ArchiveEntry {
  /** Path inside the zip, e.g. "originals/A1 - Method statement.pdf". */
  path: string;
  blobPath: string;
  /** Recorded size where we hold one; evidence photos do not record theirs. */
  sizeBytes?: number;
}

/**
 * Every original file the pack references, numbered as appendices.
 *
 * Appendix numbers are what tie the printed pack to the archive: section 7 of
 * the PDF cites "Appendix A3", and A3 is the filename in the zip. Without that
 * the two artefacts are unrelated piles of paper and files.
 */
/**
 * Just the appendix LABELS, for a document that lists them without carrying the
 * files. Thin wrapper so the numbering cannot drift between the PDF and the
 * archive: the same collector produces both, and "Appendix A3" means the same
 * file in each.
 */
export async function collectAppendixLabels(
  viewer: PlatformViewer,
  siteId: string,
): Promise<{ ref: string; title: string; source: string }[]> {
  const { labels } = await collectAppendices(viewer, siteId);
  return labels;
}

export async function collectAppendices(
  viewer: PlatformViewer,
  siteId: string,
): Promise<{
  entries: ArchiveEntry[];
  labels: { ref: string; title: string; source: string }[];
}> {
  const entries: ArchiveEntry[] = [];
  const labels: { ref: string; title: string; source: string }[] = [];
  let n = 0;

  const push = (
    title: string,
    source: string,
    blobPath: string,
    fileName: string,
    sizeBytes?: number,
  ) => {
    n += 1;
    const ref = `A${n}`;
    const safe = fileName.replace(/[^a-zA-Z0-9._ -]+/g, '_');
    entries.push({ path: `originals/${ref} - ${safe}`, blobPath, sizeBytes });
    labels.push({ ref, title, source });
  };

  if (viewerCan(viewer, 'documents', 'view', siteId)) {
    // One file per document. The pack is a client handover, so it carries the
    // document as issued — the annotated version — not two near-identical
    // files. This mirrors what the photo section below already does with
    // superseded evidence originals. The original is retained in storage and
    // remains reachable by direct id; it is simply not shipped in the archive.
    const supersededDocs = await supersededDocumentIds([siteId]);
    const docs = await prisma.document.findMany({
      where: {
        jobSiteId: siteId,
        id: supersededDocs.length > 0 ? { notIn: supersededDocs } : undefined,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        title: true,
        fileName: true,
        blobPath: true,
        category: true,
        sizeBytes: true,
      },
    });
    for (const d of docs) {
      if (d.blobPath)
        push(
          d.title,
          `Document · ${d.category}`,
          d.blobPath,
          d.fileName,
          d.sizeBytes,
        );
    }
  }

  // Evidence photos, capped at the same limit the printed pack uses so the two
  // never disagree about what was included.
  if (viewerCan(viewer, 'audits', 'view', siteId)) {
    // SC-017 FOLLOW-UP: the same exclusion the printed pack applies, applied the
    // same way — in the query, ahead of the cap. The ZIP and the pack must agree
    // about what was included, and a downloaded archive containing each photo
    // twice is the version of this bug that leaves the building.
    const superseded = await supersededEvidenceIdsForSite(siteId);
    const [findings, actions] = await Promise.all([
      prisma.findingEvidence.findMany({
        where: {
          finding: { audit: { jobSiteId: siteId } },
          id: excludeIds(superseded.findingEvidenceIds),
        },
        orderBy: { createdAt: 'desc' },
        take: PHOTO_LIMIT,
        select: { fileName: true, blobPath: true },
      }),
      prisma.actionEvidence.findMany({
        where: {
          action: { jobSiteId: siteId },
          id: excludeIds(superseded.actionEvidenceIds),
        },
        orderBy: { createdAt: 'desc' },
        take: PHOTO_LIMIT,
        select: { fileName: true, blobPath: true },
      }),
    ]);
    for (const e of [...findings, ...actions].slice(0, PHOTO_LIMIT)) {
      if (e.blobPath)
        push(e.fileName, 'Evidence photo', e.blobPath, e.fileName);
    }
  }

  return { entries, labels };
}

/** A self-contained HTML rendering of the pack, for the archive. */
/**
 * Build the archive and store it against the project.
 *
 * Re-checks permissions via renderPack and collectAppendices, so an archive can
 * never contain more than the person building it may see.
 */
export async function buildAndStoreArchive(
  viewer: PlatformViewer,
  packId: string,
): Promise<ArchiveResult> {
  const pack = await renderPack(viewer, packId);
  if (!pack) return { ok: false, error: 'Pack not found.' };

  const row = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    select: { jobSiteId: true, version: true },
  });
  if (!row) return { ok: false, error: 'Pack not found.' };

  /*
   * The branding and the logo are no longer loaded here: the PDF renderer
   * fetches them itself through packPdfData, and the logo is EMBEDDED in the
   * document rather than inlined as a data URI. The archived pack still has to
   * open off a memory stick years from now with no network - a PDF carries its
   * own images and faces, which is a stronger version of the same guarantee.
   */
  const { entries, labels } = await collectAppendices(viewer, row.jobSiteId);

  // The archiver typings expose the concrete archive classes rather than a
  // callable default, so the class is constructed directly.
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const upload = new PassThrough();

  let bytes = 0;
  let truncated = false;
  let fileCount = 0;
  let failure: Error | null = null;

  // An unhandled 'error' on a stream takes the whole process down, and this runs
  // on a single-instance App Service — one unreadable blob must not restart the
  // site for every other user. Record it and let the caller report it.
  archive.on('error', (err: Error) => {
    failure = failure ?? err;
    upload.destroy(err);
  });

  // Pipe first, THEN attach the counter: attaching a 'data' listener puts the
  // stream in flowing mode, and anything emitted before pipe() is attached would
  // be counted but never uploaded.
  archive.pipe(upload);

  // Count bytes as they actually pass, rather than trusting recorded sizes —
  // the ceiling has to hold against the real archive, not a database estimate.
  archive.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });

  // archiver queues appends and drains them asynchronously, so appending the
  // whole list up front would let `bytes` read near zero for every ceiling
  // check and blow straight past the limit. Waiting for each entry to be
  // processed keeps the byte count truthful at the moment we decide.
  let processed = 0;
  let waiters: Array<() => void> = [];
  const release = () => {
    const pending = waiters;
    waiters = [];
    pending.forEach((w) => w());
  };
  archive.on('entry', () => {
    processed += 1;
    release();
  });
  archive.on('error', release);

  const settled = async (target: number) => {
    while (processed < target && !failure) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  const blobPath = buildBlobPath(
    row.jobSiteId,
    `close-out-pack-v${row.version}.zip`,
  );
  const uploadPromise = uploadBlobStream(blobPath, upload, 'application/zip');

  /*
   * THE PACK ITSELF IS A PDF NOW, not an HTML file.
   *
   * This archive is handed to a client. A recipient who opened it found a web
   * page to view in a browser and print themselves - complete with their own
   * URL and timestamp across the top - which was the first impression the
   * platform made on somebody who never logs into it.
   */
  archive.append(
    await renderCloseOutPackPdf(
      await packPdfData(pack, labels, { appendicesIncluded: true }),
    ),
    { name: 'close-out-pack.pdf' },
  );
  fileCount += 1;
  await settled(fileCount);

  const manifest = [
    'Reference,Title,Source,File',
    ...labels.map((l, i) => {
      const e = entries[i]!;
      const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return [q(l.ref), q(l.title), q(l.source), q(e.path)].join(',');
    }),
  ].join('\n');
  archive.append(manifest, { name: 'manifest.csv' });
  fileCount += 1;
  await settled(fileCount);

  for (const entry of entries) {
    if (failure) break;
    // Stop on the measured total, and also refuse a file whose recorded size
    // would clear the ceiling on its own — otherwise a single 400 MB upload
    // sails past the limit because the check ran before its bytes existed.
    if (
      bytes >= ZIP_LIMIT_BYTES ||
      (entry.sizeBytes != null && bytes + entry.sizeBytes > ZIP_LIMIT_BYTES)
    ) {
      truncated = true;
      break;
    }
    const stream = await openDocumentBlobStream(entry.blobPath);
    // A missing blob skips rather than failing the whole export — one deleted
    // file should not cost the client their entire handover archive.
    if (!stream) continue;
    archive.append(Readable.from(stream), { name: entry.path });
    fileCount += 1;
    await settled(fileCount);
  }

  if (truncated) {
    archive.append(
      `This archive reached its ${Math.round(ZIP_LIMIT_BYTES / 1024 / 1024)} MB limit before every original file could be added.\n` +
        `The pack document and manifest are complete; some files listed in manifest.csv are not present.\n` +
        `Download the remaining files from the project's Documents and Audits records.\n`,
      { name: 'INCOMPLETE-README.txt' },
    );
    fileCount += 1;
  }

  if (failure) {
    archive.destroy();
    await uploadPromise.catch(() => undefined);
    return {
      ok: false,
      error: `Archive failed: ${(failure as Error).message}`,
    };
  }

  await archive.finalize();
  await uploadPromise;

  await prisma.closeOutPack.update({
    where: { id: packId },
    data: {
      zipBlobPath: blobPath,
      zipSizeBytes: bytes,
      zipGeneratedAt: new Date(),
      zipTruncated: truncated,
      zipFileCount: fileCount,
    },
  });

  return { ok: true, blobPath, sizeBytes: bytes, fileCount, truncated };
}

export interface StoredArchive {
  blobPath: string;
  fileName: string;
  sizeBytes: number;
  generatedAt: Date;
  truncated: boolean;
  fileCount: number;
}

/**
 * The stored archive for a pack, or null if none has been built.
 *
 * Applies the SAME site boundary renderPack does — a pack ID alone must never
 * be enough to pull down a project's entire document set.
 */
export async function getStoredArchive(
  viewer: PlatformViewer,
  packId: string,
): Promise<StoredArchive | null> {
  const row = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    select: {
      jobSiteId: true,
      version: true,
      zipBlobPath: true,
      zipSizeBytes: true,
      zipGeneratedAt: true,
      zipTruncated: true,
      zipFileCount: true,
      jobSite: { select: { jobReference: true } },
    },
  });
  if (!row?.zipBlobPath || !row.zipGeneratedAt) return null;
  if (!viewer.siteIds.includes(row.jobSiteId)) return null;

  const ref = (row.jobSite?.jobReference || 'project').replace(
    /[^a-zA-Z0-9._-]+/g,
    '-',
  );
  return {
    blobPath: row.zipBlobPath,
    fileName: `${ref}-close-out-pack-v${row.version}.zip`,
    sizeBytes: row.zipSizeBytes ?? 0,
    generatedAt: row.zipGeneratedAt,
    truncated: row.zipTruncated,
    fileCount: row.zipFileCount ?? 0,
  };
}
