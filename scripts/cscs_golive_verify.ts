/**
 * SC-001 — the three changes that make Smart Check ready to switch on.
 *
 *   1. A card number obliges a surname and a scheme.
 *   2. Incomplete details are reported as ours, not as a CSCS failure.
 *   3. One operative's card can be checked without switching the live provider.
 */
import { readFileSync } from 'fs';
import { CscsDetailsMissingError } from '../services/cscs/CscsProvider';
import { cardRequestBody } from '../services/cscs/smartCheckProvider';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');

// ── 1. a card obliges a surname and a scheme ──────────────────────────────
{
  const route = read('app/api/worker/profile/route.ts');
  const guard = route.slice(route.indexOf('A CARD NUMBER OBLIGES'), route.indexOf('A CARD NUMBER OBLIGES') + 1400);
  ok('the server requires a surname when a card is given', /surname\.trim\(\)\.length < 2/.test(guard), 'missing');
  ok('  and a recognised scheme', /!isKnownScheme\(fields\.cscsSchemeId\)/.test(guard), 'missing');
  ok('  ONLY when a card number is present', /if \(fields\.cscsCardNumber\.trim\(\)\) \{/.test(guard), 'not conditional');
  ok('  telling the operative which field, not just "invalid"',
    /Please enter your surname/.test(guard) && /Please choose the scheme/.test(guard), guard.slice(0, 200));

  const form = read('components/checkin/IdentityForm.tsx');
  ok('the form checks before the round trip',
    /if \(form\.cscsCardNumber\.trim\(\)\) \{[\s\S]{0,400}form\.surname\.trim\(\)\.length < 2/.test(form),
    'no client guard');
  ok('  and opens the card section so the field is visible',
    (form.match(/setShowCscs\(true\);\s*\n\s*toast\.error/g) ?? []).length === 2, 'section not opened');
  ok('  the scheme is only demanded when the picker is usable',
    /schemesAreUsable\(\) && !form\.cscsSchemeId\.trim\(\)/.test(form), 'would demand an unofferable field');

  // A worker with NO card must not be asked for either.
  ok('no card means no surname requirement',
    !/if \(true\) \{[\s\S]{0,80}surname\.trim\(\)\.length < 2/.test(route), 'unconditional');
}

// ── 2. incomplete details are OUR problem, said honestly ──────────────────
{
  ok('a distinct error type exists', typeof CscsDetailsMissingError === 'function');
  let err: CscsDetailsMissingError | null = null;
  try { cardRequestBody({ cardNumber: '1', surname: '', schemeId: '' } as never); }
  catch (e) { err = e as CscsDetailsMissingError; }
  ok('an incomplete lookup throws it', err instanceof CscsDetailsMissingError, err?.constructor?.name);
  ok('  naming what is missing as data, not prose to regex',
    Array.isArray(err?.missing) && err!.missing.length === 2, err?.missing);
  ok('  in words an operative would recognise',
    err!.missing.every((m) => /surname|scheme/i.test(m)), err?.missing);

  const svc = read('services/cscs/cscsVerificationService.ts');
  ok('the service distinguishes it by TYPE, not by message',
    /error instanceof CscsDetailsMissingError/.test(svc), 'matching on prose');
  ok('  reporting UNVERIFIED, because no check was attempted',
    /detailsMissing \? 'UNVERIFIED' : 'ERROR'/.test(svc), 'reported as a service failure');
  ok('  with a message that asks for what is needed',
    /We need your \$\{[^}]+\} to check this card/.test(svc), 'still blames the service');
  ok('  and the audit row records the same status',
    (svc.match(/detailsMissing \? 'UNVERIFIED' : 'ERROR'/g) ?? []).length === 2, 'log disagrees with the result');
  ok('a genuine provider failure is STILL an ERROR',
    /: messageForStatus\('ERROR', null\)/.test(svc), 'error path lost');
}

// ── 3. one card, without switching the provider ───────────────────────────
{
  const route = read('app/api/platform/workers/[id]/cscs-check/route.ts');
  ok('the action is POST-only and platform-guarded',
    /requirePlatformViewer\(\)/.test(route) && /permits\(viewer\.role/.test(route), 'unguarded');
  ok('  requiring edit rights, because it writes a competency record',
    /'checkins', 'edit'/.test(route), 'view-only would be wrong');
  ok('it builds the LIVE provider explicitly, not whatever is configured',
    /new SmartCheckCscsProvider\(/.test(route), 'would run the mock');
  // Asserted on CODE, not the file. The comment above that line explains why
  // resolveCscsProvider is deliberately NOT used, and matching the file caught
  // the explanation instead of the behaviour - the same trap as asserting on a
  // migration's comments rather than its statements.
  const routeCode = route
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
  ok('  and does not resolve the configured provider',
    !/resolveCscsProvider\(/.test(routeCode), 'resolves the configured one');
  ok('credentials come from stored config, never from the request',
    /getCscsRuntimeConfig\(\)/.test(route) && !/req\.json\(\)/.test(route), 'accepts input');
  ok('it refuses for the exempt test account',
    /isCscsExemptMobile\(worker\.mobile\)/.test(route), 'exemption ignored');
  ok('  saying why, not just refusing', /never sent to CSCS/.test(route));
  ok('it refuses when the worker lacks card, surname or scheme',
    /if \(missing\.length\) \{/.test(routeCode) && /card check cannot run/.test(route),
    'no completeness guard');
  ok('it acts on ONE worker from the URL, never a batch',
    /params\.id/.test(route) && !/findMany/.test(route), 'batch capable');
  ok('the result is recorded like any other verification',
    /verifyCscsCard\(/.test(route), 'result discarded');

  const svc = read('services/cscs/cscsVerificationService.ts');
  ok('the override is opt-in; every other caller gets the configured provider',
    /input\.providerOverride \?\? \(await resolveCscsProvider\(input\.mobile\)\)/.test(svc), 'default changed');

  const page = read('app/platform/dashboard/workers/[id]/page.tsx');
  ok('the button is offered only for a worker WITH a card',
    /!worker\.cscsExempt && worker\.cscsCardNumber && \(/.test(page), 'offered without a card');
  ok('  and never for the exempt account', /!worker\.cscsExempt/.test(page));

  const btn = read('components/platform/CscsCheckNowButton.tsx');
  ok('the button says it reaches CSCS even on the test provider',
    /even while the platform\s*\n?\s*is set to the test provider/.test(btn.replace(/\s+/g, ' ')) ||
    /Runs against CSCS even while/.test(btn.replace(/\s+/g, ' ')), 'label is ambiguous');
  ok('  and shows what to compare against the physical card',
    /Name on card/.test(btn) && /Type:/.test(btn) && /Scheme:/.test(btn), 'result not actionable');
  ok('  refreshing so the record does not disagree with the answer',
    /router\.refresh\(\)/.test(btn), 'stale record left on screen');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
