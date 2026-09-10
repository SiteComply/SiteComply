/**
 * Invite a Worker — invitation code removal, existing-worker handling and the
 * narrowed approval step.
 *
 * Runs the real service against the real local database. The SMS transport is
 * stubbed so the message BODY can be asserted — bodies are deliberately never
 * stored (they used to carry one-time codes), so this is the only way to prove
 * what a worker actually receives.
 *
 * Run: npx tsx scripts/inviteflow_verify.ts
 */
import { WorkerAssignmentStatus } from '@prisma/client';

// Capture SMS instead of sending. Must be stubbed BEFORE the service is loaded.
const outbox: Array<{ to: string; message: string; purpose: string }> = [];
require.cache[require.resolve('../services/sms/smsSendService')] = {
  id: 'smsSendService', filename: 'smsSendService', loaded: true,
  exports: {
    sendAuditedSms: async (a: { to: string; message: string; purpose: string }) => {
      outbox.push(a);
      return { ok: true };
    },
  },
} as never;

process.env.APP_BASE_URL = 'https://app.sitecomply.co.uk';

const { prisma } = require('../lib/prisma');
const svc = require('../services/workerAccess/workerAssignmentService');
const { assignmentStatusLabel } = require('../services/workerAccess/assignmentLabels');

let pass = 0; const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const MOBILE_NEW = '+447700900901';
const MOBILE_EXISTING = '+447700900902';
const made: string[] = [];

async function main() {
  console.log('== INVITE A WORKER ==\n');

  const site = await prisma.jobSite.findFirst({ select: { id: true, name: true } });
  const viewerUser = await prisma.platformUser.findFirst({ select: { id: true, name: true, role: true } });
  if (!site || !viewerUser) { console.log('  ABORT: need a site and a platform user locally'); process.exit(1); }
  const viewer = { id: viewerUser.id, name: viewerUser.name, role: viewerUser.role, siteIds: [site.id] };
  console.log(`  site: ${site.name}   inviter: ${viewer.name} (${viewer.role})\n`);

  // Clean slate for the two mobiles this script owns.
  for (const m of [MOBILE_NEW, MOBILE_EXISTING]) {
    const w = await prisma.worker.findUnique({ where: { mobile: m }, select: { id: true } });
    if (w) { await prisma.workerSiteAssignment.deleteMany({ where: { workerId: w.id } });
             await prisma.workerAssignmentEvent.deleteMany({ where: { workerId: w.id } });
             await prisma.worker.delete({ where: { id: w.id } }); }
  }

  /* ---------------- 1. A brand-new worker ---------------- */
  console.log('[1] Inviting a mobile SiteComply has never seen');
  outbox.length = 0;
  const r1 = await svc.inviteWorker(viewer, site.id, {
    mobile: MOBILE_NEW, fullName: 'Ada Bricklayer', company: 'Bricks Ltd',
  });
  chk('the invitation succeeds', r1.ok === true, r1.ok ? '' : r1.error);
  const w1 = await prisma.worker.findUnique({ where: { mobile: MOBILE_NEW } });
  made.push(w1.id);
  chk('the invited name becomes the worker record', w1.fullName === 'Ada Bricklayer', w1.fullName);
  chk('the invited company becomes the worker record', w1.company === 'Bricks Ltd', w1.company);
  chk('no existing-worker notice is raised', !r1.existingWorker);

  const a1 = await prisma.workerSiteAssignment.findFirst({ where: { workerId: w1.id, jobSiteId: site.id } });
  chk('access is granted outright — no second approval click',
      a1.status === WorkerAssignmentStatus.ACTIVE && r1.autoApproved === true, `${a1.status}`);
  chk('the approval is attributed to the inviter', a1.approvedByName === viewer.name && a1.approvedAt !== null);
  chk('no invitation code is stored', a1.invitationCode === null, String(a1.invitationCode));

  /* ---------------- 2. The SMS ---------------- */
  console.log('\n[2] What the worker actually receives');
  chk('exactly one message was sent', outbox.length === 1);
  const body = outbox[0]?.message ?? '';
  console.log(`      "${body}"`);
  chk('it carries no invitation code', !/invitation code/i.test(body));
  chk('it carries the real URL', body.includes('https://app.sitecomply.co.uk'));
  chk('it does not fall back to the placeholder wording', !/the SiteComply app/.test(body));
  chk('it names the project', body.includes(site.name));

  /* ---------------- 3. A worker already on SiteComply ---------------- */
  console.log('\n[3] Inviting a mobile that already belongs to a worker');
  const existing = await prisma.worker.create({
    data: { mobile: MOBILE_EXISTING, fullName: 'Existing Name', company: 'Existing Co' },
  });
  made.push(existing.id);
  const r2 = await svc.inviteWorker(viewer, site.id, {
    mobile: MOBILE_EXISTING, fullName: 'Typed Name', company: 'Typed Co',
  });
  chk('the invitation succeeds', r2.ok === true);
  const w2 = await prisma.worker.findUnique({ where: { mobile: MOBILE_EXISTING } });
  chk('the existing record is NOT overwritten', w2.fullName === 'Existing Name' && w2.company === 'Existing Co',
      `${w2.fullName} / ${w2.company}`);
  chk('the manager is TOLD which details will be used',
      r2.existingWorker?.fullName === 'Existing Name' && r2.existingWorker?.company === 'Existing Co',
      JSON.stringify(r2.existingWorker));
  chk('a known worker is still auto-approved', r2.autoApproved === true);

  /* ---------------- 4. Approval is kept where it is a real control ---------------- */
  console.log('\n[4] Approval still required where it protects something');
  const a2 = await prisma.workerSiteAssignment.findFirst({ where: { workerId: existing.id, jobSiteId: site.id } });

  await prisma.workerSiteAssignment.update({
    where: { id: a2.id },
    data: { status: WorkerAssignmentStatus.SUSPENDED, suspendedAt: new Date(), suspendedByName: 'Test' },
  });
  const r3 = await svc.inviteWorker(viewer, site.id, { mobile: MOBILE_EXISTING, fullName: 'Re Invited', company: 'Re Co' });
  chk('the re-invitation itself succeeds', r3.ok === true, r3.ok ? '' : r3.error);
  const a3 = await prisma.workerSiteAssignment.findFirst({ where: { workerId: existing.id, jobSiteId: site.id } });
  chk('re-inviting a SUSPENDED worker does NOT restore access',
      a3.status === WorkerAssignmentStatus.INVITED && r3.autoApproved === false, `${a3.status}`);

  await prisma.workerSiteAssignment.update({
    where: { id: a2.id },
    data: { status: WorkerAssignmentStatus.REMOVED, removedAt: new Date() },
  });
  const r4 = await svc.inviteWorker(viewer, site.id, { mobile: MOBILE_EXISTING, fullName: 'Re Invited', company: 'Re Co' });
  chk('the re-invitation itself succeeds', r4.ok === true, r4.ok ? '' : r4.error);
  const a4 = await prisma.workerSiteAssignment.findFirst({ where: { workerId: existing.id, jobSiteId: site.id } });
  chk('re-inviting a REMOVED worker does NOT restore access',
      a4.status === WorkerAssignmentStatus.INVITED && r4.autoApproved === false, `${a4.status}`);

  /* ---------------- 5. Safety is unchanged ---------------- */
  console.log('\n[5] Auto-approval does not bypass competency or induction');
  const gateApproved = svc.evaluateAssignmentGate(
    true, { invitedWorkersOnly: true, requireActiveSiteAssignment: true },
    { status: WorkerAssignmentStatus.ACTIVE, startDate: null, endDate: null });
  chk('an ACTIVE assignment still defers to the requirement checks',
      gateApproved.blocked === false && gateApproved.requirementsPending === true,
      `blocked=${gateApproved.blocked} requirementsPending=${gateApproved.requirementsPending}`);
  const gateInvited = svc.evaluateAssignmentGate(
    true, { invitedWorkersOnly: true, requireActiveSiteAssignment: true },
    { status: WorkerAssignmentStatus.INVITED, startDate: null, endDate: null });
  chk('an INVITED assignment is still blocked', gateInvited.blocked === true, gateInvited.short);

  /* ---------------- 6. Audit trail ---------------- */
  console.log('\n[6] The history still explains what happened');
  const events = await prisma.workerAssignmentEvent.findMany({
    where: { workerId: w1.id }, orderBy: { createdAt: 'asc' }, select: { action: true, detail: true },
  });
  chk('the invitation is recorded', events.some((e: any) => e.action === 'INVITED'));
  chk('the approval is recorded as its own event, not inferred',
      events.some((e: any) => e.action === 'APPROVED' && /automatically/i.test(e.detail ?? '')),
      events.map((e: any) => e.action).join(' → '));

  /* ---------------- 7. Invited until first check-in ---------------- */
  console.log('\n[7] The roster says Invited until the worker turns up');
  const fresh = await prisma.workerSiteAssignment.findFirst({ where: { workerId: w1.id, jobSiteId: site.id } });
  chk('a newly invited worker has no acceptance yet', fresh.acceptedAt === null);
  chk('...and is labelled Invited, not Approved',
      assignmentStatusLabel(fresh) === 'Invited', assignmentStatusLabel(fresh));
  chk('no approval wording appears for a normal invite',
      !/approv/i.test(assignmentStatusLabel(fresh)), assignmentStatusLabel(fresh));

  await svc.recordAcceptance(w1.id, site.id);
  const arrived = await prisma.workerSiteAssignment.findFirst({ where: { workerId: w1.id, jobSiteId: site.id } });
  chk('checking in records the acceptance', arrived.acceptedAt !== null);
  chk('...and the label becomes Active', assignmentStatusLabel(arrived) === 'Active', assignmentStatusLabel(arrived));

  const before = arrived.acceptedAt;
  await svc.recordAcceptance(w1.id, site.id);
  const again = await prisma.workerSiteAssignment.findFirst({ where: { workerId: w1.id, jobSiteId: site.id } });
  chk('a second check-in does not move the first-arrival time',
      again.acceptedAt.getTime() === before.getTime());

  console.log('\n[8] Approval wording only where approval applies');
  chk('a SUSPENDED row still reads as suspended',
      assignmentStatusLabel({ status: 'SUSPENDED', acceptedAt: null }) === 'Suspended');
  chk('a genuinely INVITED row still says Awaiting approval',
      assignmentStatusLabel({ status: 'INVITED', acceptedAt: null }) === 'Awaiting approval');
  chk('an accepted ACTIVE row never says approved',
      !/approv/i.test(assignmentStatusLabel({ status: 'ACTIVE', acceptedAt: new Date() })));

  console.log('\n[9] Check-in wires acceptance for real');
  const src = require('fs').readFileSync('services/submissions/submissionService.ts', 'utf8');
  chk('the check-in path calls recordAcceptance', /recordAcceptance\(input\.workerId, input\.siteId\)/.test(src));
  chk('...and does not await it into the check-in result', /void recordAcceptance/.test(src));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { for (const f of failures) console.log(`   FAILED: ${f}`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const id of made) {
    await prisma.workerAssignmentEvent.deleteMany({ where: { workerId: id } });
    await prisma.workerSiteAssignment.deleteMany({ where: { workerId: id } });
    await prisma.worker.deleteMany({ where: { id } });
  }
  console.log(`   cleaned up ${made.length} test workers`);
  await prisma.$disconnect();
});
