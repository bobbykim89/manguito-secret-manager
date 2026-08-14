import { useEffect, useState } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";
import {
  useDeleteSecret,
  useFetchSecretValue,
  useSecretValue,
  type Secret,
} from "./useSecrets";

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
 * How long a revealed value stays on screen.
 *
 * Visual only, deliberately. The cached plaintext is left in place, so a
 * re-reveal serves the cache and one visit still produces one secret.read
 * audit row. ADR 003 A9 records why hiding is an affordance rather than a
 * boundary, and the threat this addresses is an unattended screen, which
 * re-masking covers fully. Purging the cache instead would charge a second
 * audit row for what the user experiences as one visit.
 */
const AUTO_MASK_MS = 30_000;

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
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "clipboard-failed" | "fetch-failed"
  >("idle");

  const value = useSecretValue(bucket, secret.key_name, revealed);
  const fetchValue = useFetchSecretValue(bucket);
  const remove = useDeleteSecret(bucket);
  const notify = useToast();

  // The `revealed` guard is what keeps the copy path from becoming a reveal.
  // TanStack Query's enabled: false stops useSecretValue from fetching, not
  // from reading a cache entry the copy path populated, so dropping this guard
  // would put a value on screen that the user only asked to copy.
  const plaintext = revealed ? value.data?.value : undefined;

  // Armed on the value arriving rather than on the click, so a slow fetch does
  // not eat the reading window. The cleanup runs whenever the value leaves the
  // screen, a manual Hide included, so no stale timer can fire against a later
  // reveal.
  useEffect(() => {
    if (plaintext === undefined) return;
    const timer = setTimeout(() => setRevealed(false), AUTO_MASK_MS);
    return () => clearTimeout(timer);
  }, [plaintext]);

  function toggleReveal() {
    setRevealed((was) => !was);
    setCopyState("idle");
  }

  async function copy() {
    setCopyState("copying");
    let text: string;
    try {
      // A local, never state. On this path the plaintext reaches the clipboard
      // and nothing else: no DOM node, no toast, no error message.
      text = (await fetchValue(secret.key_name)).value;
    } catch {
      // Same fixed sentence as a failed reveal, for the same reason: SP4 made
      // decrypt failures carry no detail, so differentiating here would turn
      // the error path into a channel.
      setCopyState("fetch-failed");
      return;
    }
    try {
      // Awaited in a try/catch: writeText rejects on a denied permission or a
      // non secure context, and an unhandled rejection is an stderr line.
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("clipboard-failed");
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
          <button
            type="button"
            aria-label={`Copy ${secret.key_name}`}
            onClick={() => void copy()}
            disabled={copyState === "copying"}
            className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            Copy
          </button>
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

      {copyState === "copying" && (
        <p role="status" className="text-sm text-text-muted">
          Copying
        </p>
      )}
      {copyState === "copied" && (
        <p role="status" className="text-sm text-text-muted">
          Copied
        </p>
      )}
      {copyState === "fetch-failed" && (
        <Alert variant="inline">Could not reveal this secret.</Alert>
      )}
      {copyState === "clipboard-failed" && (
        <Alert variant="inline">Could not copy to the clipboard.</Alert>
      )}

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
