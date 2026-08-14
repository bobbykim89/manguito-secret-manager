import { useContext } from "react";

import { ToastContext } from "./ToastProvider";

/**
 * The narrow surface most callers need: fire a toast without also pulling
 * in the current toast list, which only ToastViewport itself renders.
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context.notify;
}
