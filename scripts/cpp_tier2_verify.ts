/**
 * CPP Tier 2 — verification.
 *
 *   npx tsx scripts/cpp_tier2_verify.ts
 *
 * Tier 2 replaces three free-text boxes with HSE L153 Appendix 3's explicit risk
 * topics, and replaces filename guessing in the drawings appendix with a real
 * document category.
 *
 * Mostly source-level: the assembly needs a database. The catalogue itself is
 * pure and is tested directly.
 */
import { readFileSync } from 'node:fs';
import {
  CPP_RISK_TOPICS,
  SAFETY_TOPICS,
  HEALTH_TOPICS,
  isRiskTopicKey,
  riskTopicMeta,
  answerFor,
} from '../services/sites/cppRiskTopics';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const svc = readFileSync('services/sites/cppService.ts', 'utf8');
const riskSvc = readFileSync('services/sites/cppRiskService.ts', 'utf8');
const editor = readFileSync('components/platform/SiteRiskRegister.tsx', 'utf8');
const docConsts = readFileSync('services/documents/documentConstants.ts', 'utf8');
const completion = readFileSync('services/sites/siteSetupCompletion.ts', 'utf8');

const code = (src: string) =>
  src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  }).join('\n');

function main() {
  console.log('== CPP TIER 2 ==\n');

  console.log('[1] The L153 catalogue');
  chk('[1] 25 topics in total', CPP_RISK_TOPICS.length === 25, `${CPP_RISK_TOPICS.length}`);
  chk('[1] 17 safety topics', SAFETY_TOPICS.length === 17, `${SAFETY_TOPICS.length}`);
  chk('[1] 8 health topics', HEALTH_TOPICS.length === 8, `${HEALTH_TOPICS.length}`);
  chk('[1] every key is unique',
    new Set(CPP_RISK_TOPICS.map((t) => t.key)).size === CPP_RISK_TOPICS.length);
  chk('[1] every topic has a label', CPP_RISK_TOPICS.every((t) => t.label.trim().length > 3));
  // The topics that actually get forgotten if nobody asks.
  for (const k of ['ASBESTOS', 'LIFTING_OPERATIONS', 'CONTAMINATED_LAND',
                   'HAZARDOUS_SUBSTANCES', 'PREVENTING_FALLS', 'NOISE_VIBRATION',
                   'FRAGILE_MATERIALS', 'EXCAVATIONS_GROUND']) {
    chk(`[1] ${k} is asked about`, isRiskTopicKey(k));
  }
  chk('[1] a catch-all exists for each kind',
    isRiskTopicKey('OTHER_SAFETY') && isRiskTopicKey('OTHER_HEALTH'));
  chk('[1] asbestos is flagged as commonly applicable — pre-2000 buildings',
    riskTopicMeta('ASBESTOS')?.commonlyApplicable === true);
  chk('[1] CONTROL — an invented key is rejected', !isRiskTopicKey('NOT_A_TOPIC'));

  console.log('\n[2] The catalogue and the enum agree');
  // A key in one and not the other is a topic that cannot be saved, or an enum
  // value nothing can ever set. Silent either way.
  const enumBlock = schema.slice(schema.indexOf('enum RiskTopic {'), schema.indexOf('}', schema.indexOf('enum RiskTopic {')));
  const missingInEnum = CPP_RISK_TOPICS.filter((t) => !new RegExp(`\\b${t.key}\\b`).test(enumBlock));
  chk('[2] every catalogue key exists in the RiskTopic enum',
    missingInEnum.length === 0, missingInEnum.map((t) => t.key).join(', '));
  const enumValues = enumBlock.split('\n').map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
  chk('[2] the enum has exactly 25 values', enumValues.length === 25, `${enumValues.length}`);
  const orphanEnum = enumValues.filter((v) => !isRiskTopicKey(v));
  chk('[2] no enum value is missing from the catalogue',
    orphanEnum.length === 0, orphanEnum.join(', '));
  chk('[2] CONTROL — the enum block was actually located', enumValues.length > 0);

  console.log('\n[3] Three states, and the middle one is real');
  chk('[3] no row is UNANSWERED', answerFor(undefined) === 'UNANSWERED');
  chk('[3] applicable null is UNANSWERED', answerFor({ applicable: null }) === 'UNANSWERED');
  chk('[3] false is a recorded NOT_APPLICABLE', answerFor({ applicable: false }) === 'NOT_APPLICABLE');
  chk('[3] true APPLIES', answerFor({ applicable: true }) === 'APPLIES');
  chk('[3] the column is nullable, so "not considered" is storable',
    /applicable\s+Boolean\?/.test(schema));
  chk('[3] nothing is seeded — no row means not considered',
    !/SiteRiskTopic[\s\S]{0,400}createMany/.test(code(riskSvc)));
  chk('[3] controls survive a topic being switched off',
    /Kept even when the topic does not apply/.test(riskSvc));
  chk('[3] the API can clear an answer back to null',
    /body\.applicable === undefined \? null/.test(
      readFileSync('app/api/platform/sites/[id]/risks/route.ts', 'utf8')));

  console.log('\n[4] The plan prints what was considered');
  chk('[4] two risk sections exist',
    /riskSection\('risks-safety'/.test(svc) && /riskSection\('risks-health'/.test(svc));
  chk('[4] NOT APPLICABLE is printed, not hidden',
    /Considered — does not apply to this site/.test(svc));
  chk('[4] an applicable topic with no controls says so',
    /APPLIES — control measures not yet recorded/.test(svc));
  chk('[4] unconsidered topics are named, not merely counted',
    /Not yet considered/.test(svc) && /unanswered\.map\(\(r\) => r\.label\)/.test(svc));
  chk('[4] the narrative hazard fields are retained',
    /section\('hazards', 'Hazards and existing site risks'/.test(svc));

  console.log('\n[5] Tier 2 does not move completion either');
  // Asserted on the BUILDER'S OWN BODY rather than a character distance — the
  // first version of this allowed 1600 characters and the real gap was 1618, so
  // it failed correct code. A brittle assertion is worse than none.
  const svcCode = code(svc);
  const builder = svcCode.slice(
    svcCode.indexOf('const riskSection = ('),
    svcCode.indexOf('const sections: CppSection[] = ['),
  );
  chk('[5] CONTROL — the riskSection builder was located',
    builder.length > 200 && /stepKey: null/.test(builder));
  chk('[5] risk sections are reference content',
    /gatesCompletion: false/.test(builder));
  chk('[5] both risk sections go through that builder',
    (svcCode.match(/riskSection\('risks-/g) ?? []).length === 2);

  const req = completion.slice(completion.indexOf('const REQUIREMENTS'), completion.indexOf('export function requirementsFor'));
  // Matched on the TOPIC KEYS, not the word "risk": `high-risk` is a legitimate
  // pre-existing setup step and a word match failed on it.
  const leaked = CPP_RISK_TOPICS.filter((t) => req.includes(t.key));
  chk('[5] no risk topic leaked into the completion requirements',
    leaked.length === 0, leaked.map((t) => t.key).join(', '));
  chk('[5]   and the completion module never reaches the risk service',
    !/cppRisk/.test(completion));
  chk('[5] CONTROL — the REQUIREMENTS slice was located', /of: 'siteRules'/.test(req));

  console.log('\n[6] The drawings appendix stopped guessing');
  chk('[6] DRAWING exists on the DocumentCategory enum', /\n  DRAWING\n/.test(schema));
  chk('[6] it is selectable when filing a document',
    /value: 'DRAWING'/.test(docConsts));
  chk('[6] the appendix filters on the category', /d\.category === 'DRAWING'/.test(code(svc)));
  chk('[6] filename matching is gone',
    !/DRAWING_TITLE_HINTS\s*=/.test(code(svc)));
  chk('[6]   and the document select carries the category',
    /fileName: true, category: true/.test(svc));

  console.log('\n[7] The client/server split holds');
  // cppRiskService reaches lib/prisma; a VALUE import from the editor fails the
  // webpack build while tsc stays green. Exactly the Site Rules trap.
  const valueImports = [...editor.matchAll(/^import\s+(?!type)([\s\S]*?)from\s+'([^']+)'/gm)]
    .filter(([, clause, mod]) => mod.includes('cppRiskService') && !clause.trim().startsWith('type'));
  chk('[7] the editor never value-imports the risk service',
    valueImports.length === 0, valueImports.map((m) => m[2]).join(', '));
  chk('[7]   and the catalogue it does use is pure',
    !/lib\/prisma|@prisma\/client/.test(readFileSync('services/sites/cppRiskTopics.ts', 'utf8')));
  chk('[7] CONTROL — the editor does import the service as a TYPE',
    /import type \{ RiskTopicRow \}/.test(editor));

  console.log('\n[8] Permissions match the neighbouring editors');
  const route = readFileSync('app/api/platform/sites/[id]/risks/route.ts', 'utf8');
  chk('[8] editing needs sites:edit', /permits\(viewer\.role, 'sites', action\)/.test(route));
  chk('[8] and the site must be in scope', /viewer\.siteIds\.includes\(siteId\)/.test(route));
  chk('[8] the service re-checks rather than trusting the route',
    /permits\(viewer\.role, 'sites', 'edit'\)/.test(riskSvc) &&
    /viewer\.siteIds\.includes\(siteId\)/.test(riskSvc));
  chk('[8] a closed project is handled like every other write',
    /withClosedProjectHandling/.test(route));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
