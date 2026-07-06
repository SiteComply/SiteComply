/**
 * Shown at the top of an admin settings screen when the signed-in admin's role
 * is read-only (VIEWER). The mutation controls are also disabled, but this makes
 * the reason explicit rather than letting a save silently 403.
 */
export function ReadOnlyBanner() {
  return (
    <div className="rounded-xl border border-hivis-400 bg-surface-sunken px-4 py-3 text-sm text-ink">
      <span className="font-semibold text-hivis-600">Read-only.</span> Your admin role can view
      these settings but not change them. Ask an Owner or Admin to make updates.
    </div>
  );
}
