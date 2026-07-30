/**
 * SC-020 Phase 4 — the hourly compliance generation timer.
 *
 * Deliberately thin: it holds NO business logic, no database access and no
 * schedule knowledge. All it does is call the app's secured tick endpoint, so
 * generation, escalation and their idempotency stay in one place in the app
 * where they are tested. If this file ever needs to know about compliance
 * rules, something has been put in the wrong layer.
 *
 * Schedule "0 5 * * * *" — hourly at five past, avoiding the top of the hour
 * where every other scheduled thing in the world runs.
 *
 * The app is the source of truth for run history: it records every run,
 * including failures, in SchedulerRun. This function only needs to make the
 * call and log the outcome.
 */

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

module.exports = async function complianceTick(context, timer) {
  const url = process.env.TICK_URL;
  const secret = process.env.SCHEDULER_SECRET;

  if (!url || !secret) {
    // Fail loudly. A silently misconfigured timer is indistinguishable from a
    // quiet hour, which is the exact failure this whole phase exists to prevent.
    context.log.error(
      'ComplianceTick is not configured: TICK_URL and SCHEDULER_SECRET must both be set.',
    );
    throw new Error('Missing TICK_URL or SCHEDULER_SECRET');
  }

  if (timer && timer.isPastDue) {
    context.log.warn('ComplianceTick is running past due — a previous run was missed.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-scheduler-secret': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ source: 'azure-timer' }),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      // Throwing marks the invocation failed so it is visible in the function's
      // own monitoring as well as in the app's SchedulerRun history.
      context.log.error(`Tick endpoint returned ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Tick failed with HTTP ${res.status}`);
    }

    context.log(`Tick OK: ${text.slice(0, 500)}`);
  } finally {
    clearTimeout(timeout);
  }
};
