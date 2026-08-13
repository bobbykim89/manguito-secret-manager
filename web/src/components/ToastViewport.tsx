import { useContext } from "react";

import { ToastContext } from "./ToastProvider";

/**
 * Renders whatever ToastProvider currently holds. Mounted once, near the
 * root, so it sits above every route rather than being duplicated per
 * page.
 */
export function ToastViewport() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("ToastViewport must be used within a ToastProvider");
  }

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2">
      {context.toasts.map((toast) => (
        <div key={toast.id} role="status" className="rounded border bg-surface px-4 py-2 text-sm shadow">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
