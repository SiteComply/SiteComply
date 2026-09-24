import {
  issueRevision,
  saveDraft,
  seedModuleCatalogue,
  setModuleActive,
  startDraft,
  updateModuleSettings,
} from '@/services/inductionModules/inductionModuleService';
import type { ModuleActor } from '@/services/inductionModules/moduleActor';

/**
 * THE ONE SET OF COMPANY-MODULE ACTIONS, shared by both front doors.
 *
 * Induction Videos and the Admin Centre administer the same modules. They differ
 * only in how the person signed in and therefore how their authority is
 * resolved; what the actions ARE, and every rule about them, is identical.
 *
 * So the dispatch lives here rather than in either route. Each route does exactly
 * two things: authenticate in its own realm, and build a `ModuleActor`. Neither
 * knows what "issue a revision" means.
 *
 * This is the difference between two front doors and two systems. The Admin
 * Centre → Settings → Company incident is the cautionary case: two surfaces wrote
 * one singleton row under different permissions, with no shared rule layer, and
 * neither screen showed what the other had done. Here there is one service, one
 * approval workflow, one audit trail, and one dispatcher — the realm is recorded
 * on the record, not branched on in the logic.
 */

export interface ActionOutcome {
  status: number;
  payload: Record<string, unknown>;
}

const refuse = (error: string): ActionOutcome => ({
  status: 400,
  payload: { ok: false, error },
});
const ok = (extra: Record<string, unknown> = {}): ActionOutcome => ({
  status: 200,
  payload: { ok: true, ...extra },
});

export async function handleModuleAction(
  actor: ModuleActor,
  body: Record<string, unknown>,
): Promise<ActionOutcome> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');

  switch (body.action) {
    case 'startDraft': {
      const r = await startDraft(actor, str('moduleId'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'saveDraft': {
      const r = await saveDraft(actor, str('revisionId'), {
        heading: str('heading'),
        narration: str('narration'),
      });
      return r.ok ? ok() : refuse(r.error);
    }
    case 'issue': {
      const r = await issueRevision(actor, str('revisionId'), str('issueNote'));
      return r.ok ? ok(r.value) : refuse(r.error);
    }
    case 'setActive': {
      const r = await setModuleActive(actor, str('moduleId'), body.active === true);
      return r.ok ? ok() : refuse(r.error);
    }
    case 'settings': {
      const num = (k: string) =>
        typeof body[k] === 'number' ? (body[k] as number) : undefined;
      const bool = (k: string) =>
        typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined;
      const r = await updateModuleSettings(actor, str('moduleId'), {
        mandatory: bool('mandatory'),
        defaultIncluded: bool('defaultIncluded'),
        order: num('order'),
      });
      return r.ok ? ok() : refuse(r.error);
    }
    case 'seed': {
      /*
       * Creating the starter set writes only DRAFTS, but it decides which topics
       * this company briefs on at all - organisational policy rather than a
       * convenience - so it takes the same authority as issuing.
       */
      if (!actor.canIssue) {
        return refuse('You do not have permission to create the starter modules.');
      }
      const result = await seedModuleCatalogue(actor);
      return ok(result as unknown as Record<string, unknown>);
    }
    default:
      return refuse('Unknown action.');
  }
}
