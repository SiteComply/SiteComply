'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered view "live" by calling router.refresh() on an
 * interval (and on tab re-focus). Used by the On Site Now view so check-ins and
 * check-outs appear without a manual reload. Pausable to avoid needless load.
 */
export function AutoRefresh({
  intervalSeconds = 15,
  updatedLabel,
}: {
  intervalSeconds?: number;
  updatedLabel: string;
}) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => router.refresh(), intervalSeconds * 1000);
    const onFocus = () => router.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [auto, intervalSeconds, router]);

  return (
    <div className="flex items-center gap-3 text-sm text-ink-subtle">
      <span>Updated {updatedLabel}</span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="font-semibold text-brand-700"
      >
        Refresh
      </button>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
        />
        Auto
      </label>
    </div>
  );
}
