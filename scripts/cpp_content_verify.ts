/**
 * CPP Tier 1 content — verification.
 *
 *   npx tsx scripts/cpp_content_verify.ts
 *
 * Tier 1 surfaces content that ALREADY EXISTS in the platform: site rules, PPE,
 * permits, RAMS, induction, competence and monitoring. No schema change, no new
 * data capture.
 *
 * THE PROPERTY THAT MATTERS MOST is negative: none of it may move a site's
 * completion percentage. Completion belongs to the setup steps, it was only just
 * put on an honest footing, and a section added for reference must not quietly
 * become a requirement. Source-level, because the assembly needs a database.
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const svc = readFileSync('services/sites/cppService.ts', 'utf8');
const page = readFileSync('app/platform/dashboard/sites/[id]/cpp/page.tsx', 'utf8');
const completion = readFileSync('services/sites/siteSetupCompletion.ts', 'utf8');

/** Source with comments stripped — these files EXPLAIN what they replaced. */
const code = (src: string) =>
  src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  }).join('\n');
const svcCode = code(svc);

function main() {
  console.log('== CPP TIER 1 CONTENT ==\n');

  console.log('[1] The seven Tier 1 sections exist');
  for (const [key, title] of [
    ['induction', 'Site induction arrangements'],
    ['competence', 'Competence and site access requirements'],
    ['rules', 'Site rules'],
    ['ppe', 'Personal protective equipment'],
    ['permits', 'Permit-to-work arrangements'],
    ['rams', 'Risk assessments and method statements'],
    ['monitoring', 'Monitoring and inspection arrangements'],
  ] as const) {
    chk(`[1] ${title}`, new RegExp(`'${key}',\\s*\\n?\\s*'${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(svcCode));
  }

  console.log('\n[2] NONE of them can move a completion percentage');
  chk('[2] wired sections declare gatesCompletion: false',
    /gatesCompletion: false/.test(svcCode));
  chk('[2] setup sections still gate completion',
    /gatesCompletion: true/.test(svcCode));
  chk('[2] status stamping skips wired sections',
    /if \(!s\.gatesCompletion \|\| s\.stepKey === null\) continue;/.test(svcCode));
  chk('[2] the gap list only contains setup-owned sections',
    /s\.gatesCompletion &&\s*\n\s*s\.stepKey !== null &&/.test(svcCode));
  chk('[2] no wired source was added to the completion requirements',
    !/ppe|rams|permits|monitoring|induction|competence/i.test(
      completion.slice(completion.indexOf('const REQUIREMENTS'), completion.indexOf('export function requirementsFor')),
    ));
  // CONTROL: the rules requirement IS in there, so the check above is not
  // passing merely because the slice is empty or mis-located.
  chk('[2] CONTROL — the rules requirement is still present in REQUIREMENTS',
    /of: 'siteRules'/.test(
      completion.slice(completion.indexOf('const REQUIREMENTS'), completion.indexOf('export function requirementsFor')),
    ));

  console.log('\n[3] Site rules come from the Library, not the free text');
  chk('[3] the section is built from getSiteRules', /getSiteRules\(siteId\)/.test(svcCode));
  chk('[3] the free-text field is demoted to supplementary notes',
    /label: 'Additional site information', value: clean\(info\?\.siteRules\)/.test(svcCode));
  chk('[3] and is no longer the section\'s own content',
    !/section\('rules', 'Site rules'/.test(svcCode));

  console.log('\n[4] Everything is read, nothing is captured or stored');
  chk('[4] no write reaches the CPP service',
    !/prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany)/.test(svcCode));
  // This asserted the schema had NO CPP model, which was true when Tier 1
  // shipped and stopped being true when document control added CppRevision.
  // The claim it was really making — that Tier 1 content is assembled from its
  // source modules and never kept as a second copy — survives, so that is what
  // it asserts now. A frozen revision snapshot is a different thing: a dated
  // record for document control, not a rival source of truth.
  chk('[4] the CPP still assembles content from its source modules',
    !/prisma\.cppRevision/.test(svcCode));
  chk('[4] CONTROL — it does read the source modules directly',
    /prisma\.document\.findMany/.test(svcCode) && /getSiteRules\(siteId\)/.test(svcCode));
  chk('[4] the draft is still assembled per request, not snapshotted',
    /export async function getCppDraft/.test(svcCode) && !/snapshot/i.test(svcCode));

  console.log('\n[5] The wired sources are the real ones');
  chk('[5] PPE from the site PPE service', /getSitePpeRequirements\(siteId\)/.test(svcCode));
  chk('[5] permits from the availability service', /getSiteServiceConfig\(viewer, siteId\)/.test(svcCode));
  chk('[5]   and only ENABLED permit types are listed',
    /filter\(\(i\) => i\.enabled\)/.test(svcCode));
  chk('[5] RAMS from the document register, by category',
    /category: 'RAMS'/.test(svcCode));
  chk('[5] induction from the site induction config',
    /siteInductionConfig\.findUnique/.test(svcCode));
  chk('[5] competence from the site access requirements',
    /siteAccessRequirement\.findMany/.test(svcCode));
  chk('[5]   and only requirements actually ENFORCED',
    /enabled: true/.test(svcCode));
  chk('[5] monitoring from active compliance schedules',
    /complianceSchedule\.findMany/.test(svcCode) && /active: true/.test(svcCode));

  console.log('\n[6] The plan is honest when there is nothing to show');
  chk('[6] an unenforced site says so rather than implying control',
    /No access requirements are enforced on this site/.test(svc));
  chk('[6] a site with no scheduled inspections says so',
    /No recurring inspections are scheduled for this site/.test(svc));
  chk('[6] an empty wired section reads "None recorded", not "Not yet recorded"',
    /s\.gatesCompletion \? 'Not yet recorded\.' : 'None recorded\.'/.test(page));
  chk('[6]   and does not send the reader to a wizard that cannot fix it',
    /href=\{s\.manageHref \?\? setupHref\}/.test(page));

  console.log('\n[7] Labels are the reader\'s language, and only real values');
  chk('[7] access requirements are translated for a duty holder',
    /CSCS_VERIFIED:/.test(svcCode) && /Smart Check service/.test(svc));
  const freq = svcCode.slice(svcCode.indexOf('const FREQUENCY_LABELS'), svcCode.indexOf('const ACCESS_REQUIREMENT_LABELS'));
  chk('[7] frequency labels cover exactly the four ScheduleFrequency values',
    ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'].every((f) => freq.includes(`${f}:`)) &&
    !/FORTNIGHTLY|QUARTERLY/.test(freq));
  chk('[7] the page renders register items',
    /s\.items\.map/.test(page));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
