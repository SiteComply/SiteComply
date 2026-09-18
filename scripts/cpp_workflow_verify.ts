/**
 * CPP guided workflow — verification.
 *
 *   npx tsx scripts/cpp_workflow_verify.ts
 *
 * The revision controls worked but only REPORTED state, leaving the user to
 * infer what mattered from a row of equally-weighted buttons. This proves the
 * screen now answers "what should I do now?" — one recommended action, chosen in
 * lifecycle order — and that an incomplete plan WARNS without ever blocking.
 */
import { readFileSync } from 'node:fs';
import {
  recommendNextAction,
  readinessGaps,
  CPP_STAGES,
  type CppReadiness,
} from '../services/sites/cppWorkflow';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const CLEAN: CppReadiness = {
  outstandingSections: 0, riskTopicsUnconsidered: 0, arrangementsNotRecorded: 0,
};
const GAPPY: CppReadiness = {
  outstandingSections: 4, riskTopicsUnconsidered: 25, arrangementsNotRecorded: 6,
};
const flow = (o: Partial<Parameters<typeof recommendNextAction>[0]> = {}) =>
  recommendNextAction({
    issued: null, draft: null, drift: null, readiness: CLEAN,
    canCreate: true, canIssue: true, ...o,
  });

const bar = readFileSync('components/platform/CppRevisionBar.tsx', 'utf8');
const page = readFileSync('app/platform/dashboard/sites/[id]/cpp/page.tsx', 'utf8');

function main() {
  console.log('== CPP GUIDED WORKFLOW ==\n');

  console.log('[1] Three stages, and the current one is derivable');
  chk('[1] three stages', CPP_STAGES.length === 3);
  chk('[1] nothing issued is DRAFT', flow().stage === 'DRAFT');
  chk('[1] an open revision is PREPARED', flow({ draft: { version: 1 } }).stage === 'PREPARED');
  chk('[1] issued is ISSUED', flow({ issued: { version: 1 } }).stage === 'ISSUED');
  chk('[1] issued WITH a new draft open is PREPARED — the work is on the next one',
    flow({ issued: { version: 1 }, draft: { version: 2 } }).stage === 'PREPARED');

  console.log('\n[2] One recommended action, in lifecycle order');
  chk('[2] incomplete and unissued → finish the content first',
    flow({ readiness: GAPPY }).primary?.kind === 'COMPLETE_CONTENT');
  chk('[2] complete and unissued → prepare',
    flow().primary?.kind === 'PREPARE_REVISION');
  chk('[2] a prepared revision outranks content gaps — the snapshot is taken',
    flow({ draft: { version: 1 }, readiness: GAPPY }).primary?.kind === 'APPROVE_AND_ISSUE');
  chk('[2] issued and drifted → update',
    flow({ issued: { version: 2 }, drift: { changed: true, changedSections: ['A', 'B'] } })
      .primary?.kind === 'UPDATE_PLAN');
  chk('[2] the next version number is correct',
    // `=== true` rather than a bare optional chain: `?.includes()` yields
    // boolean | undefined, which tsx runs happily and tsc rejects — and the
    // deploy typechecks, so it failed there rather than here.
    flow({ issued: { version: 2 }, drift: { changed: true, changedSections: ['A'] } })
      .primary?.label.includes('Revision 3') === true);
  // The headline names the revision, so the button does not repeat it — that
  // made the primary action long as well as prominent.
  chk('[2] the approve action is the verb alone',
    flow({ draft: { version: 2 } }).primary?.label === 'Approve and issue');
  chk('[2]   and the headline is what names the revision',
    /Revision 2/.test(flow({ draft: { version: 2 } }).headline));
  chk('[2] no primary label repeats a revision the headline already names',
    !/Revision \d+/.test(flow({ draft: { version: 2 } }).primary?.label ?? ''));
  chk('[2] never two primary actions at once',
    [flow(), flow({ readiness: GAPPY }), flow({ draft: { version: 1 } }),
     flow({ issued: { version: 1 } })].every((f) => f.primary === null || typeof f.primary.label === 'string'));

  console.log('\n[3] A current plan still offers something to do');
  const current = flow({ issued: { version: 2 }, drift: { changed: false, changedSections: [] } });
  chk('[3] no primary action when nothing needs doing', current.primary === null);
  chk('[3] but a quiet secondary remains — a dead stop reads as broken',
    current.secondary?.kind === 'PREPARE_REVISION');
  chk('[3] the discard action is worded as a control, not a description',
    flow({ draft: { version: 1 } }).secondary?.label === 'Discard revision');
  chk('[3] and the tone is positive', current.tone === 'GOOD');
  chk('[3] it says plainly that nothing needs doing',
    /Nothing needs doing/.test(current.detail ?? ''));
  chk('[3] a current plan with gaps still mentions them',
    /remain/.test(flow({
      issued: { version: 1 }, drift: { changed: false, changedSections: [] }, readiness: GAPPY,
    }).detail ?? ''));

  console.log('\n[4] Warn, never block');
  const gappy = flow({ readiness: GAPPY });
  chk('[4] an incomplete plan can still be prepared',
    gappy.secondary?.kind === 'PREPARE_REVISION');
  chk('[4]   and the wording admits it is going ahead regardless',
    /anyway/i.test(gappy.secondary?.label ?? ''));
  chk('[4] the gaps are named, not just counted',
    gappy.gaps.length === 3 && gappy.gaps.every((g) => /\d/.test(g)));
  chk('[4] nothing in the module refuses an action over readiness',
    !/return null;[\s\S]{0,60}readiness/.test(
      readFileSync('services/sites/cppWorkflow.ts', 'utf8')));
  chk('[4] the prepare warning offers both routes',
    /Prepare it anyway/.test(bar) && /Complete the sections first/.test(bar));
  chk('[4] the APPROVAL dialog shows the gaps beside the declaration',
    /This plan still has information outstanding/.test(bar) &&
    bar.indexOf('This plan still has information outstanding') < bar.indexOf('{declaration}'));

  console.log('\n[5] Gap phrasing');
  chk('[5] no gaps on a clean plan', readinessGaps(CLEAN).length === 0);
  chk('[5] singular reads correctly',
    readinessGaps({ outstandingSections: 1, riskTopicsUnconsidered: 1, arrangementsNotRecorded: 1 })
      .every((g) => !/1 \w+s /.test(g)));
  chk('[5] plural reads correctly',
    readinessGaps(GAPPY).some((g) => /4 sections/.test(g)) &&
    readinessGaps(GAPPY).some((g) => /25 risk topics/.test(g)));

  console.log('\n[6] Permissions shape the guidance, not just the buttons');
  chk('[6] someone who cannot issue is told who can',
    /Director or Principal Contractor/.test(
      flow({ draft: { version: 1 }, canIssue: false }).detail ?? ''));
  chk('[6]   and is offered no approve button',
    flow({ draft: { version: 1 }, canIssue: false }).primary === null);
  chk('[6] someone who cannot create is offered no prepare action',
    flow({ canCreate: false }).primary === null);
  chk('[6]   nor a secondary one on a current plan',
    flow({ issued: { version: 1 }, drift: { changed: false, changedSections: [] }, canCreate: false })
      .secondary === null);

  console.log('\n[7] The page no longer contradicts itself');
  chk('[7] the unconditional "— draft" heading is gone',
    !/Construction Phase Plan — draft/.test(page));
  chk('[7] the heading follows what is being read',
    /Revision \$\{viewingRevision\.version\} · in force/.test(page));
  chk('[7] a working draft says so', /'Working draft'/.test(page));
  chk('[7] the document banner is still separate and honest',
    /Working draft — for duty holder review and approval/.test(page));

  console.log('\n[8] The bar guides rather than reports');
  chk('[8] it computes one action', /recommendNextAction\(\{/.test(bar));
  chk('[8] the stage indicator is rendered', /CPP_STAGES\.map/.test(bar));
  chk('[8]   and the current stage is not carried by colour alone',
    /current stage/.test(bar) && /sr-only/.test(bar));
  chk('[8] the old technical wording is gone',
    !/Create a revision from the current plan/.test(bar));
  chk('[8] drift is folded into the flow, not a separate box',
    /Which sections changed\?/.test(bar));
  chk('[8] the switcher and history survive as secondary',
    /Working draft/.test(bar) && /Revision history/.test(bar));

  console.log('\n[9] The controls look like the rest of the platform');
  // These were hand-rolled class strings while every other platform editor uses
  // the Button component — which is why the primary read as oversized and the
  // secondary did not read as a control at all.
  chk('[9] no hand-rolled primary button classes remain',
    !/bg-brand-600 px-4 py-2/.test(bar));
  chk('[9] the shared Button component is used', /<Button/.test(bar));
  chk('[9] the secondary action is an outlined button, not bare text',
    /variant="secondary"/.test(bar) && !/text-ink-subtle hover:underline/.test(bar));
  chk('[9] a navigation is styled through buttonClasses, not a copied string',
    /buttonClasses\(\{ variant: 'primary', size: 'md' \}\)/.test(bar));
  chk('[9] the switcher says which revision is in force, not that one was issued',
    /Revision \{issued\.version\} \(Current\)/.test(bar) && !/Issued \(Rev /.test(bar));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
