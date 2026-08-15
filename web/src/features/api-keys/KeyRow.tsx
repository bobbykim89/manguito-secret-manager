import { useState, type ReactNode } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { keyStatus, useRevokeApiKey, type ApiKey } from "./useApiKeys";

const STATUS_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

/**
 * index.css defines dark mode values at the 100 and 800 steps of each ramp
 * (used here) plus accent-600/700 and danger-600 (used for hover states). A
 * tone using any other step would render a light chip on a dark page, which
 * is the defect that hit Alert's inline variant. These four stay inside
 * 100/800, and a fifth tone must too.
 */
const TAG_BASE =
  "inline-flex items-center text-[11px] tracking-[0.02em] px-2.5 py-[3px] rounded-[12px]";

const TAG_TONE = {
  neutral: "bg-neutral-100 text-neutral-800",
  accent: "bg-accent-100 text-accent-800",
  accent2: "bg-accent-2-100 text-accent-2-800",
  outline: "border border-accent text-accent",
} as const;

const STATUS_TONE = { active: "accent2", expired: "outline", revoked: "neutral" } as const;

function Tag({ tone, children }: { tone: keyof typeof TAG_TONE; children: ReactNode }) {
  return <span className={`${TAG_BASE} ${TAG_TONE[tone]}`}>{children}</span>;
}

export function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const [confirming, setConfirming] = useState(false);
  const revoke = useRevokeApiKey();
  const notify = useToast();
  const status = keyStatus(apiKey);
  const live = status === "active";
  const readOnly = !apiKey.can_write && !apiKey.can_reveal;

  function onConfirmed() {
    revoke.mutate(apiKey.id, {
      onSuccess: () => {
        setConfirming(false);
        notify(`Key ${apiKey.name} revoked`);
      },
    });
  }

  return (
    <li
      aria-label={apiKey.name}
      className="flex flex-row items-center justify-between gap-4 rounded-sm bg-surface p-3 shadow-sm"
    >
      {/* min-w-0 so a long name or a full row of tags shrinks rather than
          shoving the Revoke button out past the card's edge. */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[17px] leading-tight">{apiKey.name}</span>
          {/* Not secret, and exists precisely to identify a key without
              authenticating as one. */}
          <span className="text-xs text-text-muted">msm_{apiKey.lookup_id}</span>
          <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {apiKey.buckets.map((bucket) => (
            <Tag key={bucket} tone="neutral">
              {bucket}
            </Tag>
          ))}
          {apiKey.can_write && <Tag tone="accent">Write</Tag>}
          {apiKey.can_reveal && <Tag tone="accent2">Bulk reveal</Tag>}
          {/* The mockup shows nothing at all when neither flag is set. Naming
              it keeps the grant legible instead of leaving it to be inferred
              from two absent tags. */}
          {readOnly && <Tag tone="neutral">Read only</Tag>}
        </div>

        <span className="text-xs text-text-muted">
          {apiKey.last_used_at === null
            ? "Never used"
            : `Last used ${new Date(apiKey.last_used_at).toLocaleDateString()}`}
        </span>
      </div>

      {/* Revoking an already dead key changes nothing the user can see, so the
          button is not offered. The status tag carries that state instead of
          dimming the whole row, which would put 11px muted text under AA. */}
      {live && (
        <button
          type="button"
          aria-label={`Revoke ${apiKey.name}`}
          onClick={() => {
            // Cleared on open so a previous failure's message does not greet
            // the next attempt.
            revoke.reset();
            setConfirming(true);
          }}
          className="shrink-0 rounded-md border border-border px-4 py-2 font-sans text-sm"
        >
          Revoke
        </button>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Revoke key?">
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            {apiKey.name} will stop working immediately. This cannot be undone.
          </p>

          {/* The dialog stays open on failure, so the error belongs here rather
              than behind it on the card. */}
          {revoke.isError && <Alert variant="inline">{revoke.error.message}</Alert>}

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
              disabled={revoke.isPending}
              className="rounded-md bg-danger px-4 py-2 font-sans text-sm font-semibold text-bg disabled:opacity-50"
            >
              Revoke key
            </button>
          </div>
        </div>
      </Modal>
    </li>
  );
}
