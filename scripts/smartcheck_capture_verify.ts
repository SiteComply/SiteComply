/**
 * SC-001 — capturing what a Smart Check lookup actually needs.
 *
 * V2.6 identifies a card by scheme id + surname + registration number.
 * SiteComply held only the third. This suite covers the two new fields end to
 * end: schema, capture, persistence, erasure, and the deliberate refusal to
 * guess either of them.
 *
 * THE RULE BEING PROTECTED: a wrong surname or scheme returns "not found", and
 * "not found" at a site gate reads as a rejected card. Every assertion below
 * exists so a competent worker is never turned away by a value we invented.
 */
import { readFileSync } from 'fs';
import {
  CSCS_SCHEMES,
  SCHEME_LIST_EXHAUSTIVE,
  schemesAreUsable,
  schemeById,
  isKnownScheme,
} from '../services/cscs/schemes';
import { cardRequestBody } from '../services/cscs/smartCheckProvider';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');

// ── schema: additive and nullable ─────────────────────────────────────────
{
  const schema = read('prisma/schema.prisma');
  /*
   * TO THE MODEL'S CLOSING BRACE, not a fixed 2500 characters.
   *
   * The window version silently shrank its own coverage: adding doc comments to
   * the model pushed cscsHolderName past 2500 chars and the guard reported a
   * dropped column that was sitting right there. A length is not a boundary.
   */
  const worker = schema.slice(
    schema.indexOf('model Worker {'),
    schema.indexOf('\n}', schema.indexOf('model Worker {')),
  );
  ok('Worker.surname exists', /\n\s*surname\s+String\?/.test(worker), 'missing');
  ok('  and is NULLABLE — nothing is backfilled', /surname\s+String\?/.test(worker));
  ok('Worker.cscsSchemeId exists', /cscsSchemeId\s+String\?/.test(worker), 'missing');
  ok('  and is NULLABLE', /cscsSchemeId\s+String\?/.test(worker));
  ok('fullName is untouched', /\n\s*fullName\s+String\n/.test(worker), 'fullName changed');
  ok('cscsScheme (the verified OUTPUT) is still separate',
    /cscsScheme\s+String\?/.test(worker) && worker.includes('cscsSchemeId'), 'conflated');
  ok('no column was renamed or dropped',
    ['cscsCardNumber', 'cscsCardType', 'cscsExpiry', 'cscsVerified', 'cscsHolderName']
      .every((f) => worker.includes(f)), 'a field went missing');
}

// ── the migration is additive, nullable, and re-runnable ──────────────────
{
  // Assert on the STATEMENTS, not the file. The first version of this matched
  // the migration's own comments — "no column is renamed" contains RENAME, and
  // "no default is written" contains DEFAULT — so it failed a migration that was
  // correct, while a genuinely destructive statement in a commented-out line
  // would have failed it for the right reason by accident.
  const sqlFile = read(`${process.env.HOME}/worker_smartcheck_fields.sql`);
  const sql = sqlFile
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  ok('the migration only ADDs', !/DROP|RENAME|UPDATE |DELETE/i.test(sql), sql);
  ok('  columns are nullable (no NOT NULL, no DEFAULT)', !/NOT NULL|DEFAULT/i.test(sql), sql);
  ok('  and it is safe to re-run', (sql.match(/IF NOT EXISTS/g) ?? []).length === 2, sql);
  ok('  it touches only the Worker table',
    (sql.match(/ALTER TABLE "(\w+)"/g) ?? []).every((m) => m.includes('"Worker"')), sql);
  ok('  and adds exactly the two columns',
    (sql.match(/ADD COLUMN/g) ?? []).length === 2, sql);
  const verify = read(`${process.env.HOME}/worker_smartcheck_fields_verify.sql`);
  ok('verification checks nothing was backfilled', /surname_set|schemeid_set/.test(verify));
  ok('verification checks the counts are unchanged', /verification_rows/.test(verify));
}

// ── the scheme list: honest about being incomplete ────────────────────────
{
  // Supplied as "at a minimum", so usable is true while exhaustive stays false.
  // Those are different questions and conflating them would either hide a
  // working picker or claim a completeness nobody stated.
  ok('the list is not claimed to be exhaustive', SCHEME_LIST_EXHAUSTIVE === false);
  ok('  but it IS usable — seventeen is a real choice', schemesAreUsable() === true);
  ok('all seventeen supplied schemes are present', CSCS_SCHEMES.length === 17, CSCS_SCHEMES.length);
  // Transcribed, not remembered. A single wrong character fails silently.
  const SUPPLIED: [string, string][] = [
    ['C4T', 'CSCS'], ['OUQ', 'JIB PMES'], ['Z2T', 'ECITB ACE'], ['9ZA', 'BESA'],
    ['ROT', 'IPAF'], ['R7S', 'PASMA'], ['HEZ', 'EUSR'], ['P5Y', 'NPORS'],
    ['4UC', 'Lantra TTM'], ['JHW', 'AMI'], ['U19', 'ALLMI'], ['MRD', 'TICA'],
    ['WKN', 'ACAD'], ['62O', 'GEA'], ['WP8', 'ICATS'], ['3W0', 'CSR'],
    ['LO7', 'ADSA DHF'],
  ];
  ok('every id and name matches what was supplied, character for character',
    SUPPLIED.every(([id, name], i) => CSCS_SCHEMES[i]?.id === id && CSCS_SCHEMES[i]?.name === name),
    CSCS_SCHEMES);
  ok('  in the order supplied', CSCS_SCHEMES[0]?.id === 'C4T' && CSCS_SCHEMES[16]?.id === 'LO7');
  ok('the O/0 pairs are preserved distinctly',
    schemeById('62O')?.name === 'GEA' && schemeById('3W0')?.name === 'CSR' &&
    schemeById('620') === undefined && schemeById('3WO') === undefined,
    'letter O and digit zero confused');
  ok('every entry has an id and a display name',
    CSCS_SCHEMES.every((s) => s.id.trim() && s.name.trim()), CSCS_SCHEMES);
  ok('ids are unique', new Set(CSCS_SCHEMES.map((s) => s.id)).size === CSCS_SCHEMES.length);
  ok('a known id resolves', schemeById('C4T')?.id === 'C4T');
  ok('an unknown id does NOT resolve', schemeById('NOPE') === undefined);
  ok('  and is not treated as known', isKnownScheme('NOPE') === false);
  ok('a blank id is not known', isKnownScheme('') === false && isKnownScheme(null) === false);
  // The flag and the list must agree, or "complete" becomes a lie left behind.
  ok('usability follows the list, not a hand-maintained flag',
    schemesAreUsable() === CSCS_SCHEMES.length > 1);
}

// ── capture: asked, never derived ─────────────────────────────────────────
{
  const form = read('components/checkin/IdentityForm.tsx');
  ok('the form asks for a Surname', form.includes('label="Surname"'));
  ok('  with the right autocomplete for a family name', form.includes("autoComplete=\"family-name\""));
  ok('  and it is bound to its own field', form.includes("update('surname'"));
  ok('the form NEVER splits fullName',
    !/fullName[^\n]*\.split\(/.test(form) && !/\.split\([^)]*\)\s*\.pop\(\)/.test(form), 'name parsing found');
  ok('the scheme picker is a SELECT, not a text box',
    form.includes('id="cscsSchemeId"') && form.includes('<select'), 'not a select');
  ok('  populated from the one registry', form.includes('CSCS_SCHEMES.map'));
  ok('  and gated on the list being usable', form.includes('schemesAreUsable()'));
  ok('  with a way out for a scheme that is not listed',
    /not listed/i.test(form), 'no guidance for an absent scheme');
  ok('both fields are submitted', form.includes("fd.append('surname'") && form.includes("fd.append('cscsSchemeId'"));
}

// ── nothing is guessed anywhere in the CSCS path ──────────────────────────
{
  const files = [
    'services/cscs/smartCheckProvider.ts',
    'services/cscs/cscsVerificationService.ts',
    'app/api/worker/profile/route.ts',
    'services/workers/workerService.ts',
  ];
  for (const f of files) {
    const src = read(f);
    ok(`${f} does not derive a surname from a name`,
      !/split\(['"\s]/.test(src) || !/fullName/.test(src.slice(Math.max(0, src.indexOf('split(')) - 200, src.indexOf('split(') + 200)),
      'possible name parsing');
  }
  const route = read('app/api/worker/profile/route.ts');
  ok('an unrecognised scheme id is dropped, not forwarded',
    /isKnownScheme\(fields\.cscsSchemeId\)/.test(route), 'no validation');
}

// ── the lookup refuses rather than improvises ─────────────────────────────
{
  const full = cardRequestBody({ cardNumber: '14660726', surname: 'Zhang', schemeId: 'C4T' });
  ok('a complete input builds a lookup', Object.keys(full).length === 4, full);
  for (const [label, input, expect] of [
    ['missing surname', { cardNumber: '1', schemeId: 'C4T' }, /surname/],
    ['missing scheme', { cardNumber: '1', surname: 'Z' }, /scheme ID/],
  ] as [string, Record<string, unknown>, RegExp][]) {
    let msg = '';
    try { cardRequestBody(input as never); } catch (e) { msg = (e as Error).message; }
    ok(`${label} → refused`, expect.test(msg), msg || '(did not throw)');
    ok(`  and the message names what is missing, not the worker`, !/invalid|rejected/i.test(msg), msg);
  }
}

// ── persistence and erasure ───────────────────────────────────────────────
{
  const svc = read('services/workers/workerService.ts');
  ok('both fields are written on create', /surname,/.test(svc) && /cscsSchemeId: input\.cscsSchemeId/.test(svc));
  ok('both fields are written on update', (svc.match(/cscsSchemeId: data\.cscsSchemeId/g) ?? []).length === 1, 'update missing');
  const erase = svc.slice(svc.indexOf("fullName: 'Erased (UK GDPR)'"), svc.indexOf("fullName: 'Erased (UK GDPR)'") + 1200);
  ok('GDPR erasure clears the surname — it is a personal identifier',
    /surname: null/.test(erase), erase.slice(0, 200));
  ok('  and clears the scheme id', /cscsSchemeId: null/.test(erase));
}

// ── the admin can SEE what is missing, and why it matters ─────────────────
{
  const page = read('app/platform/dashboard/workers/[id]/page.tsx');
  ok('the worker view shows the surname', page.includes('label="Surname"'));
  ok('  and the card scheme by NAME, not raw id', page.includes('schemeById(worker.cscsSchemeId)?.name'));
  ok('  and says plainly when a card cannot be checked',
    /cannot be checked until/.test(page), 'no explanation');
  const detail = read('services/workers/workerDetailService.ts');
  ok('both fields are in the explicit select',
    /surname: true/.test(detail) && /cscsSchemeId: true/.test(detail), 'select missing a field');
  ok('  and in the declared return type',
    /surname: string \| null/.test(detail) && /cscsSchemeId: string \| null/.test(detail), 'type missing a field');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
