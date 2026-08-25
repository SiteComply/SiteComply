-- ============================================================================
-- SiteComply — correct the "Toolbox Talk" audit-template description in PROD.
--
-- Removes the SC-018 internal reference. Touches ONE column of ONE row.
-- Does NOT touch other templates, template items, categories, schedules or any
-- other seeded content.
--
-- Self-protecting: the guarded UPDATE must match exactly one row, or it raises
-- and the whole statement rolls back. Safe to re-run — a second run matches
-- zero rows, reports that, and changes nothing.
--
-- Deliberately NOT using scripts/seed-audit-templates.ts: that rewrites every
-- system template AND does deleteMany/createMany on all template items.
-- ============================================================================

\echo '--- BEFORE ---'
SELECT id, name, "isSystem", description
FROM "AuditTemplate"
WHERE name = 'Toolbox Talk';

DO $$
DECLARE n integer;
BEGIN
  UPDATE "AuditTemplate"
     SET description = 'A supervisor-delivered safety briefing, recorded as a scheduled compliance activity.'
   WHERE name = 'Toolbox Talk'
     AND "isSystem" = true
     AND description LIKE '%SC-018%';

  GET DIAGNOSTICS n = ROW_COUNT;

  IF n <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly 1 matching row, found %. No change made (rolled back).', n;
  END IF;

  RAISE NOTICE 'OK: updated % row.', n;
END $$;

\echo '--- AFTER ---'
SELECT id, name, "isSystem", description
FROM "AuditTemplate"
WHERE name = 'Toolbox Talk';

\echo '--- VERIFY: any SC-0xx / REV-1 left anywhere in the database? (expect 0 rows) ---'
SELECT t.table_name, t.column_name,
       unnest(xpath('//v/text()', t.x))::text AS match_value
FROM (
  SELECT c.table_name, c.column_name,
         query_to_xml(
           format('SELECT %I::text AS v FROM public.%I WHERE %I::text ~ %L LIMIT 50',
                  c.column_name, c.table_name, c.column_name,
                  'SC-0[0-2][0-9]|REV[- ]?1|rev1'),
           false, false, '') AS x
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND tb.table_type = 'BASE TABLE'
    AND c.data_type IN ('text', 'character varying')
) t
WHERE cardinality(xpath('//v/text()', t.x)) > 0
ORDER BY 1, 2;
