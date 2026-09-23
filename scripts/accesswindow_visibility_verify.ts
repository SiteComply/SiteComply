/**
 * An assignment outside its access window must LOOK refused.
 *
 * THE DEFECT: the roster read "Active" for an operative whose access period had
 * ended, while the gate refused them with "Access ended 26/08/2026". Manager and
 * operative saw different truths, and the only warning the page carried looked
 * seven days AHEAD - never at a window that had already lapsed.
 *
 * Run: npx tsx scripts/accesswindow_visibility_verify.ts
 */
import { readFileSync } from 'fs';
import {
  assignmentStatusLabel,
  assignmentStatusClass,
} from '../services/workerAccess/assignmentLabels';

let pass = 0; const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');
const ENDED = new Date(Date.parse('2026-08-26T00:00:00Z'));
const STARTS = new Date(Date.parse('2026-10-01T00:00:00Z'));

function main() {
  console.log('== EXPIRED ACCESS IS VISIBLE ==\n');

  console.log('[1] The label states the window, not just the status');
  ok('an ACTIVE assignment past its end date reads "Access ended"',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: new Date(), windowState: 'expired', endDate: ENDED })
      === 'Access ended 26/08/2026',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: new Date(), windowState: 'expired', endDate: ENDED }));
  ok('  even for someone who has arrived before - they cannot check in now',
    !/Active/.test(assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: new Date(), windowState: 'expired', endDate: ENDED })));
  ok('  and it is coloured like everything else that stops a worker',
    assignmentStatusClass({ status: 'ACTIVE', arrivedAt: null, windowState: 'expired', endDate: ENDED }).includes('danger'));
  ok('an assignment whose window has not started says so',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: null, windowState: 'pending', startDate: STARTS })
      === 'Access starts 01/10/2026');
  ok('an open window is unchanged: arrived reads Active',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: new Date(), windowState: 'open' }) === 'Active');
  ok('  and not-yet-arrived still reads Invited',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: null, windowState: 'open' }) === 'Invited');
  ok('no window at all is unchanged',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: null }) === 'Invited' &&
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: new Date() }) === 'Active');
  ok('"expired" with no date falls back rather than printing a gap',
    assignmentStatusLabel({ status: 'ACTIVE', arrivedAt: new Date(), windowState: 'expired', endDate: null }) === 'Active');
  ok('the other statuses are untouched',
    assignmentStatusLabel({ status: 'SUSPENDED', arrivedAt: null }) === 'Suspended' &&
    assignmentStatusLabel({ status: 'INVITED', arrivedAt: null }) === 'Awaiting approval' &&
    assignmentStatusLabel({ status: 'REMOVED', arrivedAt: null }) === 'Removed from project');

  console.log('\n[2] The roster says it too');
  const page = read('app/platform/dashboard/sites/[id]/workers/page.tsx');
  ok('an expired window is its own roster state', /'access-ended': 'Access ended'/.test(page));
  ok('  reached from the assignment window, not from attendance',
    /windowState === 'expired'\) return 'access-ended'/.test(page));
  ok('  and shown in the refusing colour', /'access-ended': 'bg-danger-50 text-danger-700'/.test(page));
  ok('a window that has not started is shown too', /'access-pending': 'Access not started'/.test(page));
  ok('being ON SITE still wins - they are here, whatever the dates say',
    /if \(r\.checkedInAt && !r\.checkedOutAt\) return 'on-site';/.test(page));
  ok('the page warns about windows that have ALREADY ended, not only ones expiring soon',
    /const accessEnded = assignments\.filter\(/.test(page) && /cannot check in: their access period has ended/.test(page));
  ok('  naming them, with the date, and what to do',
    /\(ended \$\{formatDateUK\(r\.endDate\)\}\)/.test(page) && /Set new access dates/.test(page));
  ok('the worker rail says the window ended rather than just showing a date',
    /ended, they cannot check in/.test(page));

  console.log('\n[3] The re-invitation no longer carries a stale window');
  const svc = read('services/workerAccess/workerAssignmentService.ts');
  // The ASSIGNMENT upsert, not the worker upsert above it (whose `update: {}`
  // is deliberately empty and matched first).
  const assignmentUpsert = svc.indexOf('prisma.workerSiteAssignment.upsert(', svc.indexOf('export async function inviteWorker'));
  const update = svc.slice(svc.indexOf('    update: {', assignmentUpsert));
  ok('inviteWorker clears startDate and endDate on re-invitation',
    /startDate: null,\s*\n\s*endDate: null,/.test(update.slice(0, 1200)), 'stale window survives');
  ok('  the same rule a transfer already applied', (svc.match(/startDate: null,/g) ?? []).length >= 2);

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main();
