\set QUIET on
begin;

-- Pinned identifiers go into a temp table via ORDINARY SQL, where psql variable
-- interpolation is certain. The assertion block then reads them from the table, so
-- nothing depends on whether psql substitutes inside a dollar-quoted body.
create temp table _target(vid text, aid text, st text, sc int) on commit drop;
insert into _target values (:'vid', :'aid', :'st', (:'sc')::int);

-- ── EVERY PRE-CONDITION, AS ONE ASSERTION ────────────────────────────────────
-- Raises and aborts unless the row is exactly what the investigation found AND
-- satisfies every condition versionMayBeDeleted() checks. One block, so a partial
-- match cannot slip through between checks.
do $$
declare
  t record;
  v record;
  n_views int; n_jobs int; n_scenes int; n_audio int;
begin
  select * into t from _target;
  select * into v from "InductionVideo" where id = t.vid;

  if v.id is null then
    raise exception 'ABORT: video % no longer exists - it may already be gone', t.vid;
  end if;
  if v."libraryAssetId" is distinct from t.aid then
    raise exception 'ABORT: video belongs to asset %, not the Company Introduction asset %',
      v."libraryAssetId", t.aid;
  end if;
  if v.status::text <> t.st then
    raise exception 'ABORT: status is %, expected % - it has moved on since the investigation',
      v.status, t.st;
  end if;
  if v."publishedAt" is not null then
    raise exception 'ABORT: published at % - a published induction is a record', v."publishedAt";
  end if;
  if v."supersededAt" is not null then
    raise exception 'ABORT: superseded at % - kept as history', v."supersededAt";
  end if;
  if v."approvedAt" is not null then
    raise exception 'ABORT: approved at % - part of the approval workflow', v."approvedAt";
  end if;
  if v."videoBlobPath" is not null or v."captionsBlobPath" is not null
     or v."transcriptBlobPath" is not null then
    raise exception 'ABORT: this version has media in blob storage - delete it through the UI so the blobs go too';
  end if;

  select count(*) into n_views from "InductionVideoView" where "videoId" = t.vid;
  if n_views > 0 then
    raise exception 'ABORT: % operative view(s) - this is the record of an induction', n_views;
  end if;

  select count(*) into n_jobs from "InductionVideoJob" where "videoId" = t.vid;
  if n_jobs > 0 then
    raise exception 'ABORT: % job row(s) exist - confirm none is in flight first', n_jobs;
  end if;

  select count(*), count("audioBlobPath") into n_scenes, n_audio
    from "InductionVideoScene" where "videoId" = t.vid;
  if n_scenes <> t.sc then
    raise exception 'ABORT: % scenes, expected % - the version has been edited', n_scenes, t.sc;
  end if;
  if n_audio > 0 then
    raise exception 'ABORT: % scene(s) carry narration audio in blob storage - delete via the UI', n_audio;
  end if;

  raise notice 'PRE-CONDITIONS OK: version % (%), from module revision %, % scenes, no media, no views, no jobs',
    v.version, v.status, v."sourceModuleRevisionId", n_scenes;
end $$;
\set QUIET off

\echo '--- what is being removed (this row, plus cascades) ---'
select v.id, v.version, v.status, v."sourceModuleRevisionId" as produced_from_revision,
       (select count(*) from "InductionVideoScene" s where s."videoId" = v.id) as scenes,
       (select count(*) from "InductionVideoEvent" e where e."videoId" = v.id) as events
from "InductionVideo" v, _target t where v.id = t.vid;

\echo '--- recorded AI spend, which SURVIVES by design ---'
select count(*) as ai_usage_rows from "AiUsageEvent", _target t where "videoId" = t.vid;

delete from "InductionVideo" where id = (select vid from _target);

\echo '--- after: productions still attached to the Company Introduction asset ---'
select count(*) as remaining_productions
from "InductionVideo", _target t where "libraryAssetId" = t.aid;
