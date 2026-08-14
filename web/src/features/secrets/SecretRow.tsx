import { useState } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";
import { useDeleteSecret, useSecretValue, type Secret } from "./useSecrets";

/**
 * A constant, never "•".repeat(value.length).
 *
 * Before a first reveal the client has no value, so a length derived mask is
 * impossible by accident. After a reveal and a hide the value is in the cache,
 * and that one natural looking line would publish exactly the length invariant
 * 7 exists to withhold.
 */
const MASK = "••••••••";

/**
 * One secret, owning its reveal flag, its dialog flag and its copy notice.
 *
 * All three are ephemeral: leaving the bucket and returning hides everything
 * again, which for a secret manager is the safer default and is why no store
 * arrives with this sub-project. See ADR 003 A9.
 */
export function SecretRow({ bucket, secret }: { bucket: string; secret: Secret }) {
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const value = useSecretValue(bucket, secret.key_name, revealed);
  const remove = useDeleteSecret(bucket);
  const notify = useToast();

  const plaintext = revealed ? value.data?.value : undefined;

  function toggleReveal() {
    setRevealed((was) => !was);
    setCopyState("idle");
  }

  async function copy(text: string) {
    // Awaited in a try/catch: writeText rejects on a denied permission or a
    // non secure context, and an unhandled rejection is an stderr line.
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function onConfirmed() {
    remove.mutate(secret.key_name, {
      onSuccess: () => {
        setConfirming(false);
        notify(`Secret ${secret.key_name} deleted`);
      },
    });
  }

  return (
    <li aria-label={secret.key_name} className="flex flex-col gap-2 border-b border-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold">{secret.key_name}</span>
          <time dateTime={secret.updated_at} className="text-xs text-text-muted">
            {new Date(secret.updated_at).toLocaleDateString()}
          </time>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            aria-label={`${revealed ? "Hide" : "Reveal"} ${secret.key_name}`}
            onClick={toggleReveal}
            className="rounded-md border border-border px-3 py-1 text-sm"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
          {plaintext !== undefined && (
            <button
              type="button"
              aria-label={`Copy ${secret.key_name}`}
              onClick={() => void copy(plaintext)}
              className="rounded-md border border-border px-3 py-1 text-sm"
            >
              Copy
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete ${secret.key_name}`}
            onClick={() => {
              // Cleared on open so a previous failure's message does not greet
              // the next attempt.
              remove.reset();
              setConfirming(true);
            }}
            className="rounded-md px-2 py-1 text-sm text-accent"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Styled as an input, following the mockup. The wider tracking applies
          to the mask only: it spaces the dots out without changing how many
          there are. */}
      <code
        className={`break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] ${
          plaintext === undefined ? "tracking-[3px]" : ""
        }`}
      >
        {plaintext ?? MASK}
      </code>

      {revealed && value.isFetching && (
        <p role="status" className="text-sm text-text-muted">
          Revealing
        </p>
      )}

      {/* The server has nothing to say here: SP4 made decrypt failures a 500
          carrying no detail. A fixed sentence keeps the error path from being
          a channel. */}
      {revealed && value.isError && <Alert variant="inline">Could not reveal this secret.</Alert>}

      {copyState === "copied" && (
        <p role="status" className="text-sm text-text-muted">
          Copied
        </p>
      )}
      {copyState === "failed" && <Alert variant="inline">Could not copy to the clipboard.</Alert>}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Delete secret?">
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            {secret.key_name} will be deleted. This cannot be undone.
          </p>

          {/* The dialog stays open on failure, so the error belongs here
              rather than behind it on the row. */}
          {remove.isError && <Alert variant="inline">{remove.error.message}</Alert>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmed}
              disabled={remove.isPending}
              className="rounded-md bg-danger px-4 py-2 font-sans text-sm font-semibold text-bg disabled:opacity-50"
            >
              Delete secret
            </button>
          </div>
        </div>
      </Modal>
    </li>
  );
}
