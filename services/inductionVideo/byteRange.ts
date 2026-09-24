/**
 * Parsing a `Range` header, on its own so it can be tested on its own.
 *
 * This is the piece that decides which bytes of a private file a caller gets,
 * which makes it worth exercising directly rather than through a route: an
 * off-by-one here is either a player that will not seek or, worse, a response
 * that claims to be bytes 0-99 and is not.
 */

/** The most bytes to read at once. Small enough to protect a B1 instance. */
export const MAX_RANGE_CHUNK = 2 * 1024 * 1024;

export type ParsedRange = { offset: number; count: number } | 'unsatisfiable' | null;

/**
 * null  — no range asked for, send the whole file
 * 'unsatisfiable' — a range outside the file: 416, per RFC 9110
 */
export function parseRangeHeader(
  header: string | null | undefined,
  totalLength: number,
  maxChunk = MAX_RANGE_CHUNK,
): ParsedRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // multi-range and other units: treated as no range
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (totalLength <= 0) return 'unsatisfiable';

  if (rawStart === '') {
    /*
     * "bytes=-500": the LAST 500 bytes. This is how a player looks for the
     * metadata at the end of a file, and a route that mistook it for "from 500"
     * would hand back the wrong part of the file with a 206 saying otherwise.
     */
    const wanted = Number(rawEnd);
    if (!Number.isFinite(wanted) || wanted <= 0) return 'unsatisfiable';
    const count = Math.min(wanted, totalLength);
    return { offset: totalLength - count, count: Math.min(count, maxChunk) };
  }

  const offset = Number(rawStart);
  if (!Number.isFinite(offset) || offset < 0) return 'unsatisfiable';
  if (offset >= totalLength) return 'unsatisfiable';
  const end = rawEnd === '' ? totalLength - 1 : Math.min(Number(rawEnd), totalLength - 1);
  if (!Number.isFinite(end) || end < offset) return 'unsatisfiable';
  return { offset, count: Math.min(end - offset + 1, maxChunk) };
}
