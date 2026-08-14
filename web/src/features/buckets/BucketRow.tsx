import { useState } from "react";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { useDeleteBucket, type Bucket } from "./useBuckets";

/**
 * One bucket, owning its own dialog flag and its own delete mutation.
 *
 * A page level "which row is confirming" would need this component to receive
 * the flag plus start, cancel, confirm, pending and error as props, which is
 * seven arguments to say one thing. Owning them takes one prop and gets per
 * row pending and error states for free.
 *
 * The whole card is clickable through a stretched pseudo element on the name's
 * Link, rather than an onClick on the card itself. That keeps exactly one link
 * in the accessibility tree, keeps it keyboard reachable, and avoids nesting
 * the Delete button inside a clickable region.
 */
export function BucketRow({ bucket }: { bucket: Bucket }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteBucket();
  const notify = useToast();
  const holdsSecrets = bucket.secret_count > 0;

  function onConfirmed() {
    remove.mutate(bucket.name, {
      onSuccess: () => {
        setConfirming(false);
        notify(`Bucket ${bucket.name} deleted`);
      },
    });
  }

  return (
    <li
      aria-label={bucket.name}
      className="relative flex flex-col gap-2 rounded-sm bg-surface p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <span className="text-[10px] uppercase tracking-[0.1em] text-accent">Bucket</span>

      <h3 className="font-sans text-[17px] leading-tight">
        {/* The stretched pseudo element is what makes the whole card
            clickable. The card is relative, so it covers exactly this card. */}
        <Link
          to={`/buckets/${encodeURIComponent(bucket.name)}`}
          className="after:absolute after:inset-0 after:content-['']"
        >
          {bucket.name}
        </Link>
      </h3>

      <p className="flex-1 text-[13px] opacity-80">
        {bucket.secret_count} {bucket.secret_count === 1 ? "secret" : "secrets"}
        {" · "}
        <time dateTime={bucket.created_at}>
          {new Date(bucket.created_at).toLocaleDateString()}
        </time>
      </p>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span aria-hidden="true" className="text-accent">
          View →
        </span>
        <div className="flex items-center gap-2">
          {holdsSecrets && <span>Still holds secrets</span>}
          {/* relative so it paints above the Link's stretched pseudo element
              and stays independently clickable. */}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={holdsSecrets}
            className="relative rounded-md px-2 py-1 text-accent disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete bucket?"
      >
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            {bucket.name} will be deleted. This cannot be undone.
          </p>

          {/* The dialog stays open on failure, so the error belongs here
              rather than behind it on the card. */}
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
              disabled={remove.isPending || holdsSecrets}
              className="rounded-md bg-danger px-4 py-2 font-sans text-sm font-semibold text-bg disabled:opacity-50"
            >
              Delete bucket
            </button>
          </div>
        </div>
      </Modal>
    </li>
  );
}
