import { cn } from '@/lib/cn';

/**
 * SiteComply logo. A placeholder wordmark for v1 — a rounded "shield" mark
 * carrying a compliance tick over a hi-vis accent stripe, set alongside the
 * SiteComply wordmark. Swap the SVG for final brand artwork when supplied.
 */
export function Logo({
  className,
  showWordmark = true,
  markSize = 36,
}: {
  className?: string;
  showWordmark?: boolean;
  markSize?: number;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={markSize} />
      {showWordmark && (
        <span className="text-xl font-bold tracking-tight text-ink">
          Site<span className="text-brand-600">Comply</span>
        </span>
      )}
    </span>
  );
}

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="SiteComply"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield body */}
      <path
        d="M24 3 6 9v13c0 11.2 7.5 18.7 18 23 10.5-4.3 18-11.8 18-23V9L24 3Z"
        className="fill-brand-700"
      />
      {/* Hi-vis accent stripe */}
      <path
        d="M6 22h36c0 1.7-.16 3.3-.46 4.8H6.46C6.16 25.3 6 23.7 6 22Z"
        className="fill-hivis-500"
      />
      {/* Compliance tick */}
      <path
        d="m16.5 24.2 4.7 4.8 10.3-10.6"
        stroke="white"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
