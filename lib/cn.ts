/**
 * Tiny class-name joiner. Filters out falsey values so conditional classes read
 * cleanly at the call site. Deliberately dependency-free for v1; swap for
 * `clsx` + `tailwind-merge` later if conflicting utilities become a problem.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
