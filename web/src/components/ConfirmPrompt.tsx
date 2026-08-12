/**
 * The confirming half of a two step confirm, shared by every row that has one.
 *
 * Only this branch is shared. Each row keeps its own flag, its own mutation
 * and its own non confirming branch, because those differ: a bucket row
 * disables confirm on a stale secret_count, a secret row sits beside Reveal
 * and Copy.
 *
 * The labels are optional because cancel is never disabled: a row that cannot
 * confirm must still be escapable.
 */
export function ConfirmPrompt({
  prompt,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: {
  prompt: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{prompt}</span>
      <button
        type="button"
        aria-label={confirmLabel}
        onClick={onConfirm}
        disabled={confirmDisabled}
        className="rounded border px-2 py-1"
      >
        Yes
      </button>
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="rounded border px-2 py-1"
      >
        Cancel
      </button>
    </div>
  );
}
