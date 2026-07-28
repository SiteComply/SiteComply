'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatMetres } from '@/services/geo/geoConstants';

/**
 * GPS Location Check (SC-007) — the mockup's "Location Check" step. Shown before a
 * check-in is recorded on sites that require GPS validation. It obtains the
 * worker's location, asks the server to classify it (verified / outside / poor /
 * unavailable), and only enables "Confirm check in" when the worker may proceed
 * (inside the radius, a manager override exists, or GPS is unavailable and the
 * site policy allows a flagged check-in).
 *
 * This is advisory: the actual check-in is re-validated server-side. On a site
 * without GPS validation it resolves immediately (onConfirmed(null)).
 */

export type ConfirmLocation =
  | { lat: number; lng: number; accuracyM: number }
  | { gpsUnavailable: true }
  | null;

type Phase = 'init' | 'locating' | 'result';
type State =
  | 'verified'
  | 'outside'
  | 'poor_accuracy'
  | 'unavailable'
  | 'denied';

interface EvalResponse {
  ok: boolean;
  required?: boolean;
  state?: 'verified' | 'outside' | 'poor_accuracy' | 'unavailable' | 'off';
  distanceM?: number | null;
  accuracyM?: number | null;
  radiusM?: number;
  hasOverride?: boolean;
  allowUnavailable?: boolean;
}

export function LocationCheck({
  siteId,
  siteName,
  onConfirmed,
  busy = false,
}: {
  siteId: string;
  siteName: string;
  onConfirmed: (location: ConfirmLocation) => void;
  busy?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('init');
  const [state, setState] = useState<State>('unavailable');
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [radiusM, setRadiusM] = useState<number>(100);
  const [hasOverride, setHasOverride] = useState(false);
  const [allowUnavailable, setAllowUnavailable] = useState(false);
  const [lastFix, setLastFix] = useState<ConfirmLocation>({
    gpsUnavailable: true,
  });

  const classify = useCallback(
    async (location: unknown): Promise<EvalResponse> => {
      const res = await fetch('/api/worker/location-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, location }),
      });
      return (await res.json()) as EvalResponse;
    },
    [siteId],
  );

  const applyEval = useCallback((data: EvalResponse) => {
    setRadiusM(data.radiusM ?? 100);
    setDistanceM(data.distanceM ?? null);
    setHasOverride(Boolean(data.hasOverride));
    setAllowUnavailable(Boolean(data.allowUnavailable));
    setState((data.state as State) ?? 'unavailable');
    setPhase('result');
  }, []);

  const requestLocation = useCallback(() => {
    setPhase('locating');
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      classify({ gpsUnavailable: true }).then((d) => {
        setLastFix({ gpsUnavailable: true });
        applyEval(d);
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        };
        setLastFix(fix);
        applyEval(await classify(fix));
      },
      async (err) => {
        // 1 = permission denied, 2 = position unavailable, 3 = timeout
        setLastFix({ gpsUnavailable: true });
        const d = await classify({ gpsUnavailable: true });
        applyEval(d);
        if (err.code === 1) setState('denied');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, [classify, applyEval]);

  // On mount, learn whether GPS is required for this site (without prompting for
  // location on sites that don't use it).
  useEffect(() => {
    let cancelled = false;
    classify({ gpsUnavailable: true }).then((d) => {
      if (cancelled) return;
      if (!d.required) {
        onConfirmed(null);
        return;
      }
      requestLocation();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canConfirm =
    state === 'verified' ||
    hasOverride ||
    (state === 'unavailable' && allowUnavailable);

  if (phase !== 'result') {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-500" />
        <p className="text-sm text-ink-muted">Checking your location…</p>
      </div>
    );
  }

  const good = state === 'verified';

  return (
    <div className="flex min-h-[50vh] flex-col">
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border p-5 text-center',
          good
            ? 'border-safe-500/40 bg-safe-50'
            : 'border-danger-500/40 bg-danger-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full text-white',
            good ? 'bg-safe-600' : 'bg-danger-600',
          )}
        >
          {good ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          )}
        </span>
        <h1 className="text-2xl font-bold text-ink">
          {good
            ? 'Location verified'
            : state === 'outside'
              ? 'Outside site boundary'
              : state === 'poor_accuracy'
                ? 'Couldn’t pin your location'
                : state === 'denied'
                  ? 'Location access is off'
                  : 'Location unavailable'}
        </h1>
        <p className="max-w-sm text-sm text-ink-muted">
          {good
            ? `You are within the allowed range of ${siteName}.`
            : state === 'outside'
              ? `You are currently outside the allowed check-in range for ${siteName}.`
              : state === 'poor_accuracy'
                ? 'Your GPS signal is too weak to confirm you’re on site. Move to an open area and try again.'
                : state === 'denied'
                  ? 'Turn on location access for your browser, then refresh.'
                  : 'We couldn’t get your location.'}
        </p>
      </div>

      {(state === 'verified' || state === 'outside') && distanceM != null && (
        <dl className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <Row
            label="Your distance from site"
            value={formatMetres(distanceM)}
            tone={good ? 'good' : 'bad'}
          />
          <Row label="Allowed check-in range" value={formatMetres(radiusM)} />
        </dl>
      )}

      {hasOverride && !good && (
        <p className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Your site manager has authorised an off-site check-in for you. You may
          continue.
        </p>
      )}

      {good ? (
        <div className="mt-5 rounded-xl border border-safe-500/40 bg-safe-50 px-4 py-3 text-sm text-safe-700">
          <p className="font-semibold">You may now check in</p>
          <p className="text-safe-700/80">
            Your attendance will be recorded with your location and time.
          </p>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-hivis-500 bg-hivis-400/15 px-4 py-3 text-sm text-ink">
          <p className="font-semibold">Need help?</p>
          <p className="text-ink-muted">
            If you believe this is an error or need to check in remotely,
            contact your site manager to authorise it.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {canConfirm ? (
          <Button
            size="lg"
            fullWidth
            disabled={busy}
            onClick={() => onConfirmed(lastFix)}
          >
            {busy ? 'Checking you in…' : 'Confirm check in'}
          </Button>
        ) : (
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            onClick={requestLocation}
          >
            Refresh location
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          'text-sm font-bold tabular-nums',
          tone === 'good'
            ? 'text-safe-700'
            : tone === 'bad'
              ? 'text-danger-600'
              : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
