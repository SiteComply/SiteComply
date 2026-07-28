'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { captureLocation } from '@/lib/clientGeolocation';
import {
  RADIUS_PRESETS_M,
  RADIUS_MIN_M,
  RADIUS_MAX_M,
  DEFAULT_CHECKIN_RADIUS_M,
} from '@/services/geo/geoConstants';

export interface GpsConfigInitial {
  gpsCheckInEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  checkInRadiusM: number | null;
  gpsUnavailablePolicy: 'BLOCK' | 'ALLOW_FLAGGED';
}

export interface WorkerOption {
  workerId: string;
  fullName: string;
  company: string;
}

export interface OverrideView {
  id: string;
  workerName: string;
  company: string;
  reason: string;
  grantedByName: string | null;
  createdAtLabel: string;
  expiresAtLabel: string | null;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

/**
 * Site Details → Check-in location (SC-007). Enable GPS validation, set the site
 * check-in point (with "use my current location"), the radius and the
 * unavailable policy, and grant/revoke manager overrides that let a named worker
 * check in from off-site (a reason is mandatory for audit).
 */
export function GpsCheckInConfig({
  siteId,
  canEdit,
  initial,
  workers,
  overrides,
}: {
  siteId: string;
  canEdit: boolean;
  initial: GpsConfigInitial;
  workers: WorkerOption[];
  overrides: OverrideView[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [enabled, setEnabled] = useState(initial.gpsCheckInEnabled);
  const [lat, setLat] = useState(initial.latitude?.toString() ?? '');
  const [lng, setLng] = useState(initial.longitude?.toString() ?? '');
  const [radius, setRadius] = useState(
    initial.checkInRadiusM ?? DEFAULT_CHECKIN_RADIUS_M,
  );
  const [policy, setPolicy] = useState(initial.gpsUnavailablePolicy);
  const [busy, setBusy] = useState(false);

  // Override grant form.
  const [ovWorker, setOvWorker] = useState('');
  const [ovReason, setOvReason] = useState('');
  const [ovDays, setOvDays] = useState('1');
  const [ovBusy, setOvBusy] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/platform/sites/${siteId}/gps`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, error: data.error as string | undefined };
  }

  async function useCurrentLocation() {
    setBusy(true);
    try {
      const loc = await captureLocation({ timeoutMs: 12000 });
      if ('gpsUnavailable' in loc) {
        toast.error(
          'Could not get your location. Allow location access and try again.',
        );
        return;
      }
      setLat(loc.lat.toFixed(6));
      setLng(loc.lng.toFixed(6));
      toast.success('Location set from your current position.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const latNum = lat.trim() === '' ? null : Number(lat);
      const lngNum = lng.trim() === '' ? null : Number(lng);
      const r = await post({
        action: 'config',
        config: {
          gpsCheckInEnabled: enabled,
          latitude: latNum,
          longitude: lngNum,
          checkInRadiusM: radius,
          gpsUnavailablePolicy: policy,
        },
      });
      if (!r.ok) {
        toast.error(r.error ?? 'Could not save.');
        return;
      }
      toast.success('Check-in location saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    if (!ovWorker) {
      toast.error('Choose a worker.');
      return;
    }
    if (ovReason.trim().length < 3) {
      toast.error('A reason is required.');
      return;
    }
    setOvBusy(true);
    try {
      const r = await post({
        action: 'grantOverride',
        workerId: ovWorker,
        reason: ovReason,
        days: Number(ovDays) || null,
      });
      if (!r.ok) {
        toast.error(r.error ?? 'Could not grant override.');
        return;
      }
      toast.success('Off-site check-in authorised.');
      setOvWorker('');
      setOvReason('');
      router.refresh();
    } finally {
      setOvBusy(false);
    }
  }

  async function revoke(id: string) {
    setOvBusy(true);
    try {
      const r = await post({ action: 'revokeOverride', overrideId: id });
      if (!r.ok) {
        toast.error(r.error ?? 'Could not revoke.');
        return;
      }
      toast.success('Override revoked.');
      setRevokeId(null);
      router.refresh();
    } finally {
      setOvBusy(false);
    }
  }

  const activeOverrides = overrides.filter((o) => o.status === 'active');

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Require workers to be within a set distance of the site to check in. Off
        by default — set the site’s check-in point and turn it on.
      </p>

      <div className="space-y-3 rounded-lg border border-line p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              Require GPS check-in
            </p>
            <p className="text-xs text-ink-subtle">
              Needs a check-in point set below.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Require GPS check-in"
            disabled={!canEdit || busy}
            onClick={() => setEnabled((v) => !v)}
            className={cn(
              'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              enabled ? 'bg-safe-500' : 'bg-line',
              !canEdit || busy
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Latitude"
            inputMode="decimal"
            placeholder="51.5074"
            value={lat}
            disabled={!canEdit || busy}
            onChange={(e) => setLat(e.target.value)}
          />
          <TextField
            label="Longitude"
            inputMode="decimal"
            placeholder="-0.1278"
            value={lng}
            disabled={!canEdit || busy}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
        {canEdit && (
          <button
            type="button"
            className="text-sm font-semibold text-brand-700 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={useCurrentLocation}
          >
            Use my current location
          </button>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink">
            Check-in radius
          </span>
          <select
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:opacity-60"
            value={
              RADIUS_PRESETS_M.includes(radius) ? String(radius) : 'custom'
            }
            disabled={!canEdit || busy}
            onChange={(e) => {
              if (e.target.value !== 'custom')
                setRadius(Number(e.target.value));
            }}
          >
            {RADIUS_PRESETS_M.map((m) => (
              <option key={m} value={m}>
                {m} m
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          <input
            type="number"
            min={RADIUS_MIN_M}
            max={RADIUS_MAX_M}
            className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:opacity-60"
            value={radius}
            disabled={!canEdit || busy}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
          <span className="text-sm text-ink-subtle">metres</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink">
            If GPS is unavailable
          </span>
          <select
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:opacity-60"
            value={policy}
            disabled={!canEdit || busy}
            onChange={(e) =>
              setPolicy(e.target.value as 'BLOCK' | 'ALLOW_FLAGGED')
            }
          >
            <option value="BLOCK">Block check-in (recommended)</option>
            <option value="ALLOW_FLAGGED">Allow, flagged for review</option>
          </select>
        </div>

        {canEdit && (
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save check-in location'}
          </Button>
        )}
      </div>

      {/* Overrides */}
      <div className="space-y-3 rounded-lg border border-line p-3">
        <p className="text-sm font-semibold text-ink">
          Off-site check-in overrides
        </p>
        <p className="text-xs text-ink-subtle">
          Authorise a worker to check in from outside the radius (e.g. a genuine
          GPS problem). A reason is required and recorded for audit.
        </p>

        {activeOverrides.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {activeOverrides.map((o) => (
              <li
                key={o.id}
                className="flex items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {o.workerName}
                  </p>
                  <p className="text-xs text-ink-muted">“{o.reason}”</p>
                  <p className="text-xs text-ink-subtle">
                    Granted {o.createdAtLabel}
                    {o.grantedByName ? ` by ${o.grantedByName}` : ''}
                    {o.expiresAtLabel ? ` · expires ${o.expiresAtLabel}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className="shrink-0 text-sm font-semibold text-danger-600 hover:underline disabled:opacity-50"
                    disabled={ovBusy}
                    onClick={() => setRevokeId(o.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
            <select
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              value={ovWorker}
              onChange={(e) => setOvWorker(e.target.value)}
            >
              <option value="">Select a worker…</option>
              {workers.map((w) => (
                <option key={w.workerId} value={w.workerId}>
                  {w.fullName} — {w.company}
                </option>
              ))}
            </select>
            <TextField
              label="Reason (required)"
              placeholder="e.g. GPS not working on worker's phone — verified on site by phone"
              value={ovReason}
              onChange={(e) => setOvReason(e.target.value)}
            />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-subtle">Expires in</span>
              <input
                type="number"
                min={0}
                className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                value={ovDays}
                onChange={(e) => setOvDays(e.target.value)}
              />
              <span className="text-ink-subtle">
                days (0 = no expiry; single use)
              </span>
            </div>
            <Button onClick={grant} disabled={ovBusy}>
              {ovBusy ? 'Working…' : 'Authorise off-site check-in'}
            </Button>
          </div>
        )}

        {workers.length === 0 && (
          <p className="text-xs text-ink-subtle">
            Overrides can be granted once workers have checked in to this site.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={revokeId !== null}
        title="Revoke this override?"
        message="The worker will no longer be able to check in from off-site."
        confirmLabel={ovBusy ? 'Revoking…' : 'Revoke'}
        cancelLabel="Cancel"
        busy={ovBusy}
        onConfirm={() => revokeId && revoke(revokeId)}
        onCancel={() => setRevokeId(null)}
      />
    </div>
  );
}
