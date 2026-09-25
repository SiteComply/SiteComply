-- "Does this site have temporary works / traffic management / high-risk activities?"
--
-- Asked outright from now on. These were INFERRED from whether the matching
-- textarea was non-empty, so the step that collects the detail only appeared once
-- somebody had already filled it in - nothing ever asked, and a site with real
-- temporary works read as fully set up while its induction had no temporary-works
-- scene.
--
-- NULLABLE AND NOT DEFAULTED, deliberately: null is "not asked yet" and false is
-- an answer, and the completeness check must tell them apart. Existing sites are
-- left null, so they will show these as outstanding - which is true.
ALTER TABLE "SiteInformation"
  ADD COLUMN IF NOT EXISTS "hasTemporaryWorks"     BOOLEAN,
  ADD COLUMN IF NOT EXISTS "hasTrafficManagement"  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "hasHighRiskActivities" BOOLEAN;

-- BACKFILL ONLY WHERE THE SITE HAS ALREADY ANSWERED.
--
-- The old rule was precisely "this applies if the textarea is non-empty". So a
-- site with a temporary-works paragraph HAS temporary works - that is not an
-- inference, it is the answer it already gave, and re-asking would be a
-- regression dressed up as a new requirement.
--
-- The empty case is the ambiguous one and stays null: "we have none" and "nobody
-- asked" are indistinguishable in the old data, and only one of them is complete.
UPDATE "SiteInformation"
   SET "hasTemporaryWorks" = TRUE
 WHERE "hasTemporaryWorks" IS NULL
   AND COALESCE(TRIM("temporaryWorks"), '') <> '';

UPDATE "SiteInformation"
   SET "hasTrafficManagement" = TRUE
 WHERE "hasTrafficManagement" IS NULL
   AND COALESCE(TRIM("trafficManagement"), '') <> '';

UPDATE "SiteInformation"
   SET "hasHighRiskActivities" = TRUE
 WHERE "hasHighRiskActivities" IS NULL
   AND COALESCE(TRIM("highRiskActivities"), '') <> '';
