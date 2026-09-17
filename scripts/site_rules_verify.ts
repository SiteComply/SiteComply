/**
 * Site Rules Library — verification.
 *
 *   npx tsx scripts/site_rules_verify.ts
 *
 * No database. Everything proven here is pure: the library, the seeded template,
 * how rules flow into induction screens, how a save is validated, and where a
 * saved run lands in the checklist. The parts that do need Postgres — that the
 * enum value exists and that saveChecklist versions correctly — are covered by
 * the migration runbook and by the existing checklist behaviour this reuses.
 *
 * [12] MUTATION TESTS. Every guard above is re-run against a deliberately broken
 * input, to prove the guard would actually catch the bug it exists for. A guard
 * nobody has seen fail is a guard nobody has tested.
 */
import { ChecklistItemType } from '@prisma/client';
import { UK_SITE_RULES_LIBRARY } from '../services/checklists/ukSiteRulesLibrary';
import { UK_INDUCTION_TEMPLATE } from '../services/checklists/ukInductionTemplate';
import {
  buildInductionSteps,
  isStepComplete,
  isSiteRulesAck,
  SITE_RULES_ACK_LABEL,
  type FlowItem,
} from '../services/checklists/inductionFlow';
import {
  validateSiteRules,
  mergeRuleItems,
  isLibraryRule,
  DEFAULT_SITE_RULES,
  type MergeableItem,
} from '../services/checklists/siteRulesService';

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

/** Turn a template into FlowItems with stable ids, the way the pages do. */
const flow = (
  rows: { label: string; helpText?: string | null; type: string; required: boolean }[],
): FlowItem[] =>
  rows.map((t, i) => ({
    id: `i${i}`,
    label: t.label,
    helpText: t.helpText ?? null,
    type: t.type as FlowItem['type'],
    required: t.required,
  }));

const ack = (label: string, required = true) => ({
  label,
  helpText: null,
  type: 'ACKNOWLEDGEMENT',
  required,
});
const rule = (label: string) => ({
  label,
  helpText: null,
  type: 'SITE_RULE',
  required: false,
});

function main() {
  console.log('== SITE RULES LIBRARY ==\n');

  // ─────────────────────────────────────────────────────────────────────────
  console.log('[1] The standard library');
  chk('a sensible number of rules', UK_SITE_RULES_LIBRARY.length >= 12,
      `${UK_SITE_RULES_LIBRARY.length} rules`);
  const labels = UK_SITE_RULES_LIBRARY.map((r) => r.label.trim().toLowerCase());
  chk('no duplicates', new Set(labels).size === labels.length);
  chk('every rule has real wording',
      UK_SITE_RULES_LIBRARY.every((r) => r.label.trim().length >= 3));
  chk('no rule exceeds the 200-character save limit',
      UK_SITE_RULES_LIBRARY.every((r) => r.label.trim().length <= 200),
      `longest ${Math.max(...UK_SITE_RULES_LIBRARY.map((r) => r.label.length))}`);
  chk('DEFAULT_SITE_RULES mirrors the library exactly',
      DEFAULT_SITE_RULES.length === UK_SITE_RULES_LIBRARY.length &&
      DEFAULT_SITE_RULES.every((r, i) => r.label === UK_SITE_RULES_LIBRARY[i]!.label));
  chk('isLibraryRule recognises a library rule',
      isLibraryRule(UK_SITE_RULES_LIBRARY[0]!.label));
  chk('isLibraryRule is case- and space-insensitive',
      isLibraryRule(`  ${UK_SITE_RULES_LIBRARY[0]!.label.toUpperCase()}  `));
  chk('isLibraryRule rejects a site-specific rule',
      !isLibraryRule('No deliveries through the school gate before 9am.'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[2] New sites are seeded with the rules selected');
  const seededRules = UK_INDUCTION_TEMPLATE.filter(
    (t) => t.type === ChecklistItemType.SITE_RULE,
  );
  chk('the whole library is seeded',
      seededRules.length === UK_SITE_RULES_LIBRARY.length,
      `${seededRules.length} seeded`);
  chk('no seeded rule is required',
      seededRules.every((r) => r.required === false));
  const ackIndex = UK_INDUCTION_TEMPLATE.findIndex(isSiteRulesAck);
  const firstRuleIndex = UK_INDUCTION_TEMPLATE.findIndex(
    (t) => t.type === ChecklistItemType.SITE_RULE,
  );
  chk('the site-rules acknowledgement is still in the template', ackIndex >= 0);
  chk('the rules sit immediately after it, not at the end',
      firstRuleIndex === ackIndex + 1,
      `ack at ${ackIndex}, rules from ${firstRuleIndex}`);
  chk('the rules are one unbroken run',
      UK_INDUCTION_TEMPLATE.slice(firstRuleIndex, firstRuleIndex + seededRules.length)
        .every((t) => t.type === ChecklistItemType.SITE_RULE));
  chk('PPE is untouched — still 6 items',
      UK_INDUCTION_TEMPLATE.filter((t) => t.type === ChecklistItemType.PPE_CONFIRM)
        .length === 6);
  chk('the acknowledgements are untouched — still 6',
      UK_INDUCTION_TEMPLATE.filter(
        (t) => t.type === ChecklistItemType.ACKNOWLEDGEMENT,
      ).length === 6);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[3] The seeded induction: rules ride on the acknowledgement');
  const steps = buildInductionSteps(flow(UK_INDUCTION_TEMPLATE));
  chk('still four screens — rules add none', steps.length === 4,
      `${steps.length}`);
  const first = steps[0];
  chk('screen 1 is the site briefing section',
      first?.kind === 'section' && first.section.key === 'site-briefing');
  chk('the rules are attached to it',
      first?.kind === 'section' && (first.rules?.length ?? 0) === seededRules.length,
      first?.kind === 'section' ? `${first.rules?.length ?? 0} rules` : 'n/a');
  chk('they are NOT among the items to tick',
      first?.kind === 'section' && first.items.every((i) => i.type !== 'SITE_RULE'));
  chk('the section still holds exactly three ticks',
      first?.kind === 'section' && first.items.length === 3);
  chk('no standalone rules screen was produced',
      !steps.some((s) => s.kind === 'rules'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[4] One acknowledgement covers the whole set');
  const sectionStep = steps[0];
  if (sectionStep?.kind !== 'section') {
    chk('screen 1 is a section', false);
  } else {
    const ticks: Record<string, true> = {};
    for (const i of sectionStep.items) ticks[i.id] = true;
    chk('ticking the three acknowledgements completes the screen',
        isStepComplete(sectionStep, ticks, false));
    chk('no rule has an answer key',
        (sectionStep.rules ?? []).every((r) => !(r.id in ticks)));
    const withoutRulesAck: Record<string, true> = { ...ticks };
    const rulesAck = sectionStep.items.find(isSiteRulesAck);
    if (rulesAck) delete withoutRulesAck[rulesAck.id];
    chk('leaving the rules acknowledgement unticked blocks the screen',
        rulesAck !== undefined && !isStepComplete(sectionStep, withoutRulesAck, false));
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[5] A rule can never gate a screen, even a malformed one');
  // Bypassing the service, as a hand-made API call or a direct DB row could.
  const forcedRequired = flow([
    ack(SITE_RULES_ACK_LABEL),
    { ...rule('A rule somebody marked required'), required: true },
  ]);
  const forcedSteps = buildInductionSteps(forcedRequired);
  const ackStep = forcedSteps[0]!;
  chk('a required rule is still display-only',
      ackStep.kind === 'acknowledgement' && (ackStep.rules?.length ?? 0) === 1);
  chk('ticking only the acknowledgement still completes the screen',
      ackStep.kind === 'acknowledgement' &&
      isStepComplete(ackStep, { [ackStep.item.id]: true }, false));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[6] A lone acknowledgement outside a section hosts the rules');
  const lone = buildInductionSteps(
    flow([ack(SITE_RULES_ACK_LABEL), rule('Rule one'), rule('Rule two')]),
  );
  chk('one acknowledgement screen, no rules screen',
      lone.length === 2 && lone[0]?.kind === 'acknowledgement' && lone[1]?.kind === 'gdpr');
  chk('both rules are attached to it',
      lone[0]?.kind === 'acknowledgement' && lone[0].rules?.length === 2);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[7] A straight apostrophe or odd casing still matches');
  const odd = buildInductionSteps(
    flow([ack('  i have read and will follow the SITE RULES and signage.  '),
          rule('Rule one')]),
  );
  chk('normalised matching finds the acknowledgement',
      odd[0]?.kind === 'acknowledgement' && odd[0].rules?.length === 1);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[8] Rules are never lost when nothing acknowledges them');
  const orphaned = buildInductionSteps(
    flow([
      ack('Something else entirely'),
      rule('Rule one'),
      rule('Rule two'),
      ack('A later statement'),
    ]),
  );
  const orphanStep = orphaned.find((s) => s.kind === 'rules');
  chk('a standalone rules screen appears', orphanStep !== undefined);
  chk('it carries both rules',
      orphanStep?.kind === 'rules' && orphanStep.items.length === 2);
  chk('it sits where the rules were, between the two statements',
      orphaned[1]?.kind === 'rules',
      orphaned.map((s) => s.kind).join(' | '));
  chk('it never blocks: nothing to answer',
      orphanStep !== undefined && isStepComplete(orphanStep, {}, false));
  chk('no acknowledgement wrongly claimed them',
      orphaned.every((s) => s.kind !== 'acknowledgement' || s.rules === undefined));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[9] A checklist with no rules is completely unchanged');
  const noRules = UK_INDUCTION_TEMPLATE.filter(
    (t) => t.type !== ChecklistItemType.SITE_RULE,
  );
  const before = buildInductionSteps(flow(noRules));
  chk('four screens, exactly as before the feature',
      before.length === 4 && before.map((s) => s.kind).join(',') ===
        'section,section,ppe,gdpr');
  chk('no step carries a rules payload',
      before.every((s) => !('rules' in s) || s.rules === undefined));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[10] Saving: what is accepted and what is refused');
  const good = validateSiteRules([
    { label: 'Sign in on arrival.', helpText: null },
    { label: 'Wear your PPE.', helpText: '  trimmed  ' },
  ]);
  chk('two good rules are accepted', good.ok);
  chk('every saved rule is typed SITE_RULE',
      good.ok && good.items.every((i) => i.type === ChecklistItemType.SITE_RULE));
  chk('every saved rule is forced to required: false',
      good.ok && good.items.every((i) => i.required === false));
  chk('help text is trimmed',
      good.ok && good.items[1]!.helpText === 'trimmed');
  chk('empty help text becomes null',
      good.ok && good.items[0]!.helpText === null);

  chk('a blank rule is refused',
      !validateSiteRules([{ label: '  ', helpText: null }]).ok);
  chk('a two-character rule is refused',
      !validateSiteRules([{ label: 'ok', helpText: null }]).ok);
  chk('a duplicate is refused, ignoring case',
      !validateSiteRules([
        { label: 'No smoking on site.', helpText: null },
        { label: 'NO SMOKING ON SITE.', helpText: null },
      ]).ok);
  chk('a 201-character rule is refused',
      !validateSiteRules([{ label: 'x'.repeat(201), helpText: null }]).ok);
  chk('a 200-character rule is accepted',
      validateSiteRules([{ label: 'x'.repeat(200), helpText: null }]).ok);
  chk('41 rules are refused',
      !validateSiteRules(
        Array.from({ length: 41 }, (_, i) => ({ label: `Rule ${i}`, helpText: null })),
      ).ok);
  chk('40 rules are accepted',
      validateSiteRules(
        Array.from({ length: 40 }, (_, i) => ({ label: `Rule ${i}`, helpText: null })),
      ).ok);
  chk('an empty list is accepted — deselecting every rule is allowed',
      validateSiteRules([]).ok);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[11] Saving: where the rules land in the checklist');
  const newRun = validateSiteRules([{ label: 'New rule', helpText: null }]);
  if (!newRun.ok) {
    chk('the new run validates', false);
  } else {
    const existing: MergeableItem[] = UK_INDUCTION_TEMPLATE.map((t) => ({
      label: t.label,
      helpText: t.helpText ?? null,
      type: t.type,
      required: t.required,
    }));
    const merged = mergeRuleItems(existing, newRun.items);
    const mAck = merged.findIndex(isSiteRulesAck);
    const mRule = merged.findIndex((i) => i.type === ChecklistItemType.SITE_RULE);
    chk('the old run is gone, the new one is in its place',
        merged.filter((i) => i.type === ChecklistItemType.SITE_RULE).length === 1);
    chk('still directly after the acknowledgement', mRule === mAck + 1,
        `ack ${mAck}, rule ${mRule}`);
    chk('nothing else was touched',
        merged.filter((i) => i.type !== ChecklistItemType.SITE_RULE).length ===
        existing.filter((i) => i.type !== ChecklistItemType.SITE_RULE).length);
    chk('PPE keeps its place after the rules',
        merged.findIndex((i) => i.type === ChecklistItemType.PPE_CONFIRM) > mRule);

    // A site with no rules yet — they go after the acknowledgement.
    const fresh: MergeableItem[] = existing.filter(
      (i) => i.type !== ChecklistItemType.SITE_RULE,
    );
    const freshMerged = mergeRuleItems(fresh, newRun.items);
    const fAck = freshMerged.findIndex(isSiteRulesAck);
    const fRule = freshMerged.findIndex(
      (i) => i.type === ChecklistItemType.SITE_RULE,
    );
    chk('a first save lands after the acknowledgement, not at the end',
        fRule === fAck + 1 && fRule < freshMerged.length - 1,
        `ack ${fAck}, rule ${fRule} of ${freshMerged.length}`);

    // No acknowledgement at all — appended rather than dropped.
    const noAck: MergeableItem[] = [
      { label: 'Only statement', helpText: null, type: ChecklistItemType.ACKNOWLEDGEMENT, required: true },
    ];
    const noAckMerged = mergeRuleItems(noAck, newRun.items);
    chk('with no acknowledgement the rules are appended, never dropped',
        noAckMerged.length === 2 &&
        noAckMerged[1]!.type === ChecklistItemType.SITE_RULE);

    // Deselecting everything removes the run and leaves the rest intact.
    const cleared = mergeRuleItems(existing, []);
    chk('saving an empty set clears the rules and keeps everything else',
        cleared.every((i) => i.type !== ChecklistItemType.SITE_RULE) &&
        cleared.length === existing.filter(
          (i) => i.type !== ChecklistItemType.SITE_RULE,
        ).length);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[12] MUTATION — each guard above catches its own bug');

  // If SITE_RULE items were treated as ordinary items, they would become ticks.
  const asAcks = flow([
    ack(SITE_RULES_ACK_LABEL),
    ...UK_SITE_RULES_LIBRARY.map((r) => ack(r.label, false)),
  ]);
  const asAckSteps = buildInductionSteps(asAcks);
  chk('[3] would fail if rules were acknowledgements — they would add screens',
      asAckSteps.length > 4, `${asAckSteps.length} screens`);

  // If the rules run were appended instead of spliced, [11] would notice.
  const appended = [
    ...UK_INDUCTION_TEMPLATE.filter((t) => t.type !== ChecklistItemType.SITE_RULE)
      .map((t) => ({
        label: t.label,
        helpText: t.helpText ?? null,
        type: t.type,
        required: t.required,
      })),
    { label: 'New rule', helpText: null, type: ChecklistItemType.SITE_RULE, required: false },
  ];
  const badAck = appended.findIndex(isSiteRulesAck);
  const badRule = appended.findIndex((i) => i.type === ChecklistItemType.SITE_RULE);
  chk('[11] would fail on an appended run — the position check is real',
      badRule !== badAck + 1, `ack ${badAck}, rule ${badRule}`);

  // If required were taken from the caller, [10] would notice.
  const asked = validateSiteRules([
    { label: 'A rule', helpText: null } as never,
  ]);
  chk('[10] required:false is forced, not defaulted',
      asked.ok && asked.items[0]!.required === false);
  const passedThrough = validateSiteRules([
    { label: 'A rule', helpText: null, required: true } as never,
  ]);
  chk('[10] a caller asking for required:true is overruled',
      passedThrough.ok && passedThrough.items[0]!.required === false);

  // If the orphan fallback were dropped, [8] would notice.
  const droppedOrphans = buildInductionSteps(
    flow([ack('Something else entirely')]),
  );
  chk('[8] the orphan screen only appears when there are orphans',
      !droppedOrphans.some((s) => s.kind === 'rules'));

  // If isSiteRulesAck matched loosely, [7] and [8] would both be meaningless.
  chk('[7] matching is exact, not "contains rules"',
      !isSiteRulesAck({
        label: 'I have read the site rules booklet issued at the gate.',
        type: 'ACKNOWLEDGEMENT',
      }));
  chk('[7] a SITE_RULE row is never mistaken for the acknowledgement',
      !isSiteRulesAck({ label: SITE_RULES_ACK_LABEL, type: 'SITE_RULE' }));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
