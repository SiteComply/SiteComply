'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PermissionTemplateSummary,
  CompanyDefaultRow,
} from '@/services/platformUsers/permissionTemplateService';
import {
  NARROWABLE_MODULES,
  MODULE_LABELS,
  MODULE_ACCESS_NOTE,
} from '@/services/platformUsers/contractorAccessConstants';
import { PERMISSION_VERBS } from '@/services/platformUsers/platformPermissions';

/**
 * SC-022 Phase 2 — permission templates and company defaults.
 *
 * Both live on one screen because they are the same decision at two scopes: a
 * template says what a KIND of contractor sees, a company default says what a
 * PARTICULAR firm sees everywhere. Separating them would hide the interaction —
 * that a company default cannot be loosened by a site — at the moment someone
 * needs to understand it.
 */

const VERB_LABEL: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  export: 'Export',
};

export function PermissionTemplateLibrary({
  templates,
  companies,
  companyDefaults,
  canManageTemplates,
  canSetCompanyDefaults,
  itemsByTemplate = {},
}: {
  templates: PermissionTemplateSummary[];
  companies: { company: string; users: number }[];
  companyDefaults: Record<string, CompanyDefaultRow[]>;
  canManageTemplates: boolean;
  canSetCompanyDefaults: boolean;
  /** Existing item sets, so a template can be edited rather than only replaced. */
  itemsByTemplate?: Record<string, { module: string; verbs: string[] }[]>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // null = closed, '' = creating, id = editing. One form for both, so the two
  // cannot drift apart.
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [company, setCompany] = useState(companies[0]?.company ?? '');

  async function call(
    url: string,
    method: string,
    body: unknown,
    key: string,
    onOk: (data: Record<string, unknown>) => string,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not save that change.');
        return;
      }
      setNotice(onOk(data));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setEditing('');
    setError(null);
    setNotice(null);
    setName('');
    setDescription('');
    setDraft({});
  }

  function openEdit(t: PermissionTemplateSummary) {
    setEditing(t.id);
    setError(null);
    setNotice(null);
    setName(t.name);
    setDescription(t.description ?? '');
    const d: Record<string, string[]> = {};
    for (const i of itemsByTemplate[t.id] ?? []) d[i.module] = i.verbs;
    setDraft(d);
  }

  async function saveTemplate() {
    if (!name.trim()) return;
    const isNew = editing === '';
    await call(
      isNew
        ? '/api/platform/permission-templates'
        : `/api/platform/permission-templates/${editing}`,
      isNew ? 'POST' : 'PATCH',
      {
        name,
        description,
        items: NARROWABLE_MODULES.map((m) => ({
          module: m,
          verbs: draft[m] ?? [],
        })),
      },
      'save',
      () => {
        setEditing(null);
        const saved = name.trim();
        setName('');
        setDescription('');
        setDraft({});
        return isNew ? `Created “${saved}”.` : `Saved changes to “${saved}”.`;
      },
    );
  }

  const currentDefaults = companyDefaults[company] ?? [];
  const defaultFor = (module: string) =>
    currentDefaults.find((d) => d.module === module);
  const matchedUsers = companies.find((c) => c.company === company)?.users ?? 0;

  return (
    <div className="space-y-8">
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

      <section>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">
              Permission templates
            </h2>
            <p className="text-sm text-ink-muted">
              Reusable restrictions for a type of contractor, applied to someone
              on a project from that site’s Access tab.
            </p>
          </div>
          {canManageTemplates ? (
            <button
              type="button"
              onClick={() =>
                editing === null ? openCreate() : setEditing(null)
              }
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              {editing === null ? 'New template' : 'Cancel'}
            </button>
          ) : null}
        </div>

        {editing !== null ? (
          <div className="mb-3 rounded-xl border border-line bg-surface-sunken p-4">
            <h3 className="mb-2 text-sm font-bold text-ink">
              {editing === '' ? 'New template' : 'Edit template'}
            </h3>
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name, e.g. Groundworks subcontractor"
                className="min-w-52 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What it is for (optional)"
                className="min-w-52 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Tick what this type of contractor KEEPS. A section left untouched
              stays at whatever their role already allows.
            </p>
            <ul className="mt-2 space-y-1.5">
              {NARROWABLE_MODULES.map((m) => (
                <li key={m} className="flex flex-wrap items-center gap-3">
                  <span className="w-28 text-sm font-medium text-ink">
                    {MODULE_LABELS[m] ?? m}
                  </span>
                  {PERMISSION_VERBS.map((verb) => (
                    <label key={verb} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-line text-brand-600"
                        checked={(draft[m] ?? []).includes(verb)}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [m]: e.target.checked
                              ? [...(d[m] ?? []), verb]
                              : (d[m] ?? []).filter((v) => v !== verb),
                          }))
                        }
                      />
                      <span className="text-xs text-ink-muted">
                        {VERB_LABEL[verb] ?? verb}
                      </span>
                    </label>
                  ))}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={!name.trim() || busy === 'save'}
                onClick={saveTemplate}
                className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {editing === '' ? 'Create template' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {t.name}
                  {t.isSystem ? (
                    <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
                      Built-in
                    </span>
                  ) : null}
                  {!t.active ? (
                    <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      Inactive
                    </span>
                  ) : null}
                </p>
                {t.description ? (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t.description}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-ink-subtle">
                  Restricts {t.restrictedCount} section
                  {t.restrictedCount === 1 ? '' : 's'}
                  {t.createdByName ? ` · created by ${t.createdByName}` : ''}
                </p>
              </div>
              {canManageTemplates ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() => openEdit(t)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() =>
                      call(
                        `/api/platform/permission-templates/${t.id}`,
                        'PATCH',
                        { active: !t.active },
                        t.id,
                        () =>
                          `${t.active ? 'Deactivated' : 'Reactivated'} “${t.name}”.`,
                      )
                    }
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                  >
                    {t.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  {!t.isSystem ? (
                    <button
                      type="button"
                      disabled={busy === t.id}
                      onClick={() => {
                        if (!window.confirm(`Delete “${t.name}”?`)) return;
                        call(
                          `/api/platform/permission-templates/${t.id}`,
                          'DELETE',
                          undefined,
                          t.id,
                          () => `Deleted “${t.name}”.`,
                        );
                      }}
                      className="rounded-lg border border-danger-500/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canSetCompanyDefaults ? (
        <section>
          <h2 className="text-base font-bold text-ink">
            Company default access
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            A floor applying to everyone from a company, on every site — now and
            in future. A site cannot give back what is removed here.
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-ink" htmlFor="company">
              Company
            </label>
            <select
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              {companies.map((c) => (
                <option key={c.company} value={c.company}>
                  {c.company} ({c.users} user{c.users === 1 ? '' : 's'})
                </option>
              ))}
            </select>
            {/* Chosen from companies already in use rather than typed, because
                the match is on a free-text string — a typo would otherwise
                create a rule that silently applies to nobody. */}
            <span className="text-xs text-ink-subtle">
              Applies to {matchedUsers} user{matchedUsers === 1 ? '' : 's'}
              {matchedUsers === 0 ? ' — nothing would change' : ''} (Directors
              are never restricted)
            </span>
          </div>

          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {NARROWABLE_MODULES.map((m) => {
              const d = defaultFor(m);
              const key = `${company}:${m}`;
              return (
                <li key={m} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {MODULE_LABELS[m] ?? m}
                        {d ? (
                          <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                            {d.verbs.length === 0
                              ? 'Removed company-wide'
                              : `Limited to ${d.verbs.join(', ')}`}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {MODULE_ACCESS_NOTE[m]}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy === key || (d && d.verbs.length === 0)}
                        onClick={() =>
                          call(
                            '/api/platform/company-permission-defaults',
                            'PATCH',
                            { company, module: m, verbs: [] },
                            key,
                            (data) =>
                              `${MODULE_LABELS[m] ?? m} removed for ${company} — affects ${data.usersAffected} user(s).`,
                          )
                        }
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                      >
                        Remove company-wide
                      </button>
                      <button
                        type="button"
                        disabled={busy === key || !d}
                        onClick={() =>
                          call(
                            '/api/platform/company-permission-defaults',
                            'PATCH',
                            { company, module: m, verbs: null },
                            key,
                            () =>
                              `${MODULE_LABELS[m] ?? m} default cleared for ${company}.`,
                          )
                        }
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
