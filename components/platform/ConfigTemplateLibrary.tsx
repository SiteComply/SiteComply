'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ConfigTemplateSummary,
  MandatoryPolicyRow,
} from '@/services/siteServices/siteConfigTemplateService';
import { SITE_SERVICE_KIND_META } from '@/services/siteServices/siteServiceCatalog';

/**
 * SC-021 Phase 2 — the shared configuration template library, plus the
 * Director-only company requirements.
 *
 * The two live on one screen because they answer the same question from
 * opposite ends: a template says what a KIND of project uses, a company
 * requirement says what EVERY project must use regardless. Splitting them
 * across two pages would hide the interaction — that a requirement overrides
 * any template — at exactly the moment someone needs to understand it.
 */

const CATEGORY_LABEL: Record<string, string> = {
  PROJECT_TYPE: 'Project type',
  CLIENT: 'Client',
  INDUSTRY: 'Industry',
  OTHER: 'Other',
};

export function ConfigTemplateLibrary({
  templates,
  canManage,
  policy,
  canSetPolicy,
}: {
  templates: ConfigTemplateSummary[];
  canManage: boolean;
  policy: MandatoryPolicyRow[];
  canSetPolicy: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function setActive(id: string, active: boolean) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/platform/site-config-templates/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not update the template.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, name: string) {
    if (
      !window.confirm(
        `Delete “${name}”?\n\nSites already configured from it keep their settings — this only removes the template.`,
      )
    ) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/platform/site-config-templates/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not delete the template.');
        return;
      }
      setNotice(`Deleted “${name}”.`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function setMandatory(
    row: MandatoryPolicyRow,
    mandatory: boolean,
    why: string | null,
  ) {
    const key = `${row.kind}:${row.refId}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/platform/org-service-policy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: row.kind,
          refId: row.refId,
          mandatory,
          reason: why,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not update the requirement.');
        return;
      }
      // The real effect is stated, not implied: making something mandatory
      // turns it back on for sites that had switched it off.
      const n = data.sitesAffected as number;
      setNotice(
        mandatory
          ? n > 0
            ? `“${row.name}” is now required on every site — it has been turned back on for ${n} site${n === 1 ? '' : 's'} that had it off.`
            : `“${row.name}” is now required on every site.`
          : `“${row.name}” is no longer required. Sites can turn it off again.`,
      );
      setReasonFor(null);
      setReason('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

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
        <h2 className="text-base font-bold text-ink">
          Configuration templates
        </h2>
        <p className="mb-3 text-sm text-ink-muted">
          Reusable sets of permits and inspections for a project type, a client
          or an industry. Create one by configuring a site and choosing “Save
          this site as a template”.
        </p>

        {templates.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-subtle">
            No configuration templates yet. Configure a site’s permits and
            inspections, then save it as a template to reuse on similar
            projects.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {t.name}
                    <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
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
                    Turns off {t.disabledCount} of {t.itemCount}
                    {t.createdByName ? ` · created by ${t.createdByName}` : ''}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setActive(t.id, !t.active)}
                      disabled={busy === t.id}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                    >
                      {t.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(t.id, t.name)}
                      disabled={busy === t.id}
                      className="rounded-lg border border-danger-500/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canSetPolicy ? (
        <section>
          <h2 className="text-base font-bold text-ink">Company requirements</h2>
          <p className="mb-3 text-sm text-ink-muted">
            Services required on every site. A required service is switched on
            everywhere and cannot be turned off by a site or by a configuration
            template.
          </p>

          {(['PERMIT_TYPE', 'ACTIVITY_TYPE'] as const).map((kind) => (
            <div key={kind} className="mb-4">
              <h3 className="mb-1 text-sm font-semibold text-ink">
                {SITE_SERVICE_KIND_META[kind].title}
              </h3>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {policy
                  .filter((r) => r.kind === kind)
                  .map((r) => {
                    const key = `${r.kind}:${r.refId}`;
                    return (
                      <li key={key} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink">
                              {r.name}
                              {r.mandatory ? (
                                <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
                                  Required
                                </span>
                              ) : null}
                            </p>
                            {r.mandatory && r.reason ? (
                              <p className="mt-0.5 text-xs text-ink-muted">
                                {r.reason}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            disabled={busy === key}
                            onClick={() => {
                              if (r.mandatory) {
                                setMandatory(r, false, null);
                              } else {
                                setReasonFor(reasonFor === key ? null : key);
                                setReason('');
                              }
                            }}
                            className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                          >
                            {r.mandatory ? 'Remove requirement' : 'Require'}
                          </button>
                        </div>

                        {reasonFor === key ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                            <input
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Why is this required? e.g. Group H&S policy 4.2"
                              className="min-w-52 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink"
                            />
                            <button
                              type="button"
                              onClick={() => setMandatory(r, true, reason)}
                              disabled={busy === key}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                            >
                              Make required
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
