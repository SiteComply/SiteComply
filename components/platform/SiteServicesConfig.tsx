'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SITE_SERVICE_KIND_META,
  disableBlockedReason,
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

export function SiteServicesConfig({
  siteId,
  groups: initialGroups,
  canEdit,
}: {
  siteId: string;
  groups: SiteServiceGroup[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
                const busy = busyId === item.id;
                return (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">
                          {item.name}
                          {!item.enabled ? (
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

                        {blocked ? (
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
                          disabled={!canEdit || busy || blocked}
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
