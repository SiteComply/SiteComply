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
import { readStoredNarrative } from '@/services/closeOut/closeOutAi';
import {
  getCompanyBranding,
  getCompanyLogo,
  type CompanyBranding,
} from '@/services/company/companyConfigService';
import { PHOTO_LIMIT } from '@/services/closeOut/closeOutSections';
import {
  supersededEvidenceIdsForSite,
  excludeIds,
} from '@/services/annotations/supersededEvidenceQuery';

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
    const docs = await prisma.document.findMany({
      where: { jobSiteId: siteId },
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
function packHtml(
  pack: NonNullable<Awaited<ReturnType<typeof renderPack>>>,
  labels: { ref: string; title: string; source: string }[],
  company: CompanyBranding,
  logoDataUri: string | null,
): string {
  // The archived copy carries the SAME AI labelling as the on-screen pack. This
  // is the copy that gets filed and read years later, so unlabelled machine
  // prose here would be worse than none.
  const narrative = readStoredNarrative(
    pack.aiSummary,
    pack.sections.map((sec) => sec.id),
  );
  const esc = (v: string) =>
    v.replace(/[&<>"]/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
    );

  const sections = pack.sections
    .map((s, i) => {
      const facts = s.facts
        ? `<dl>${s.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>`
        : '';
      const rows =
        s.rows && s.rows.length
          ? `<table><thead><tr>${s.rows[0]!.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${s.rows
              .map(
                (r) =>
                  `<tr>${r.map((c) => `<td>${esc(c.value)}</td>`).join('')}</tr>`,
              )
              .join('')}</tbody></table>`
          : '';
      const photos = s.photos
        ? `<ul>${s.photos.map((p) => `<li>${esc(p.caption)}</li>`).join('')}</ul>`
        : '';
      const capped = s.cappedNote
        ? `<p class="note">${esc(s.cappedNote)}</p>`
        : '';
      const sectionNarrative = narrative?.sectionNarratives.find(
        (x) => x.sectionId === s.id,
      );
      const ai = sectionNarrative
        ? `<div class="ai"><span class="ai-badge">AI-generated</span><p>${esc(sectionNarrative.narrative)}</p></div>`
        : '';
      return `<section id="${s.id}"><h2>${i + 1}. ${esc(s.label)}</h2>${ai}${facts}${rows}${photos}${capped}</section>`;
    })
    .join('');

  const appendix = labels.length
    ? `<section><h2>Appendices</h2><table><thead><tr><th>Ref</th><th>Title</th><th>Source</th></tr></thead><tbody>${labels
        .map(
          (l) =>
            `<tr><td>${l.ref}</td><td>${esc(l.title)}</td><td>${esc(l.source)}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table><p class="note">Each appendix is included in the <code>originals/</code> folder of this archive, named by its reference.</p></section>`
    : '';

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<title>${esc(pack.title)}</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;max-width:900px;margin:2rem auto;padding:0 1.5rem;line-height:1.5}
h1{font-size:1.6rem;text-transform:uppercase;text-align:center;margin:0}
h2{font-size:1.05rem;margin:2rem 0 .5rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;color:#555;border-bottom:1px solid #ddd;padding:.25rem .5rem .25rem 0}
td{padding:.25rem .5rem .25rem 0;border-bottom:1px solid #f0f0f0;vertical-align:top}
dl{display:grid;grid-template-columns:1fr 1fr;gap:.5rem 1rem;font-size:.85rem}
dt{font-weight:600}dd{margin:0;color:#444;white-space:pre-line}
.cover{text-align:center;border-bottom:2px solid ${esc(company.primaryColor)};padding-bottom:2rem;margin-bottom:2rem}
.logo{max-height:64px;max-width:220px;margin:0 auto 1rem;display:block}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;text-align:left;max-width:620px;margin:1.5rem auto 0;font-size:.85rem}
.note{background:#fff8e1;border:1px solid #f0d68a;padding:.5rem .75rem;font-size:.8rem}
.ai{border:1px solid rgba(56,181,74,.35);background:rgba(56,181,74,.06);padding:.5rem .75rem;margin:.5rem 0;font-size:.85rem}
.ai p{margin:.25rem 0 0}
.ai-badge{display:inline-block;border:1px solid rgba(56,181,74,.5);color:#2f8f3c;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:.05rem .3rem}
.ai-note{font-size:.72rem;color:#666;margin-top:.35rem}
.footer{margin-top:3rem;font-size:.75rem;color:#666;border-top:1px solid #ddd;padding-top:1rem}
@media print{section{break-before:page}.cover{break-before:auto}}
</style></head><body>
<div class="cover">
${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="${esc(company.companyName)}">` : ''}
<p style="font-weight:700;letter-spacing:.1em;color:${esc(company.primaryColor)}">${esc(company.companyName)}</p>
${company.tagline ? `<p style="font-size:.8rem;color:#666">${esc(company.tagline)}</p>` : ''}
<h1>${esc(pack.site.name)}</h1><p style="text-transform:uppercase;color:#555">Project Close-Out Pack</p>
<div class="meta">
<div><b>Project address</b><br>${esc(pack.site.address)}</div>
<div><b>Job reference</b><br>${esc(pack.site.jobReference)}</div>
<div><b>Prepared for</b><br>${esc(pack.preparedFor ?? '—')}</div>
<div><b>Prepared by</b><br>${esc(pack.generatedByName)}</div>
</div>
<p style="font-size:.75rem;color:#666;margin-top:1.5rem">Generated on ${pack.generatedAt.toLocaleDateString('en-GB')} · Version ${pack.version}.0</p>
</div>
${
  narrative
    ? `<section><h2>Executive summary</h2><div class="ai"><span class="ai-badge">AI-generated</span><p>${esc(narrative.executiveSummary)}</p></div><p class="ai-note">This narrative was written automatically from the records held in this project and is a descriptive summary only. It is not an assessment, certification or approval of compliance. The project team remains responsible for the accuracy and completeness of this pack.</p></section>`
    : ''
}
<h2>Contents</h2><ol>${pack.sections.map((s) => `<li><a href="#${s.id}">${esc(s.label)}</a></li>`).join('')}${labels.length ? '<li>Appendices</li>' : ''}</ol>
${sections}${appendix}
<p class="footer">This pack was compiled automatically from the records held in SiteComply for this project on ${pack.generatedAt.toLocaleDateString('en-GB')}. It is a record of what was captured, not an assessment or certification of compliance. The Principal Contractor remains responsible for the accuracy and completeness of project records under CDM 2015.<br><br>To save as PDF, open this file in a browser and print to PDF.${
    narrative
      ? '<br><br>Passages marked &ldquo;AI-generated&rdquo; were written automatically as descriptive summaries of the records above. They are not assessments, certifications or approvals of compliance.'
      : ''
  }</p>
</body></html>`;
}

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

  const [{ entries, labels }, company, logo] = await Promise.all([
    collectAppendices(viewer, row.jobSiteId),
    getCompanyBranding(),
    // Inlined as a data URI: the archived pack has to render off a memory stick
    // years from now, with no network and no SiteComply to fetch the logo from.
    getCompanyLogo(),
  ]);
  const logoDataUri = logo
    ? `data:${logo.contentType};base64,${logo.bytes.toString('base64')}`
    : null;

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

  archive.append(packHtml(pack, labels, company, logoDataUri), {
    name: 'close-out-pack.html',
  });
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
