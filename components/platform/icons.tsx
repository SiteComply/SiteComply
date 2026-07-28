import { ReactNode } from 'react';

/**
 * Minimal line icons for the Platform area (nav + dashboard cards). They inherit
 * their colour from `currentColor` so they pick up whatever accent wraps them.
 */
export type PlatformIconName =
  | 'grid'
  | 'pin'
  | 'clipboard'
  | 'chart'
  | 'doc'
  | 'shield'
  | 'bolt'
  | 'hardhat'
  | 'permit'
  | 'bell';

const PATHS: Record<PlatformIconName, ReactNode> = {
  permit: (
    <>
      <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="m9 14 2 2 4-4.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z" />
      <path d="m9.5 13 2 2 3.5-4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V11" />
      <path d="M10 20V4" />
      <path d="M16 20v-6" />
      <path d="M3 20h18" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 16.5h6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z" />
      <path d="m9.5 11.5 2 2 3.5-3.5" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  hardhat: (
    <>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="M10 9V5.5a1.5 1.5 0 0 1 3 0V9" />
      <path d="M3 16h18" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10.5 20a1.8 1.8 0 0 0 3 0" />
    </>
  ),
};

export function PlatformIcon({
  name,
  className = 'h-5 w-5',
}: {
  name: PlatformIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
