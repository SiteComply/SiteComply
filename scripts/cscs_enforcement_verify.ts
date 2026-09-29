export {};
/**
 * NO VERIFIED CARD, NO SITE ACCESS.
 *
 * The rule: except for designated test accounts, an operative without a verified
 * CSCS/ECS card cannot check in — by either door — and is handed the journey that
 * can change the answer rather than a warning they can walk past.
 *
 * ── WHAT WENT WRONG, SO THE TESTS AIM AT IT ───────────────────────────────
 *
 * The enforcement was never missing. `canWorkerCheckIn` evaluates the site's
 * requirements and is called at the start of a full check-in AND by express
 * check-in. What was missing was anything switched ON: SiteAccessRequirement.enabled
 * defaults to false, rows appear only when a manager toggles one, and five of six
 * live projects had CSCS_VERIFIED explicitly off. So the gate ran, found nothing to
 * enforce, and the advisory banner was the only thing the operative saw.
 *
 * Run: npx tsx scripts/cscs_enforcement_verify.ts
 */
const { prisma } = require('../lib/prisma');
const reqs = require('../services/workerAccess/accessRequirements');
const { canWorkerCheckIn } = require('../services/workerAccess/workerAssignmentService');
const { CARD_FIX_HREF } = require('../services/cscs/cardFixFlow');
const { readFileSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const SITE = 'CSCS_ENF_SITE';
const EXEMPT_MOBILE = '+447700900150';

(async () => {
  // The exemption is an allow-list of mobiles, read from the environment.
  process.env.CSCS_MOCK_MOBILES_ENABLED = '1';
  process.env.CSCS_MOCK_MOBILES = EXEMPT_MOBILE;

  await prisma.jobSite.deleteMany({ where: { jobReference: SITE } });
  await prisma.worker.deleteMany({ where: { mobile: { startsWith: '+4477009001' } } });
  try {
    // A site belongs to the admin who created it; reuse whichever exists locally.
    const admin = await prisma.admin.findFirst({ select: { id: true } });
    if (!admin) throw new Error('no Admin row locally — run `npx tsx prisma/seed.ts`');
    const site = await prisma.jobSite.create({
      data: {
        name: 'CSCS enforcement test', jobReference: SITE, status: 'ACTIVE',
        town: 'Bristol', postcode: 'BS1 1AA', addressLine1: '1 Test Street',
        createdByAdmin: { connect: { id: admin.id } },
      },
    });

    const worker = async (over: Record<string, unknown>) => {
      const w = await prisma.worker.create({
        data: {
          fullName: 'Test Operative', firstName: 'Test', surname: 'Operative',
          company: 'Test Contractor Ltd',
          mobile: over.mobile as string, ...over,
        },
      });
      await prisma.workerSiteAssignment.create({
        data: { workerId: w.id, jobSiteId: site.id, status: 'ACTIVE' },
      });
      return w;
    };

    console.log('\nTHE COMPANY RULE IS ON BY DEFAULT');
    chk('a verified card is required by default',
      reqs.REQUIRED_BY_DEFAULT.includes('CSCS_VERIFIED'),
      'a project used to enforce nothing until somebody remembered to switch it on');
    const noRows = await reqs.enabledRequirementsForSite(site.id);
    chk('a brand-new site with NO requirement rows still requires it',
      noRows.some((r: { requirement: string }) => r.requirement === 'CSCS_VERIFIED'),
      'this is the default that was missing');
    chk('  and nothing else is switched on by default',
      noRows.length === 1, noRows.map((r: {requirement:string}) => r.requirement).join(', '));

    console.log('\nBUT A SITE MAY STILL DELIBERATELY TURN IT OFF');
    await prisma.siteAccessRequirement.create({
      data: { jobSiteId: site.id, requirement: 'CSCS_VERIFIED', enabled: false },
    });
    const off = await reqs.enabledRequirementsForSite(site.id);
    chk('an explicit OFF still wins over the default',
      !off.some((r: { requirement: string }) => r.requirement === 'CSCS_VERIFIED'),
      'a site that has genuinely decided otherwise is not overridden silently');
    await prisma.siteAccessRequirement.update({
      where: { jobSiteId_requirement: { jobSiteId: site.id, requirement: 'CSCS_VERIFIED' } },
      data: { enabled: true },
    });

    console.log('\nFOUR JOURNEYS');
    // 1. A VALID CARD — in.
    const valid = await worker({
      mobile: '+447700900101', cscsVerified: true,
      cscsVerificationStatus: 'VALID', cscsCardNumber: '12345678',
    });
    const validDecision = await canWorkerCheckIn(valid.id, site.id);
    chk('a worker with a VERIFIED card may check in', validDecision.allowed === true,
      validDecision.reason ?? '');

    // 2. UNVERIFIED — Ryan's exact case.
    const unverified = await worker({
      mobile: '+447700900102', cscsVerified: false,
      cscsVerificationStatus: 'UNVERIFIED', cscsCardNumber: '87654321',
    });
    const unverifiedDecision = await canWorkerCheckIn(unverified.id, site.id);
    chk('RYAN\'S CASE: an UNVERIFIED card is refused, not warned',
      unverifiedDecision.allowed === false,
      'the reported fault: a warning was shown and check-in continued');
    chk('  the refusal names the requirement',
      /Verified CSCS card/.test(unverifiedDecision.reason ?? ''),
      unverifiedDecision.reason ?? '');
    chk('  and hands over the remediation journey',
      unverifiedDecision.fix?.href === CARD_FIX_HREF,
      unverifiedDecision.fix?.href ?? 'no route offered');

    // 3. EXPIRED — refused, and told it is expiry, not a missing card.
    const expired = await worker({
      mobile: '+447700900103', cscsVerified: false,
      cscsVerificationStatus: 'EXPIRED', cscsCardNumber: '11112222',
    });
    const expiredDecision = await canWorkerCheckIn(expired.id, site.id);
    chk('an EXPIRED card is refused', expiredDecision.allowed === false);
    chk('  and is told to renew, not to re-check a typo',
      /expired/i.test(expiredDecision.reason ?? '') && /renew/i.test(expiredDecision.reason ?? ''),
      expiredDecision.reason ?? '');
    chk('  and still gets the route out', Boolean(expiredDecision.fix?.href));

    // A withdrawn card must not be told to go and edit a number.
    const revoked = await worker({
      mobile: '+447700900104', cscsVerified: false,
      cscsVerificationStatus: 'REVOKED', cscsCardNumber: '33334444',
    });
    const revokedDecision = await canWorkerCheckIn(revoked.id, site.id);
    chk('a WITHDRAWN card is refused and says so',
      revokedDecision.allowed === false && /withdrawn/i.test(revokedDecision.reason ?? ''),
      'sending somebody to an admin for a scheme decision wastes their day');

    // No card at all.
    const noCard = await worker({ mobile: '+447700900105', cscsVerified: false });
    const noCardDecision = await canWorkerCheckIn(noCard.id, site.id);
    chk('NO card recorded is refused', noCardDecision.allowed === false);
    chk('  and says no card is recorded',
      /No CSCS card is recorded/i.test(noCardDecision.reason ?? ''),
      noCardDecision.reason ?? '');

    // 4. THE DESIGNATED TEST ACCOUNT — exempt, and in.
    const testAccount = await worker({
      mobile: EXEMPT_MOBILE, cscsVerified: false,
      cscsVerificationStatus: 'UNVERIFIED',
    });
    const testDecision = await canWorkerCheckIn(testAccount.id, site.id);
    chk('a DESIGNATED TEST ACCOUNT is exempt and may check in',
      testDecision.allowed === true, testDecision.reason ?? '');
    chk('  and the exemption is an allow-list of mobiles, not a role',
      /isCscsExemptMobile/.test(read('services/workerAccess/accessRequirements.ts')));
    // The exemption must be narrow.
    chk('  which skips ONLY the CSCS requirements',
      /requirement === 'CSCS_VERIFIED' \|\| requirement === 'CSCS_IN_DATE'/.test(
        read('services/workerAccess/accessRequirements.ts')),
      'induction, knowledge check and the rest still apply to a test account');

    console.log('\nA FAILURE TO REACH A VERDICT IS NOT A NEGATIVE VERDICT');
    /*
     * The profile save wrote `cscsVerified = verified` unconditionally, so an ERROR —
     * Smart Check unreachable, not a rejection — silently stripped a good
     * verification. Harmless while nothing enforced the requirement. Now that every
     * project does, it is the difference between working and being turned away, and
     * a CSCS outage would have locked out operatives whose cards are perfectly fine.
     */
    const profile = read('app/api/worker/profile/route.ts');
    chk('an ERROR keeps whatever the previous answer was',
      /const unreachable = verification\?\.status === 'ERROR';/.test(profile) &&
        /const verified = unreachable\s*\n?\s*\? existing\?\.cscsVerified === true/.test(profile),
      'a transient outage must not revoke a verified card');
    chk('  a real verdict is still written exactly as before',
      /: verification\?\.verified === true;/.test(profile),
      'VALID, EXPIRED, REVOKED and NOT_FOUND are the scheme telling us about the card');
    chk('  the errored status is still recorded, so it is visible',
      /cscsVerificationStatus: verification\?\.status \?\? null,/.test(profile));
    chk('  and the verified-at date is not moved by a failed check',
      /cscsVerifiedAt: unreachable/.test(profile),
      'otherwise a card that failed to check looks as though it had just been confirmed');
    // The refusal wording and the write must agree about what ERROR means.
    chk('the refusal text has always called ERROR temporary',
      /could not be checked just now/.test(reqs.cscsRefusalAction('ERROR', true, true)),
      'the wording and the write cannot both be right; the wording was');

    console.log('\nBOTH DOORS, NOT ONE');
    const sub = read('services/submissions/submissionService.ts');
    const exp = read('services/induction/inductionValidityService.ts');
    chk('the full check-in asks before writing', /canWorkerCheckIn\(input\.workerId/.test(sub));
    chk('express check-in asks in its own right', /canWorkerCheckIn\(workerId, siteId\)/.test(exp),
      'enforcing only in one is the second door that makes access control fail');
    chk('both hand the fix route to the screen',
      /fix: access\.fix/.test(sub) && /fix: access\.fix/.test(exp));
    chk('the induction page turns an unauthorised worker away',
      /if \(!access\.allowed\) redirect/.test(read('app/check-in/site/[siteId]/induction/page.tsx')),
      'nobody should complete a whole induction and be refused at the end');
    chk('the site page offers the remediation button',
      /access\.fix && \(/.test(read('app/check-in/site/[siteId]/page.tsx')));
    for (const [what, f] of [
      ['the induction wizard', 'components/checkin/InductionWizard.tsx'],
      ['the express button', 'components/checkin/ExpressCheckInButton.tsx'],
    ] as const) {
      chk(`${what} sends the worker to the fix`, /data\.fix\?\.href/.test(read(f)));
    }

    console.log('\nWHAT IS DELIBERATELY *NOT* ON BY DEFAULT');
    chk('INDUCTION_VALID stays per-site',
      !reqs.REQUIRED_BY_DEFAULT.includes('INDUCTION_VALID'),
      'it is an OUTCOME of inducting: defaulting it on refuses the re-induction that fixes it');
    chk('SIGNATURE_ON_FILE stays per-site',
      !reqs.REQUIRED_BY_DEFAULT.includes('SIGNATURE_ON_FILE'),
      'the signature is captured during the induction it would block');
    chk('  and both are still marked as never blocking a first induction',
      reqs.requirementMeta('INDUCTION_VALID').blocksFirstTime === false &&
        reqs.requirementMeta('SIGNATURE_ON_FILE').blocksFirstTime === false);
    chk('CSCS_VERIFIED, by contrast, DOES block a first induction',
      reqs.requirementMeta('CSCS_VERIFIED').blocksFirstTime === true,
      'a card is a precondition, not something obtained by inducting');
    chk('CSCS_IN_DATE stays off: a VALID result already means not expired',
      !reqs.REQUIRED_BY_DEFAULT.includes('CSCS_IN_DATE'));
  } finally {
    await prisma.worker.deleteMany({ where: { mobile: { startsWith: '+4477009001' } } });
    await prisma.jobSite.deleteMany({ where: { jobReference: SITE } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
