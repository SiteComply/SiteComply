'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SiteServicesConfig } from '@/components/platform/SiteServicesConfig';
import type { SiteServiceGroup } from '@/services/siteServices/siteServiceCatalog';
import Link from 'next/link';
import {
  SETUP_STEPS,
  applicableSteps,
  computeCompleteness,
  type SetupFlag,
  type SetupStep,
} from '@/services/sites/siteSetupConstants';

/**
 * SC-019 Phase 1 — the project setup wizard.
 *
 * Save-and-resume is the defining behaviour: the site already EXISTS (created
 * from a short mandatory core), every step saves independently, and the sidebar
 * shows exactly what is outstanding. A 16-step wizard that had to be completed in
 * one sitting before a site could exist would be unusable on site.
 *
 * Steps the current user may not edit are shown but disabled, so a Site Manager
 * can see the Director-owned appointments without being able to change them —
 * visibility without authority, rather than pretending they don't exist.
 */

export interface SetupValues {
  [stepKey: string]: Record<string, unknown>;
}

export interface KeyPersonRow {
  kind: string;
  name: string;
  phone: string;
  location: string;
}

const PERSON_KINDS = [
  { value: 'SITE_MANAGER', label: 'Site manager' },
  { value: 'FIRST_AIDER', label: 'First aider' },
  { value: 'FIRE_MARSHAL', label: 'Fire marshal' },
  { value: 'OTHER', label: 'Other' },
];

/** Field definitions per step — narrative steps are textareas, contacts inputs. */
const FIELDS: Record<
  string,
  {
    name: string;
    label: string;
    kind: 'text' | 'area' | 'date' | 'check';
    hint?: string;
  }[]
> = {
  project: [
    { name: 'description', label: 'Project description', kind: 'area' },
    { name: 'scopeOfWorks', label: 'Scope of works', kind: 'area' },
    { name: 'startDate', label: 'Start date', kind: 'date' },
    { name: 'plannedEndDate', label: 'Planned end date', kind: 'date' },
    {
      name: 'cdmNotifiable',
      label: 'CDM notifiable project (F10)',
      kind: 'check',
      hint: 'Over 30 working days with 20+ workers at once, or over 500 person days. Notifying the HSE remains the client’s duty.',
    },
  ],
  f10: [{ name: 'f10Reference', label: 'F10 reference', kind: 'text' }],
  client: [
    { name: 'clientName', label: 'Client organisation', kind: 'text' },
    { name: 'clientContactName', label: 'Contact name', kind: 'text' },
    { name: 'clientContactEmail', label: 'Contact email', kind: 'text' },
    { name: 'clientContactPhone', label: 'Contact phone', kind: 'text' },
  ],
  'duty-holders': [
    {
      name: 'principalDesigner',
      label: 'Principal Designer (organisation)',
      kind: 'text',
    },
    {
      name: 'principalDesignerContact',
      label: 'Principal Designer contact',
      kind: 'text',
    },
    {
      name: 'principalDesignerEmail',
      label: 'Principal Designer email',
      kind: 'text',
    },
    {
      name: 'principalDesignerPhone',
      label: 'Principal Designer phone',
      kind: 'text',
    },
    {
      name: 'principalDesignerAppointedAt',
      label: 'Appointed on',
      kind: 'date',
    },
    {
      name: 'principalContractor',
      label: 'Principal Contractor (organisation)',
      kind: 'text',
    },
    {
      name: 'principalContractorContact',
      label: 'Principal Contractor contact',
      kind: 'text',
    },
    {
      name: 'principalContractorEmail',
      label: 'Principal Contractor email',
      kind: 'text',
    },
    {
      name: 'principalContractorPhone',
      label: 'Principal Contractor phone',
      kind: 'text',
    },
    {
      name: 'principalContractorAppointedAt',
      label: 'Appointed on',
      kind: 'date',
    },
  ],
  emergency: [
    { name: 'fireAssemblyPoint', label: 'Fire assembly point', kind: 'text' },
    { name: 'nearestHospital', label: 'Nearest A&E', kind: 'text' },
    { name: 'emergencyNumber', label: 'Site emergency number', kind: 'text' },
    { name: 'fireArrangements', label: 'Fire arrangements', kind: 'area' },
    {
      name: 'emergencyProcedures',
      label: 'Emergency procedures',
      kind: 'area',
    },
  ],
  welfare: [
    { name: 'welfareFacilities', label: 'Welfare facilities', kind: 'area' },
    { name: 'workingHours', label: 'Working hours', kind: 'area' },
  ],
  rules: [{ name: 'siteRules', label: 'Site rules', kind: 'area' }],
  hazards: [
    { name: 'siteHazards', label: 'Site-specific hazards', kind: 'area' },
    {
      name: 'existingSiteRisks',
      label: 'Existing site risks',
      kind: 'area',
      hint: 'Risks already present on or next to the site.',
    },
  ],
  'high-risk': [
    { name: 'highRiskActivities', label: 'High-risk activities', kind: 'area' },
  ],
  'temporary-works': [
    { name: 'temporaryWorks', label: 'Temporary works', kind: 'area' },
  ],
  access: [
    { name: 'accessEgress', label: 'Site access and egress', kind: 'area' },
    { name: 'deliveryProcedures', label: 'Delivery procedures', kind: 'area' },
  ],
  traffic: [
    { name: 'trafficManagement', label: 'Traffic management', kind: 'area' },
  ],
  utilities: [
    {
      name: 'utilitiesIsolation',
      label: 'Utilities and isolation points',
      kind: 'area',
    },
  ],
  environment: [
    {
      name: 'environmentalControls',
      label: 'Environmental controls',
      kind: 'area',
    },
  ],
};

export function SiteSetupWizard({
  siteId,
  siteName,
  initialValues,
  initialPeople,
  completedSteps,
  canEditProject,
  serviceGroups,
}: {
  siteId: string;
  siteName: string;
  initialValues: SetupValues;
  initialPeople: KeyPersonRow[];
  completedSteps: string[];
  canEditProject: boolean;
  /** SC-021 — permits and inspections available on this site. */
  serviceGroups: SiteServiceGroup[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<SetupValues>(initialValues);
  const [people, setPeople] = useState<KeyPersonRow[]>(initialPeople);
  const [done, setDone] = useState<string[]>(completedSteps);
  const [activeKey, setActiveKey] = useState<string>(SETUP_STEPS[0]!.key);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  // Conditional triggers, recomputed live so answering "notifiable" reveals the
  // F10 step immediately rather than after a reload.
  const flags = useMemo<Partial<Record<SetupFlag, boolean>>>(() => {
    const str = (k: string, f: string) => String(values[k]?.[f] ?? '').trim();
    return {
      cdmNotifiable: values.project?.cdmNotifiable === true,
      hasTemporaryWorks: str('temporary-works', 'temporaryWorks') !== '',
      hasTrafficManagement: str('traffic', 'trafficManagement') !== '',
      hasHighRiskActivities: str('high-risk', 'highRiskActivities') !== '',
    };
  }, [values]);

  // Conditional steps stay visible so they can be filled in the first place;
  // only the completeness maths uses `applicableSteps`.
  const visible = SETUP_STEPS;
  const completeness = computeCompleteness(flags, done);
  const applicable = applicableSteps(flags).map((s) => s.key);
  const active = visible.find((s) => s.key === activeKey) ?? visible[0]!;
  const editable = active.owner === 'SITE_MANAGER' || canEditProject;

  function set(stepKey: string, field: string, value: unknown) {
    setValues((v) => ({
      ...v,
      [stepKey]: { ...(v[stepKey] ?? {}), [field]: value },
    }));
  }

  async function save(step: SetupStep, markComplete: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const payload =
        step.key === 'people' ? { people } : (values[step.key] ?? {});
      const res = await fetch(`/api/platform/sites/${siteId}/setup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepKey: step.key,
          values: payload,
          markComplete,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage({ tone: 'error', text: data.error ?? 'Could not save.' });
        return;
      }
      setDone((d) => {
        const next = new Set(d);
        if (markComplete) next.add(step.key);
        else next.delete(step.key);
        return [...next];
      });
      setMessage({
        tone: 'ok',
        text: markComplete
          ? `${step.title} marked complete.`
          : 'Progress saved.',
      });
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Network problem. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">Project setup</h1>
          <p className="text-sm text-ink-muted">{siteName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/platform/dashboard/sites/${siteId}/cpp`}
            className="touch-target rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            View CPP draft
          </Link>
          <Link
            href={`/platform/dashboard/sites/${siteId}`}
            className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Back to site
          </Link>
        </div>
      </div>

      {/* Progress — the save-and-resume anchor. */}
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {completeness.completed} of {completeness.applicable} sections
            complete
          </p>
          <p className="text-sm text-ink-muted">
            {completeness.cppReady ? (
              <span className="font-semibold text-safe-700">
                Ready for a Construction Phase Plan draft
              </span>
            ) : (
              `${completeness.outstanding.length} still to do`
            )}
          </p>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={completeness.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup completeness"
        >
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${completeness.percent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          You can leave and come back at any time — every section saves on its
          own.
        </p>
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-2 text-sm ${
            message.tone === 'ok'
              ? 'border-safe-500/40 bg-safe-50 text-safe-700'
              : 'border-danger-500/40 bg-danger-50 text-danger-700'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* Step list */}
        <nav aria-label="Setup sections" className="space-y-1">
          {visible.map((step) => {
            const isDone = done.includes(step.key);
            const isActive = step.key === active.key;
            const relevant = applicable.includes(step.key);
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => setActiveKey(step.key)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isActive
                    ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
                    : 'border-line bg-surface text-ink-muted hover:bg-surface-sunken'
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    isDone
                      ? 'bg-safe-500 text-white'
                      : 'bg-surface-sunken text-ink-subtle ring-1 ring-line'
                  }`}
                >
                  {isDone ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                {!relevant && (
                  <span className="shrink-0 text-[10px] uppercase text-ink-subtle">
                    n/a
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Active step */}
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-base font-bold text-ink">{active.title}</h2>
          <p className="mb-1 text-sm text-ink-muted">{active.description}</p>
          <p className="mb-4 text-xs text-ink-subtle">
            Owned by {active.owner === 'DIRECTOR' ? 'Director' : 'Site Manager'}
            {active.requiresFlag &&
              ' · only required when relevant to this site'}
          </p>

          {!editable && (
            <p className="mb-4 rounded-lg border border-hivis-500/40 bg-hivis-500/10 px-3 py-2 text-sm text-ink-muted">
              This section is maintained by a Director. You can see it but not
              change it.
            </p>
          )}

          {active.key === 'people' ? (
            <PeopleEditor
              rows={people}
              disabled={!editable || saving}
              onChange={setPeople}
            />
          ) : active.key === 'services' ? (
            // SC-021. Each toggle saves immediately through its own endpoint,
            // so this step needs no fields of its own — "Save & continue" only
            // records that the manager has been through it.
            <SiteServicesConfig
              siteId={siteId}
              groups={serviceGroups}
              canEdit={editable}
            />
          ) : active.key === 'drawings' ? (
            <div className="space-y-2 text-sm text-ink-muted">
              <p>
                Site layout drawings and emergency plans are filed as site
                documents, so they use the register’s permissions, expiry
                tracking and photo annotation.
              </p>
              <Link
                href={`/platform/dashboard/documents/new?site=${siteId}`}
                className="inline-flex font-semibold text-brand-700 hover:underline"
              >
                Upload a drawing or plan →
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {(FIELDS[active.key] ?? []).map((f) => {
                const current = values[active.key]?.[f.name];
                if (f.kind === 'check') {
                  return (
                    <label key={f.name} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={current === true}
                        disabled={!editable || saving}
                        onChange={(e) =>
                          set(active.key, f.name, e.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 rounded border-line"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">
                          {f.label}
                        </span>
                        {f.hint && (
                          <span className="block text-xs text-ink-subtle">
                            {f.hint}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                }
                return (
                  <div key={f.name} className="space-y-1.5">
                    <label className="block text-sm font-semibold text-ink">
                      {f.label}
                    </label>
                    {f.kind === 'area' ? (
                      <textarea
                        rows={4}
                        value={String(current ?? '')}
                        disabled={!editable || saving}
                        onChange={(e) =>
                          set(active.key, f.name, e.target.value)
                        }
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:bg-surface-sunken"
                      />
                    ) : (
                      <input
                        type={f.kind === 'date' ? 'date' : 'text'}
                        value={String(current ?? '')}
                        disabled={!editable || saving}
                        onChange={(e) =>
                          set(active.key, f.name, e.target.value)
                        }
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:bg-surface-sunken"
                      />
                    )}
                    {f.hint && (
                      <p className="text-xs text-ink-subtle">{f.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => save(active, false)}
              disabled={!editable || saving}
              className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save and continue later'}
            </button>
            <button
              type="button"
              onClick={() => save(active, true)}
              disabled={!editable || saving}
              className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Save and mark complete
            </button>
            {done.includes(active.key) && (
              <button
                type="button"
                onClick={() => save(active, false)}
                disabled={!editable || saving}
                className="text-sm font-medium text-ink-subtle hover:underline disabled:opacity-50"
              >
                Reopen this section
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Repeatable named-personnel editor — multiple first aiders, marshals, managers. */
function PeopleEditor({
  rows,
  disabled,
  onChange,
}: {
  rows: KeyPersonRow[];
  disabled: boolean;
  onChange: (rows: KeyPersonRow[]) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-sm text-ink-subtle">No personnel recorded yet.</p>
      )}
      {rows.map((r, idx) => (
        <div
          key={idx}
          className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-4"
        >
          <select
            value={r.kind}
            disabled={disabled}
            aria-label={`Role for person ${idx + 1}`}
            onChange={(e) =>
              onChange(
                rows.map((x, i) =>
                  i === idx ? { ...x, kind: e.target.value } : x,
                ),
              )
            }
            className="rounded-lg border border-line px-2 py-1.5 text-sm"
          >
            {PERSON_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            value={r.name}
            disabled={disabled}
            placeholder="Name"
            aria-label={`Name for person ${idx + 1}`}
            onChange={(e) =>
              onChange(
                rows.map((x, i) =>
                  i === idx ? { ...x, name: e.target.value } : x,
                ),
              )
            }
            className="rounded-lg border border-line px-2 py-1.5 text-sm"
          />
          <input
            value={r.phone}
            disabled={disabled}
            placeholder="Phone"
            aria-label={`Phone for person ${idx + 1}`}
            onChange={(e) =>
              onChange(
                rows.map((x, i) =>
                  i === idx ? { ...x, phone: e.target.value } : x,
                ),
              )
            }
            className="rounded-lg border border-line px-2 py-1.5 text-sm"
          />
          <div className="flex gap-1">
            <input
              value={r.location}
              disabled={disabled}
              placeholder="Location"
              aria-label={`Location for person ${idx + 1}`}
              onChange={(e) =>
                onChange(
                  rows.map((x, i) =>
                    i === idx ? { ...x, location: e.target.value } : x,
                  ),
                )
              }
              className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
              aria-label={`Remove person ${idx + 1}`}
              className="rounded px-2 text-ink-subtle hover:text-danger-600 disabled:opacity-40"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...rows,
            { kind: 'FIRST_AIDER', name: '', phone: '', location: '' },
          ])
        }
        className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-40"
      >
        + Add person
      </button>
      <p className="text-xs text-ink-subtle">
        The first listed first aider is also shown on the worker dashboard and
        during induction.
      </p>
    </div>
  );
}
