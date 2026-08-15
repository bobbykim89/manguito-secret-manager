import { useEffect, useState } from "react";
import { useBlocker } from "react-router";

import { Alert } from "../../components/Alert";
import type { CreatedApiKey } from "./useApiKeys";

/**
 * The one screen in this application that displays a live credential on
 * purpose.
 *
 * The guard is armed by this component's existence rather than by a flag:
 * the panel renders only while a token is unacknowledged, so the blocker and
 * the beforeunload listener live exactly as long as it does and cannot drift
 * out of step with what is on screen.
 *
 * The token is shown in full, which is the opposite of SecretRow and
 * deliberate. A secret can be revealed again tomorrow; this cannot, so
 * masking it would work against the only thing this screen is for. It reaches
 * no storage, no URL and no error payload. See ADR 003 A12.
 */
export function NewKeyPanel({
  apiKey,
  onAcknowledge,
}: {
  apiKey: CreatedApiKey;
  onAcknowledge: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const blocker = useBlocker(true);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      // preventDefault is the modern spelling; returnValue is deprecated and
      // browsers render their own text either way.
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function copy() {
    // Awaited in a try/catch: writeText rejects on a denied permission or a
    // non secure context, and an unhandled rejection is an stderr line.
    try {
      await navigator.clipboard.writeText(apiKey.token);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      aria-label={`Token for ${apiKey.name}`}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
    >
      <h2 className="font-medium">Key &ldquo;{apiKey.name}&rdquo; created</h2>

      <Alert tone="warning">
        This token is shown once and cannot be recovered. Save it now. If you lose it, revoke this
        key and create another.
      </Alert>

      {/* bg-bg inside a bg-surface panel, so the token reads as a nested field
          rather than blending into the card. */}
      <code className="break-all rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm">
        {apiKey.token}
      </code>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md border border-border px-4 py-2 font-sans text-sm"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onAcknowledge}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          I have saved it
        </button>
      </div>

      {copyState === "copied" && (
        <p role="status" className="text-sm text-text-muted">
          Copied
        </p>
      )}
      {copyState === "failed" && <Alert variant="inline">Could not copy to the clipboard.</Alert>}

      {blocker.state === "blocked" && (
        // A div wrapping an Alert, not an Alert containing buttons: Alert
        // renders a <p>, and a button inside a <p> is invalid HTML.
        <div className="flex flex-col gap-2 rounded-md border border-accent bg-accent-100 p-3">
          {/* There is no amber token in this theme. accent-100 with an accent
              border reads as a warm warning in both themes and stays inside the
              100/800 pair that carries dark mode values for tags and chips. */}
          <Alert variant="inline" tone="warning">
            Leave without saving your token? It cannot be recovered.
          </Alert>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => blocker.reset()}
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
            >
              Stay
            </button>
            <button
              type="button"
              onClick={() => blocker.proceed()}
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
            >
              Leave
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
