/**
 * Permits are available to operatives by default.
 *
 * THE DEFECT IT ANSWERS: ACTIVE_PERMITS was the only worker panel that shipped
 * off. A site with permit types configured but the panel never switched on gave
 * operatives no way to request a permit, and said so to nobody - not the
 * operative, who saw no menu, and not the manager, whose own screens worked.
 *
 * THE OTHER HALF MATTERS AS MUCH: a site that deliberately switched permits off
 * must STAY off. A stored setting always beats the default.
 *
 * Run: npx tsx scripts/permits_default_verify.ts
 */
import { readFileSync } from 'fs';
import {
  WORKER_DASHBOARD_PANELS,
  defaultPanelVisibility,
} from '../services/workerDashboard/dashboardPanels';

let pass = 0; const failures: string[] = [];
const ok = (t: string, c: boolean, saw?: unknown) => {
  if (c) { pass++; console.log(`  ok   ${t}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${saw === undefined ? '' : `\n          saw: ${JSON.stringify(saw)}`}`); }
};
const read = (p: string) => readFileSync(p, 'utf8');

function main() {
  console.log('== PERMITS ON BY DEFAULT ==\n');

  console.log('[1] The default');
  ok('a site that has never been asked shows permits',
    defaultPanelVisibility().ACTIVE_PERMITS === true);
  ok('  and every other panel keeps the default it had',
    defaultPanelVisibility().SITE_INFORMATION === true &&
    defaultPanelVisibility().RAMS === true &&
    defaultPanelVisibility().CHECK_OUT === true);
  ok('no worker panel ships hidden any more',
    WORKER_DASHBOARD_PANELS.every((p) => p.defaultEnabled), 
    WORKER_DASHBOARD_PANELS.filter((p) => !p.defaultEnabled).map((p) => p.value));

  console.log('\n[2] A manager can still switch it off, and that wins');
  const svc = read('services/workerDashboard/dashboardConfigService.ts');
  ok('a stored site setting overrides the default',
    /for \(const row of rows\) \{[\s\S]{0,160}visibility\[row\.panel\] = row\.enabled;/.test(svc));
  ok('a per-worker override can only NARROW, never reveal',
    /visibility\[row\.panel\] = visibility\[row\.panel\] && row\.enabled;/.test(svc));
  ok('permits is not locked, so switching it off is possible',
    WORKER_DASHBOARD_PANELS.find((p) => p.value === 'ACTIVE_PERMITS')?.locked !== true);
  ok('  while check-out stays locked on',
    WORKER_DASHBOARD_PANELS.find((p) => p.value === 'CHECK_OUT')?.locked === true);

  console.log('\n[3] The pages still gate on the resolved value');
  for (const page of ['app/worker/permits/page.tsx', 'app/worker/permits/new/page.tsx', 'app/worker/permits/[id]/page.tsx']) {
    ok(`${page.split('/').slice(-2).join('/')} redirects when the panel is off`,
      /if \(!panels\.ACTIVE_PERMITS\) redirect\('\/worker\/dashboard'\);/.test(read(page)));
  }
  const nav = read('components/worker/WorkerNav.tsx');
  ok('the nav item is shown from the same resolved value', /panels: \['ACTIVE_PERMITS'\]/.test(nav));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) process.exitCode = 1;
}
main();
