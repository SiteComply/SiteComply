\set QUIET on
begin;

create temp table _plan(slug text, act text) on commit drop;
insert into _plan values
  ('PPE_EXPECTATIONS','retire'),
  ('HOUSEKEEPING','retire'),
  ('ENVIRONMENTAL_AWARENESS','retire'),
  ('MANUAL_HANDLING','optional'),
  ('COMPANY_INTRODUCTION','promote');

-- ── PRE-CONDITIONS, ALL OR NOTHING ───────────────────────────────────────────
do $$
declare n int; d int;
begin
  select count(*) into n from "InductionModule" m join _plan p on p.slug = m.slug;
  if n <> 5 then
    raise exception 'ABORT: expected all 5 named modules in production, found %', n;
  end if;
  -- A site that has recorded its own decision about a module being retired is a
  -- conversation, not a migration: stop and let somebody look.
  select count(*) into d
    from "SiteInductionModule" s
    join "InductionModule" m on m.id = s."moduleId"
    join _plan p on p.slug = m.slug
   where p.act = 'retire';
  if d > 0 then
    raise exception 'ABORT: % per-site decision(s) exist for a module being retired', d;
  end if;
  raise notice 'PRE-CONDITIONS OK: 5 modules present, no per-site decisions on the retirements';
end $$;
\set QUIET off

\echo '--- before ---'
select m.slug, m.active, m.mandatory, m."defaultIncluded",
       (select count(*) from "InductionModuleRevision" r
         where r."moduleId"=m.id and r.status='ISSUED' and r."supersededAt" is null) as issued_live
from "InductionModule" m join _plan p on p.slug=m.slug order by m."order";

-- RETIRE: kept for history, left out of every future induction. Published
-- inductions are untouched - they hold the wording they were approved with.
update "InductionModule" set active = false
where slug in (select slug from _plan where act='retire');

-- OPTIONAL: still available, never on unless a project opts in.
update "InductionModule" set "defaultIncluded" = false
where slug in (select slug from _plan where act='optional');

-- PROMOTE: the one genuinely universal module, which was switched off and so has
-- been reaching nobody despite being issued.
update "InductionModule" set mandatory = true, "defaultIncluded" = true
where slug in (select slug from _plan where act='promote');

\echo '--- after ---'
select m.slug, m.active, m.mandatory, m."defaultIncluded"
from "InductionModule" m order by m."order";

\echo '--- what an induction now carries from the company band ---'
select count(*) as modules_reaching_sites
from "InductionModule" m
where m.active
  and exists (select 1 from "InductionModuleRevision" r
               where r."moduleId"=m.id and r.status='ISSUED' and r."supersededAt" is null)
  and (m.mandatory or m."defaultIncluded");
