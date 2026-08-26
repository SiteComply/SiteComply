# CSCS Smart Check — mock behaviour and go-live cutover

What the CSCS integration does **today** (mock), which records that has produced, and the
checklist for retiring mock verification when Smart Check is connected.

**Status: known pre-go-live dependency.** SiteComply is not yet in customer use, so this is
recorded and scheduled rather than treated as a live production defect. Reviewed
26 August 2026. **No code changes have been made.**

> Every item under [§4 Cutover checklist](#4-cutover-checklist) must be completed **before
> the first customer uses the platform**, not merely before Smart Check is connected. The
> mock's output is indistinguishable from a real verification to anyone reading the UI.

---

## 1. Current behaviour

### How the mock gets selected

```
getCscsProvider()  →  process.env.CSCS_PROVIDER?.toLowerCase() || 'mock'
resolveCscsProvider() →  CscsConfig.activeProvider  (defaults to 'mock')
```

`CSCS_PROVIDER` is **not set** in the `sitecomply-web` App Service, and `CscsConfig`
defaults to `activeProvider = 'mock'`. Both paths therefore resolve to
`MockCscsProvider`. It is selected in production today.

### What the mock returns

`services/cscs/mockProvider.ts` derives a deterministic result from the card number:

| Card number | Result |
|---|---|
| empty / unusable | `UNVERIFIED`, `verified: false` |
| contains `0000` or `FAIL` | `NOT_FOUND`, `verified: false` |
| contains `REVOKED` | `REVOKED`, `verified: false` |
| an expiry hint in the past | `EXPIRED`, `verified: false` |
| **anything else** | **`VALID`, `verified: true`** |

So any plausible card number that avoids those four trigger strings verifies successfully.

### What a VALID mock result writes to the worker record

Set by `app/api/worker/profile/route.ts` from the verification result:

| Field | Value written | Real? |
|---|---|---|
| `cscsVerified` | `true` | **fabricated** |
| `cscsVerificationStatus` | `'VALID'` | **fabricated** |
| `cscsVerifiedAt` | the time of the check | real timestamp, meaningless check |
| `cscsScheme` | `'ECS'` if the number contains letters, else `'CSCS'` | **guessed** |
| `cscsCardType` | the typed hint, else `BLUE_SKILLED` ("Skilled Worker") | **defaulted** |
| `cscsExpiry` | the typed hint, else **verification date + 3 years** | **fabricated** |
| `cscsHolderName` | whatever the worker typed | echoed, unverified |
| `cscsQualifications` | invented competency records for the card grade | **fabricated** |

Two details worth calling out:

- **The expiry is invented.** With no expiry hint the mock writes *today + 3 years*. A card
  that expired last year can be recorded as valid until 2029.
- **The message asserts a real check.** The mock returns
  `"Card verified against the CSCS Smart Check service."` — a claim the system is not
  entitled to make. This is the string a worker sees.

### Where it surfaces

Live and **not behind a feature flag**:

- `app/check-in/details/page.tsx` and `components/checkin/IdentityForm.tsx` — card capture
- `components/checkin/CscsCompetencyBanner.tsx` — the worker's competency banner
- `app/platform/dashboard/workers/[id]/page.tsx` — the platform worker record
- `app/platform/dashboard/reports/cscs/page.tsx` — the CSCS report
- `app/admin/(dashboard)/submissions/[id]/page.tsx` — admin check-in detail

Nothing in any of these distinguishes a mock result from a real one.

### The consequential one: site access

`services/workerAccess/accessRequirements.ts` gates entry on the `CSCS_VERIFIED`
requirement, which reads `worker.cscsVerified` — the flag the mock sets to `true`:

```ts
case 'CSCS_VERIFIED':
  if (!worker.cscsVerified) { unmet.push({ requirement, ... }); }
```

If any site has `CSCS_VERIFIED` enabled, a worker can satisfy a competency gate with an
invented card number. §3 query 4 answers whether any site currently does.

---

## 2. Identifying affected records

**Every `cscsVerified = true` row in production is mock-derived by definition**, because the
mock has been the only provider ever active. No heuristic is required for the headline
figure.

For per-attempt evidence, `CscsVerificationLog` records a `provider` column on every
attempt — including failures — so mock results are precisely attributable:

```sql
SELECT provider, status, verified, COUNT(*)
FROM "CscsVerificationLog"
GROUP BY provider, status, verified;
```

Anything other than `provider = 'mock'` would mean a real Smart Check call has happened.

> **Caveat.** `CscsVerificationLog` and `CscsConfig` were added by migration
> `20260814090000_cscs_smartcheck_readiness`, and production has never been confirmed to
> have it applied (prod's startup command is `next start`, so `prisma migrate deploy` never
> runs). If the table is absent the log is empty and only the `Worker` columns are
> available — which is still sufficient, since the Worker columns predate it
> (`20260625060232_init` and `20260724092046_add_cscs_smart_check`).

**Run `scripts/audit_cscs_mock_verifications.sql`** (read-only, Cloud Shell) for the full
picture: counts, the affected rows with every mock-written field, per-provider log
attempts, whether any site gates on `CSCS_VERIFIED`, and the active provider in the
database.

**Result of the run:** _not yet executed — the production database is reachable only from
Azure Cloud Shell. Record the output here when run._

---

## 3. Two viable positions before go-live

Either is defensible; they are not equivalent.

| | **A — make the mock inert in production** | **B — hide the CSCS surfaces** |
|---|---|---|
| Change | `MockCscsProvider` refuses to construct (or returns `UNVERIFIED`) when `NODE_ENV === 'production'` | Feature-flag the capture, badges, report and the `CSCS_VERIFIED` requirement |
| Effect | Card capture still works; nothing is ever marked verified | The CSCS journey disappears until Smart Check is live |
| Pro | One small change; makes the file's own "Never selected in production" comment true by construction | No half-finished capability visible to a customer |
| Con | Workers see a permanent "unverified" state with no explanation | Larger change; more to unpick at go-live |

**Recommendation: A**, with the banner copy adjusted to say verification is not yet
available rather than that the card failed. It is the smaller change, it closes the hole
permanently regardless of environment variables, and it keeps the capture data that Smart
Check will later verify.

---

## 4. Cutover checklist

### Phase 1 — before the first customer (independent of Smart Check)

- [ ] **Decide A or B** above and implement it.
- [ ] **Run `scripts/audit_cscs_mock_verifications.sql`** and paste the output into §2.
- [ ] **Confirm whether any site has `CSCS_VERIFIED` enabled.** If so, disable it until real
      verification is live — a competency gate satisfied by an invented number is worse than
      no gate, because it produces a record asserting the check was done.
- [ ] **Reset mock-derived verification data.** Not just the boolean — clear
      `cscsVerified`, `cscsVerificationStatus`, `cscsVerifiedAt`, `cscsScheme`,
      `cscsExpiry` (where it was the invented +3-year default) and `cscsQualifications`.
      Keep `cscsCardNumber`, `cscsCardType` and `cscsCardImagePath`: those are what the
      worker actually supplied and are exactly what Smart Check will verify later.
- [ ] **Decide the audit-trail position on existing `CscsVerificationLog` rows.** They are
      correctly attributed to `provider = 'mock'`, so they are honest history. Recommend
      keeping them rather than deleting — they record that a mock check happened, which is
      true.
- [ ] **Confirm migration `20260814090000_cscs_smartcheck_readiness` is applied**
      (see the wider migration reconciliation in `docs/AUTH-OVERRIDE-CUTOVER.md` §5).

### Phase 2 — when Smart Check is connected

- [ ] **Obtain Smart Check partner credentials** from CSCS (the material external
      dependency).
- [ ] **Store credentials in the database**, via Admin → Settings, not as App Service
      environment variables — the same pattern Twilio uses, so secrets stay encrypted at
      rest. (Note `AZURE_OPENAI_KEY` and others are still plaintext app settings; that is a
      separate finding.)
- [ ] **Switch `CscsConfig.activeProvider` to `smartcheck`** and verify with the built-in
      connection test (`app/api/admin/settings/cscs/test`), which exercises the same
      endpoint, auth header and field names as `verifyCard()`.
- [ ] **Verify a known-good card end to end** — expect `provider = 'smartcheck'` in
      `CscsVerificationLog`, not `mock`.
- [ ] **Verify a known-bad card** returns `NOT_FOUND` or `EXPIRED` rather than `VALID`.
      This is the check that proves the mock is genuinely retired: the mock returns `VALID`
      for anything that is not one of its four trigger strings.
- [ ] **Confirm `CscsVerificationLog` shows zero new `mock` rows** after cutover.
- [ ] **Re-verify any worker whose data was reset in Phase 1**, so the fabricated records
      are replaced by real ones rather than simply absent.
- [ ] **Re-enable `CSCS_VERIFIED`** on the sites that need it, now that it means something.
- [ ] **Remove or neutralise `MockCscsProvider`** so it cannot be selected again — or leave
      it, if Phase 1 option A already makes it inert in production.

### Phase 3 — after go-live

- [ ] Watch `CscsVerificationLog` for `status = 'ERROR'` rows — the `durationMs` column
      exists for partner SLA questions.
- [ ] Add an alert if verification error rates rise (there is currently **no monitoring or
      alerting at all** in production — a separate High finding).

---

## 5. Summary

| | |
|---|---|
| **Today** | Mock provider active in production; returns VALID for any plausible card number; writes a fabricated expiry and invented qualifications; asserts "verified against the CSCS Smart Check service" |
| **Blast radius** | Every `cscsVerified = true` row; any site gating on `CSCS_VERIFIED` |
| **Identifiable?** | Yes, precisely — `CscsVerificationLog.provider = 'mock'`, and by definition all verified rows |
| **External dependency** | CSCS Smart Check partner credentials — the only material one outstanding |
| **Must be done before customers** | Phase 1 (independent of CSCS) |
| **Must be done at go-live** | Phase 2 |
