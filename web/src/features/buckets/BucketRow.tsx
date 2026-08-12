import { useState } from "react";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import { ConfirmPrompt } from "../../components/ConfirmPrompt";

import { useDeleteBucket, type Bucket } from "./useBuckets";

/**
 * One bucket, owning its own confirm flag and its own delete mutation.
 *
 * A page level "which row is confirming" would need this component to receive
 * the flag plus start, cancel, confirm, pending and error as props, which is
 * seven arguments to say one thing. Owning them takes one prop and gets per
 * row pending and error states for free. Two rows can sit in confirm state at
 * once, which is harmless.
 */
export function BucketRow({ bucket }: { bucket: Bucket }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteBucket();
  const holdsSecrets = bucket.secret_count > 0;

  return (
    <li aria-label={bucket.name} className="flex flex-col gap-1 border-b py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            to={`/buckets/${encodeURIComponent(bucket.name)}`}
            className="font-medium underline"
          >
            {bucket.name}
          </Link>
          <span className="ml-3 text-sm text-slate-600">
            {bucket.secret_count} {bucket.secret_count === 1 ? "secret" : "secrets"}
          </span>
          <time dateTime={bucket.created_at} className="ml-3 text-sm text-slate-500">
            {new Date(bucket.created_at).toLocaleDateString()}
          </time>
        </div>

        {confirming ? (
          <ConfirmPrompt
            prompt="Delete this bucket?"
            onConfirm={() => remove.mutate(bucket.name)}
            onCancel={() => setConfirming(false)}
            confirmDisabled={remove.isPending || holdsSecrets}
          />
        ) : (
          <div className="flex items-center gap-3 text-sm">
            {holdsSecrets && (
              <span className="text-slate-600">Still holds secrets</span>
            )}
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={holdsSecrets}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {remove.isError && <Alert variant="inline">{remove.error.message}</Alert>}
    </li>
  );
}
