import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
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
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50 touch-target';

const sizes: Record<Size, string> = {
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3.5 text-base',
};

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary:
    'bg-surface text-brand-700 border border-brand-200 hover:bg-brand-50 active:bg-brand-100',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-sunken',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'lg', fullWidth, className, type, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        base,
        sizes[size],
        variants[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
