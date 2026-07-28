'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  WORKING_HOURS_MAX,
  SITE_TEXT_MAX,
  SITE_MAP_MIME_TYPES,
  SITE_MAP_ACCEPT_HINT,
} from '@/services/sites/siteInformationConstants';

export interface SiteInformationInitial {
  workingHours: string;
  siteRules: string;
  welfareFacilities: string;
  siteHazards: string;
  emergencyProcedures: string;
  hasSiteMap: boolean;
  siteMapFileName: string | null;
  updatedByName: string | null;
  updatedAtLabel: string | null;
}

export interface SiteInfoEmergency {
  fireAssemblyPoint: string | null;
  firstAider: string | null;
  nearestHospital: string | null;
  emergencyNumber: string | null;
}

export interface Completeness {
  complete: number;
  total: number;
  missing: string[];
}

/**
 * Site Details → Worker Experience → Site information (SC-008). A Site Manager
 * maintains the structured, worker-facing site content: working hours, site
 * rules, welfare facilities, site-specific hazards, emergency procedures and a
 * site-map image. Emergency details (fire assembly, first aider, A&E, emergency
 * number) are shown read-only here — they stay on the site record and are edited
 * from the site's Edit page (Director only).
 */
export function SiteInformationConfig({
  siteId,
  canEdit,
  initial,
  emergency,
  completeness,
  siteEditHref,
}: {
  siteId: string;
  canEdit: boolean;
  initial: SiteInformationInitial;
  emergency: SiteInfoEmergency;
  completeness: Completeness;
  siteEditHref: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [workingHours, setWorkingHours] = useState(initial.workingHours);
  const [siteRules, setSiteRules] = useState(initial.siteRules);
  const [welfareFacilities, setWelfare] = useState(initial.welfareFacilities);
  const [siteHazards, setHazards] = useState(initial.siteHazards);
  const [emergencyProcedures, setProcedures] = useState(
    initial.emergencyProcedures,
  );
  const [busy, setBusy] = useState(false);

  const [mapBusy, setMapBusy] = useState(false);
  const [confirmRemoveMap, setConfirmRemoveMap] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/platform/sites/${siteId}/site-information`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workingHours,
            siteRules,
            welfareFacilities,
            siteHazards,
            emergencyProcedures,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save site information.');
        return;
      }
      toast.success('Site information saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadMap(file: File) {
    setMapBusy(true);
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
      setMapBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeMap() {
    setMapBusy(true);
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
      setConfirmRemoveMap(false);
      router.refresh();
    } finally {
      setMapBusy(false);
    }
  }

  const emergencyRows = [
    ['Fire assembly point', emergency.fireAssemblyPoint],
    ['First aider', emergency.firstAider],
    ['Nearest A&E', emergency.nearestHospital],
    ['Emergency number', emergency.emergencyNumber],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        The site information workers see on their Site information page. Updates
        appear straight away — no need for workers to re-induct.
      </p>

      {/* Completeness indicator */}
      <div className="rounded-lg border border-line bg-surface-sunken p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">
            {completeness.complete} of {completeness.total} sections complete
          </p>
          <span className="text-xs font-semibold tabular-nums text-ink-subtle">
            {Math.round((completeness.complete / completeness.total) * 100)}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-safe-500"
            style={{
              width: `${(completeness.complete / completeness.total) * 100}%`,
            }}
          />
        </div>
        {completeness.missing.length > 0 && (
          <p className="mt-2 text-xs text-ink-subtle">
            Still to add: {completeness.missing.join(', ')}.
          </p>
        )}
      </div>

      <Textarea
        label="Working hours"
        rows={2}
        maxLength={WORKING_HOURS_MAX}
        placeholder="e.g. Mon–Fri 07:30–17:00, Sat 08:00–13:00"
        value={workingHours}
        disabled={!canEdit || busy}
        onChange={(e) => setWorkingHours(e.target.value)}
      />
      <Textarea
        label="Site rules"
        rows={4}
        maxLength={SITE_TEXT_MAX}
        hint="One rule per line reads best on a phone."
        value={siteRules}
        disabled={!canEdit || busy}
        onChange={(e) => setSiteRules(e.target.value)}
      />
      <Textarea
        label="Welfare facilities"
        rows={3}
        maxLength={SITE_TEXT_MAX}
        placeholder="e.g. Ground-floor welfare cabin — toilets, hand wash, drinking water and rest area."
        value={welfareFacilities}
        disabled={!canEdit || busy}
        onChange={(e) => setWelfare(e.target.value)}
      />
      <Textarea
        label="Site-specific hazards"
        rows={3}
        maxLength={SITE_TEXT_MAX}
        hint="One hazard per line, e.g. Working at height · MEWPs in use · Live services."
        value={siteHazards}
        disabled={!canEdit || busy}
        onChange={(e) => setHazards(e.target.value)}
      />
      <Textarea
        label="Emergency procedures"
        rows={3}
        maxLength={SITE_TEXT_MAX}
        placeholder="What a worker should do in an emergency (alarm, evacuation, incident reporting)."
        value={emergencyProcedures}
        disabled={!canEdit || busy}
        onChange={(e) => setProcedures(e.target.value)}
      />

      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save site information'}
        </Button>
      )}

      {/* Site map */}
      <div className="space-y-2 rounded-lg border border-line p-3">
        <p className="text-sm font-semibold text-ink">Site map</p>
        {initial.hasSiteMap ? (
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-ink-muted">
              {initial.siteMapFileName ?? 'Uploaded image'}
            </p>
            {canEdit && (
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-danger-600 hover:underline disabled:opacity-50"
                disabled={mapBusy}
                onClick={() => setConfirmRemoveMap(true)}
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
              disabled={mapBusy}
              className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMap(f);
              }}
            />
            <p className="mt-1 text-xs text-ink-subtle">
              {mapBusy ? 'Uploading…' : SITE_MAP_ACCEPT_HINT}
            </p>
          </div>
        )}
      </div>

      {/* Emergency details — read-only (Option A) */}
      <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
        <p className="text-sm font-semibold text-ink">
          Emergency details (shown to workers)
        </p>
        {emergencyRows.length > 0 ? (
          <dl className="space-y-1.5">
            {emergencyRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 text-sm">
                <dt className="text-ink-subtle">{label}</dt>
                <dd className="text-right font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-ink-subtle">
            No emergency details set for this site yet.
          </p>
        )}
        <p className="text-xs text-ink-subtle">
          Managed on the site record.{' '}
          <a
            href={siteEditHref}
            className="font-semibold text-brand-700 hover:underline"
          >
            Edit emergency information →
          </a>
        </p>
      </div>

      {!canEdit && (
        <p className="text-xs text-ink-subtle">
          You don’t have permission to change this site’s information.
        </p>
      )}

      <ConfirmDialog
        open={confirmRemoveMap}
        title="Remove the site map?"
        message="Workers will no longer see a site map until a new one is uploaded."
        confirmLabel={mapBusy ? 'Removing…' : 'Remove'}
        cancelLabel="Cancel"
        busy={mapBusy}
        onConfirm={removeMap}
        onCancel={() => setConfirmRemoveMap(false)}
      />
    </div>
  );
}
