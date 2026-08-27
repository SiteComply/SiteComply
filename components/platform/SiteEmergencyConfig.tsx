'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { Panel } from '@/components/platform/Panel';
import { SITE_TEXT_MAX } from '@/services/sites/siteInformationConstants';

export interface SiteEmergencyValues {
  fireAssemblyPoint: string | null;
  firstAiderName: string | null;
  firstAiderNumber: string | null;
  firstAiderLocation: string | null;
  nearestHospital: string | null;
  emergencyNumber: string | null;
}

/**
 * Emergency information for the Worker Experience tab — the fire assembly point,
 * first aider, nearest A&E and site emergency number that appear on Worker →
 * Emergency info.
 *
 * This panel used to be read-only, with an "Edit emergency information" link to
 * the whole-site form. That form is Director-only, so a Project Manager or Site
 * Manager saw "No emergency information has been added for this site" and had no
 * link at all — told about the gap, unable to close it. Editing now happens here,
 * behind the same `sites` edit permission as every other section on this tab.
 *
 * Writes go to /api/platform/sites/[id]/emergency, which accepts only these six
 * fields; site name, address, job reference and status stay Director-only.
 */
export function SiteEmergencyConfig({
  siteId,
  values,
  canEdit,
  completeness,
}: {
  siteId: string;
  values: SiteEmergencyValues;
  canEdit: boolean;
  completeness: { complete: number; total: number; missing: string[] };
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fireAssemblyPoint: values.fireAssemblyPoint ?? '',
    firstAiderName: values.firstAiderName ?? '',
    firstAiderNumber: values.firstAiderNumber ?? '',
    firstAiderLocation: values.firstAiderLocation ?? '',
    nearestHospital: values.nearestHospital ?? '',
    emergencyNumber: values.emergencyNumber ?? '',
  });

  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  function cancel() {
    if (busy) return;
    setForm({
      fireAssemblyPoint: values.fireAssemblyPoint ?? '',
      firstAiderName: values.firstAiderName ?? '',
      firstAiderNumber: values.firstAiderNumber ?? '',
      firstAiderLocation: values.firstAiderLocation ?? '',
      nearestHospital: values.nearestHospital ?? '',
      emergencyNumber: values.emergencyNumber ?? '',
    });
    setEditing(false);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/emergency`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save emergency information.');
        return;
      }
      toast.success('Emergency information saved.');
      setEditing(false);
      // Re-render the server component so the summary, this panel's indicator
      // and the Overview figure all reflect the write from one source.
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const has =
    values.fireAssemblyPoint ||
    values.firstAiderName ||
    values.nearestHospital ||
    values.emergencyNumber ||
    values.firstAiderNumber ||
    values.firstAiderLocation;

  return (
    <Panel title="Emergency information">
      <p className="-mt-1 mb-3 text-sm text-ink-subtle">
        Shown to workers on their Emergency info page. Workers always see 999 and
        site signage as a fallback, so this is the site-specific detail.
      </p>

      {!editing && (
        <>
          {has ? (
            <dl className="space-y-3">
              <Row label="Fire assembly point" value={values.fireAssemblyPoint} />
              <Row
                label="First aider"
                value={
                  [
                    values.firstAiderName,
                    values.firstAiderLocation
                      ? `at ${values.firstAiderLocation}`
                      : null,
                    values.firstAiderNumber ? `· ${values.firstAiderNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || null
                }
              />
              <Row label="Nearest A&E" value={values.nearestHospital} />
              <Row label="Emergency number" value={values.emergencyNumber} />
            </dl>
          ) : (
            <p className="rounded-lg border border-line bg-surface-sunken px-3 py-4 text-center text-sm text-ink-muted">
              No emergency information has been added for this site.
            </p>
          )}

          {/* The indicator is on the panel that owns the fields, so "what is
              still missing" is answered where it can be acted on. */}
          <p className="mt-3 text-xs text-ink-subtle">
            {completeness.complete} of {completeness.total} recorded
            {completeness.missing.length > 0 && (
              <> · Still to add: {completeness.missing.join(', ')}.</>
            )}
          </p>

          {canEdit && (
            <div className="mt-3">
              <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
                {has ? 'Edit emergency information' : 'Add emergency information'}
              </Button>
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="space-y-3">
          <TextField
            label="Fire assembly point"
            value={form.fireAssemblyPoint}
            onChange={(e) => set('fireAssemblyPoint')(e.target.value)}
            maxLength={SITE_TEXT_MAX}
            placeholder="e.g. Main gate, north car park"
          />
          <TextField
            label="First aider name"
            value={form.firstAiderName}
            onChange={(e) => set('firstAiderName')(e.target.value)}
            maxLength={SITE_TEXT_MAX}
            placeholder="e.g. Sarah Nolan"
          />
          <TextField
            label="First aider location"
            value={form.firstAiderLocation}
            onChange={(e) => set('firstAiderLocation')(e.target.value)}
            maxLength={SITE_TEXT_MAX}
            placeholder="e.g. Site office"
          />
          <TextField
            label="First aider contact number"
            value={form.firstAiderNumber}
            onChange={(e) => set('firstAiderNumber')(e.target.value)}
            maxLength={SITE_TEXT_MAX}
            placeholder="e.g. 07700 900123"
          />
          <TextField
            label="Nearest A&E"
            value={form.nearestHospital}
            onChange={(e) => set('nearestHospital')(e.target.value)}
            maxLength={SITE_TEXT_MAX}
            placeholder="e.g. City Hospital — 2.4 miles"
          />
          <TextField
            label="Site emergency number"
            value={form.emergencyNumber}
            onChange={(e) => set('emergencyNumber')(e.target.value)}
            maxLength={SITE_TEXT_MAX}
            placeholder="Leave blank to show 999 only"
          />
          <div className="flex gap-2 pt-1">
            <Button size="md" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={cancel}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="text-sm text-ink">
        {value ?? <span className="text-ink-subtle">Not recorded</span>}
      </dd>
    </div>
  );
}
