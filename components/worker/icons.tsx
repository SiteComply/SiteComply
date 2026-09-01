import { ReactNode } from 'react';

/**
 * Line icons for the Worker Dashboard (SC-003). Same construction as the
 * Platform set (`components/platform/icons`): 24×24, stroked, inheriting
 * `currentColor` so each card's accent colour flows through.
 */
export type WorkerIconName =
  | 'grid'
  | 'building'
  | 'permit'
  | 'rams'
  | 'doc'
  | 'megaphone'
  | 'alert'
  | 'firstaid'
  | 'fire'
  | 'phone'
  | 'clipboard'
  | 'message'
  | 'logout'
  | 'user'
  | 'shield'
  | 'clock'
  | 'chevronDown';

const PATHS: Record<WorkerIconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V6a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15" />
      <path d="M13 10h6a1 1 0 0 1 1 1v10" />
      <path d="M3 21h18" />
      <path d="M7 9h2M7 13h2M7 17h2M16 14h1M16 17h1" />
    </>
  ),
  permit: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z" />
      <path d="m9 13 2 2 4-4.5" />
    </>
  ),
  rams: (
    <>
      <path d="M12 3 5 6v5c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z" />
      <path d="M12 9v4" />
      <path d="M12 16h.01" />
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
  megaphone: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5a1 1 0 0 0 1.7-.7V7.2a1 1 0 0 0-1.7-.7L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15 8a4 4 0 0 1 0 8" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  firstaid: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M9 6V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6" />
      <path d="M12 10v5M9.5 12.5h5" />
    </>
  ),
  fire: (
    <>
      <path d="M12 3s4.5 3.8 4.5 8a4.5 4.5 0 0 1-9 0c0-1.6.8-2.9 1.6-3.8.2 1.3.9 2.1 1.7 2.1 1 0 1.5-1 1.2-2.4A6.7 6.7 0 0 0 12 3z" />
      <path d="M6 21h12" />
    </>
  ),
  phone: (
    <path d="M6.6 3.5a1 1 0 0 1 1 .6l1.3 3a1 1 0 0 1-.3 1.2L7.3 9.3a12 12 0 0 0 5.4 5.4l1-1.3a1 1 0 0 1 1.2-.3l3 1.3a1 1 0 0 1 .6 1v2.4a1.6 1.6 0 0 1-1.8 1.6C9.3 18.8 5.2 14.7 4.4 5.3A1.6 1.6 0 0 1 6 3.5z" />
  ),
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z" />
      <path d="M9 12h6M9 15.5h4" />
    </>
  ),
  message: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z" />
      <path d="M8.5 10h.01M12 10h.01M15.5 10h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15 8.5 19 12l-4 3.5" />
      <path d="M19 12H9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3z" />
      <path d="m9.5 11.5 2 2 3.5-3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
};

export function WorkerIcon({
  name,
  className = 'h-5 w-5',
}: {
  name: WorkerIconName;
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
