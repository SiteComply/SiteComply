'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApplyPreview } from '@/services/siteServices/siteConfigTemplateService';
import {
  SITE_SERVICE_KIND_META,
  disableBlockedReason,
  mandatoryLockReason,
  inFlightNotice,
  type SiteServiceGroup,
  type SiteServiceItem,
  type SiteServiceKind,
} from '@/services/siteServices/siteServiceCatalog';

/**
 * SC-021 Phase 1 — configure which permits and inspections apply to a site.
 *
 * Used in BOTH the SC-019 setup wizard step and the Site Details → Compliance
 * tab, from one component, so the two can never drift apart.
 *
 * Two deliberate UX choices:
 *
 * 1. A blocked toggle is DISABLED and says why BEFORE it is clicked, rather
 *    than accepting the click and rejecting it afterwards. This is SC-014's
 *    lesson applied — a rule enforced only on the server means the client
 *    happily submits what the API will refuse.
 * 2. Everything is ON by default and the list shows what a site HAS, not what
 *    it lacks. The objective is removing irrelevant functionality, so the
 *    default state must be the safe one: nothing disappears until someone
 *    deliberately turns it off.
 */

const CATEGORY_LABEL: Record<string, string> = {
  PROJECT_TYPE: 'Project type',
  CLIENT: 'Client',
  INDUSTRY: 'Industry',
  OTHER: 'Other',
};

export function SiteServicesConfig({
  siteId,
  groups: initialGroups,
  canEdit,
  templates = [],
  provenance = null,
}: {
  siteId: string;
  groups: SiteServiceGroup[];
  canEdit: boolean;
  /** SC-021 Phase 2 — configuration templates available to apply. */
  templates?: { id: string; name: string; category: string }[];
  provenance?: { name: string; at: string; by: string | null } | null;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState('PROJECT_TYPE');
  const [showSave, setShowSave] = useState(false);

  async function loadPreview() {
    if (!templateId) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/platform/sites/${siteId}/apply-config-template`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId, confirm: false }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not preview that template.');
        return;
      }
      setPreview(data.preview as ApplyPreview);
    } finally {
      setApplying(false);
    }
  }

  async function confirmApply() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/sites/${siteId}/apply-config-template`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId, confirm: true }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not apply that template.');
        return;
      }
      const a = data.applied as ApplyPreview;
      setNotice(
        `Applied “${a.templateName}” — ${a.turningOff.length} turned off, ${a.turningOn.length} turned on` +
          (a.blocked.length
            ? `, ${a.blocked.length} could not be changed`
            : '') +
          '.',
      );
      setPreview(null);
      setTemplateId('');
      router.refresh();
    } finally {
      setApplying(false);
    }
  }

  async function saveAsTemplate() {
    if (!saveName.trim()) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/site-config-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: saveName,
          category: saveCategory,
          fromSiteId: siteId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not save the template.');
        return;
      }
      setNotice(`Saved “${saveName.trim()}” as a configuration template.`);
      setSaveName('');
      setShowSave(false);
      router.refresh();
    } finally {
      setApplying(false);
    }
  }

  async function toggle(
    kind: SiteServiceKind,
    item: SiteServiceItem,
    next: boolean,
  ) {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/services`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, refId: item.id, enabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(
          data?.error ?? 'Could not save that change. Please try again.',
        );
        return;
      }
      setGroups(data.groups as SiteServiceGroup[]);
      if (!next && item.inFlightCount > 0) {
        setNotice(inFlightNotice(kind, item.inFlightCount));
      }
      // Refresh the server-rendered surroundings (wizard progress, counts).
      router.refresh();
    } catch {
      setError('Could not save that change. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
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

      {canEdit && templates.length > 0 ? (
        <div className="rounded-xl border border-line bg-surface-sunken p-4">
          <h3 className="text-sm font-bold text-ink">
            Apply a configuration template
          </h3>
          <p className="mb-3 text-xs text-ink-muted">
            Sets this site to match the template. You will see exactly what
            changes before anything is saved.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setPreview(null);
              }}
              className="min-w-52 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {CATEGORY_LABEL[t.category] ?? t.category}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadPreview}
              disabled={!templateId || applying}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              Preview changes
            </button>
            <button
              type="button"
              onClick={() => setShowSave((v) => !v)}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              Save this site as a template
            </button>
          </div>

          {showSave ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Template name, e.g. Refurbishment"
                className="min-w-52 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <select
                value={saveCategory}
                onChange={(e) => setSaveCategory(e.target.value)}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveAsTemplate}
                disabled={!saveName.trim() || applying}
                className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Save template
              </button>
            </div>
          ) : null}

          {preview ? (
            <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-xs">
              <p className="mb-2 font-semibold text-ink">
                Applying “{preview.templateName}” would:
              </p>
              <ul className="space-y-1 text-ink-muted">
                <li>
                  <b className="text-ink">
                    Turn off {preview.turningOff.length}
                  </b>
                  {preview.turningOff.length
                    ? ` — ${preview.turningOff.map((c) => c.name).join(', ')}`
                    : ''}
                </li>
                <li>
                  <b className="text-ink">Turn on {preview.turningOn.length}</b>
                  {preview.turningOn.length
                    ? ` — ${preview.turningOn.map((c) => c.name).join(', ')}`
                    : ''}
                </li>
                <li>Leave {preview.unchangedCount} unchanged</li>
              </ul>

              {/* Refusals are listed INDIVIDUALLY with their own reason. A
                  count alone would leave the manager unable to act on them. */}
              {preview.blocked.length ? (
                <div className="mt-2 rounded border border-hivis-500/40 bg-hivis-500/10 p-2">
                  <p className="font-semibold text-ink">
                    {preview.blocked.length} cannot be turned off:
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-ink-muted">
                    {preview.blocked.map((b) => (
                      <li key={b.name}>{b.reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.forcedOn.length ? (
                <div className="mt-2 rounded border border-brand-200 bg-brand-50 p-2">
                  <p className="font-semibold text-brand-700">
                    {preview.forcedOn.length} stay on — company policy:
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-brand-700">
                    {preview.forcedOn.map((b) => (
                      <li key={b.name}>
                        {b.name} — {b.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={confirmApply}
                  disabled={applying}
                  className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Apply template
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {provenance ? (
            <p className="mt-3 border-t border-line pt-2 text-xs text-ink-subtle">
              Configured from “{provenance.name}” on {provenance.at}
              {provenance.by ? ` by ${provenance.by}` : ''}. Changes made since
              are not shown here.
            </p>
          ) : null}
        </div>
      ) : null}

      {groups.map((group) => {
        const meta = SITE_SERVICE_KIND_META[group.kind];
        const offCount = group.items.filter((i) => !i.enabled).length;
        return (
          <section key={group.kind}>
            <div className="mb-3">
              <h3 className="text-base font-bold text-ink">{meta.title}</h3>
              <p className="text-sm text-ink-muted">{meta.description}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {offCount === 0
                  ? `All ${group.items.length} available on this site.`
                  : `${group.items.length - offCount} of ${group.items.length} available · ${offCount} turned off.`}
              </p>
            </div>

            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {group.items.map((item) => {
                const blocked =
                  item.enabled && item.blockingSchedules.length > 0;
                const locked = item.mandatory;
                const busy = busyId === item.id;
                return (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {item.name}
                          {locked ? (
                            <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
                              Required
                            </span>
                          ) : !item.enabled ? (
                            <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                              Not used on this site
                            </span>
                          ) : null}
                        </p>
                        {item.description ? (
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {item.description}
                          </p>
                        ) : null}

                        {locked ? (
                          <p className="mt-1.5 text-xs font-medium text-brand-700">
                            {mandatoryLockReason(item.mandatoryReason)}
                          </p>
                        ) : null}

                        {!locked && blocked ? (
                          <p className="mt-1.5 text-xs font-medium text-ink-muted">
                            {disableBlockedReason(
                              item.name,
                              item.blockingSchedules,
                            )}
                          </p>
                        ) : null}

                        {!blocked && item.enabled && item.inFlightCount > 0 ? (
                          <p className="mt-1.5 text-xs text-ink-subtle">
                            {inFlightNotice(group.kind, item.inFlightCount)}
                          </p>
                        ) : null}
                      </div>

                      <label className="flex shrink-0 items-center gap-2">
                        <span className="sr-only">
                          {item.enabled ? 'Turn off' : 'Turn on'} {item.name}
                        </span>
                        <input
                          type="checkbox"
                          className="h-5 w-5 rounded border-line text-brand-600 disabled:opacity-40"
                          checked={item.enabled}
                          disabled={!canEdit || busy || blocked || locked}
                          onChange={(e) =>
                            toggle(group.kind, item, e.target.checked)
                          }
                          aria-describedby={
                            blocked ? `blocked-${item.id}` : undefined
                          }
                        />
                      </label>
                    </div>
                    {blocked ? (
                      <span id={`blocked-${item.id}`} className="sr-only">
                        {disableBlockedReason(
                          item.name,
                          item.blockingSchedules,
                        )}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <p className="text-xs text-ink-subtle">
        Turning something off removes it from new work only. Permits, audits and
        inspections already raised stay visible, can still be completed, and
        continue to appear in reports.
      </p>
    </div>
  );
}
