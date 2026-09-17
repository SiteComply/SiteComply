/**
 * Site Rules Library — build-artifact guard.
 *
 *   npx tsx scripts/site_rules_artifact_guard.ts      (after `npm run build`)
 *
 * Proves the feature is actually IN the compiled output, not merely in the
 * source. Every past deploy failure on this project has been of the same shape:
 * a change that was correct in the repository and absent from what shipped.
 *
 * Only string LITERALS and object PROPERTY NAMES survive minification. Local
 * const and function names do not, and asserting on one is how a guard passes
 * vacuously. Every absence check below is paired with a presence check on a
 * string that is provably in the same chunk, so a mistyped path fails loudly
 * instead of silently finding nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const ROOT = '.next';
const SERVER = join(ROOT, 'server');
const STATIC = join(ROOT, 'static');

function readAll(dir: string): string {
  return walk(dir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

function main() {
  console.log('== SITE RULES: BUILD ARTIFACT ==\n');

  const server = readAll(SERVER);
  const client = readAll(STATIC);
  const all = `${server}\n${client}`;

  console.log('[1] The build is the one we think it is');
  chk('server output was read', server.length > 100_000,
      `${Math.round(server.length / 1024)} KB`);
  chk('client output was read', client.length > 100_000,
      `${Math.round(client.length / 1024)} KB`);
  // Control: a string that has been in this app since long before this feature.
  chk('CONTROL — a pre-existing induction string is present',
      all.includes('I have read and will follow the site rules and signage.'));

  console.log('\n[2] The enum value shipped');
  chk('SITE_RULE appears in the server output', server.includes('SITE_RULE'));
  chk('SITE_RULE appears in the client bundle too — the wizard needs it',
      client.includes('SITE_RULE'));

  console.log('\n[3] The library shipped — both tiers, correctly split');
  // Checked individually rather than by count: a truncated library is the exact
  // failure a count would let through if the count itself were wrong.
  const defaults = [
    'Sign in on arrival and sign out when you leave.',
    'Wear the PPE required for this site at all times in working areas.',
    'Report all accidents, injuries and near misses straight away.',
    'Keep walkways, access routes and fire exits clear at all times.',
    'Keep your work area clean and tidy as you go.',
    'Do not use plant or equipment you are not trained and authorised to use.',
    'Check tools and equipment before use and report anything defective.',
    'Do not remove or bypass guarding, barriers or safety devices.',
    'On hearing the alarm, stop work, go to the assembly point and wait to be accounted for.',
    'Do not work under the influence of alcohol or drugs.',
  ];
  const optional = [
    'Smoking and vaping only in the designated area.',
    'Segregate waste and use the correct skip for each material.',
    'Observe the site speed limit and keep to marked pedestrian routes.',
    'Mobile phones must not be used while operating plant or working at height.',
    'Treat everyone on site with respect. Bullying and harassment are not tolerated.',
  ];
  const missingDefaults = defaults.filter((r) => !server.includes(r));
  chk(`all ${defaults.length} default rules are in the server output`,
      missingDefaults.length === 0, missingDefaults.join(' | '));
  // The optional templates must ship too — they are offered in the editor, just
  // not seeded. Absent, a Site Manager could never adopt one.
  //
  // CHECKED IN THE SERVER OUTPUT, like the defaults above, and not in the client
  // bundle. No rule text is compiled into client JS: the library is server data
  // handed to the editor as a prop and serialised into the RSC payload at request
  // time. An earlier draft of this guard looked in .next/static and failed a
  // perfectly good build — the assertion was wrong, not the artifact.
  const missingOptional = optional.filter((r) => !server.includes(r));
  chk(`all ${optional.length} optional templates are in the server output`,
      missingOptional.length === 0, missingOptional.join(' | '));
  // Proves the line above is a real test and not a tautology: rule text is
  // genuinely absent from the client bundle, so "server" is the only place it
  // could have been found.
  chk('CONTROL — rule text is server-side only, so that check means something',
      !client.includes(defaults[0]!) && !client.includes(optional[0]!));
  // The tier flag is a real property name, so it survives minification.
  chk('the tier flag shipped', server.includes('defaultSelected'));

  console.log('\n[3b] The rationalised removals did not creep back');
  // Paired with the presence checks above: the same bundles provably contain the
  // new wording, so an absence here cannot pass by looking in the wrong place.
  chk('the permit rule is gone',
      !server.includes('Do not start work without a valid permit where one is required.'));
  chk('the signage/speed rule is gone',
      !server.includes('Obey all site signage, speed limits and pedestrian routes.'));
  chk('the old possession-phrased drugs rule is gone',
      !server.includes('No alcohol or drugs on site.'));
  chk('the old skip-bearing tidiness rule is gone',
      !server.includes('remove waste to the right skip'));
  chk('the old stairs-bearing access rule is gone',
      !server.includes('Keep walkways, stairs and fire exits clear'));

  console.log('\n[4] The editor shipped');
  chk('the Site rules section label',
      server.includes('The rules operatives are shown and agree to at induction.'));
  chk('the PUT endpoint the editor calls',
      client.includes('/rules') && client.includes('Could not save the site rules.'));
  chk('the "Site-specific" badge for a custom rule',
      client.includes('Site-specific'));
  chk('the "Optional" badge for an unadopted template',
      client.includes('Optional'));
  chk('the missing-acknowledgement warning',
      client.includes('no longer contains the site rules'));
  chk('the cross-reference to the separate free-text field',
      client.includes('Longer reference material'));
  chk('the short intro copy',
      client.includes(
        'Selected rules are shown to operatives during their induction and must be',
      ));
  // Paired absence. The verbose original said this; if it is back, the intro
  // was reverted. The presence check directly above proves the new copy is in
  // the same bundle, so this cannot pass by looking in the wrong place.
  chk('the verbose original intro is gone',
      !client.includes('They are not ticked individually.'));
  // Absence, paired with a presence check on the same string in the same place:
  // if this heading were gone the presence half would fail first.
  chk('PPE requirements is still its own section, unchanged',
      server.includes('The PPE operatives must confirm before they check in.'));

  console.log('\n[5] The induction shipped');
  chk('the rules panel heading is in the client bundle',
      client.includes('Site rules'));
  chk('the orphan-rules screen copy',
      client.includes('Please read the rules for this site before you continue.'));
  chk('the single acknowledgement is still what is ticked',
      client.includes('I confirm and acknowledge'));

  console.log('\n[6] Historic records read correctly');
  chk('a rule shows as displayed, not as a failed acknowledgement',
      server.includes('Shown at induction'));
  chk('CONTROL — the acknowledgement wording it must not be confused with',
      server.includes('Not acknowledged'));

  console.log('\n[7] Nothing that should be absent is present');
  // The free-text Site Information field must remain a SEPARATE thing. If the
  // two were ever merged, this label would stop appearing on its own.
  chk('the separate free-text Site rules field still exists',
      server.includes('Site information'));
  // A rule must never be presented as something to tick.
  chk('no per-rule acknowledgement copy was introduced',
      !all.includes('Acknowledge each rule') &&
      !all.includes('Tick each rule'));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
