import { NextResponse } from 'next/server';
import { ProjectClosedError } from '@/services/projectClosure/projectWritable';
import { recordError } from '@/services/telemetry/errorLog';
import {
  portalFromPath,
  resolveActor,
  currentBuildId,
} from '@/services/telemetry/errorContext';

/**
 * Turn a completed-project refusal into an answer instead of a crash.
 *
 * The read-only rule for completed projects (SC-025) is enforced in the data
 * layer, which can only throw — it has no way to write an HTTP response. Nothing
 * caught it, so every blocked write returned a bare 500 with an empty body: the
 * block worked, and the person was told nothing at all. Two routes handled the
 * case by hand, and only for the JobSite record itself.
 *
 * Wrapping the handler keeps the enforcement where it belongs and reports it
 * where the caller can see it. 409 Conflict, not 403: the request is legitimate
 * and the caller is permitted — the project's state is what refuses, and it can
 * be changed by reopening.
 *
 * Anything that is not a ProjectClosedError is re-thrown untouched, so this
 * never hides an unrelated fault.
 */
// `R` is deliberately not constrained to `Response`: at least one handler has an
// inferred return type that includes `undefined`, and the wrapper must pass a
// handler's result through EXACTLY as it was, not change what that route returns.
export function withClosedProjectHandling<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ProjectClosedError) {
        // A deliberate refusal, not a fault. Recording it would bury the real
        // failures under a message the product means to send.
        return NextResponse.json(
          { ok: false, error: err.message, projectClosed: true },
          { status: 409 },
        );
      }

      // Everything else is unexpected. Record it with who, where and which
      // deploy, then re-throw so the response is exactly what it was before —
      // this wrapper observes failures, it does not change them.
      await captureRouteFailure(err, args);
      throw err;
    }
  };
}

/**
 * Pull the request out of the handler's arguments and record the failure.
 *
 * Next hands a route handler `(request, context)`. The request is read
 * defensively because this runs on a path that is already going wrong: nothing
 * here may throw, or one failing route becomes a failing route plus a failing
 * logger.
 */
async function captureRouteFailure(err: unknown, args: unknown[]): Promise<void> {
  try {
    const req = args[0] as
      | { nextUrl?: { pathname?: string }; url?: string; method?: string; headers?: Headers }
      | undefined;
    const path = req?.nextUrl?.pathname ?? req?.url ?? null;
    const portal = portalFromPath(path);
    const actor = await resolveActor(portal);
    const e = err as Error;
    await recordError({
      kind: 'SERVER_ROUTE',
      portal,
      name: e?.name ?? null,
      message: e?.message ?? String(err),
      stack: e?.stack ?? null,
      route: path,
      method: req?.method ?? null,
      statusCode: 500,
      buildId: currentBuildId(),
      userAgent: req?.headers?.get?.('user-agent') ?? null,
      ...actor,
    });
  } catch {
    /* an error logger that throws is worse than no error logger */
  }
}
