'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  SITE_MAP_MIME_TYPES,
  SITE_MAP_ACCEPT_HINT,
} from '@/services/sites/siteInformationConstants';

export interface SiteMapState {
  hasSiteMap: boolean;
  siteMapFileName: string | null;
}

/**
 * The site's layout image, uploaded and removed.
 *
 * ── EXTRACTED SO IT CAN BE ASKED FOR IN THE RIGHT PLACE ───────────────────
 *
 * This lived inline at the bottom of the Site information panel, below that
 * panel's own Save button, on the Operative Experience tab. It is a first-class
 * induction input — the video builds a layout scene from it — and it was four
 * levels down a screen nobody opens while setting a site up, which is why almost
 * no site has one.
 *
 * Now a component, so Project setup can host it alongside the drawings without a
 * second uploader existing. Both surfaces post to the same route and neither owns
 * the state; the server does.
 *
 * NOT A DOCUMENT, deliberately. Drawings and RAMS go to the document register for
 * its permissions, expiry tracking and annotation. The site map has no expiry and
 * is not annotated: it is one image the induction shows.
 */
export function SiteMapUpload({
  siteId,
  current,
  canEdit,
}: {
  siteId: string;
  current: SiteMapState;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/platform/sites/${siteId}/site-map`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not upload the site map.');
        return;
      }
      toast.success('Site map updated.');
      router.refresh();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/site-map`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not remove the site map.');
        return;
      }
      toast.success('Site map removed.');
      setConfirmRemove(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm font-semibold text-ink">Site map</p>
      {current.hasSiteMap ? (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-ink-muted">
            {current.siteMapFileName ?? 'Uploaded image'}
          </p>
          {canEdit && (
            <button
              type="button"
              className="shrink-0 text-sm font-semibold text-danger-600 hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-subtle">No site map uploaded yet.</p>
      )}
      {canEdit && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept={SITE_MAP_MIME_TYPES.join(',')}
            disabled={busy}
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <p className="mt-1 text-xs text-ink-subtle">
            {busy ? 'Uploading…' : SITE_MAP_ACCEPT_HINT}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove the site map?"
        message="Operatives will no longer see a site map until a new one is uploaded."
        confirmLabel={busy ? 'Removing…' : 'Remove'}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
