'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { XIcon } from '@/components/icons';
import {
  pushToast,
  removeToast,
  TOAST_DURATION_MS,
  type Toast,
  type ToastAction,
} from '@/lib/toast-queue';

interface ToastApi {
  /** Shows a confirmation. Returns its id, so a caller can dismiss it early. */
  show: (message: string, action?: ToastAction) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Confirmations after actions. Lives in the app shell so messages survive navigation. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => removeToast(list, id)), []);
  const show = useCallback((message: string, action?: ToastAction) => {
    const id = nextId.current++;
    setToasts((list) => pushToast(list, { id, message, action }));
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Messages"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} dismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside ToastProvider');
  return api;
}

/** Dismisses itself after a while; hovering or focusing it pauses the countdown. */
function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  const { id } = toast;
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (paused || busy) return;
    const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [paused, busy, dismiss, id]);

  async function runAction() {
    if (!toast.action || busy) return;
    setBusy(true);
    try {
      await toast.action.onClick();
    } finally {
      dismiss(id);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex max-w-md items-center gap-3 rounded-control bg-surface-inverse py-2 pr-1.5 pl-3.5 text-label text-fg-on-inverse shadow-overlay"
    >
      <span className="min-w-0 flex-1">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => void runAction()}
          disabled={busy}
          aria-busy={busy || undefined}
          className="rounded-chip px-2 py-1 font-semibold text-mint transition-colors hover:bg-fg-on-inverse/10 disabled:opacity-60"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => dismiss(id)}
        aria-label="Dismiss message"
        className="rounded-chip p-1 text-fg-on-inverse-muted transition-colors hover:text-fg-on-inverse"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
