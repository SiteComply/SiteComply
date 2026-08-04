'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { formatDateUK, toDateInputValue } from '@/lib/datetime';
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  FINDING_SEVERITY_BADGE,
  FINDING_STATUS_BADGE,
  findingCategoryLabel,
  findingSeverityLabel,
  findingStatusLabel,
  type FindingSeverityValue,
  type FindingStatusValue,
} from '@/services/audits/findingConstants';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
  EvidenceGallery,
  type EvidenceItem,
} from '@/components/platform/EvidenceGallery';
import {
  PendingPhotos,
  type PendingPhoto,
} from '@/components/platform/PendingPhotos';
import { uploadAnnotatedPair } from '@/components/platform/annotatedUpload';
import type { AssignablePerson } from '@/services/actions/actionAssigneeService';

export interface FindingRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  severity: string;
  status: string;
  dueDate: string | null; // ISO
  correctiveAction: string | null;
  createdByName: string | null;
  evidence: EvidenceItem[];
}

interface FormValues {
  title: string;
  description: string;
  category: string;
  severity: string;
  status: string;
  dueDate: string;
  correctiveAction: string;
}

type FieldErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY: FormValues = {
  title: '',
  description: '',
  category: 'SAFETY',
  severity: 'MEDIUM',
  status: 'OPEN',
  dueDate: '',
  correctiveAction: '',
};

/**
 * Findings panel for the audit detail page. Lists an audit's findings and — for
 * roles with the audits "edit" permission — supports adding, editing and closing
 * them inline (each finding carries a corrective action). All writes go through
 * the findings API, which re-checks RBAC + the Assigned-Sites boundary.
 */
export function AuditFindingsPanel({
  auditId,
  jobSiteId,
  findings,
  canEdit,
  canCreateAction = false,
}: {
  auditId: string;
  jobSiteId: string;
  findings: FindingRow[];
  canEdit: boolean;
  canCreateAction?: boolean;
}) {
  const router = useRouter();
  // null = no form open; 'add' = add form; otherwise the finding id being edited.
  const [mode, setMode] = useState<null | 'add' | string>(null);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [assignFor, setAssignFor] = useState<string | undefined>();
  const [assignee, setAssignee] = useState('');
  const [assignError, setAssignError] = useState<string | undefined>();
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [peopleFallback, setPeopleFallback] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // SC-017 FOLLOW-UP — a finding can now save successfully while one of its
  // photos does not. Closing the form would take that message with it, so the
  // panel holds it: the finding IS in the list, and the reader needs to know
  // which photo to add.
  const [notice, setNotice] = useState<string | undefined>();

  async function quickStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/audit-findings/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  // Generate a corrective action from this finding, then open it.
  async function createAction(findingId: string) {
    setBusyId(findingId);
    setAssignError(undefined);
    try {
      const res = await fetch(
        `/api/platform/audit-findings/${findingId}/create-action`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeKind: assignee.split(':')[0],
            assigneeId: assignee.split(':')[1],
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.id) {
        setAssignFor(undefined);
        router.push(`/platform/dashboard/actions/${data.id}`);
      } else {
        setAssignError(data.error ?? 'Could not create the action.');
      }
    } finally {
      setBusyId(undefined);
    }
  }

  // SC-015: an action generated from a finding must name a responsible person,
  // so the button opens an assignee picker instead of creating immediately.
  function openAssign(findingId: string) {
    setAssignFor(findingId);
    setAssignee('');
    setAssignError(undefined);
    if (people.length === 0 && !peopleLoading) {
      setPeopleLoading(true);
      fetch(`/api/platform/sites/${jobSiteId}/assignable-people`)
        .then((r) => r.json())
        .then((d) => {
          setPeople(d?.ok ? (d.people ?? []) : []);
          setPeopleFallback(Boolean(d?.isFallback));
        })
        .catch(() => setPeople([]))
        .finally(() => setPeopleLoading(false));
    }
  }

  const openCount = findings.filter((f) => f.status !== 'CLOSED').length;

  // Client-side search + pagination — findings for one audit are already loaded,
  // and the UX (search box, "Showing X–Y of N", Prev/Next) matches the list views.
  const q = search.trim().toLowerCase();
  const filtered = q
    ? findings.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          (f.description ?? '').toLowerCase().includes(q) ||
          (f.correctiveAction ?? '').toLowerCase().includes(q),
      )
    : findings;
  const pageCount = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * DEFAULT_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + DEFAULT_PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(start + DEFAULT_PAGE_SIZE, filtered.length);

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
          Findings ({findings.length}
          {findings.length > 0 ? ` · ${openCount} open` : ''})
        </h2>
        {canEdit && mode !== 'add' && (
          <button
            type="button"
            onClick={() => setMode('add')}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
          >
            Add finding
          </button>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-hivis-500/40 bg-hivis-500/10 px-3 py-2 text-sm text-ink"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(undefined)}
            className="shrink-0 text-xs font-semibold text-ink-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {mode === 'add' && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <FindingForm
            key="add"
            submitLabel="Add finding"
            endpoint={`/api/platform/audits/${auditId}/findings`}
            method="POST"
            onDone={(warning) => {
              setMode(null);
              setNotice(warning);
              router.refresh();
            }}
            onCancel={() => setMode(null)}
          />
        </div>
      )}

      {findings.length > 0 && (
        <div className="mb-3">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search findings…"
            className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>
      )}

      {findings.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          No findings recorded for this audit.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          No findings match your search.
        </p>
      ) : (
        <ul className="space-y-3">
          {pageItems.map((f) => {
            const editing = mode === f.id;
            const busy = busyId === f.id;
            return (
              <li key={f.id} className="rounded-xl border border-line p-4">
                {editing ? (
                  <FindingForm
                    key={f.id}
                    initial={{
                      title: f.title,
                      description: f.description ?? '',
                      category: f.category,
                      severity: f.severity,
                      status: f.status,
                      dueDate: f.dueDate ? toDateInputValue(f.dueDate) : '',
                      correctiveAction: f.correctiveAction ?? '',
                    }}
                    submitLabel="Save finding"
                    endpoint={`/api/platform/audit-findings/${f.id}`}
                    method="PATCH"
                    onDone={(warning) => {
                      setMode(null);
                      setNotice(warning);
                      router.refresh();
                    }}
                    onCancel={() => setMode(null)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{f.title}</span>
                      <Badge
                        className={
                          FINDING_SEVERITY_BADGE[
                            f.severity as FindingSeverityValue
                          ]
                        }
                      >
                        {findingSeverityLabel(f.severity)}
                      </Badge>
                      <Badge
                        className={
                          FINDING_STATUS_BADGE[f.status as FindingStatusValue]
                        }
                      >
                        {findingStatusLabel(f.status)}
                      </Badge>
                      <span className="text-xs text-ink-subtle">
                        {findingCategoryLabel(f.category)}
                      </span>
                      {f.dueDate && (
                        <span className="text-xs text-ink-subtle">
                          · Due {formatDateUK(f.dueDate)}
                        </span>
                      )}
                    </div>
                    {f.description && (
                      <p className="mt-1.5 whitespace-pre-line text-sm text-ink">
                        {f.description}
                      </p>
                    )}
                    {f.correctiveAction && (
                      <div className="mt-2 rounded-lg bg-surface-sunken p-3 text-sm">
                        <span className="font-semibold text-ink">
                          Corrective action:
                        </span>{' '}
                        <span className="whitespace-pre-line text-ink-muted">
                          {f.correctiveAction}
                        </span>
                      </div>
                    )}
                    {(canEdit || canCreateAction) && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setMode(f.id)}
                            disabled={busy}
                            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                        {canEdit &&
                          FINDING_STATUSES.map((s) => (
                            <button
                              key={s.value}
                              type="button"
                              disabled={busy || s.value === f.status}
                              onClick={() => quickStatus(f.id, s.value)}
                              className={cn(
                                'rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:cursor-default',
                                s.value === f.status
                                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                                  : 'border-line text-ink-muted hover:bg-surface-sunken disabled:opacity-50',
                              )}
                            >
                              {s.value === 'CLOSED'
                                ? 'Close'
                                : s.value === 'OPEN'
                                  ? 'Reopen'
                                  : s.label}
                            </button>
                          ))}
                        {canCreateAction && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openAssign(f.id)}
                            className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                          >
                            Create action
                          </button>
                        )}
                      </div>
                    )}
                    {assignFor === f.id && (
                      <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
                        <p className="text-sm font-semibold text-ink">
                          Assign this action
                        </p>
                        <p className="mb-2 text-xs text-ink-subtle">
                          {peopleLoading
                            ? 'Loading people…'
                            : people.length === 0
                              ? 'No inducted workers or assigned users for this site yet.'
                              : peopleFallback
                                ? 'No inducted workers yet — showing users assigned to this site.'
                                : 'Workers inducted on this site.'}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={assignee}
                            onChange={(e) => setAssignee(e.target.value)}
                            disabled={peopleLoading || people.length === 0}
                            aria-label="Assign this action to"
                            className="min-w-[14rem] rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                          >
                            <option value="">Select a person</option>
                            {people.map((p) => (
                              <option
                                key={`${p.kind}:${p.id}`}
                                value={`${p.kind}:${p.id}`}
                              >
                                {p.name} · {p.company}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!assignee || busy}
                            onClick={() => createAction(f.id)}
                            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            Create action
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignFor(undefined)}
                            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface"
                          >
                            Cancel
                          </button>
                        </div>
                        {assignError && (
                          <p className="mt-2 text-xs font-medium text-danger-600">
                            {assignError}
                          </p>
                        )}
                      </div>
                    )}
                    {(f.evidence.length > 0 || canEdit) && (
                      <div className="mt-3 border-t border-line pt-3">
                        <EvidenceGallery
                          basePath={`/api/platform/audit-findings/${f.id}/evidence`}
                          evidence={f.evidence}
                          canManage={canEdit}
                        />
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
          <span className="text-ink-subtle">
            Showing{' '}
            <span className="font-semibold text-ink">
              {rangeStart}–{rangeEnd}
            </span>{' '}
            of <span className="font-semibold text-ink">{filtered.length}</span>
          </span>
          <div className="flex items-center gap-2">
            <PagerButton
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </PagerButton>
            <span className="tabular-nums text-ink-subtle">
              Page {currentPage} of {pageCount}
            </span>
            <PagerButton
              disabled={currentPage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next
            </PagerButton>
          </div>
        </div>
      )}
    </section>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
        disabled
          ? 'cursor-default border-line text-ink-subtle opacity-50'
          : 'border-brand-500 text-brand-700 hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function FindingForm({
  initial = EMPTY,
  submitLabel,
  endpoint,
  method,
  onDone,
  onCancel,
}: {
  initial?: FormValues;
  submitLabel: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  /** `warning` is set when the finding saved but a photo did not attach. */
  onDone: (warning?: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // SC-017 FOLLOW-UP — photos are collected while the finding is being written
  // and attached on save. Only when CREATING: editing an existing finding has
  // the evidence gallery right there on the row, which does more (documents,
  // removal, re-annotation) than a queue could.
  const creating = method === 'POST';
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else
          setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      // THE FINDING NOW EXISTS. Everything below is best-effort attachment, and
      // a failure here must never read as "the finding was not saved" — that
      // would send someone back to write it again and end up with two.
      let warning: string | undefined;
      if (creating && photos.length > 0) {
        const findingId = data.id as string | undefined;
        if (!findingId) {
          warning =
            'The finding was saved, but its photos could not be attached. Open the finding to add them.';
        } else {
          const failures: string[] = [];
          // Sequential, not parallel: each photo is two uploads and these are
          // site phones on site connections. Racing eight requests is how the
          // last one times out.
          for (const photo of photos) {
            const out = await uploadAnnotatedPair(
              `/api/platform/audit-findings/${findingId}/evidence`,
              photo,
            );
            if (!out.ok)
              failures.push(`${photo.originalFile.name}: ${out.error}`);
          }
          if (failures.length > 0) {
            warning = `The finding was saved. ${failures.length} of ${photos.length} photo${
              photos.length === 1 ? '' : 's'
            } could not be attached — open the finding to add ${
              failures.length === 1 ? 'it' : 'them'
            }. (${failures.join('; ')})`;
          }
        }
      }
      onDone(warning);
    } catch {
      setFormError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      {formError && (
        <p className="rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
          {formError}
        </p>
      )}
      <TextField
        label="Finding title"
        value={values.title}
        onChange={(e) => set('title', e.target.value)}
        error={errors.title}
        placeholder="e.g. Unguarded floor edge on level 2"
      />
      <Textarea
        label="Description (optional)"
        rows={2}
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
        error={errors.description}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Category"
          value={values.category}
          onChange={(e) => set('category', e.target.value)}
          error={errors.category}
        >
          {FINDING_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select
          label="Severity"
          value={values.severity}
          onChange={(e) => set('severity', e.target.value)}
          error={errors.severity}
        >
          {FINDING_SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          label="Status"
          value={values.status}
          onChange={(e) => set('status', e.target.value)}
          error={errors.status}
        >
          {FINDING_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <TextField
        label="Due date (optional)"
        type="date"
        value={values.dueDate}
        onChange={(e) => set('dueDate', e.target.value)}
        error={errors.dueDate}
      />
      <Textarea
        label="Corrective action (optional)"
        rows={2}
        value={values.correctiveAction}
        onChange={(e) => set('correctiveAction', e.target.value)}
        error={errors.correctiveAction}
        hint="What needs to be done to resolve this finding."
      />
      {creating && (
        <div className="rounded-lg border border-line bg-surface-sunken p-3">
          <PendingPhotos photos={photos} onChange={setPhotos} disabled={busy} />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="brand" size="md" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Select({
  label,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <select
        aria-invalid={error ? true : undefined}
        className={cn(
          'w-full rounded-xl border bg-surface px-3 py-2.5 text-sm text-ink',
          error ? 'border-danger-500' : 'border-line',
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-sm font-medium text-danger-600">{error}</p>}
    </div>
  );
}
