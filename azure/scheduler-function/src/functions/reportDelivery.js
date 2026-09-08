const { app } = require('@azure/functions');

/**
 * Issue reports Phase 2 — the hourly delivery sweep.
 *
 * The same thin shape as complianceTick: no business logic, no database, no
 * knowledge of what a report is. It calls the app's secured endpoint and reports
 * the outcome to its own monitoring.
 *
 * Most reports are emailed inline the moment they are filed. This exists for the
 * ones that are not — a restart mid-send, a Graph outage, or the backlog stored
 * while mail was switched off.
 *
 * Schedule "0 25 * * * *" — hourly at twenty-five past, deliberately offset from
 * complianceTick at five past so the two never contend for the same single
 * instance.
 */

const REQUEST_TIMEOUT_MS = 4 * 60 * 1000;

async function reportDelivery(timer, context) {
  const url = process.env.REPORT_DELIVERY_URL;
  const secret = process.env.SCHEDULER_SECRET;

  if (!url || !secret) {
    context.error(
      'ReportDelivery is not configured: REPORT_DELIVERY_URL and SCHEDULER_SECRET must both be set.',
    );
    throw new Error('Missing REPORT_DELIVERY_URL or SCHEDULER_SECRET');
  }

  if (timer && timer.isPastDue) {
    context.warn('ReportDelivery is running past due — a previous run was missed.');
  }

  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      context.error(`Report delivery endpoint returned ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Report delivery failed with HTTP ${res.status}`);
    }

    context.log(`Report delivery OK: ${text.slice(0, 500)}`);
  } finally {
    clearTimeout(abort);
  }
}

app.timer('reportDelivery', {
  schedule: '0 25 * * * *',
  handler: reportDelivery,
});

module.exports = { reportDelivery };
