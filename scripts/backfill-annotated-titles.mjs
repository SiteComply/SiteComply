/**
 * Backfill for the legacy annotated copies created before the naming fix.
 *
 * Annotated copies used to be stored with a title of "<title> (annotated)" and a
 * file name of "<name>-annotated.jpg". New uploads no longer do that, so this
 * only ever touches rows created before that change.
 *
 * Title is reset to the uploader's own title by taking it from the ORIGINAL row
 * the copy points at — not by regex-stripping the suffix — so the result is the
 * title that was actually typed, even if the document itself legitimately ends
 * in the word "annotated". Falls back to stripping the suffix only when the
 * original is gone (a dangling `originalDocumentId`, which has no FK).
 *
 * File name keeps the original's base name with a .jpg extension, because the
 * annotated render is always JPEG.
 *
 * Idempotent: rows already clean are skipped. --apply to write; default is a
 * dry run.
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

const rows = await p.document.findMany({
  where: { annotated: true, originalDocumentId: { not: null } },
  select: { id: true, title: true, fileName: true, originalDocumentId: true },
});

let changed = 0;
for (const r of rows) {
  const original = await p.document.findUnique({
    where: { id: r.originalDocumentId },
    select: { title: true, fileName: true },
  });

  const title = original
    ? original.title
    : r.title.replace(/\s*\(annotated\)\s*$/i, '').trim() || r.title;

  const base = (original?.fileName ?? r.fileName).replace(/\.[^.]+$/, '');
  const fileName = r.fileName.endsWith('.jpg') ? `${base}.jpg` : r.fileName;

  if (title === r.title && fileName === r.fileName) {
    console.log(`  skip    ${r.id}  already clean`);
    continue;
  }
  console.log(`  ${APPLY ? 'update' : 'would '}  ${r.id}`);
  console.log(`            title    "${r.title}" -> "${title}"`);
  console.log(`            fileName "${r.fileName}" -> "${fileName}"`);
  if (APPLY) await p.document.update({ where: { id: r.id }, data: { title, fileName } });
  changed += 1;
}

console.log(`\n  ${rows.length} annotated copies examined, ${changed} ${APPLY ? 'updated' : 'to update'}`);
if (!APPLY) console.log('  DRY RUN — re-run with --apply to write.');
await p.$disconnect();
