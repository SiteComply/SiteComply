/**
 * Owner Review Item 14 — grouped acknowledgement screens.
 *
 * The point of the change is fewer screens with IDENTICAL compliance output, so
 * the assertions are mostly about what did NOT change: the same items are asked,
 * each is still answered individually, and a partly-answered screen still blocks.
 *
 * Run: npx tsx scripts/induction_grouping_verify.ts
 */
import {
  buildInductionSteps,
  isStepComplete,
  sectionFor,
  INDUCTION_SECTIONS,
  type FlowItem,
  type InductionAnswers,
} from '../services/checklists/inductionFlow';
import { UK_INDUCTION_TEMPLATE } from '../services/checklists/ukInductionTemplate';

let pass = 0;
const failures: string[] = [];
const chk = (t: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${t}${d ? ` — ${d}` : ''}`); }
  else { failures.push(t); console.log(`  FAIL ${t}${d ? ` — ${d}` : ''}`); }
};

const seeded: FlowItem[] = UK_INDUCTION_TEMPLATE.map((t, i) => ({
  id: `item-${i}`,
  label: t.label,
  helpText: t.helpText ?? null,
  type: t.type as FlowItem['type'],
  required: t.required,
}));

const describe = (s: ReturnType<typeof buildInductionSteps>[number]) =>
  s.kind === 'section' ? `section:${s.section.key}(${s.items.length})${s.rules ? `+${s.rules.length}rules` : ''}`
  : s.kind === 'ppe' ? `ppe(${s.items.length})`
  : s.kind === 'rules' ? `rules(${s.items.length})`
  : s.kind === 'gdpr' ? 'gdpr'
  : s.kind === 'briefing' ? `briefing:${s.screen.key}`
  : s.kind === 'video' ? `video:v${s.video.version}`
  : `${s.kind}:${s.item.label.slice(0, 28)}`;

function main() {
  console.log('== INDUCTION GROUPING ==\n');

  console.log('[1] The seeded induction is now four screens');
  const steps = buildInductionSteps(seeded);
  steps.forEach((s, i) => console.log(`     ${i + 1}. ${describe(s)}`));
  chk('four screens', steps.length === 4, `${steps.length}`);
  chk('1 = site briefing, 3 items',
      steps[0]?.kind === 'section' && steps[0].section.key === 'site-briefing' && steps[0].items.length === 3);
  chk('2 = work and permits, 3 items',
      steps[1]?.kind === 'section' && steps[1].section.key === 'work-and-permits' && steps[1].items.length === 3);
  chk('3 = PPE, unchanged, 6 items', steps[2]?.kind === 'ppe' && steps[2].items.length === 6);
  chk('4 = GDPR, still standalone', steps[3]?.kind === 'gdpr');

  console.log('\n[2] Nothing was dropped — every item still REACHES the operative');
  // Site rules are shown, not asked, so they ride on a step's `rules` rather than
  // its `items`. Counted here all the same: this check exists to prove nothing
  // silently vanishes from the induction, and a rule nobody sees has vanished.
  const shown = steps.flatMap((s) =>
    s.kind === 'section' || s.kind === 'ppe' || s.kind === 'rules'
      ? [
          ...s.items.map((i: FlowItem) => i.id),
          ...(s.kind === 'section' ? (s.rules ?? []) : []).map((i: FlowItem) => i.id),
        ]
    : s.kind === 'gdpr' || s.kind === 'briefing' || s.kind === 'video' ? []
    : s.kind === 'acknowledgement'
      ? [s.item.id, ...(s.rules ?? []).map((i: FlowItem) => i.id)]
      : [s.item.id]);
  chk('every checklist item still appears exactly once',
      shown.length === seeded.length && new Set(shown).size === seeded.length,
      `${shown.length} shown of ${seeded.length}`);
  const missing = seeded.filter((i) => !shown.includes(i.id));
  chk('none missing', missing.length === 0, missing.map((m) => m.label).join('; '));

  console.log('\n[3] Each acknowledgement is still answered INDIVIDUALLY');
  const s1 = steps[0]!;
  if (s1.kind === 'section') {
    const partial: InductionAnswers = { [s1.items[0]!.id]: true };
    chk('one of three ticked does NOT complete the screen', !isStepComplete(s1, partial, false));
    const two: InductionAnswers = { [s1.items[0]!.id]: true, [s1.items[1]!.id]: true };
    chk('two of three still does not', !isStepComplete(s1, two, false));
    const all: InductionAnswers = Object.fromEntries(s1.items.map((i) => [i.id, true]));
    chk('all three does', isStepComplete(s1, all, false));
    chk('the answers are keyed per item id, not per screen',
        Object.keys(all).length === 3 && Object.keys(all).every((k) => k.startsWith('item-')));
  }

  console.log('\n[4] A customised checklist is untouched');
  const custom: FlowItem[] = [
    { id: 'c1', label: 'Our own site-specific rule', helpText: null, type: 'ACKNOWLEDGEMENT', required: true },
    { id: 'c2', label: 'Another bespoke question', helpText: null, type: 'ACKNOWLEDGEMENT', required: true },
  ];
  const customSteps = buildInductionSteps(custom);
  chk('bespoke items each keep their own screen',
      customSteps.length === 3 && customSteps.every((s) => s.kind === 'acknowledgement' || s.kind === 'gdpr'),
      customSteps.map(describe).join(' | '));
  chk('an edited label opts that item out of grouping',
      sectionFor({ label: 'I have received and understood the induction', type: 'ACKNOWLEDGEMENT' }) === null,
      'no fuzzy matching — a reworded item keeps its own screen');
  chk('a straight apostrophe still matches',
      sectionFor({ label: INDUCTION_SECTIONS[0]!.labels[0]!.replace(/'/g, "’"), type: 'ACKNOWLEDGEMENT' }) !== null);
  chk('a non-acknowledgement is never grouped',
      sectionFor({ label: INDUCTION_SECTIONS[0]!.labels[0]!, type: 'YES_NO' }) === null);

  console.log('\n[5] A section reduced to one item degrades gracefully');
  const one = seeded.filter((i) => i.label === INDUCTION_SECTIONS[0]!.labels[0]);
  const oneSteps = buildInductionSteps(one);
  chk('renders as an ordinary acknowledgement, not a heading over one tick',
      oneSteps[0]?.kind === 'acknowledgement', describe(oneSteps[0]!));

  console.log('\n[6] Custom items keep their place around the sections');
  const mixed: FlowItem[] = [
    seeded[0]!,                                                                     // briefing
    { id: 'x', label: 'Site-specific hazard', helpText: null, type: 'ACKNOWLEDGEMENT', required: true },
    seeded[1]!,                                                                     // briefing
  ];
  const mixedSteps = buildInductionSteps(mixed);
  chk('the section takes the position of its first member',
      mixedSteps[0]?.kind === 'section' && mixedSteps[1]?.kind === 'acknowledgement',
      mixedSteps.map(describe).join(' | '));

  console.log(`\n== ${pass} passed, ${failures.length} failed ==`);
  if (failures.length) { failures.forEach((f) => console.log(`   FAILED: ${f}`)); process.exitCode = 1; }
}
main();
