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
  findings,
  canEdit,
}: {
  auditId: string;
  findings: FindingRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  // null = no form open; 'add' = add form; otherwise the finding id being edited.
  const [mode, setMode] = useState<null | 'add' | string>(null);
  const [busyId, setBusyId] = useState<string | undefined>();

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

  const openCount = findings.filter((f) => f.status !== 'CLOSED').length;

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

      {mode === 'add' && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <FindingForm
            key="add"
            submitLabel="Add finding"
            endpoint={`/api/platform/audits/${auditId}/findings`}
            method="POST"
            onDone={() => {
              setMode(null);
              router.refresh();
            }}
            onCancel={() => setMode(null)}
          />
        </div>
      )}

      {findings.length === 0 ? (
        <p className="text-sm text-ink-subtle">No findings recorded for this audit.</p>
      ) : (
        <ul className="space-y-3">
          {findings.map((f) => {
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
                    onDone={() => {
                      setMode(null);
                      router.refresh();
                    }}
                    onCancel={() => setMode(null)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{f.title}</span>
                      <Badge
                        className={FINDING_SEVERITY_BADGE[f.severity as FindingSeverityValue]}
                      >
                        {findingSeverityLabel(f.severity)}
                      </Badge>
                      <Badge
                        className={FINDING_STATUS_BADGE[f.status as FindingStatusValue]}
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
                    {canEdit && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setMode(f.id)}
                          disabled={busy}
                          className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                        >
                          Edit
                        </button>
                        {FINDING_STATUSES.map((s) => (
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
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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
        else setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      onDone();
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
        <Select label="Category" value={values.category} onChange={(e) => set('category', e.target.value)} error={errors.category}>
          {FINDING_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>
        <Select label="Severity" value={values.severity} onChange={(e) => set('severity', e.target.value)} error={errors.severity}>
          {FINDING_SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
        <Select label="Status" value={values.status} onChange={(e) => set('status', e.target.value)} error={errors.status}>
          {FINDING_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
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
      <div className="flex gap-2">
        <Button type="submit" variant="brand" size="md" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={busy}>
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
