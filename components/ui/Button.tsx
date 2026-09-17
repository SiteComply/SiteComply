import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
type Size = 'md' | 'lg';

/**
 * Base button. Defaults are tuned for the worker flow: large hit areas, bold
 * labels and clear states for outdoor, gloved, one-handed use. `size="lg"` is
 * the recommended size for primary worker actions.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold ' +
  'transition-all duration-200 ease-out disabled:cursor-not-allowed ' +
  'disabled:opacity-50 disabled:shadow-none touch-target';

const sizes: Record<Size, string> = {
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3.5 text-base',
};

const variants: Record<Variant, string> = {
  // Primary — solid logo green (#39B54A) with a soft shadow that lifts on hover.
  primary:
    'bg-safe-500 text-white shadow-sm shadow-safe-600/20 hover:bg-safe-600 ' +
    'hover:shadow-md hover:shadow-safe-600/25 active:bg-safe-700 active:shadow-sm',
  // Secondary — white fill, logo-blue (#00AEEF) outline; subtle lift, deeper on hover.
  secondary:
    'bg-surface text-brand-700 border-2 border-brand-500 shadow-sm ' +
    'hover:bg-brand-50 hover:border-brand-600 hover:shadow-md active:bg-brand-100 active:shadow-sm',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-sunken',
  danger:
    'bg-danger-600 text-white shadow-sm hover:bg-danger-700 hover:shadow-md',
  // Brand — solid logo light-blue (#00AEEF). Distinct from the green primary and
  // the outlined secondary; used for the Platform Login journey.
  brand:
    'bg-brand-500 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-600 ' +
    'hover:shadow-md hover:shadow-brand-600/25 active:bg-brand-700 active:shadow-sm',
};

/**
 * The class composition behind a Button, exposed so a LINK can be styled as one.
 *
 * Some actions are navigations, not button presses — the induction record opens
 * a PDF in a new tab, which needs a real anchor to work. Copying the class
 * strings into that anchor would have meant two definitions of "secondary" that
 * drift apart the first time this file changes. There is one definition, used by
 * both.
 *
 * Reach for this only where an anchor is genuinely required. A control that acts
 * on the page should still be a <button>.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'lg',
  fullWidth,
  className,
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(base, sizes[size], variants[variant], fullWidth && 'w-full', className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'lg', fullWidth, className, type, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
