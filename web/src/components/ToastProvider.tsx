/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "info";

export type ToastEntry = { id: number; message: string; tone: ToastTone };

type ToastContextValue = {
  toasts: ToastEntry[];
  notify: (message: string, tone?: ToastTone) => void;
};

const DISMISS_AFTER_MS = 4000;

export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Success confirmations only. Errors keep surfacing inline via Alert, next
 * to whatever failed. ADR 003's "errors surface where the thing that
 * failed is" is unchanged; this exists for confirmations that have nowhere
 * inline to live once the modal that triggered them has already closed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      const timer = setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      for (const timer of timerMap.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const value = useMemo(() => ({ toasts, notify }), [toasts, notify]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
