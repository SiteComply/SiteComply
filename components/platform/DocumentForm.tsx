'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { PhotoAnnotator } from '@/components/platform/PhotoAnnotator';
import { isAnnotatable } from '@/lib/imagePrep';
import type { AnnotationDocument } from '@/services/annotations/annotationTypes';
import {
  DOCUMENT_CATEGORIES,
  ACCEPTED_DOCUMENT_MIME_TYPES,
  ACCEPTED_DOCUMENTS_HINT,
  MAX_DOCUMENT_BYTES,
  formatBytes,
} from '@/services/documents/documentConstants';

export interface DocumentFormSite {
  id: string;
  name: string;
  jobReference: string;
}

interface Values {
  title: string;
  description: string;
  category: string;
  jobSiteId: string;
  expiresAt: string; // yyyy-mm-dd, or '' for no expiry
}

type FieldErrors = Partial<Record<keyof Values | 'file', string>>;

/**
 * Upload / edit form for a site document. In "upload" mode it POSTs a multipart
 * form (metadata + file) to /api/platform/documents; in "edit" mode it PATCHes
 * the metadata (the file itself can't be swapped in Phase 1). The API is the
 * authoritative validator; field errors it returns are shown inline.
 */
export function DocumentForm({
  mode,
  documentId,
  sites,
  initial,
  existingFile,
}: {
  mode: 'upload' | 'edit';
  documentId?: string;
  sites: DocumentFormSite[];
  initial?: Partial<Values>;
  existingFile?: { fileName: string; sizeBytes: number };
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    category: initial?.category ?? '',
    jobSiteId: initial?.jobSiteId ?? (sites.length === 1 ? sites[0].id : ''),
    expiresAt: initial?.expiresAt ?? '',
  });
  const [file, setFile] = useState<File | undefined>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // SC-017: an optional annotated copy of the chosen image. The ORIGINAL is
  // always uploaded first and left unchanged; this is uploaded after it as a
  // separate, linked Document — the same model as audit/action evidence.
  const [annotating, setAnnotating] = useState<File | null>(null);
  const [annotated, setAnnotated] = useState<{
    blob: Blob;
    document: AnnotationDocument;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);

    // Client-side file guard for a friendlier message before the request.
    if (mode === 'upload') {
      if (!file) {
        setErrors({ file: 'Please choose a file to upload.' });
        setBusy(false);
        return;
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        setErrors({ file: 'That file is too large (max 20 MB).' });
        setBusy(false);
        return;
      }
    }

    try {
      let res: Response;
      if (mode === 'upload') {
        const fd = new FormData();
        fd.set('title', values.title);
        fd.set('description', values.description);
        fd.set('category', values.category);
        fd.set('jobSiteId', values.jobSiteId);
        fd.set('expiresAt', values.expiresAt);
        fd.set('file', file as File);
        res = await fetch('/api/platform/documents', {
          method: 'POST',
          body: fd,
        });
      } else {
        res = await fetch(`/api/platform/documents/${documentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.errors) setErrors(data.errors);
        else
          setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      const id = data.id ?? documentId;

      // SC-017: upload the annotated copy as its own Document, linked back to the
      // original that was just created. A failure here must NOT lose the original
      // upload, so it only surfaces a message.
      if (mode === 'upload' && annotated && id) {
        const base = (file as File).name.replace(/\.[^.]+$/, '') || 'image';
        const fd2 = new FormData();
        fd2.set('title', `${values.title} (annotated)`);
        fd2.set('description', values.description);
        fd2.set('category', values.category);
        fd2.set('jobSiteId', values.jobSiteId);
        fd2.set('expiresAt', values.expiresAt);
        fd2.set(
          'file',
          new File([annotated.blob], `${base}-annotated.jpg`, {
            type: 'image/jpeg',
          }),
        );
        fd2.set('annotated', 'true');
        fd2.set('originalDocumentId', id);
        fd2.set('annotationData', JSON.stringify(annotated.document));
        const res2 = await fetch('/api/platform/documents', {
          method: 'POST',
          body: fd2,
        });
        const d2 = await res2.json().catch(() => ({}));
        if (!res2.ok || !d2.ok) {
          setFormError(
            'The document was uploaded, but the annotated copy could not be saved.',
          );
          setBusy(false);
          return;
        }
      }

      router.push(`/platform/dashboard/documents/${id}`);
      router.refresh();
    } catch {
      setFormError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const annotator = annotating ? (
    <PhotoAnnotator
      file={annotating}
      initial={annotated?.document ?? null}
      onCancel={() => setAnnotating(null)}
      onSave={({ annotatedBlob, originalFile, document }) => {
        // The prepared file replaces the chosen one, so a HEIC original is
        // stored as the converted JPEG rather than a format browsers can't show.
        setFile(originalFile);
        setAnnotated({ blob: annotatedBlob, document });
        setAnnotating(null);
      }}
    />
  ) : null;

  return (
    <>
      {annotator}
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
          label="Title"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          error={errors.title}
          placeholder="e.g. Scaffold erection method statement"
        />

        <Textarea
          label="Description (optional)"
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          error={errors.description}
          rows={3}
          hint="A short note about what this document covers."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Category"
            value={values.category}
            onChange={(e) => set('category', e.target.value)}
            error={errors.category}
          >
            <option value="" disabled>
              Choose a category…
            </option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>

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
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-ink">
              Expiry date (optional)
            </label>
            <input
              type="date"
              value={values.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
              aria-invalid={errors.expiresAt ? true : undefined}
              className={cn(
                'touch-target w-full rounded-xl border bg-surface px-4 py-3 text-base text-ink',
                errors.expiresAt ? 'border-danger-500' : 'border-line',
              )}
            />
            {errors.expiresAt ? (
              <p className="text-sm font-medium text-danger-600">
                {errors.expiresAt}
              </p>
            ) : (
              <p className="text-sm text-ink-subtle">
                For certificates, insurance or permits that expire. Leave blank
                if it doesn’t expire.
              </p>
            )}
          </div>
        </div>

        {mode === 'upload' ? (
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-ink">File</label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_DOCUMENT_MIME_TYPES.join(',')}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(f);
                setAnnotated(null);
                // SC-017: images can be annotated before upload; other file types
                // are unaffected.
                if (f && isAnnotatable(f)) setAnnotating(f);
              }}
              className={cn(
                'block w-full rounded-xl border bg-surface text-sm text-ink',
                'file:mr-4 file:cursor-pointer file:border-0 file:bg-surface-sunken file:px-4 file:py-3 file:text-sm file:font-semibold file:text-ink',
                errors.file ? 'border-danger-500' : 'border-line',
              )}
            />
            {file && (
              <p className="text-xs text-ink-subtle">
                Selected: {file.name} · {formatBytes(file.size)}
                {annotated && (
                  <span className="ml-2 inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                    Annotated copy will be saved alongside the original
                  </span>
                )}
                {isAnnotatable(file) && (
                  <button
                    type="button"
                    onClick={() => setAnnotating(file)}
                    className="ml-2 font-semibold text-brand-700 hover:underline"
                  >
                    {annotated ? 'Edit annotations' : 'Annotate'}
                  </button>
                )}
              </p>
            )}
            {errors.file ? (
              <p className="text-sm font-medium text-danger-600">
                {errors.file}
              </p>
            ) : (
              <p className="text-sm text-ink-subtle">
                {ACCEPTED_DOCUMENTS_HINT}
              </p>
            )}
          </div>
        ) : (
          existingFile && (
            <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm">
              <span className="font-semibold text-ink">Current file:</span>{' '}
              <span className="text-ink-muted">
                {existingFile.fileName} · {formatBytes(existingFile.sizeBytes)}
              </span>
              <p className="mt-1 text-xs text-ink-subtle">
                The file cannot be replaced in this phase — upload a new
                document instead.
              </p>
            </div>
          )
        )}

        <div className="flex gap-3">
          <Button type="submit" variant="brand" disabled={busy}>
            {busy
              ? mode === 'upload'
                ? 'Uploading…'
                : 'Saving…'
              : mode === 'upload'
                ? 'Upload document'
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
    </>
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
