'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { documentCategoryLabel } from '@/services/documents/documentConstants';

export interface AuditFormSite {
  id: string;
  name: string;
  jobReference: string;
}
export interface AuditFormDocument {
  id: string;
  title: string;
  jobSiteId: string;
  category: string;
}
export interface AuditFormTemplate {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

interface Values {
  title: string;
  jobSiteId: string;
  description: string;
  observations: string;
  overallScore: string;
  documentIds: string[];
}

type FieldErrors = Partial<Record<keyof Values | 'documentIds', string>>;

/**
 * Create / edit form for a site audit. Submits JSON to the audits API (create
 * POST or edit PATCH), which is the authoritative validator; field errors it
 * returns are shown inline. Documents available to reference are filtered to the
 * currently-selected site.
 */
export function AuditForm({
  mode,
  auditId,
  sites,
  documents,
  templates = [],
  initial,
}: {
  mode: 'create' | 'edit';
  auditId?: string;
  sites: AuditFormSite[];
  documents: AuditFormDocument[];
  templates?: AuditFormTemplate[];
  initial?: Partial<Values>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    title: initial?.title ?? '',
    jobSiteId: initial?.jobSiteId ?? (sites.length === 1 ? sites[0].id : ''),
    description: initial?.description ?? '',
    observations: initial?.observations ?? '',
    overallScore: initial?.overallScore ?? '',
    documentIds: initial?.documentIds ?? [],
  });
  // SC-013: when creating, start blank or from a template (its items are copied in).
  const [templateId, setTemplateId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const chosenTemplate = templates.find((t) => t.id === templateId) ?? null;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    // Prefill the title from the template name if the user hasn't typed one.
    if (t && !values.title.trim()) set('title', t.name);
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Documents for the selected site only.
  const siteDocuments = useMemo(
    () => documents.filter((d) => d.jobSiteId === values.jobSiteId),
    [documents, values.jobSiteId],
  );

  function toggleDoc(id: string) {
    setValues((v) => ({
      ...v,
      documentIds: v.documentIds.includes(id)
        ? v.documentIds.filter((x) => x !== id)
        : [...v.documentIds, id],
    }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);
    try {
      // Only send document refs that belong to the selected site.
      const validIds = new Set(siteDocuments.map((d) => d.id));
      const payload = {
        title: values.title,
        jobSiteId: values.jobSiteId,
        description: values.description,
        observations: values.observations,
        overallScore: values.overallScore,
        documentIds: values.documentIds.filter((id) => validIds.has(id)),
        ...(mode === 'create' && templateId ? { templateId } : {}),
      };
      const res = await fetch(
        mode === 'create'
          ? '/api/platform/audits'
          : `/api/platform/audits/${auditId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else
          setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      const id = data.id ?? auditId;
      router.push(`/platform/dashboard/audits/${id}`);
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

      {/* SC-013: start blank or from a template. */}
      {mode === 'create' && templates.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-sunken p-4">
          <label className="block text-sm font-semibold text-ink">
            Start from
          </label>
          <p className="mb-2 text-xs text-ink-subtle">
            Use a template to standardise the audit, or start with a blank
            audit.
          </p>
          <select
            value={templateId}
            onChange={(e) => chooseTemplate(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink"
          >
            <option value="">Blank audit (start from scratch)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.itemCount} item{t.itemCount === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          {chosenTemplate && (
            <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
              {chosenTemplate.description
                ? `${chosenTemplate.description} `
                : ''}
              Its {chosenTemplate.itemCount} checklist item
              {chosenTemplate.itemCount === 1 ? '' : 's'} will be added to the
              new audit.
            </p>
          )}
        </div>
      )}

      <TextField
        label="Audit title"
        value={values.title}
        onChange={(e) => set('title', e.target.value)}
        error={errors.title}
        placeholder="e.g. Monthly site safety inspection"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          label="Site"
          value={values.jobSiteId}
          onChange={(e) => {
            // Changing site clears document refs (they're site-specific).
            setValues((v) => ({
              ...v,
              jobSiteId: e.target.value,
              documentIds: [],
            }));
          }}
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

        <TextField
          label="Overall score (optional)"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={values.overallScore}
          onChange={(e) => set('overallScore', e.target.value)}
          error={errors.overallScore}
          hint="A whole number from 0 to 100."
          placeholder="e.g. 85"
        />
      </div>

      <Textarea
        label="Description (optional)"
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
        error={errors.description}
        rows={3}
        hint="Scope and purpose of this audit."
      />

      <Textarea
        label="Observations (optional)"
        value={values.observations}
        onChange={(e) => set('observations', e.target.value)}
        error={errors.observations}
        rows={5}
        hint="What was seen on site — notes, concerns, good practice."
      />

      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-ink">
          Referenced documents (optional)
        </label>
        {!values.jobSiteId ? (
          <p className="text-sm text-ink-subtle">
            Choose a site to list its documents.
          </p>
        ) : siteDocuments.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            No documents on this site to reference yet.
          </p>
        ) : (
          <div className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2">
            {siteDocuments.map((d) => {
              const checked = values.documentIds.includes(d.id);
              return (
                <label
                  key={d.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm',
                    checked ? 'border-brand-400 bg-brand-50' : 'border-line',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    onChange={() => toggleDoc(d.id)}
                  />
                  <span>
                    <span className="font-medium text-ink">{d.title}</span>
                    <span className="block text-xs text-ink-subtle">
                      {documentCategoryLabel(d.category)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {errors.documentIds && (
          <p className="text-sm font-medium text-danger-600">
            {errors.documentIds}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button type="submit" variant="brand" disabled={busy}>
          {busy
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create audit'
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
