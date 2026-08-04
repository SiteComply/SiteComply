/**
 * SC-017 FOLLOW-UP — checks for the superseded-original rule.
 *
 * The rule decides which photo IS the evidence. Getting it wrong in either
 * direction is serious: hide too much and an audit loses a photo nobody can
 * find; hide too little and the duplication this change exists to remove comes
 * straight back into the close-out pack a client reads.
 */
import {
  supersededOriginalIds,
  markSuperseded,
} from '@/services/annotations/supersededEvidence';
import { excludeIds } from '@/services/annotations/supersededEvidenceQuery';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const row = (
  id: string,
  annotated = false,
  originalEvidenceId: string | null = null,
) => ({
  id,
  annotated,
  originalEvidenceId,
});

console.log('== the pair ==');
{
  const rows = [row('orig'), row('ann', true, 'orig')];
  const ids = supersededOriginalIds(rows);
  check('the original of an annotated photo is superseded', ids.has('orig'));
  check('the annotated copy itself is never superseded', !ids.has('ann'));
  const marked = markSuperseded(rows);
  check('every row is returned, tagged, never dropped', marked.length === 2);
  check(
    'the tag lands on the original only',
    marked.find((r) => r.id === 'orig')!.supersededOriginal &&
      !marked.find((r) => r.id === 'ann')!.supersededOriginal,
  );
}

console.log('\n== a lone photo ==');
{
  const ids = supersededOriginalIds([row('solo')]);
  check('an un-annotated photo is not hidden', ids.size === 0);
}

console.log('\n== the annotated copy is deleted ==');
{
  // This is the self-healing case: with the copy gone, the original must come
  // back. A stored flag would leave it hidden forever.
  const ids = supersededOriginalIds([row('orig')]);
  check(
    'the original returns as soon as its annotated copy is gone',
    ids.size === 0,
  );
}

console.log('\n== the ORIGINAL is deleted, copy remains ==');
{
  const ids = supersededOriginalIds([row('ann', true, 'orig')]);
  check(
    'a dangling link hides nothing',
    ids.size === 0,
    'nothing to hide, so nothing is claimed to exist',
  );
}

console.log('\n== several photos on one finding ==');
{
  const rows = [
    row('o1'),
    row('a1', true, 'o1'),
    row('o2'),
    row('a2', true, 'o2'),
    row('plainPdf'),
  ];
  const ids = supersededOriginalIds(rows);
  check(
    'each original is matched to its OWN copy',
    ids.has('o1') && ids.has('o2'),
  );
  check('an unrelated file is untouched', !ids.has('plainPdf'));
  check('exactly two are hidden', ids.size === 2, `${ids.size}`);
  const visible = markSuperseded(rows).filter((r) => !r.supersededOriginal);
  check(
    'three items are presented for five rows',
    visible.length === 3,
    visible.map((v) => v.id).join(','),
  );
}

console.log('\n== rows from a different finding cannot interfere ==');
{
  // markSuperseded is applied per finding for exactly this reason.
  const findingA = [row('x'), row('xa', true, 'x')];
  const findingB = [row('y')];
  check(
    'an id from another finding does not hide anything here',
    !supersededOriginalIds(findingB).has('x'),
  );
  check(
    'and its own finding still resolves',
    supersededOriginalIds(findingA).has('x'),
  );
}

console.log('\n== annotated flag without a link ==');
{
  // A flattened photo saved with no source — should never happen, but if it
  // does it must not hide an arbitrary row.
  const ids = supersededOriginalIds([row('a', true, null), row('b')]);
  check('an annotated row with no link hides nothing', ids.size === 0);
}

console.log('\n== the query-side exclusion filter ==');
{
  check(
    'no superseded ids means no filter at all',
    excludeIds([]) === undefined,
  );
  check(
    'ids produce a notIn filter',
    JSON.stringify(excludeIds(['a', 'b'])) === '{"notIn":["a","b"]}',
    JSON.stringify(excludeIds(['a', 'b'])),
  );
}

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail === 0 ? 0 : 1);
