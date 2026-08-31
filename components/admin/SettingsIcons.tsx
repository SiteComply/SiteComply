import { ReactNode } from 'react';

/**
 * Line icons for the Admin → Settings index. Same authoring rules as
 * `components/platform/icons.tsx` — 24px box, `currentColor`, no fills — but a
 * separate set on purpose: that file is documented as the Platform area's, and
 * Admin has never imported from it. Four icons used on one page did not seem
 * worth a cross-area dependency.
 *
 * Deliberately no tinted tile behind them. The tile is what made the previous
 * card layout read as a dashboard widget; here the icon's only job is to give
 * the eye a fixed rail to run down.
 */
export type SettingsIconName =
  | 'plug'
  | 'shield'
  | 'bell'
  | 'building'
  | 'chevron';

const PATHS: Record<SettingsIconName, ReactNode> = {
  plug: (
    <>
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z" />
      <path d="M12 17v4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M12 11.5v2.5" />
      <circle cx="12" cy="9.6" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  building: (
    <>
      <path d="M4 20V6l7-3v17" />
      <path d="M11 9h6a2 2 0 0 1 2 2v9" />
      <path d="M3 20h18" />
      <path d="M7 8.5h1" />
      <path d="M7 12.5h1" />
      <path d="M14.5 13h1" />
      <path d="M14.5 16.5h1" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
};

export function SettingsIcon({
  name,
  className = 'h-5 w-5',
  // The chevron is an affordance rather than an identity, and reads as a hairline
  // at 1.75 next to 20px icons; it is the one that gets a heavier stroke.
  strokeWidth = 1.75,
}: {
  name: SettingsIconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
