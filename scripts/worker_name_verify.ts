/**
 * SC-001 UX — First name + Surname, with fullName derived.
 *
 * THE PROPERTY THAT MATTERS: fullName must keep working exactly as it does
 * today. Roughly 200 places read it — reports, exports, close-out PDFs,
 * induction signatures, search and sort — including documents already issued
 * and signed. It is now composed rather than typed; nothing that reads it
 * changes.
 */
import { readFileSync } from 'fs';
import { composeFullName, openingFirstName } from '../services/workers/workerName';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');

// ── composing the display name ────────────────────────────────────────────
{
  ok('two parts join with one space', composeFullName('Jordan', 'Smith') === 'Jordan Smith');
  ok('  surrounding space is trimmed', composeFullName('  Jordan ', ' Smith  ') === 'Jordan Smith');
  ok('  a compound surname is preserved whole',
    composeFullName('Anna', 'van der Berg') === 'Anna van der Berg');
  ok('a missing part does not leave a dangling space',
    composeFullName('Jordan', '') === 'Jordan' && composeFullName('', 'Smith') === 'Smith');
  ok('nothing composes to empty, not to " "', composeFullName(null, null) === '');
  ok('  and to empty for undefined too', composeFullName(undefined, undefined) === '');
}

// ── opening an existing record ────────────────────────────────────────────
{
  ok('a stored first name is used as-is',
    openingFirstName({ firstName: 'Jo', surname: 'Smith', fullName: 'Jordan Smith' }) === 'Jo');
  ok('an exact suffix match yields the remainder',
    openingFirstName({ surname: 'Smith', fullName: 'Jordan Smith' }) === 'Jordan');
  ok('  including a compound surname',
    openingFirstName({ surname: 'van der Berg', fullName: 'Anna van der Berg' }) === 'Anna');

  /*
   * FAMILY NAME FIRST. "Zhang Wei" does not END with "Zhang", so nothing is
   * inferred and the whole name is handed back for the worker to correct. A
   * word-splitting rule would have produced "Wei" here, which is wrong, or an
   * empty box, which loses what we had.
   */
  ok('family-name-first is left alone, not mangled',
    openingFirstName({ surname: 'Zhang', fullName: 'Zhang Wei' }) === 'Zhang Wei');
  ok('a surname that is not a suffix is ignored',
    openingFirstName({ surname: 'Jones', fullName: 'Jordan Smith' }) === 'Jordan Smith');
  ok('a fullName equal to the surname yields the whole thing, not empty',
    openingFirstName({ surname: 'Smith', fullName: 'Smith' }) === 'Smith');
  ok('no surname means the whole name is offered for correction',
    openingFirstName({ fullName: 'Jordan Smith' }) === 'Jordan Smith');
  ok('an empty record opens empty', openingFirstName({}) === '');
  ok('matching is case-insensitive',
    openingFirstName({ surname: 'SMITH', fullName: 'Jordan Smith' }) === 'Jordan');
  // A bare substring must NOT match - only a whole trailing word.
  ok('a partial word is not treated as a suffix',
    openingFirstName({ surname: 'mith', fullName: 'Jordan Smith' }) === 'Jordan Smith');
}

// ── fullName survives, and is derived ─────────────────────────────────────
{
  const schemaFile = read('prisma/schema.prisma');
  /*
   * SCOPED TO THE WORKER MODEL. A second model also has a `fullName String`
   * column, and an unscoped regex matched THAT one - so making Worker.fullName
   * optional slipped past a guard that looked like it was watching for exactly
   * that. Mutation testing found it; reading would not have.
   */
  const schema = schemaFile.slice(
    schemaFile.indexOf('model Worker {'),
    schemaFile.indexOf('\n}', schemaFile.indexOf('model Worker {')),
  );
  ok('the guard is reading the Worker model', /model Worker \{/.test('model Worker {') && schema.includes('cscsCardNumber'), schema.slice(0, 60));
  ok('Worker.fullName is STILL required', /\n\s*fullName\s+String\n/.test(schema), 'changed or dropped');
  ok('firstName was added, nullable', /firstName\s+String\?/.test(schema));
  ok('surname is still nullable', /surname\s+String\?/.test(schema));

  const route = read('app/api/worker/profile/route.ts');
  ok('the route composes fullName rather than accepting one',
    /const fullName = composeFullName\(/.test(route), 'still typed');
  ok('  and no longer reads a fullName field from the request',
    !/fields\.fullName/.test(route), 'still reading a typed fullName');
  ok('both parts are required', /Please enter your first name/.test(route) && /Please enter your surname/.test(route));
  ok('the composed name is what gets stored', /^\s*fullName,$/m.test(route), 'not stored');
  ok('Smart Check still receives the SURNAME field, not a parsed name',
    /surname: fields\.surname\?\.trim\(\) \|\| null,/.test(route), 'verification input changed');

  const svc = read('services/workers/workerService.ts');
  ok('firstName is written on create and update',
    (svc.match(/^\s*firstName,$/gm) ?? []).length === 2, svc.match(/^\s*firstName,$/gm));
  ok('GDPR erasure clears the first name too', /firstName: null,/.test(svc));
}

// ── the form asks for a person, not a card ────────────────────────────────
{
  const form = read('components/checkin/IdentityForm.tsx');
  ok('the form asks for a First name', /label="First name"/.test(form));
  ok('  with the right autocomplete', /autoComplete="given-name"/.test(form));
  ok('there is no Full name box any more', !/label="Full name"/.test(form), 'still asking twice');
  ok('the surname is no longer described as a card attribute',
    !/as it appears on your card/.test(form), 'still framed as card data');

  // ORDER: first name, surname, company - then the card section.
  const iFirst = form.indexOf('label="First name"');
  const iSur = form.indexOf('label="Surname"');
  const iCo = form.indexOf('label="Company"');
  const iCard = form.indexOf('CSCS / ECS card details');
  ok('the order is First name, Surname, Company', iFirst < iSur && iSur < iCo, { iFirst, iSur, iCo });
  ok('  and all three sit ABOVE the card section', iCo < iCard, { iCo, iCard });
}

// ── nothing that READS fullName had to change ─────────────────────────────
{
  for (const [what, file, needle] of [
    ['the CSCS report', 'services/reports/cscsReport.ts', "orderBy: { fullName: 'asc' }"],
    ['check-in search', 'services/submissions/submissionQueryService.ts', 'fullName: { contains: q'],
    ['check-in sort', 'services/submissions/checkinSort.ts', 'worker: { fullName: dir }'],
    ['the close-out PDF', 'services/closeOut/closeOutService.ts', 'r.worker.fullName'],
  ] as [string, string, string][]) {
    ok(`${what} still reads fullName, untouched`, read(file).includes(needle), needle);
  }
}

// ── the migration is additive and touches nothing ─────────────────────────
{
  const sql = read(`${process.env.HOME}/worker_firstname.sql`)
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  ok('the migration only ADDs', !/DROP|RENAME|UPDATE |DELETE/i.test(sql), sql);
  ok('  nullable, no default', !/NOT NULL|DEFAULT/i.test(sql), sql);
  ok('  and never rewrites fullName', !/fullName/i.test(sql), sql);
  ok('  safe to re-run', /IF NOT EXISTS/.test(sql));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
