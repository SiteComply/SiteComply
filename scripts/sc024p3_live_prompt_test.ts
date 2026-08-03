/**
 * SC-024 Phase 3 — does the real model actually write conclusion-free prose?
 *
 * The guard rejects any narrative containing a verdict. If the prompt is not
 * strong enough, EVERY generation is rejected and the feature silently never
 * works — which unit tests cannot reveal, because they never call a model.
 *
 * So this runs the real prompt against the configured provider with a realistic
 * project context and checks the answer survives the guard. One API call.
 */
import { buildAiProvider } from '@/services/ai';
import {
  CLOSE_OUT_MAX_OUTPUT_TOKENS,
  CLOSE_OUT_NARRATIVE_SCHEMA,
  CLOSE_OUT_SYSTEM_PROMPT,
  buildCloseOutUserPrompt,
  parseCloseOutNarrative,
} from '@/services/closeOut/closeOutNarrative';

// A context shaped exactly like buildContext() produces, with the kind of mixed
// good/bad figures that tempt a model into evaluating.
const CONTEXT = {
  project: {
    name: 'Riverside Phase 2',
    jobReference: 'RIV-2026-002',
    generatedOn: '2026-08-03',
    version: 1,
  },
  sections: [
    {
      sectionId: 'site_details',
      label: 'Site details',
      recordCount: null,
      photoCount: null,
      facts: [
        { label: 'Project address', value: '12 Riverside Way, Leeds LS1 4AB' },
        { label: 'Status', value: 'Active' },
        { label: 'Start date', value: '4 March 2026' },
      ],
      capped: false,
    },
    {
      sectionId: 'permits',
      label: 'Permits to work',
      recordCount: 14,
      photoCount: null,
      facts: null,
      capped: false,
    },
    {
      sectionId: 'audits',
      label: 'Audit reports',
      recordCount: 8,
      photoCount: null,
      facts: null,
      capped: false,
    },
    {
      // Deliberately provocative: 6 of 23 findings still open invites a verdict.
      sectionId: 'actions',
      label: 'Corrective actions',
      recordCount: 23,
      photoCount: null,
      facts: [
        { label: 'Open', value: '6' },
        { label: 'Closed', value: '17' },
        { label: 'Overdue', value: '3' },
      ],
      capped: false,
    },
    {
      sectionId: 'toolbox_talks',
      label: 'Toolbox talks',
      recordCount: 0,
      photoCount: null,
      facts: null,
      capped: false,
    },
  ],
};

const ALLOWED = CONTEXT.sections.map((s) => s.sectionId);

async function main() {
  const providerName = process.env.AI_PROVIDER || 'mock';
  console.log(`== SC-024 P3 live prompt check (provider: ${providerName}) ==\n`);

  const provider = buildAiProvider(providerName);

  const result = await provider.complete({
    system: CLOSE_OUT_SYSTEM_PROMPT,
    user: buildCloseOutUserPrompt('Riverside Phase 2 (RIV-2026-002)', CONTEXT),
    schema: CLOSE_OUT_NARRATIVE_SCHEMA,
    maxOutputTokens: CLOSE_OUT_MAX_OUTPUT_TOKENS,
  });

  console.log(`model: ${result.model}`);
  console.log(
    `tokens: ${result.tokensPrompt ?? '?'} prompt / ${result.tokensOutput ?? '?'} output\n`,
  );

  const parsed = parseCloseOutNarrative(result.json ?? result.text, ALLOWED);

  if (!parsed.ok) {
    console.log('REJECTED BY THE GUARD:');
    console.log(`  ${parsed.reason}\n`);
    console.log('Raw model output:');
    console.log(JSON.stringify(result.json ?? result.text, null, 2).slice(0, 2500));
    console.log(
      '\n== FAILED — the prompt lets the model draw conclusions, or returns an unusable shape ==',
    );
    process.exit(1);
  }

  const n = parsed.narrative;
  console.log('ACCEPTED\n');
  console.log(`headline: ${n.headline}\n`);
  console.log(`executiveSummary:\n  ${n.executiveSummary}\n`);
  console.log('sectionNarratives:');
  for (const s of n.sectionNarratives) {
    console.log(`  [${s.sectionId}] ${s.narrative}`);
  }

  const covered = new Set(n.sectionNarratives.map((s) => s.sectionId));
  const missing = ALLOWED.filter((id) => !covered.has(id));
  console.log(
    `\ncoverage: ${covered.size}/${ALLOWED.length} sections${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`,
  );

  // A narrative that covers almost nothing is technically valid but useless.
  const enough = covered.size >= Math.ceil(ALLOWED.length / 2);
  console.log(
    `\n== ${enough ? 'PASSED' : 'PASSED WITH LOW COVERAGE — review the prompt'} ==`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('provider call failed:', e?.message ?? e);
  process.exit(1);
});
