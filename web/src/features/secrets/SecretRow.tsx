import { useState } from "react";

import { Alert } from "../../components/Alert";
import { ConfirmPrompt } from "../../components/ConfirmPrompt";
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
 * One secret, owning its reveal flag, its confirm flag and its copy notice.
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

  return (
    <li aria-label={secret.key_name} className="flex flex-col gap-2 border-b py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="font-medium">{secret.key_name}</span>
          <time dateTime={secret.updated_at} className="ml-3 text-sm text-slate-500">
            {new Date(secret.updated_at).toLocaleDateString()}
          </time>
        </div>

        {confirming ? (
          <ConfirmPrompt
            prompt="Delete this secret?"
            confirmLabel={`Confirm deleting ${secret.key_name}`}
            cancelLabel={`Cancel deleting ${secret.key_name}`}
            onConfirm={() => remove.mutate(secret.key_name)}
            onCancel={() => setConfirming(false)}
            confirmDisabled={remove.isPending}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              aria-label={`${revealed ? "Hide" : "Reveal"} ${secret.key_name}`}
              onClick={toggleReveal}
              className="rounded border px-2 py-1"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            {plaintext !== undefined && (
              <button
                type="button"
                aria-label={`Copy ${secret.key_name}`}
                onClick={() => void copy(plaintext)}
                className="rounded border px-2 py-1"
              >
                Copy
              </button>
            )}
            <button
              type="button"
              aria-label={`Delete ${secret.key_name}`}
              onClick={() => setConfirming(true)}
              className="rounded border px-2 py-1"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm">
        {plaintext ?? MASK}
      </code>

      {revealed && value.isFetching && (
        <p role="status" className="text-sm text-slate-600">
          Revealing
        </p>
      )}

      {/* The server has nothing to say here: SP4 made decrypt failures a 500
          carrying no detail. A fixed sentence keeps the error path from being
          a channel. */}
      {revealed && value.isError && <Alert variant="inline">Could not reveal this secret.</Alert>}

      {copyState === "copied" && (
        <p role="status" className="text-sm text-slate-600">
          Copied
        </p>
      )}
      {copyState === "failed" && <Alert variant="inline">Could not copy to the clipboard.</Alert>}

      {remove.isError && <Alert variant="inline">{remove.error.message}</Alert>}
    </li>
  );
}
