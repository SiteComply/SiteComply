import { NextRequest, NextResponse } from 'next/server';
import { ErrorEventKind } from '@prisma/client';
import { recordError } from '@/services/telemetry/errorLog';
import {
  portalFromPath,
  resolveActor,
  currentBuildId,
} from '@/services/telemetry/errorContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/telemetry/error — a browser reporting a crash it just survived.
 *
 * Deliberately open to unauthenticated callers: the operative check-in flow and
 * the public pages are exactly where a crash is hardest to hear about, and
 * requiring a session would lose those. Identity is taken from whatever session
 * IS present, never from the body — a caller cannot claim to be someone.
 *
 * Because it is open, the body is capped, the caller is rate limited, and
 * nothing is echoed back beyond a reference. It is a write-only drop box.
 */

const MAX_BODY_BYTES = 16_000;

/** Per-IP ceiling. A page crash-looping must not become a write loop. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const seen = new Map<string, { n: number; started: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const row = seen.get(key);
  if (!row || now - row.started > RATE_WINDOW_MS) {
    seen.set(key, { n: 1, started: now });
    // Bounded so the map cannot grow without limit on a long-lived process.
    if (seen.size > 5_000) {
      for (const [k, v] of seen) if (now - v.started > RATE_WINDOW_MS) seen.delete(k);
    }
    return false;
  }
  row.n += 1;
  return row.n > RATE_MAX;
}

const KINDS = new Set<string>([
  ErrorEventKind.CLIENT_RENDER,
  ErrorEventKind.CLIENT_UNCAUGHT,
  ErrorEventKind.CLIENT_REJECTION,
  ErrorEventKind.SERVER_RENDER,
]);

async function POSTHandler(req: NextRequest) {
  // Always 204, whatever happens. A reporting endpoint that returns errors
  // gives a crashing page something new to crash on, and tells a prober which
  // inputs are interesting.
  const ok = () => new NextResponse(null, { status: 204 });

  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-client-ip') ??
      'unknown';
    if (rateLimited(ip)) return ok();

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return ok();

    const body = JSON.parse(raw) as Record<string, unknown>;
    const kind = String(body.kind ?? '');
    if (!KINDS.has(kind)) return ok();

    const pagePath = typeof body.pagePath === 'string' ? body.pagePath : null;
    const portal = portalFromPath(pagePath);
    const actor = await resolveActor(portal);

    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

    await recordError({
      kind: kind as ErrorEventKind,
      portal,
      name: str(body.name),
      message: summarise(str(body.message), str(body.digest)),
      stack: str(body.stack),
      digest: str(body.digest),
      pagePath,
      pageTitle: str(body.pageTitle),
      buildId: str(body.buildId) ?? currentBuildId(),
      userAgent: req.headers.get('user-agent'),
      viewportWidth: num(body.viewportWidth),
      viewportHeight: num(body.viewportHeight),
      ...actor,
    });
    return ok();
  } catch {
    return ok();
  }
}

export const POST = POSTHandler;

/**
 * A server-render failure reaches the browser carrying Next's production
 * boilerplate — "An error occurred in the Server Components render. The
 * specific message is omitted in production builds to avoid leaking sensitive
 * details…" — the same 40 words on every such error. Stored verbatim it fills
 * the log with text that identifies nothing and makes two different faults look
 * alike. Replace it with the one thing that IS specific: the code to search for.
 */
const NEXT_BOILERPLATE = /^An error occurred in the Server Components render/i;

function summarise(message: string | null, digest: string | null): string {
  const m = (message ?? '').trim();
  if (!m) return 'Unknown client error';
  if (NEXT_BOILERPLATE.test(m)) {
    return digest
      ? `Server render failed. The message stays on the server; find it in the server log under code ${digest}.`
      : 'Server render failed. The message stays on the server.';
  }
  return m;
}
