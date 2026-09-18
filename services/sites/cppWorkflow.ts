/**
 * CPP workflow guidance — where the plan is, and what to do next.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The revision controls worked but only ever REPORTED: "Revision 2 is the
 * version in force", "3 sections differ", a row of equally-weighted buttons. A
 * user had to infer the implication and pick. Worse, the page carried two
 * headers that could contradict each other, and the primary action read
 * "Create a revision from the current plan" — a mechanism, with no statement of
 * purpose or destination.
 *
 * This computes ONE recommended next action from the real state, so the screen
 * answers "what should I do now?" instead of listing what is possible.
 *
 * ── WARN, NEVER BLOCK ────────────────────────────────────────────────────
 *
 * An incomplete plan can still be prepared and issued. CDM 2015 expects a
 * construction phase plan to exist before work starts and to be developed as the
 * project proceeds, so refusing to issue one with gaps would be wrong. But
 * issuing captures a signature against a declaration reading "in my judgement it
 * is suitable and sufficient", and letting somebody sign that over visible holes
 * without showing them is not a workflow. So the gaps travel with the decision.
 *
 * Pure and client-safe: the bar renders it, the page derives its heading from
 * it, and the suite proves every branch without a database.
 */

/** Where the plan sits in its lifecycle. Drives the stage indicator. */
export type CppStage = 'DRAFT' | 'PREPARED' | 'ISSUED';

export const CPP_STAGES: { key: CppStage; label: string; hint: string }[] = [
  { key: 'DRAFT', label: 'Draft', hint: 'Assembled from current site information' },
  { key: 'PREPARED', label: 'Revision prepared', hint: 'Snapshotted and awaiting approval' },
  { key: 'ISSUED', label: 'Issued', hint: 'Approved and in force' },
];

export interface CppReadiness {
  outstandingSections: number;
  riskTopicsUnconsidered: number;
  arrangementsNotRecorded: number;
}

export interface CppWorkflowInput {
  issued: { version: number } | null;
  draft: { version: number } | null;
  /** Null when nothing is issued — nothing to drift from. */
  drift: { changed: boolean; changedSections: string[] } | null;
  readiness: CppReadiness;
  canCreate: boolean;
  canIssue: boolean;
}

export type CppActionKind =
  | 'COMPLETE_CONTENT'
  | 'PREPARE_REVISION'
  | 'APPROVE_AND_ISSUE'
  | 'AWAIT_APPROVER'
  | 'UPDATE_PLAN'
  | 'NONE';

export interface CppWorkflow {
  stage: CppStage;
  /** Where the plan is, in one line. */
  headline: string;
  /** What is outstanding or what changed. Null when there is nothing to add. */
  detail: string | null;
  primary: { kind: CppActionKind; label: string } | null;
  /** Always offered, so the screen never ends with nothing to do. */
  secondary: { kind: CppActionKind; label: string } | null;
  tone: 'INFO' | 'ATTENTION' | 'GOOD';
  /** The gaps, phrased for a warning. Empty when the plan has none. */
  gaps: string[];
}

/** The outstanding content, as phrases. Shared by the banner and the warnings. */
export function readinessGaps(r: CppReadiness): string[] {
  const out: string[] = [];
  if (r.outstandingSections > 0) {
    out.push(
      `${r.outstandingSections} section${r.outstandingSections === 1 ? '' : 's'} with information still needed`,
    );
  }
  if (r.riskTopicsUnconsidered > 0) {
    out.push(
      `${r.riskTopicsUnconsidered} risk topic${r.riskTopicsUnconsidered === 1 ? '' : 's'} not yet considered`,
    );
  }
  if (r.arrangementsNotRecorded > 0) {
    out.push(
      `${r.arrangementsNotRecorded} management arrangement${r.arrangementsNotRecorded === 1 ? '' : 's'} not recorded`,
    );
  }
  return out;
}

/**
 * ONE recommended action, chosen in lifecycle order.
 *
 * The order is the point: finish the content, snapshot it, approve it, keep it
 * current. Earlier branches win, so a user is never asked to approve a plan
 * while the thing they most need to do is fill it in.
 */
export function recommendNextAction(input: CppWorkflowInput): CppWorkflow {
  const gaps = readinessGaps(input.readiness);
  const gapText = gaps.length > 0 ? `${gaps.join(', ')}.` : null;

  // A revision is open and waiting. This outranks content gaps: the snapshot is
  // already taken, so the live content no longer changes what is being approved.
  if (input.draft) {
    if (input.canIssue) {
      return {
        stage: 'PREPARED',
        headline: `Revision ${input.draft.version} is prepared and ready for approval`,
        detail:
          'Approving issues it as the version in force. It cannot be edited afterwards.',
        primary: {
          kind: 'APPROVE_AND_ISSUE',
          label: `Approve and issue Revision ${input.draft.version}`,
        },
        secondary: { kind: 'NONE', label: 'Discard this revision' },
        tone: 'ATTENTION',
        gaps,
      };
    }
    return {
      stage: 'PREPARED',
      headline: `Revision ${input.draft.version} is prepared and awaiting approval`,
      detail:
        'A Director or Principal Contractor approves and issues the plan.',
      primary: null,
      secondary: null,
      tone: 'INFO',
      gaps,
    };
  }

  // Issued and the site has moved on. The plan in force is out of date, which is
  // the thing CDM asks a Principal Contractor to notice.
  if (input.issued && input.drift?.changed) {
    const n = input.drift.changedSections.length;
    return {
      stage: 'ISSUED',
      headline: `Revision ${input.issued.version} is in force, but the site has changed since it was issued`,
      detail:
        n > 0
          ? `${n} section${n === 1 ? '' : 's'} now differ from the issued plan.`
          : 'The plan no longer matches the current site information.',
      primary: input.canCreate
        ? { kind: 'UPDATE_PLAN', label: `Prepare Revision ${input.issued.version + 1} for approval` }
        : null,
      secondary: null,
      tone: 'ATTENTION',
      gaps,
    };
  }

  // Issued and current. There IS still something to do — a plan can be revised
  // at any time — so the screen offers it quietly rather than ending in a dead
  // stop that reads as broken.
  if (input.issued) {
    return {
      stage: 'ISSUED',
      headline: `Revision ${input.issued.version} is in force and matches the current site information`,
      detail: gapText
        ? `The plan is current, but ${gaps.join(', ')} remain.`
        : 'Nothing needs doing. Revise the plan when the project changes.',
      primary: null,
      secondary: input.canCreate
        ? { kind: 'PREPARE_REVISION', label: `Prepare Revision ${input.issued.version + 1}` }
        : null,
      tone: 'GOOD',
      gaps,
    };
  }

  // Nothing issued yet. Content first — a plan with holes is not ready to be
  // signed for, even though it CAN be.
  if (gaps.length > 0) {
    return {
      stage: 'DRAFT',
      headline: 'No plan has been issued for this project yet',
      detail: gapText,
      primary: { kind: 'COMPLETE_CONTENT', label: 'Complete the outstanding sections' },
      secondary: input.canCreate
        ? { kind: 'PREPARE_REVISION', label: 'Prepare Revision 1 anyway' }
        : null,
      tone: 'ATTENTION',
      gaps,
    };
  }

  return {
    stage: 'DRAFT',
    headline: 'The plan is complete and has not yet been issued',
    detail:
      'Preparing a revision takes a dated snapshot that can be approved and issued.',
    primary: input.canCreate
      ? { kind: 'PREPARE_REVISION', label: 'Prepare Revision 1 for approval' }
      : null,
    secondary: null,
    tone: 'INFO',
    gaps,
  };
}

/** The page heading's status chip. The document's own banner is separate. */
export function stageLabel(stage: CppStage): string {
  return CPP_STAGES.find((s) => s.key === stage)?.label ?? 'Draft';
}
