'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import {
  ACTION_PRIORITIES,
  ACTION_STATUSES,
} from '@/services/actions/actionConstants';
import type { AssignablePerson } from '@/services/actions/actionAssigneeService';

export interface ActionFormSite {
  id: string;
  name: string;
  jobReference: string;
}

interface Values {
  title: string;
  jobSiteId: string;
  priority: string;
  status: string;
  dueDate: string;
  assignedTo: string;
  // SC-015: the chosen person's identity. `assignedTo` remains the display name.
  assigneeKind: string;
  assigneeId: string;
  description: string;
}

type FieldErrors = Partial<Record<keyof Values, string>>;

/**
 * Create / edit form for a corrective action. Submits JSON to the actions API
 * (create POST or edit PATCH), which is the authoritative validator; field
 * errors it returns are shown inline. Sites are limited to the viewer's scope.
 */
export function ActionForm({
  mode,
  actionId,
  sites,
  initial,
}: {
  mode: 'create' | 'edit';
  actionId?: string;
  sites: ActionFormSite[];
  initial?: Partial<Values>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    title: initial?.title ?? '',
    jobSiteId: initial?.jobSiteId ?? (sites.length === 1 ? sites[0].id : ''),
    priority: initial?.priority ?? 'MEDIUM',
    status: initial?.status ?? 'OPEN',
    dueDate: initial?.dueDate ?? '',
    assignedTo: initial?.assignedTo ?? '',
    assigneeKind: initial?.assigneeKind ?? '',
    assigneeId: initial?.assigneeId ?? '',
    description: initial?.description ?? '',
  });

  // SC-015: people assignable on the CURRENTLY selected site. Refetched whenever
  // the site changes, and the previous choice is cleared — an assignee from
  // another site must never survive a site change.
  const [people, setPeople] = useState<AssignablePerson[]>([]);
  const [peopleFallback, setPeopleFallback] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const siteId = values.jobSiteId;
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!siteId) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    setPeopleLoading(true);
    fetch(`/api/platform/sites/${siteId}/assignable-people`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setPeople(d?.ok ? (d.people ?? []) : []);
        setPeopleFallback(Boolean(d?.isFallback));
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false);
      });
    // Keep an existing assignee on the first render of an EDIT form; clear it on
    // any later site change.
    if (firstLoad.current) {
      firstLoad.current = false;
    } else {
      setValues((v) => ({ ...v, assigneeKind: '', assigneeId: '' }));
    }
    return () => {
      cancelled = true;
    };
  }, [siteId]);
  const [completionNote, setCompletionNote] = useState('');
  const [errors, setErrors] = useState<
    FieldErrors & { completionNote?: string }
  >({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // A completion note is required only when transitioning an existing action to
  // Completed via the form (not when it was already completed).
  const needsCompletionNote =
    mode === 'edit' &&
    initial?.status !== 'COMPLETED' &&
    values.status === 'COMPLETED';

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);
    if (needsCompletionNote && completionNote.trim() === '') {
      setErrors({
        completionNote: 'A completion note is required to mark this Completed.',
      });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(
        mode === 'create'
          ? '/api/platform/actions'
          : `/api/platform/actions/${actionId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, completionNote }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else
          setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      const id = data.id ?? actionId;
      router.push(`/platform/dashboard/actions/${id}`);
      router.refresh();
    } catch {
      setFormError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      {formError && (
        <p
          role="alert"
          className="rounded-xl border border-danger-500 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
        >
          {formError}
        </p>
      )}

      <TextField
        label="Action title"
        value={values.title}
        onChange={(e) => set('title', e.target.value)}
        error={errors.title}
        placeholder="e.g. Install edge protection on level 2"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          label="Site"
          value={values.jobSiteId}
          onChange={(e) => set('jobSiteId', e.target.value)}
          error={errors.jobSiteId}
          hint="Only sites you have access to are listed."
        >
          <option value="" disabled>
            Choose a site…
          </option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.jobReference}
            </option>
          ))}
        </Select>

        <div>
          <Select
            label="Assigned to"
            value={
              values.assigneeId
                ? `${values.assigneeKind}:${values.assigneeId}`
                : ''
            }
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              setValues((v) => ({
                ...v,
                assigneeKind: id ? kind : '',
                assigneeId: id ?? '',
              }));
            }}
            error={errors.assignedTo}
            disabled={!siteId || peopleLoading}
          >
            <option value="">
              {!siteId
                ? 'Select a site first'
                : peopleLoading
                  ? 'Loading…'
                  : people.length === 0
                    ? 'No one available for this site'
                    : 'Select a person'}
            </option>
            {people.map((p) => (
              <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                {p.name} · {p.company}
              </option>
            ))}
          </Select>
          {siteId && !peopleLoading && (
            <p className="mt-1 text-xs text-ink-subtle">
              {people.length === 0
                ? 'No inducted workers or assigned users for this site yet.'
                : peopleFallback
                  ? 'No inducted workers yet — showing users assigned to this site.'
                  : 'Workers inducted on the selected site.'}
            </p>
          )}
          {mode === 'edit' && values.assignedTo && !values.assigneeId && (
            <p className="mt-1 text-xs text-ink-subtle">
              Currently assigned to{' '}
              <span className="font-medium text-ink-muted">
                {values.assignedTo}
              </span>
              . Choose a person above to change it.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Select
          label="Priority"
          value={values.priority}
          onChange={(e) => set('priority', e.target.value)}
          error={errors.priority}
        >
          {ACTION_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        <Select
          label="Status"
          value={values.status}
          onChange={(e) => set('status', e.target.value)}
          error={errors.status}
        >
          {ACTION_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <TextField
          label="Due date (optional)"
          type="date"
          value={values.dueDate}
          onChange={(e) => set('dueDate', e.target.value)}
          error={errors.dueDate}
        />
      </div>

      {needsCompletionNote && (
        <Textarea
          label="Completion note (required)"
          rows={3}
          value={completionNote}
          onChange={(e) => setCompletionNote(e.target.value)}
          error={errors.completionNote}
          hint="Summarise what was done to complete this action."
        />
      )}

      <Textarea
        label="Description (optional)"
        rows={4}
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
        error={errors.description}
        hint="What needs to be done and any context."
      />

      <div className="flex gap-3">
        <Button type="submit" variant="brand" disabled={busy}>
          {busy
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create action'
              : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
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
  hint,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <select
        aria-invalid={error ? true : undefined}
        className={cn(
          'touch-target w-full rounded-xl border bg-surface px-4 py-3 text-base text-ink',
          error ? 'border-danger-500' : 'border-line',
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="text-sm font-medium text-danger-600">{error}</p>
      ) : hint ? (
        <p className="text-sm text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
