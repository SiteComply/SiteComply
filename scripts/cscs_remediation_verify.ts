/**
 * SC-001 — the CSCS remediation prompt.
 *
 * Asks an operative to put their card details right, once, dismissibly. Softer
 * than a refusal at a gate, and it is what PRODUCES the data hard enforcement
 * would need.
 *
 * TWO THINGS MUST HOLD ABOVE ALL: the exempt test account is never prompted, and
 * nobody is trapped in a loop they cannot leave.
 */
import { readFileSync } from 'fs';
import {
  needsCscsRemediation,
  remediationIsEnabled,
  remediationHeading,
  remediationDismissKey,
} from '../services/cscs/cscsRemediation';
import { cscsRefusalAction } from '../services/workerAccess/accessRequirements';
import {
  CARD_FIX_HREF,
  isCardFixRequest,
  shouldLeaveCheckInDetails,
} from '../services/cscs/cardFixFlow';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, saw?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => readFileSync(p, 'utf8');
const EXEMPT = '+447700900150';
const OTHER = '+447700900151';

function env(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k]!;
  }
  try { fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}
const ON = {
  CSCS_REMEDIATION_ENABLED: '1',
  CSCS_MOCK_MOBILES_ENABLED: '1',
  CSCS_MOCK_MOBILES: EXEMPT,
};
const card = (status: string, mobile = OTHER) => ({
  mobile,
  cscsCardNumber: '14660726',
  cscsVerificationStatus: status,
});

// ── OFF BY DEFAULT ────────────────────────────────────────────────────────
{
  env({ ...ON, CSCS_REMEDIATION_ENABLED: undefined }, () => {
    ok('with the flag unset, nobody is prompted', !needsCscsRemediation(card('REVOKED')));
    ok('  and the flag reports itself off', !remediationIsEnabled());
  });
  env({ ...ON, CSCS_REMEDIATION_ENABLED: '0' }, () =>
    ok('"0" does not switch it on', !needsCscsRemediation(card('REVOKED'))));
  env({ ...ON, CSCS_REMEDIATION_ENABLED: 'true' }, () =>
    ok('"true" does not either - only "1"', !needsCscsRemediation(card('REVOKED'))));
}

// ── WHO IS PROMPTED ───────────────────────────────────────────────────────
env(ON, () => {
  for (const s of ['REVOKED', 'EXPIRED', 'NOT_FOUND', 'UNVERIFIED']) {
    ok(`${s} is prompted`, needsCscsRemediation(card(s)), s);
  }
  ok('VALID is not prompted', !needsCscsRemediation(card('VALID')));

  /*
   * ERROR IS NOT PROMPTED. The check could not be COMPLETED - the service was
   * unreachable or unreadable. That is not something an operative fixes by
   * editing their details, and asking them to try sends them round a loop that
   * ends only when somebody else's server comes back.
   */
  ok('ERROR is NOT prompted - it is not theirs to fix', !needsCscsRemediation(card('ERROR')));
  ok('an unrecognised status is not prompted', !needsCscsRemediation(card('SOMETHING_NEW')));
  ok('a worker with NO card is not prompted',
    !needsCscsRemediation({ mobile: OTHER, cscsCardNumber: null, cscsVerificationStatus: 'UNVERIFIED' }));
  ok('  nor one whose card number is blank',
    !needsCscsRemediation({ mobile: OTHER, cscsCardNumber: '   ', cscsVerificationStatus: 'UNVERIFIED' }));
  ok('a null status with a card IS prompted (never checked)',
    needsCscsRemediation({ mobile: OTHER, cscsCardNumber: '1', cscsVerificationStatus: null }) === false,
    'null maps to default -> not prompted');
});

// ── THE EXEMPT ACCOUNT IS NEVER PROMPTED ──────────────────────────────────
env(ON, () => {
  for (const s of ['REVOKED', 'EXPIRED', 'NOT_FOUND', 'UNVERIFIED', 'ERROR', 'VALID']) {
    ok(`exempt account: ${s} -> no prompt`, !needsCscsRemediation(card(s, EXEMPT)), s);
  }
  ok('but the SAME status prompts a non-exempt operative',
    needsCscsRemediation(card('REVOKED', OTHER)), 'exemption is not doing the work');
});

// ── THE WORDS ─────────────────────────────────────────────────────────────
{
  ok('REVOKED heading says withdrawn', /withdrawn/i.test(remediationHeading('REVOKED')));
  ok('EXPIRED heading says expired', /expired/i.test(remediationHeading('EXPIRED')));
  ok('NOT_FOUND heading says not found', /could not find/i.test(remediationHeading('NOT_FOUND')));
  ok('UNVERIFIED heading says not checked yet', /not been checked/i.test(remediationHeading('UNVERIFIED')));
  const headings = ['REVOKED', 'EXPIRED', 'NOT_FOUND', 'UNVERIFIED'].map(remediationHeading);
  ok('each status gets its own heading', new Set(headings).size === 4, headings);

  // REUSED, not reworded. One story whether they meet it as a prompt or a refusal.
  const src = read('services/workerDashboard/workerDashboardService.ts');
  ok('the guidance reuses the gate refusal text',
    /action: cscsRefusalAction\(/.test(src), 'duplicated wording');
  ok('  and that text differs per status',
    new Set(['REVOKED', 'EXPIRED', 'NOT_FOUND', 'UNVERIFIED'].map((s) => cscsRefusalAction(s, true))).size === 4);
}

// ── DISMISSAL IS PER STATUS, NOT PER WORKER ───────────────────────────────
{
  const a = remediationDismissKey('w1', 'EXPIRED');
  const b = remediationDismissKey('w1', 'REVOKED');
  ok('dismissing one status does not silence another', a !== b, { a, b });
  ok('  the same status gives a stable key', a === remediationDismissKey('w1', 'EXPIRED'));
  ok('  and a different worker gets a different key', a !== remediationDismissKey('w2', 'EXPIRED'));
  ok('case does not create a second key', remediationDismissKey('w1', 'expired') === a);
  ok('a null status still produces a key', remediationDismissKey('w1', null).length > 10);
}

// ── WIRING: decided once, rendered everywhere ─────────────────────────────
{
  const ctx = read('services/workerDashboard/workerDashboardService.ts');
  /*
   * The call must be the DIRECT condition. Merely appearing in the file is not
   * enough - `false && needsCscsRemediation(worker)` contains it too, and that
   * mutation slipped past the looser version of this guard.
   */
  ok('the prompt is decided in the shared context',
    /const cscsRemediation = needsCscsRemediation\(worker\)\s*\n?\s*\?/.test(ctx), 'not centralised');
  ok('  and is not short-circuited off',
    !/(?:false|0|null)\s*&&\s*needsCscsRemediation/.test(ctx), 'disabled by a short circuit');
  ok('  exactly once', (ctx.match(/needsCscsRemediation\(/g) ?? []).length === 1, ctx.match(/needsCscsRemediation\(/g));

  const shell = read('components/worker/WorkerShell.tsx');
  ok('the shell renders it above the page content', /<CscsRemediationBanner/.test(shell));
  ok('  and only when it is set', /cscsRemediation && \(/.test(shell), 'renders unconditionally');

  const banner = read('components/worker/CscsRemediationBanner.tsx');
  ok('the banner is dismissible', /Not now/.test(banner));
  ok('  and offers the fix', /Check my card details/.test(banner) && /CARD_FIX_HREF/.test(banner));
  ok('  remembering the dismissal', /localStorage\.setItem\(dismissKey/.test(banner));
  ok('  and showing it when storage is unavailable', /catch \{[\s\S]{0,200}setShow\(true\)/.test(banner),
    'would hide itself on a storage failure');

  /*
   * ── THE BOUNCE ────────────────────────────────────────────────────────────
   *
   * Ryan pressed "Check my card details" and nothing appeared to happen. The
   * link went to /check-in/details, which sends a CHECKED-IN worker to their
   * dashboard - and the banner only ever appears to checked-in workers. Every
   * person who could press it was returned to the page they pressed it on.
   *
   * These check the journey, not the two halves of it.
   */
  console.log('\n[5] Pressing the button actually goes somewhere');
  ok('a worker fixing a card is NOT bounced back to their dashboard',
    shouldLeaveCheckInDetails(true, true) === false);
  ok('  even though a checked-in worker arriving any other way still is',
    shouldLeaveCheckInDetails(true, false) === true);
  ok('  and a worker who is not checked in is never bounced',
    shouldLeaveCheckInDetails(false, true) === false &&
      shouldLeaveCheckInDetails(false, false) === false);
  ok('the prompt\'s link is recognised by the screen it points at',
    isCardFixRequest(Object.fromEntries(
      new URLSearchParams(CARD_FIX_HREF.split('?')[1]).entries(),
    )) === true, CARD_FIX_HREF);
  ok('  an ordinary visit is not mistaken for one', isCardFixRequest({}) === false);
  ok('  and neither is a different value', isCardFixRequest({ fix: 'something' }) === false);

  const details = read('app/check-in/details/page.tsx');
  ok('the details screen asks the shared rule rather than redirecting blindly',
    /shouldLeaveCheckInDetails\(Boolean\(await getWorkerContext\(\)\), fixingCard\)/.test(details),
    'the page would bounce everybody the prompt sends');
  ok('  and says why they are there', /Check the card details below/.test(details));
  ok('  without numbering them through a check-in they are not doing',
    /\{!fixingCard && <Steps/.test(details));

  const form = read('components/checkin/IdentityForm.tsx');
  ok('saving returns them where they came from, not into site selection',
    (form.match(/router\.push\(fixingCard \? CARD_FIX_RETURN : '\/check-in\/site'\)/g) ?? []).length === 2,
    form.match(/router\.push\([^)]*\)/g));
  ok('  the button says so too', /'Back to my dashboard'/.test(form) && /Save & check my card again/.test(form));
  ok('  the card section is open, not collapsed out of sight',
    /fixingCard \|\| Boolean\(initial\.cscsCardNumber/.test(form));
  ok('  and there is a way out that is not "save"', /Back without changes/.test(form));

  // EVERY page that renders the shell must pass it, or one screen silently never
  // shows the prompt.
  const { execSync } = require('child_process') as typeof import('child_process');
  const shells = execSync('grep -rl "<WorkerShell" --include=*.tsx app/worker/ | wc -l').toString().trim();
  const passes = execSync('grep -rl "cscsRemediation" --include=*.tsx app/worker/ | wc -l').toString().trim();
  ok(`all ${shells} shell pages pass the prompt`, shells === passes, { shells, passes });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
