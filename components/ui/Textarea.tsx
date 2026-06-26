import { TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

/** Labelled multi-line text input, matching TextField's styling and a11y. */
export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, id, className, rows = 4, ...props }, ref) => {
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
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full rounded-xl border bg-surface px-4 py-3 text-base text-ink',
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

Textarea.displayName = 'Textarea';
