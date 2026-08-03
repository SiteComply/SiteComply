/**
 * SC-024 Phase 2 — streaming archive mechanics.
 *
 * Exercises the exact append/settle/truncate pattern buildAndStoreArchive uses,
 * against the real archiver library and real streams. The value here is the
 * failure modes types cannot catch: a settle loop that deadlocks, a ceiling that
 * is checked before the bytes exist, and an error path that never resolves.
 *
 * No Azure credentials are needed — the upload sink is a local PassThrough.
 */
import { ZipArchive } from 'archiver';
import { PassThrough, Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

const ZIP_LIMIT_BYTES = 250 * 1024 * 1024;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

/**
 * Genuinely incompressible bytes. A patterned filler is not good enough: deflate
 * crushed a periodic 2.5 MB payload to 36 KB, so the ceiling test never reached
 * its limit and passed for the wrong reason.
 */
function noise(size: number): Buffer {
  return randomBytes(size);
}

interface Entry {
  path: string;
  bytes: Buffer;
  sizeBytes?: number;
  missing?: boolean;
}

/** Mirrors buildAndStoreArchive's streaming core. */
async function runArchive(
  entries: Entry[],
  limit: number,
): Promise<{
  bytes: number;
  fileCount: number;
  truncated: boolean;
  sunk: number;
  error?: string;
}> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const upload = new PassThrough();

  let bytes = 0;
  let truncated = false;
  let fileCount = 0;
  let failure: Error | null = null;

  archive.on('error', (err: Error) => {
    failure = failure ?? err;
    upload.destroy(err);
  });

  archive.pipe(upload);
  archive.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });

  // The sink stands in for the Azure upload; count what actually arrives so we
  // can prove the counter matches the bytes that would really be stored.
  let sunk = 0;
  const uploadPromise = new Promise<void>((resolve, reject) => {
    upload.on('data', (c: Buffer) => {
      sunk += c.length;
    });
    upload.on('end', () => resolve());
    upload.on('error', reject);
  });

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

  archive.append('<html>pack</html>', { name: 'close-out-pack.html' });
  fileCount += 1;
  await settled(fileCount);

  archive.append('Reference,Title\n', { name: 'manifest.csv' });
  fileCount += 1;
  await settled(fileCount);

  for (const entry of entries) {
    if (failure) break;
    if (
      bytes >= limit ||
      (entry.sizeBytes != null && bytes + entry.sizeBytes > limit)
    ) {
      truncated = true;
      break;
    }
    if (entry.missing) continue;
    archive.append(Readable.from(entry.bytes), { name: entry.path });
    fileCount += 1;
    await settled(fileCount);
  }

  if (truncated) {
    archive.append('truncated\n', { name: 'INCOMPLETE-README.txt' });
    fileCount += 1;
  }

  if (failure) {
    archive.destroy();
    await uploadPromise.catch(() => undefined);
    return {
      bytes,
      fileCount,
      truncated,
      sunk,
      error: (failure as Error).message,
    };
  }

  await archive.finalize();
  await uploadPromise;
  return { bytes, fileCount, truncated, sunk };
}

async function main() {
  console.log('== SC-024 P2 archive mechanics ==\n');

  console.log('[1] Small archive completes and does not deadlock');
  const small = await runArchive(
    [
      { path: 'originals/A1 - a.pdf', bytes: noise(50_000), sizeBytes: 50_000 },
      { path: 'originals/A2 - b.jpg', bytes: noise(80_000) },
    ],
    ZIP_LIMIT_BYTES,
  );
  check('finalized', !small.error, small.error ?? '');
  check(
    'all four entries present',
    small.fileCount === 4,
    `got ${small.fileCount}`,
  );
  check('not truncated', small.truncated === false);
  check(
    'counted bytes equal uploaded bytes',
    small.bytes === small.sunk && small.bytes > 0,
    `counted ${small.bytes}, uploaded ${small.sunk}`,
  );

  console.log('\n[2] A missing blob is skipped, not fatal');
  const withMissing = await runArchive(
    [
      { path: 'originals/A1 - a.pdf', bytes: noise(20_000) },
      {
        path: 'originals/A2 - gone.pdf',
        bytes: Buffer.alloc(0),
        missing: true,
      },
      { path: 'originals/A3 - c.pdf', bytes: noise(20_000) },
    ],
    ZIP_LIMIT_BYTES,
  );
  check('completed', !withMissing.error, withMissing.error ?? '');
  check(
    'skipped file excluded, others kept',
    withMissing.fileCount === 4,
    `got ${withMissing.fileCount}`,
  );

  console.log('\n[3] Measured ceiling truncates and says so');
  // A 1 MB limit against ~2.5 MB of incompressible input.
  const limit = 1024 * 1024;
  const big = await runArchive(
    Array.from({ length: 5 }, (_, i) => ({
      path: `originals/A${i + 1} - big.bin`,
      bytes: noise(512 * 1024),
    })),
    limit,
  );
  check('completed', !big.error, big.error ?? '');
  check('flagged truncated', big.truncated === true);
  check(
    'stopped near the ceiling rather than writing everything',
    big.bytes < 5 * 512 * 1024 && big.fileCount < 7,
    `wrote ${big.bytes} bytes across ${big.fileCount} entries (all 5 originals would be 7)`,
  );
  check(
    'counted bytes equal uploaded bytes',
    big.bytes === big.sunk,
    `counted ${big.bytes}, uploaded ${big.sunk}`,
  );

  console.log('\n[4] A single oversized file is refused up front');
  const oversized = await runArchive(
    [
      {
        path: 'originals/A1 - small.pdf',
        bytes: noise(10_000),
        sizeBytes: 10_000,
      },
      {
        path: 'originals/A2 - huge.bin',
        bytes: noise(1000),
        sizeBytes: 400 * 1024 * 1024,
      },
    ],
    ZIP_LIMIT_BYTES,
  );
  check('flagged truncated', oversized.truncated === true);
  check(
    'huge file never appended',
    oversized.fileCount === 4,
    `entries: pack + manifest + 1 original + readme, got ${oversized.fileCount}`,
  );

  console.log(
    `\n== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} ==`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
