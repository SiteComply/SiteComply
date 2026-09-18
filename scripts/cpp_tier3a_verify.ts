/**
 * CPP Tier 3A — management arrangements. Verification.
 *
 *   npx tsx scripts/cpp_tier3a_verify.ts
 *
 * Six L153 Appendix 3 Section 2 arrangements, written once at company level,
 * inherited by every site, overridable per site, and labelled in the plan.
 *
 * The resolution rule is the thing worth proving: site override, else company
 * standard, else nothing — and the LABEL must follow the text, or the plan tells
 * a reviewer the wrong thing about what they are reading.
 */
import { readFileSync } from 'node:fs';
import {
  CPP_ARRANGEMENTS,
  isArrangementKey,
  arrangementMeta,
  arrangementSourceLabel,
} from '../services/sites/cppArrangements';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const svc = readFileSync('services/sites/arrangementService.ts', 'utf8');
const cpp = readFileSync('services/sites/cppService.ts', 'utf8');
const editor = readFileSync('components/platform/ArrangementsEditor.tsx', 'utf8');
const completion = readFileSync('services/sites/siteSetupCompletion.ts', 'utf8');
const code = (src: string) =>
  src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  }).join('\n');

function main() {
  console.log('== CPP TIER 3A ==\n');

  console.log('[1] The six arrangements');
  chk('[1] exactly six', CPP_ARRANGEMENTS.length === 6, `${CPP_ARRANGEMENTS.length}`);
  for (const k of ['HS_FILE', 'MANAGEMENT_STRUCTURE', 'WORKER_CONSULTATION',
                   'CONTRACTOR_MANAGEMENT', 'PUBLIC_PROTECTION', 'INCIDENT_REPORTING']) {
    chk(`[1] ${k}`, isArrangementKey(k));
  }
  chk('[1] CONTROL — an invented key is rejected', !isArrangementKey('NOT_REAL'));
  chk('[1] every one carries guidance on what to write',
    CPP_ARRANGEMENTS.every((a) => a.guidance.length > 60));
  chk('[1] the two that usually differ by project are prompted',
    arrangementMeta('PUBLIC_PROTECTION')?.promptSiteSpecific === true &&
    arrangementMeta('MANAGEMENT_STRUCTURE')?.promptSiteSpecific === true);
  chk('[1]   and it is only a prompt — not all six',
    CPP_ARRANGEMENTS.filter((a) => a.promptSiteSpecific).length === 2);

  console.log('\n[2] The catalogue and the enum agree');
  const enumBlock = schema.slice(schema.indexOf('enum ArrangementKey {'),
    schema.indexOf('}', schema.indexOf('enum ArrangementKey {')));
  const values = enumBlock.split('\n').map((l) => l.trim()).filter((l) => /^[A-Z_]+$/.test(l));
  chk('[2] CONTROL — the enum block was located', values.length > 0);
  chk('[2] the enum has exactly six values', values.length === 6, `${values.length}`);
  const missing = CPP_ARRANGEMENTS.filter((a) => !values.includes(a.key));
  chk('[2] every catalogue key exists in the enum', missing.length === 0,
    missing.map((a) => a.key).join(', '));
  const orphans = values.filter((v) => !isArrangementKey(v));
  chk('[2] no enum value is missing from the catalogue', orphans.length === 0, orphans.join(', '));

  console.log('\n[3] Inheritance: site, else company, else nothing');
  chk('[3] the resolution is one expression',
    /const content = siteText \?\? stdText;/.test(code(svc)));
  chk('[3] the source follows the same order',
    /siteText\s*\n?\s*\? 'SITE'\s*\n?\s*: stdText\s*\n?\s*\? 'STANDARD'\s*\n?\s*: 'NONE'/.test(code(svc)));
  chk('[3] a blank site row is not an override',
    /A site row whose content is blank is treated as no override/.test(svc));
  // COMMENTS STRIPPED. Both files EXPLAIN why there is no such flag and name it
  // while doing so, so a raw grep matches its own documentation — the same trap
  // this project has now hit four times. Schema comments use `///`, which the
  // stripper handles as a `//` prefix.
  chk('[3] CONTROL — stripping kept the real code',
    /prisma\.siteArrangement/.test(code(svc)) && /model SiteArrangement/.test(code(schema)));
  chk('[3] absent means inherit — there is no usesDefault field',
    !/usesDefault/.test(code(svc)) && !/usesDefault/.test(code(schema)));
  chk('[3] removing an override is a delete',
    /prisma\.siteArrangement\.deleteMany/.test(code(svc)));
  chk('[3] clearing a company standard is a delete too',
    /prisma\.standardArrangement\.deleteMany/.test(code(svc)));
  chk('[3] all six are always returned, written or not',
    /CPP_ARRANGEMENTS\.map/.test(code(svc)));

  console.log('\n[4] The plan says which it is reading');
  chk('[4] the source label is printed as the entry label',
    /label: arrangementSourceLabel\(a\.source\)/.test(code(cpp)));
  chk('[4] SITE reads "Site-specific"', arrangementSourceLabel('SITE') === 'Site-specific');
  chk('[4] STANDARD reads "Company standard"', arrangementSourceLabel('STANDARD') === 'Company standard');
  chk('[4] NONE reads "Not recorded"', arrangementSourceLabel('NONE') === 'Not recorded');
  chk('[4] the labels are distinct — a reviewer can tell them apart',
    new Set((['SITE', 'STANDARD', 'NONE'] as const).map(arrangementSourceLabel)).size === 3);
  chk('[4] all six become CPP sections',
    /\.\.\.arrangements\.map\(\(a\) =>/.test(code(cpp)));

  console.log('\n[5] Permissions');
  chk('[5] company standards are Director-only',
    /saveStandardArrangement[\s\S]{0,400}canEditSite\(viewer\.role\)/.test(code(svc)));
  chk('[5] a site override follows sites:edit',
    /saveSiteArrangement[\s\S]{0,400}permits\(viewer\.role, 'sites', 'edit'\)/.test(code(svc)));
  chk('[5] and the site must be in scope',
    /saveSiteArrangement[\s\S]{0,600}viewer\.siteIds\.includes\(siteId\)/.test(code(svc)));
  chk('[5] the service enforces it, not only the route',
    /Only a Director can edit company arrangements/.test(svc));
  const siteRoute = readFileSync('app/api/platform/sites/[id]/arrangements/route.ts', 'utf8');
  chk('[5] a closed project is handled like any other write',
    /withClosedProjectHandling/.test(siteRoute));

  console.log('\n[6] Nothing is seeded, and Tier 3A does not move completion');
  chk('[6] no arrangement is pre-written',
    !/createMany/.test(code(svc)));
  const req = completion.slice(completion.indexOf('const REQUIREMENTS'),
    completion.indexOf('export function requirementsFor'));
  chk('[6] CONTROL — the REQUIREMENTS slice was located', /of: 'siteRules'/.test(req));
  const leaked = CPP_ARRANGEMENTS.filter((a) => req.includes(a.key));
  chk('[6] no arrangement leaked into the completion requirements',
    leaked.length === 0, leaked.map((a) => a.key).join(', '));
  chk('[6] the arrangement sections are reference content',
    /\.\.\.arrangements\.map[\s\S]{0,400}wired\(/.test(code(cpp)));

  console.log('\n[7] The client/server split holds');
  const valueImports = [...editor.matchAll(/^import\s+(?!type)([\s\S]*?)from\s+'([^']+)'/gm)]
    .filter(([, , mod]) => mod.includes('arrangementService'));
  chk('[7] the editor never imports the service', valueImports.length === 0,
    valueImports.map((m) => m[2]).join(', '));
  chk('[7] the catalogue it does import is pure',
    !/lib\/prisma|@prisma\/client/.test(readFileSync('services/sites/cppArrangements.ts', 'utf8')));
  chk('[7] CONTROL — the editor does import the catalogue',
    /CPP_ARRANGEMENTS/.test(editor));

  console.log('\n[8] The site editor does not silently copy the default');
  chk('[8] the override box starts EMPTY when inheriting',
    /overriding\s*\n?\s*\? \(row\?\.content \?\? ''\)\s*\n?\s*: ''/.test(editor));
  chk('[8]   and the reason is recorded',
    /silently copy it/.test(editor));
  chk('[8] the inherited text is shown read-only alongside',
    /row\.standardContent/.test(editor));
  chk('[8] a missing company standard is stated, not left blank',
    /No company standard has been written for this arrangement/.test(editor));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
