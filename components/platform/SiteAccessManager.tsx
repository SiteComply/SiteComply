'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import type { SiteUserAccess } from '@/services/platformUsers/contractorAccessService';
import {
  CONTRACTOR_STANDARD_LABEL,
  CONTRACTOR_STANDARD_DESCRIPTION,
  MODULE_LABELS,
  MODULE_ACCESS_NOTE,
} from '@/services/platformUsers/contractorAccessConstants';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import type { PlatformRole } from '@prisma/client';

/**
 * SC-022 Phase 1 — configure what each person assigned to this site can see.
 *
 * Shows the ROLE BASELINE alongside the effective permission, so it is always
 * visible that this screen can only take access away. A verb the role never had
 * is shown as unavailable rather than as an unticked box, because an empty
 * checkbox implies it could be granted here — and it cannot.
 *
 * TICKING A BOX IS AN EDIT, NOT A COMMIT.
 *
 * Every checkbox used to PATCH the moment it changed. Someone adjusting four
 * verbs across two sections made four separate permanent changes to a person's
 * access without ever choosing to save, and a mis-click was already live —
 * recoverable only by knowing what the value had been. Nothing on screen
 * distinguished "I am deciding" from "I have decided".
 *
 * Edits are now held as a draft and committed by SAVE ACCESS in the workspace
 * action bar, which appears only when something is pending and says how much.
 * The RULES ARE UNCHANGED: the same PATCH, the same per-module payload, the
 * same server-side narrowing. What changed is when it is sent.
 *
 * The row buttons (preset, template, reset, remove) stay immediate. They are
 * ACTIONS, not edits — each already reads as a decision, and Remove has its own
 * confirmation. They are disabled while that person has unsaved edits, because
 * applying a preset over a pending draft would silently discard it.
 */

const VERB_LABEL: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  export: 'Export',
};

export function SiteAccessManager({
  siteId,
  users,
  canManage,
  templates = [],
}: {
  siteId: string;
  users: SiteUserAccess[];
  canManage: boolean;
  /** SC-022 Phase 2 — saved permission templates available to apply. */
  templates?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [templateFor, setTemplateFor] = useState<Record<string, string>>({});

  /**
   * Pending edits: userId → module → the verbs that module would end up with.
   *
   * Only CHANGED modules are held. An entry that matches what the server
   * already has is dropped, so ticking a box and unticking it leaves nothing
   * pending — the bar must not offer to save a change that is not one.
   */
  const [draft, setDraft] = useState<
    Record<string, Record<string, string[]>>
  >({});

  const dirtyUsers = useMemo(
    () => Object.keys(draft).filter((id) => Object.keys(draft[id]!).length > 0),
    [draft],
  );
  const pendingCount = useMemo(
    () => dirtyUsers.reduce((n, id) => n + Object.keys(draft[id]!).length, 0),
    [draft, dirtyUsers],
  );

  /** The verbs a module would have if saved now: the draft, else the server. */
  function verbsFor(user: SiteUserAccess, module: string): string[] {
    const staged = draft[user.userId]?.[module];
    if (staged) return staged;
    return user.modules.find((m) => m.module === module)?.effective ?? [];
  }

  const same = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();

  /** Drop a user's draft — after their access is replaced by a row action. */
  function clearDraftFor(userId: string) {
    setDraft((d) => {
      if (!d[userId]) return d;
      const next = { ...d };
      delete next[userId];
      return next;
    });
  }

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(String(body.userId));
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not update access.');
        return;
      }
      // The row actions replace this person's access wholesale, so anything
      // staged for them describes a state that no longer exists.
      clearDraftFor(String(body.userId));
      setNotice(ok);
      toast.success(ok);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /** Stage a verb change. Nothing is sent until Save Access. */
  function toggleVerb(
    user: SiteUserAccess,
    module: string,
    verb: string,
    next: boolean,
  ) {
    const current = verbsFor(user, module);
    const verbs = next
      ? [...current, verb]
      : current.filter((v) => v !== verb);
    const server =
      user.modules.find((m) => m.module === module)?.effective ?? [];

    setError(null);
    setNotice(null);
    setDraft((d) => {
      const forUser = { ...(d[user.userId] ?? {}) };
      if (same(verbs, server)) delete forUser[module];
      else forUser[module] = verbs;
      const out = { ...d };
      if (Object.keys(forUser).length === 0) delete out[user.userId];
      else out[user.userId] = forUser;
      return out;
    });
  }

  /**
   * Commit every pending change.
   *
   * One request per changed module, because that is the shape the API already
   * takes — this release does not invent a batch endpoint. They run in
   * SEQUENCE so a partial failure is unambiguous: everything before it landed,
   * everything after was not attempted, and the ones that did not land stay in
   * the draft so the screen still shows what the user asked for.
   */
  async function saveAccess() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    const landed: Record<string, Record<string, string[]>> = {};
    try {
      for (const userId of dirtyUsers) {
        const user = users.find((u) => u.userId === userId);
        if (!user) continue;
        for (const [module, verbs] of Object.entries(draft[userId] ?? {})) {
          const res = await fetch(`/api/platform/sites/${siteId}/access`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'setModule',
              userId,
              module,
              verbs,
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) {
            failures.push(
              `${MODULE_LABELS[module] ?? module} for ${user.name}${
                data?.error ? ` — ${data.error}` : ''
              }`,
            );
            landed[userId] = { ...(landed[userId] ?? {}) };
            landed[userId]![module] = verbs;
          }
        }
      }

      // Keep only what failed, so a retry sends exactly the outstanding work.
      setDraft(landed);

      if (failures.length > 0) {
        setError(
          `Some access changes were not saved: ${failures.join('; ')}.`,
        );
        toast.error('Some access changes could not be saved.');
      } else {
        const msg =
          pendingCount === 1
            ? 'Access saved. 1 section updated.'
            : `Access saved. ${pendingCount} sections updated.`;
        setNotice(msg);
        toast.success(msg);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (users.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-subtle">
        No platform users are assigned to this site yet. Assigned users appear
        here so their access can be limited to what their work requires.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* THE WORKSPACE ACTION BAR — same construction as Settings →
          Authentication & access: sticky, leading the workspace, stating what
          is outstanding beside the control that resolves it. Sticky rather
          than a header action because the list of people is long, and a Save
          that has scrolled out of sight is the problem it exists to solve.

          It appears ONLY when something is pending. A permanently visible Save
          on a screen that is usually already saved teaches people to ignore
          it, and then it is not feedback. */}
      {canManage && pendingCount > 0 ? (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-sunken px-1 py-3">
          {/* COUNTED IN SECTIONS, AND SAYS SO. The unit here is the section,
              because that is what one request commits — two verbs changed in
              Permits is one change to Permits. Calling it "1 unsaved change"
              read as one tick, which understates it. The table column is
              already headed Section, so the word is the one on screen. */}
          <p className="text-sm font-medium text-ink">
            {pendingCount === 1
              ? '1 section changed'
              : `${pendingCount} sections changed`}
            {dirtyUsers.length === 1 ? ' for 1 person' : ` for ${dirtyUsers.length} people`}
            <span className="ml-1 font-normal text-ink-muted">
              — nothing is applied until you save.
            </span>
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft({});
                setError(null);
                setNotice(null);
              }}
              disabled={saving}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={saveAccess}
              disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save access'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}

      <ul className="space-y-3">
        {users.map((u) => {
          const open = openUser === u.userId;
          const restricted = u.modules.filter(
            (m) => m.effective.length < m.baseline.length,
          );
          const changed = Object.keys(draft[u.userId] ?? {}).length;
          // A row action replaces this person's access outright, so offering
          // one while edits are staged would throw them away without saying so.
          const blockedByDraft = changed > 0;
          return (
            <li
              key={u.userId}
              className="overflow-hidden rounded-xl border border-line bg-surface"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {u.name}
                    <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      {ROLE_LABELS[u.role as PlatformRole] ?? u.role}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">{u.company}</p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {restricted.length === 0
                      ? 'Full access for their role on this site.'
                      : `Restricted: ${restricted
                          .map((m) => MODULE_LABELS[m.module] ?? m.module)
                          .join(', ')}`}
                  </p>
                  {/* Named at the person, not just counted in the bar: with the
                      list collapsed, the bar says how much is pending but not
                      whose. */}
                  {changed > 0 ? (
                    <p className="mt-1 inline-flex items-center whitespace-nowrap rounded-full bg-hivis-400/25 px-2 py-0.5 text-xs font-semibold text-ink ring-1 ring-inset ring-hivis-500">
                      {changed === 1
                        ? '1 section changed, not saved'
                        : `${changed} sections changed, not saved`}
                    </p>
                  ) : null}
                  {u.lockedReason ? (
                    <p className="mt-1 text-xs font-medium text-ink-muted">
                      {u.lockedReason}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenUser(open ? null : u.userId)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    {open ? 'Hide access' : 'Manage access'}
                  </button>
                  {canManage && !u.lockedReason ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === u.userId || saving || blockedByDraft || u.matchesPreset}
                        title={
                          blockedByDraft
                            ? 'Save or discard the unsaved changes for this person first.'
                            : u.matchesPreset
                              ? 'Already at or below this preset.'
                              : CONTRACTOR_STANDARD_DESCRIPTION
                        }
                        onClick={() =>
                          send(
                            { action: 'applyPreset', userId: u.userId },
                            `Applied ${CONTRACTOR_STANDARD_LABEL} to ${u.name}.`,
                          )
                        }
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                      >
                        Apply {CONTRACTOR_STANDARD_LABEL}
                      </button>
                      {/* SC-022 Phase 2 — apply a saved template. Uses the same
                          narrowing as every other change here, so it can only
                          remove access. */}
                      {templates.length > 0 ? (
                        <span className="flex items-center gap-1">
                          <select
                            aria-label={`Permission template for ${u.name}`}
                            value={templateFor[u.userId] ?? ''}
                            onChange={(e) =>
                              setTemplateFor((t) => ({
                                ...t,
                                [u.userId]: e.target.value,
                              }))
                            }
                            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink"
                          >
                            <option value="">Template…</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={
                              busy === u.userId ||
                              saving ||
                              blockedByDraft ||
                              !templateFor[u.userId]
                            }
                            title={
                              blockedByDraft
                                ? 'Save or discard the unsaved changes for this person first.'
                                : undefined
                            }
                            onClick={() =>
                              send(
                                {
                                  action: 'applyTemplate',
                                  userId: u.userId,
                                  templateId: templateFor[u.userId],
                                },
                                `Applied the template to ${u.name}.`,
                              )
                            }
                            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                          >
                            Apply
                          </button>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        disabled={
                          busy === u.userId ||
                          saving ||
                          blockedByDraft ||
                          restricted.length === 0
                        }
                        title={
                          blockedByDraft
                            ? 'Save or discard the unsaved changes for this person first.'
                            : undefined
                        }
                        onClick={() =>
                          send(
                            { action: 'reset', userId: u.userId },
                            `Restored full role access for ${u.name}.`,
                          )
                        }
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        disabled={busy === u.userId || saving || blockedByDraft}
                        title={
                          blockedByDraft
                            ? 'Save or discard the unsaved changes for this person first.'
                            : undefined
                        }
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Remove ${u.name} from this site?\n\nThey lose access immediately. Their check-ins, permits and actions on this site are kept.`,
                            )
                          ) {
                            return;
                          }
                          send(
                            { action: 'revoke', userId: u.userId },
                            `${u.name} no longer has access to this site.`,
                          );
                        }}
                        className="rounded-lg border border-danger-500/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-40"
                      >
                        Remove from site
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {open ? (
                <div className="border-t border-line bg-surface-sunken px-4 py-3">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink-subtle">
                        <th className="pb-2 font-medium">Section</th>
                        <th className="pb-2 font-medium">Access</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {u.modules.map((m) => (
                        <tr key={m.module} className="align-top">
                          <td className="py-2 pr-4">
                            <p className="font-semibold text-ink">
                              {MODULE_LABELS[m.module] ?? m.module}
                            </p>
                            <p className="text-ink-muted">
                              {MODULE_ACCESS_NOTE[m.module]}
                            </p>
                          </td>
                          <td className="py-2">
                            {m.baseline.length === 0 ? (
                              <span className="text-ink-subtle">
                                Not available to this role
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-3">
                                {m.baseline.map((verb) => (
                                  <label
                                    key={verb}
                                    className="flex items-center gap-1.5"
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-line text-brand-600 disabled:opacity-40"
                                      checked={verbsFor(u, m.module).includes(
                                        verb,
                                      )}
                                      disabled={
                                        !canManage ||
                                        !!u.lockedReason ||
                                        busy === u.userId ||
                                        saving
                                      }
                                      onChange={(e) =>
                                        toggleVerb(
                                          u,
                                          m.module,
                                          verb,
                                          e.target.checked,
                                        )
                                      }
                                    />
                                    <span className="text-ink">
                                      {VERB_LABEL[verb] ?? verb}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-ink-subtle">
                    Only what the role already grants can be shown here — this
                    screen removes access, it never adds it. Changes here are
                    not applied until you choose Save access.
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
