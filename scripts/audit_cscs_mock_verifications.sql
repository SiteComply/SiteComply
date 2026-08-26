-- ============================================================================
-- SiteComply — identify worker records carrying CSCS data produced by the MOCK
-- Smart Check provider.
--
-- READ-ONLY. Nothing is written, altered or locked.
--
-- WHY THIS IS NEEDED
-- The mock provider has been the only active CSCS provider in production
-- (CSCS_PROVIDER is unset and CscsConfig defaults to activeProvider='mock').
-- It returns VALID/verified for any plausible card number and writes a
-- fabricated expiry and fabricated qualification records to the Worker row.
-- Every cscsVerified = true in production is therefore mock-derived by
-- definition — this script quantifies it and lists the affected rows.
--
-- Run from Azure Cloud Shell:
--   RAW=$(az webapp config appsettings list -g rgSiteComply -n sitecomply-web \
--           --query "[?name=='DATABASE_URL'].value" -o tsv)
--   DB=$(printf '%s' "$RAW" | sed -E 's/[?&]schema=[^&]*//')
--   psql "$DB" -f audit_cscs_mock_verifications.sql
-- ============================================================================

\echo '=== 0. Is the CSCS readiness migration applied? (CscsConfig / CscsVerificationLog) ==='
SELECT
  to_regclass('public."CscsConfig"')            IS NOT NULL AS cscsconfig_exists,
  to_regclass('public."CscsVerificationLog"')   IS NOT NULL AS verificationlog_exists;
\echo '(If either is false, migration 20260814090000_cscs_smartcheck_readiness is NOT applied.'
\echo ' Section 3 will then return nothing — sections 1 and 2 remain valid regardless.)'
\echo ''

\echo '=== 1. HEADLINE: how many worker records carry mock-derived CSCS data? ==='
SELECT
  COUNT(*)                                                      AS workers_total,
  COUNT(*) FILTER (WHERE "cscsCardNumber" IS NOT NULL)          AS with_a_card_number,
  COUNT(*) FILTER (WHERE "cscsVerified")                        AS marked_verified,
  COUNT(*) FILTER (WHERE "cscsVerificationStatus" = 'VALID')    AS status_valid,
  COUNT(*) FILTER (WHERE "cscsQualifications" IS NOT NULL)      AS with_fabricated_qualifications,
  COUNT(*) FILTER (WHERE "cscsExpiry" IS NOT NULL AND "cscsVerified")
                                                                AS with_fabricated_expiry
FROM "Worker";
\echo ''

\echo '=== 2. The affected worker rows, with every mock-written field ==='
\echo '(cscsExpiry on a verified row is the mock default: verification date + 3 years,'
\echo ' unless the worker typed an expiry hint. cscsQualifications are invented.)'
SELECT
  w.id,
  w."fullName",
  w.company,
  w."cscsCardNumber",
  w."cscsCardType",
  w."cscsScheme",
  w."cscsVerificationStatus"                      AS status,
  w."cscsVerified"                                AS verified,
  w."cscsVerifiedAt",
  w."cscsExpiry",
  (w."cscsQualifications" IS NOT NULL)            AS has_qualifications,
  (w."cscsCardImagePath" IS NOT NULL)             AS has_card_image
FROM "Worker" w
WHERE w."cscsVerified"
   OR w."cscsVerificationStatus" IS NOT NULL
   OR w."cscsCardNumber" IS NOT NULL
ORDER BY w."cscsVerifiedAt" DESC NULLS LAST, w."fullName";
\echo ''

\echo '=== 3. Per-attempt evidence from the verification log (if the table exists) ==='
\echo '(provider = the provider that produced the result. Anything other than'
\echo ' "mock" would mean a real Smart Check call has occurred.)'
SELECT
  l.provider,
  l.status,
  l.verified,
  COUNT(*)                AS attempts,
  MIN(l."createdAt")      AS first_seen,
  MAX(l."createdAt")      AS last_seen
FROM "CscsVerificationLog" l
GROUP BY l.provider, l.status, l.verified
ORDER BY l.provider, l.status;
\echo ''

\echo '=== 4. Do any sites currently GATE access on CSCS_VERIFIED? ==='
\echo '(If enabled = true anywhere, mock verification is not just cosmetic —'
\echo ' it is satisfying a live site-access requirement.)'
SELECT
  j.name                AS site,
  r.requirement::text   AS requirement,
  r.enabled
FROM "SiteAccessRequirement" r
JOIN "JobSite" j ON j.id = r."jobSiteId"
WHERE r.requirement::text = 'CSCS_VERIFIED'
ORDER BY r.enabled DESC, j.name;
\echo ''

\echo '=== 5. Which CSCS provider does the database say is active? ==='
SELECT id, "activeProvider", "updatedAt" FROM "CscsConfig";
