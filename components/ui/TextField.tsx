import { InputHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Labelled text input tuned for the worker flow: large touch target, big legible
 * text, clear error and helper messaging, and proper label association for
 * screen readers. Used across the OTP and identity screens.
 */
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const describedBy = error
      ? `${fieldId}-error`
      : hint
        ? `${fieldId}-hint`
        : undefined;

    return (
      <div className="space-y-1.5">
        <label
          htmlFor={fieldId}
          className="block text-sm font-semibold text-ink"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'touch-target w-full rounded-xl border bg-surface px-4 py-3 text-lg text-ink',
            'placeholder:text-ink-subtle',
            error ? 'border-danger-500' : 'border-line',
            className,
          )}
          {...props}
        />
        {error ? (
          <p
            id={`${fieldId}-error`}
            className="text-sm font-medium text-danger-600"
          >
            {error}
          </p>
        ) : hint ? (
          <p id={`${fieldId}-hint`} className="text-sm text-ink-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);

TextField.displayName = 'TextField';
