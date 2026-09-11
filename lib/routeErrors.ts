import { NextResponse } from 'next/server';
import { ProjectClosedError } from '@/services/projectClosure/projectWritable';

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
        return NextResponse.json(
          { ok: false, error: err.message, projectClosed: true },
          { status: 409 },
        );
      }
      throw err;
    }
  };
}
