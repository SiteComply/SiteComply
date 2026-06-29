'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * App-wide, non-intrusive notification toasts.
 *
 * A single {@link ToastProvider} is mounted in the root layout, so toasts
 * persist across client-side navigations (e.g. a "Site created" toast raised
 * just before `router.push` still shows on the destination page). Toasts render
 * in a fixed overlay pinned to the top of the screen — they never affect page
 * layout — and dismiss themselves after a few seconds.
 *
 * Success uses the subtle safety-green palette; errors use danger-red. Both are
 * the same tokens used elsewhere for compliance status, so feedback reads
 * consistently across the app.
 */

type ToastVariant = 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastApi {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = (idRef.current += 1);
      setToasts((list) => [...list, { id, message, variant }]);
    },
    [],
  );

  const success = useCallback(
    (message: string) => show(message, 'success'),
    [show],
  );
  const error = useCallback(
    (message: string) => show(message, 'error'),
    [show],
  );

  return (
    <ToastContext.Provider value={{ show, success, error, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Access the toast API. Must be used within a {@link ToastProvider}. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    // Fixed overlay: never participates in document flow, so layout is untouched.
    // `pointer-events-none` lets clicks pass through the gaps between toasts.
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-3"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  // Each toast clears itself; reduced-motion users still get the timed dismiss.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const isSuccess = toast.variant === 'success';

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-card',
        isSuccess
          ? 'border-safe-500 bg-safe-50 text-safe-700'
          : 'border-danger-500 bg-danger-50 text-danger-700',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
          isSuccess ? 'bg-safe-600' : 'bg-danger-600',
        )}
      >
        {isSuccess ? '✓' : '!'}
      </span>
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className={cn(
          'shrink-0 rounded-md px-1 text-base leading-none opacity-60 hover:opacity-100',
          isSuccess ? 'text-safe-700' : 'text-danger-700',
        )}
      >
        ✕
      </button>
    </div>
  );
}
