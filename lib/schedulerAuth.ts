import type { NextRequest } from 'next/server';

/**
 * Shared-secret authorisation for the machine-called `/api/system/*` endpoints.
 *
 * Extracted from the compliance tick route when report delivery needed the same
 * guard: a timing-safe comparison is not something to have two copies of, where
 * one can quietly drift into `===` and become an oracle.
 *
 * The three outcomes are kept separate rather than collapsed to a boolean so
 * each route can answer in its own shape — 'disabled' is a 503 (the endpoint is
 * switched off, not open), 'unauthorised' is a bare 401 that says nothing.
 */
export type SchedulerAuth = 'ok' | 'disabled' | 'unauthorised';

/** Timing-safe string comparison over the raw bytes. */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

export function authoriseScheduler(req: NextRequest): SchedulerAuth {
  const expected = process.env.SCHEDULER_SECRET;
  // Disabled, not open. A misconfigured deploy must not expose a write path.
  if (!expected) return 'disabled';

  const provided =
    req.headers.get('x-scheduler-secret') ?? req.nextUrl.searchParams.get('secret') ?? '';
  return secretsMatch(provided, expected) ? 'ok' : 'unauthorised';
}
