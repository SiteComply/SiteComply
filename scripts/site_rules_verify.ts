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
import {
  UK_SITE_RULES_LIBRARY,
  UK_SITE_RULES_DEFAULT,
} from '../services/checklists/ukSiteRulesLibrary';
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
  isOptionalTemplateRule,
  buildRuleRows,
  siteRulesChanged,
  DEFAULT_SITE_RULES,
  SITE_RULE_LIBRARY,
  type MergeableItem,
} from '../services/checklists/siteRulesService';
import { readFileSync } from 'node:fs';

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
  chk('every entry states its tier explicitly',
      UK_SITE_RULES_LIBRARY.every((r) => typeof r.defaultSelected === 'boolean'));
  chk('both tiers are populated',
      UK_SITE_RULES_DEFAULT.length >= 8 &&
      UK_SITE_RULES_LIBRARY.length > UK_SITE_RULES_DEFAULT.length,
      `${UK_SITE_RULES_DEFAULT.length} default, ` +
      `${UK_SITE_RULES_LIBRARY.length - UK_SITE_RULES_DEFAULT.length} optional`);
  const labels = UK_SITE_RULES_LIBRARY.map((r) => r.label.trim().toLowerCase());
  chk('no duplicates', new Set(labels).size === labels.length);
  chk('every rule has real wording',
      UK_SITE_RULES_LIBRARY.every((r) => r.label.trim().length >= 3));
  chk('no rule exceeds the 200-character save limit',
      UK_SITE_RULES_LIBRARY.every((r) => r.label.trim().length <= 200),
      `longest ${Math.max(...UK_SITE_RULES_LIBRARY.map((r) => r.label.length))}`);
  chk('DEFAULT_SITE_RULES is exactly the default tier',
      DEFAULT_SITE_RULES.length === UK_SITE_RULES_DEFAULT.length &&
      DEFAULT_SITE_RULES.every((r, i) => r.label === UK_SITE_RULES_DEFAULT[i]!.label));
  chk('SITE_RULE_LIBRARY is the whole library, tiers intact',
      SITE_RULE_LIBRARY.length === UK_SITE_RULES_LIBRARY.length &&
      SITE_RULE_LIBRARY.every(
        (r, i) => r.defaultSelected === UK_SITE_RULES_LIBRARY[i]!.defaultSelected,
      ));
  chk('isLibraryRule recognises a library rule',
      isLibraryRule(UK_SITE_RULES_LIBRARY[0]!.label));
  chk('isLibraryRule is case- and space-insensitive',
      isLibraryRule(`  ${UK_SITE_RULES_LIBRARY[0]!.label.toUpperCase()}  `));
  chk('isLibraryRule rejects a site-specific rule',
      !isLibraryRule('No deliveries through the school gate before 9am.'));
  chk('isOptionalTemplateRule separates the tiers',
      UK_SITE_RULES_LIBRARY.every(
        (r) => isOptionalTemplateRule(r.label) === !r.defaultSelected,
      ));

  console.log('\n[1b] The rationalised set: what must NOT be a default');
  // Each of these was removed from the default tier by owner decision. They are
  // named individually because "the count went down" would pass even if the
  // wrong five had gone.
  const mustNotBeDefault = [
    ['smoking', /smoking|vaping/i],
    ['waste segregation', /skip|segregate/i],
    ['site traffic', /speed limit/i],
    ['mobile phones', /mobile phone/i],
    ['respect and harassment', /bullying|harassment/i],
  ] as const;
  for (const [name, pattern] of mustNotBeDefault) {
    chk(`${name} is not seeded by default`,
        !UK_SITE_RULES_DEFAULT.some((r) => pattern.test(r.label)));
    chk(`${name} is still available as an optional template`,
        UK_SITE_RULES_LIBRARY.some(
          (r) => pattern.test(r.label) && !r.defaultSelected,
        ));
  }

  console.log('\n[1c] Nothing duplicates an acknowledgement on the same induction');
  // Removed because the operative ticks these inches away. The signage rule sat
  // directly beneath "I have read and will follow the site rules AND SIGNAGE".
  chk('the permit rule is gone from the library entirely',
      !UK_SITE_RULES_LIBRARY.some((r) => /permit/i.test(r.label)));
  chk('the acknowledgement that replaced it is still on the induction',
      UK_INDUCTION_TEMPLATE.some((t) => /permit to work system/i.test(t.label)));
  chk('the signage rule is gone from the library entirely',
      !UK_SITE_RULES_LIBRARY.some((r) => /signage/i.test(r.label)));
  chk('the acknowledgement that replaced it is still on the induction',
      UK_INDUCTION_TEMPLATE.some((t) => /site rules and signage/i.test(t.label)));

  console.log('\n[1d] Alcohol and drugs stays a default — owner decision');
  const drugs = UK_SITE_RULES_LIBRARY.find((r) => /alcohol/i.test(r.label));
  chk('the rule exists', drugs !== undefined);
  chk('it is seeded by default', drugs?.defaultSelected === true);
  chk('phrased as impairment, not possession',
      drugs !== undefined && /under the influence/i.test(drugs.label) &&
      !/^No alcohol or drugs on site/i.test(drugs.label),
      drugs?.label);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[1e] The editor: what a Site Manager actually sees');

  // The tier is asked of the LIBRARY, never of the row. RuleRow deliberately does
  // not carry it — see siteRuleRows — so these tests cannot accidentally start
  // proving that a distinction the UI must not make is still being made.
  const isTemplate = (r: { label: string }) => isOptionalTemplateRule(r.label);

  // A BRAND NEW SITE — seeded with the defaults, nothing else.
  const fresh = buildRuleRows(DEFAULT_SITE_RULES, SITE_RULE_LIBRARY);
  chk('every library rule appears, adopted or not',
      fresh.length === SITE_RULE_LIBRARY.length, `${fresh.length} rows`);
  chk('the 10 defaults are ticked',
      fresh.filter((r) => r.selected).length === DEFAULT_SITE_RULES.length);
  chk('the 5 optional templates are present and unticked',
      fresh.filter(isTemplate).length === 5 &&
      fresh.filter(isTemplate).every((r) => !r.selected));
  chk('no library rule is badged at all — defaults and templates look alike',
      fresh.every((r) => !r.custom));
  chk('the row carries NO tier, so no badge can render one',
      fresh.every((r) => !('optional' in r)));
  chk('a default and a template are indistinguishable but for the tick',
      JSON.stringify(Object.keys(fresh.find((r) => !isTemplate(r))!).sort()) ===
      JSON.stringify(Object.keys(fresh.find(isTemplate)!).sort()));
  chk('the smoking template is there, unticked, unbadged',
      fresh.some(
        (r) => /Smoking and vaping/.test(r.label) && !r.selected && !r.custom,
      ));
  chk('help text rides along for the rules that have it',
      fresh.some((r) => r.helpText !== null));

  // A SITE THAT HAS ADOPTED ONE TEMPLATE AND DROPPED ONE DEFAULT, and added
  // a rule of its own.
  const adopted: typeof DEFAULT_SITE_RULES = [
    ...DEFAULT_SITE_RULES.filter((r) => !/PPE/.test(r.label)),
    { label: 'Smoking and vaping only in the designated area.', helpText: null },
    { label: 'No deliveries through the school gate before 9am.', helpText: null },
  ];
  const used = buildRuleRows(adopted, SITE_RULE_LIBRARY);
  chk('the adopted template now shows ticked, and still unbadged',
      used.some(
        (r) => /Smoking and vaping/.test(r.label) && r.selected && !r.custom,
      ));
  chk('the dropped default shows unticked, NOT removed from the list',
      used.some((r) => /PPE/.test(r.label) && !r.selected && !r.custom));
  chk('an adopted template and a kept default are presented identically',
      used.find((r) => /Smoking and vaping/.test(r.label))?.custom ===
      used.find((r) => /Sign in on arrival/.test(r.label))?.custom);
  chk('the site\'s own rule IS badged Site-specific and comes last',
      used[used.length - 1]?.custom === true &&
      /school gate/.test(used[used.length - 1]!.label));
  chk('it is the only badged row',
      used.filter((r) => r.custom).length === 1);
  chk('nothing saved is silently dropped from the editor',
      adopted.every((saved) =>
        used.some((r) => r.label === saved.label && r.selected)));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[2] New sites are seeded with the rules selected');
  const seededRules = UK_INDUCTION_TEMPLATE.filter(
    (t) => t.type === ChecklistItemType.SITE_RULE,
  );
  chk('the DEFAULT tier is seeded, and only that',
      seededRules.length === UK_SITE_RULES_DEFAULT.length &&
      seededRules.every((r, i) => r.label === UK_SITE_RULES_DEFAULT[i]!.label),
      `${seededRules.length} seeded of ${UK_SITE_RULES_LIBRARY.length} in the library`);
  chk('no optional template reaches a new site',
      !seededRules.some((r) => isOptionalTemplateRule(r.label)));
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

  // If the seed went back to the whole library, [2] would notice. Proven by
  // running [2]'s own comparison against exactly that mistake.
  const wholeLibrarySeed = UK_SITE_RULES_LIBRARY.map((r) => r.label);
  chk('[2] would fail if the seed took the whole library',
      wholeLibrarySeed.length !== UK_SITE_RULES_DEFAULT.length,
      `${wholeLibrarySeed.length} vs ${UK_SITE_RULES_DEFAULT.length}`);
  chk('[2] and it would specifically catch an optional template getting through',
      wholeLibrarySeed.some((l) => isOptionalTemplateRule(l)));

  // If a removed rule were flipped back to a default, [1b] would notice. Proven
  // by running [1b]'s own predicate against a deliberately mis-tiered entry.
  const mistiered = [{ label: 'Smoking and vaping only in the designated area.' }];
  chk('[1b] would fail if smoking were seeded again',
      mistiered.some((r) => /smoking|vaping/i.test(r.label)));
  // ...and the same predicate must NOT fire on the real default tier.
  chk('[1b] the predicate is discriminating, not always-true',
      !UK_SITE_RULES_DEFAULT.some((r) => /smoking|vaping/i.test(r.label)));

  // If the permit or signage rule came back, [1c] would notice.
  chk('[1c] would fail on a returning permit rule',
      /permit/i.test('Do not start work without a valid permit where one is required.'));
  chk('[1c] would fail on a returning signage rule',
      /signage/i.test('Obey all site signage, speed limits and pedestrian routes.'));

  // If the editor were handed only the DEFAULT tier, [1e] would notice: the five
  // optional templates would simply not be rows, and could never be adopted.
  const defaultsOnly = buildRuleRows(
    DEFAULT_SITE_RULES,
    SITE_RULE_LIBRARY.filter((r) => r.defaultSelected),
  );
  chk('[1e] would fail if the editor got only the defaults',
      defaultsOnly.filter((r) => isOptionalTemplateRule(r.label)).length === 0 &&
      defaultsOnly.length < SITE_RULE_LIBRARY.length,
      `${defaultsOnly.length} rows, 0 templates`);
  // ...and the real call must not look like that.
  chk('[1e] the real editor call does offer the templates',
      buildRuleRows(DEFAULT_SITE_RULES, SITE_RULE_LIBRARY)
        .filter((r) => isOptionalTemplateRule(r.label)).length === 5);

  // -----------------------------------------------------------------------
  // [13] POST-INDUCTION REVIEW on Site information.
  //
  // The rules an operative acknowledged used to be readable afterwards in the
  // induction record PDF and nowhere else; the "Site rules" card on Site
  // information rendered the unrelated free-text field, and rendered nothing
  // when that field was blank. Someone looking for their rules reached the right
  // screen and found the section missing.
  // -----------------------------------------------------------------------
  console.log('\n[13] Site rules are reviewable after induction');

  const page = readFileSync('app/worker/site-information/page.tsx', 'utf8');

  chk('[13] Site information asks for the worker\'s rule view',
      /getSiteRulesForWorker\(site\.id, worker\.id\)/.test(page));
  chk('[13] and renders ONE site-rules section',
      (page.match(/title="Site rules"/g) ?? []).length === 1,
      `${(page.match(/title="Site rules"/g) ?? []).length} cards`);
  chk('[13] the section does NOT depend on the free-text field',
      /<SiteRulesSection view=\{siteRules\} notes=\{info\.siteRules\} \/>/.test(page));
  chk('[13]   — it renders on rules alone',
      /const hasRules = view\.rules\.length > 0;[\s\S]{0,120}if \(!hasRules && !notes\) return null;/.test(page));
  chk('[13] rules lead, free text follows as supplementary notes',
      page.indexOf('view.rules.map') < page.indexOf('<LongText value={notes} />'));
  chk('[13] and the free text is labelled as additional, not as the rules',
      /Additional site information/.test(page) && !/title="Site rules \(/.test(page));
  chk('[13] the acknowledgement date is shown',
      /You acknowledged these rules at your induction on/.test(page));
  chk('[13] numbered like the induction, so it reads as the same list',
      /<ol className="space-y-3">/.test(page));

  // The changed-since predicate. This decides whether an operative is told to
  // read the rules again, so it is proven both ways.
  const setA: { label: string; helpText: string | null }[] = [
    { label: 'Wear a hard hat', helpText: 'At all times.' },
    { label: 'Report all accidents', helpText: null },
  ];
  chk('[13] an unchanged set raises no notice',
      !siteRulesChanged(setA, setA.map((r) => ({ ...r }))));
  chk('[13]   — nor does re-saving with stray whitespace',
      !siteRulesChanged(setA, [
        { label: '  Wear a hard   hat ', helpText: 'At all times. ' },
        { label: 'Report all accidents', helpText: null },
      ]));
  chk('[13] a changed LABEL is a change',
      siteRulesChanged(setA, [
        { label: 'Wear a hard hat and boots', helpText: 'At all times.' },
        { label: 'Report all accidents', helpText: null },
      ]));
  chk('[13] a changed HELP TEXT is a change — the obligation often lives there',
      siteRulesChanged(setA, [
        { label: 'Wear a hard hat', helpText: 'Except in the site office.' },
        { label: 'Report all accidents', helpText: null },
      ]));
  chk('[13] an ADDED rule is a change',
      siteRulesChanged(setA, [...setA, { label: 'No lone working', helpText: null }]));
  chk('[13] a REMOVED rule is a change',
      siteRulesChanged(setA, [setA[0]]));
  chk('[13] a REORDERED set is a change — "rule 4" must mean rule 4',
      siteRulesChanged(setA, [setA[1], setA[0]]));
  chk('[13] null and empty help text are the same thing, not a change',
      !siteRulesChanged(
        [{ label: 'Wear a hard hat', helpText: null }],
        [{ label: 'Wear a hard hat', helpText: '' }],
      ));

  // The service wrapper's two honest UNKNOWNs. Neither may raise a false alarm.
  const svc = readFileSync('services/checklists/siteRulesService.ts', 'utf8');
  chk('[13] the acknowledgement ignores a reused induction',
      /inductionReused: false/.test(svc));
  chk('[13] a worker who never inducted here is not told anything changed',
      /if \(!induction\) \{\s*\n\s*return \{ rules, acknowledgedAt: null, changedSinceInduction: false \};/.test(svc));
  chk('[13] a missing historic version is an unknown, not a change',
      /answered\s*\?[\s\S]{0,80}: false,/.test(svc));
  chk('[13] the rules shown are the ones IN FORCE, not the signed snapshot',
      /const rules = checklist \? rulesOf\(checklist\.items\) : \[\];/.test(svc));

  // -----------------------------------------------------------------------
  // [13b] The panel cannot hide the rules.
  //
  // Site information is an opt-OUT panel. A site that switched it off was
  // hiding site information — not the operative's own signed record. Rules they
  // acknowledged stay reachable, on the same reasoning that keeps Attendance and
  // Induction records always visible.
  // -----------------------------------------------------------------------
  console.log('\n[13b] Site rules survive the panel being switched off');

  const shell = readFileSync('components/worker/WorkerShell.tsx', 'utf8');
  const nav = readFileSync('components/worker/WorkerNav.tsx', 'utf8');

  chk('[13b] the shell resolves it once, for every worker page',
      /const siteRulesVisible = activeSiteId\s*\n?\s*\? await siteHasSiteRules\(activeSiteId\)/.test(shell));
  chk('[13b]   — so no page can forget to pass it',
      (shell.match(/siteRulesVisible/g) ?? []).length >= 2 &&
      !/siteRulesVisible\?:/.test(shell));
  chk('[13b] the nav shows Site information when the panel is off but rules exist',
      /alsoWhenSiteRules: true/.test(nav) &&
      /\(item\.alsoWhenSiteRules && siteRulesVisible\)/.test(nav));
  chk('[13b]   — and the panel route still works on its own',
      /item\.panels\.some\(\(p\) => panels\[p\]\)/.test(nav));
  chk('[13b]   — the rules clause is an OR, never a new requirement',
      /item\.panels\.some\(\(p\) => panels\[p\]\) \|\|\s*\n?\s*\(item\.alsoWhenSiteRules/.test(nav));
  chk('[13b] only Site information opts in — this is not a global unhide',
      (nav.match(/alsoWhenSiteRules: true/g) ?? []).length === 1);

  chk('[13b] the page no longer redirects purely on the panel',
      !/if \(!panels\.SITE_INFORMATION\) redirect/.test(page));
  chk('[13b] it narrows to the rules instead of disappearing',
      /const rulesOnly = !panels\.SITE_INFORMATION;/.test(page));
  chk('[13b] panel off AND no rules is left exactly as it was',
      /if \(rulesOnly && siteRules\.rules\.length === 0\) redirect\('\/worker\/dashboard'\);/.test(page));
  chk('[13b] the narrowed page is titled for what it actually shows',
      /title=\{rulesOnly \? 'Site rules' : 'Site information'\}/.test(page));
  chk('[13b] and still carries the safety reminder',
      (page.match(/<SafetyReminder \/>/g) ?? []).length === 2);

  // The nav and the page must agree, or a visible link leads to a redirect.
  chk('[13b] nav visibility and page visibility share one condition',
      /siteHasSiteRules/.test(shell) &&
      /siteRules\.rules\.length === 0/.test(page));

  const svcRules = readFileSync('services/checklists/siteRulesService.ts', 'utf8');
  chk('[13b] the shell predicate reads the CURRENT checklist version',
      /siteHasSiteRules[\s\S]{0,400}orderBy: \{ version: 'desc' \}/.test(svcRules));
  chk('[13b]   — and counts rather than loading the checklist, it runs everywhere',
      /siteHasSiteRules[\s\S]{0,600}prisma\.checklistItem\.count/.test(svcRules));

  // -----------------------------------------------------------------------
  // [14] The editor naming collision that caused this.
  // -----------------------------------------------------------------------
  console.log('\n[14] The two editors are distinguishable');

  const exp = readFileSync('app/platform/dashboard/sites/[id]/experience/page.tsx', 'utf8');
  const infoCfg = readFileSync('components/platform/SiteInformationConfig.tsx', 'utf8');
  const wizard = readFileSync('components/platform/SiteSetupWizard.tsx', 'utf8');

  // Plain "Site rules" — the collision was resolved by renaming the free-text
  // field, so the rule set does not need a suffix to be unambiguous. The tab's
  // DESCRIPTION still names the induction, which is where that belongs.
  chk('[14] the library tab is labelled plainly',
      /label: 'Site rules',/.test(exp) && !/Site rules \(induction\)/.test(exp));
  chk('[14]   — and its description still names the induction',
      /The numbered rules operatives agree to at induction/.test(exp));
  chk('[14] the free-text field is no longer called "Site rules"',
      !/label="Site rules"/.test(infoCfg));
  chk('[14]   — it is called Additional site information',
      /label="Additional site information"/.test(infoCfg));
  chk('[14]   — and points at the right editor for actual rules',
      /use the Site rules section/.test(infoCfg));
  chk('[14] the setup wizard agrees with the editor',
      /label: 'Additional site information'/.test(wizard) &&
      !/'siteRules', label: 'Site rules'/.test(wizard));
  // The site setup wizard's step, which is where a manager FIRST meets this
  // field. Its description actively claimed to be the induction rule set.
  const setup = readFileSync('services/sites/siteSetupConstants.ts', 'utf8');
  chk('[14] the setup step no longer claims to be the induction rules',
      !/description: 'The rules every operative agrees to at induction\.'/.test(setup));
  chk('[14]   — and is titled as supplementary information',
      /key: 'rules',[\s\S]{0,500}title: 'Additional site information'/.test(setup));

  // The completeness indicator, which reports this field as a missing section.
  const infoConsts = readFileSync('services/sites/siteInformationConstants.ts', 'utf8');
  chk('[14] the completeness indicator does not report "Site rules" missing',
      /\{ key: 'siteRules', label: 'Additional site information' \}/.test(infoConsts));

  chk('[14] no editor surface still labels the free text as the rule set',
      !/label="Site rules"/.test(infoCfg) && !/label: 'Site rules',/.test(wizard));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
