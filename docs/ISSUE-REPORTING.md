# Issue reporting and feedback

A "Feedback" control in every experience lets a signed-in person report a bug,
leave feedback or make a suggestion without leaving the page they are on. Every
report gets a reference (`SC-R-0001`, `SC-R-0002`, …) shown back to the sender.

## Phase 1 — capture and storage (live)

The `IssueReport` row is the record. A report is complete once it is stored;
nothing about mail can make a submission slower or able to fail.

- **Entry point** — `components/ui/ReportIssueButton.tsx`, a flag icon labelled
  "Feedback" from 375px up, icon-only below.
  - *Worker* — the identity row beside Sign out on phones; from `sm` up it moves
    into the action group **between Check out and Sign out**.
  - *Platform* — the rail head on phones; on desktop it sits in the **account
    foot, paired with Sign out on one row**.
  - *Admin* — the top-row right cluster, left of Sign out.
  - Worker and Platform each render **two instances** switched by breakpoint.
    Only one is ever in the accessibility tree. Anything that measures or
    screenshots one **must filter for the visible instance** — `querySelector`
    returns the hidden one first.
- **Identity comes from the session cookie only** (`resolveReporter`), never from
  the request body. An unauthenticated caller is refused.
- **Context** captured with consent, shown in an expandable panel before sending:
  page path (query string stripped), page title, build id, active site, viewport,
  and browser/OS/device parsed from the user agent.
- **Rate limits**, per reporter: 1/minute, 10/hour, 30/day.

## Phase 2 — delivery (shipped dark)

Reports are emailed to the tech mailbox via Microsoft Graph `sendMail`.

| File | Responsibility |
| --- | --- |
| `services/reports/reportMailer.ts` | Transport. Token, `sendMail`, and whether a failure is worth retrying. Knows nothing about reports. |
| `services/reports/reportDelivery.ts` | Policy. What the email says, when to retry, what is recorded. |
| `app/api/system/reports/deliver/route.ts` | The hourly sweep, behind `SCHEDULER_SECRET`. |
| `azure/scheduler-function/src/functions/reportDelivery.js` | The timer that calls it, at 25 past the hour. |

**Two paths, deliberately.** The API route fires delivery in the background
after the row exists — never awaited, so the reporter's submission is unaffected
by the mailbox. The hourly sweep catches anything that missed: a restart
mid-send, a Graph outage, a throttle, or the whole backlog stored while mail was
switched off. Both paths skip an already-`SENT` row, so they can race safely.

**Statuses.** `PENDING` still trying · `SENT` delivered · `FAILED` given up ·
`DISABLED` mail is not configured, no attempt consumed.

**Retries.** Five attempts, one per hourly sweep, so a transient outage has most
of a working morning to clear. There is no next-attempt-at column — the sweep's
own cadence is the backoff, which keeps Phase 2 free of a second migration. A
403 or 401 (consent, secret or access policy) is treated as permanent and fails
immediately rather than burning five hours on an error that cannot change.

**Switching it on delivers the backlog.** The sweep picks up `DISABLED` rows as
well as `PENDING` ones, because those were stored before mail existed and have
never had an attempt. Expect the reports already in the table to arrive shortly
after the app settings are added.

### Configuration

All five must be set or mail is off; see `.env.example`. They go on the App
Service (`sitecomply-web`), not in source.

```
REPORT_MAIL_TENANT_ID     the MAILBOX tenant, not the subscription tenant
REPORT_MAIL_CLIENT_ID     the "SiteComply Mailer" app registration
REPORT_MAIL_CLIENT_SECRET
REPORT_MAIL_FROM          tech@sitecomply.co.uk — the mailbox that sends
REPORT_MAIL_TO            where reports land; comma-separated
```

The Function App (`sitecomply-scheduler`) additionally needs
`REPORT_DELIVERY_URL=https://app.sitecomply.co.uk/api/system/reports/deliver`.
It already has `SCHEDULER_SECRET`.

### Entra setup (one-time, Global Administrator)

A **dedicated** app registration, not the `AZURE_AD_*` one behind Admin Centre
sign-in: the mailbox is in a different tenant, and an application-permission
`Mail.Send` grant should be scoped and revocable on its own.

1. **Register.** Entra admin centre → Applications → App registrations → New
   registration. Name `SiteComply Mailer`, single tenant, no redirect URI.
   Keep the **Application (client) ID** and **Directory (tenant) ID**.
2. **Secret.** Certificates & secrets → Client secrets → New. Copy the **Value**
   immediately — it is never shown again. Note the expiry: mail stops when it
   lapses.
3. **Permission.** API permissions → Add → Microsoft Graph → **Application
   permissions** → `Mail.Send` → Add. Then **Grant admin consent**. The status
   column must read "Granted".
4. **Restrict it to one mailbox.** `Mail.Send` as an application permission
   otherwise allows sending as *any* user in the tenant. In Exchange Online
   PowerShell:

   ```powershell
   New-ApplicationAccessPolicy -AppId <client-id> `
     -PolicyScopeGroupId tech@sitecomply.co.uk `
     -AccessRight RestrictAccess `
     -Description "SiteComply Mailer may send only as tech@"
   Test-ApplicationAccessPolicy -Identity tech@sitecomply.co.uk -AppId <client-id>
   ```

   `Test-ApplicationAccessPolicy` must return `AccessCheckResult: Granted`.
   Policy changes can take up to an hour to take effect.
5. **Add the app settings** above and restart the App Service.

### End-to-end test

1. Confirm the settings landed and the app restarted cleanly (health 200).
2. Sign in to any experience, click **Feedback**, send a report. The inline path
   delivers within seconds — do not wait for the timer.
3. Check `tech@sitecomply.co.uk`. The subject is
   `[SiteComply] SC-R-nnnn — <type> from <experience>`.
4. Expect the **backlog** as well: the first sweep picks up every `DISABLED` row,
   so the earlier verification reports (SC-R-0001..0003) arrive too. That is the
   design, not a fault.
5. To force a sweep instead of waiting for :25 past:
   `curl -X POST -H "x-scheduler-secret: <SCHEDULER_SECRET>" \
     https://app.sitecomply.co.uk/api/system/reports/deliver`
   A healthy response reads `{"ok":true,"mail":"enabled",...}`.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `mail":"disabled"` after setting the values | One of the five is missing or blank — config is all-or-nothing. Check for a trailing space. |
| 403 `ErrorAccessDenied` | The access policy (step 4) is missing, names the wrong app id, or has not propagated. Allow an hour. |
| 401 `invalid_client` | Wrong secret, or the secret **ID** was pasted instead of its **Value**. |
| `AADSTS700016` app not found | Registered in the wrong tenant, or `REPORT_MAIL_TENANT_ID` is the subscription tenant rather than the mailbox tenant. |
| 403 with consent granted | `Mail.Send` was added as **Delegated** rather than **Application**. |
| Mail stops months later | The client secret expired. Nothing watches for this yet. |

### Verifying

- `npx tsx scripts/reportdelivery_verify.ts` — runs the real service against the
  local database with the transport injected. Covers the retry policy, the
  status transitions, the duplicate guard, escaping, and the sweep's limit. It
  cannot prove the transport; only production can.
- In production, file a report and check it reaches the mailbox, then confirm the
  row reads `SENT` with a `deliveredAt`.
- If mail is misconfigured the row records why in `deliveryLastError` — a 403
  there almost always means step 4 was skipped or has not propagated yet.

## Later phases

- **Phase 3** — optional screenshot attachment.
- **Phase 4** — an admin view of reports, so triage does not depend on the inbox.
