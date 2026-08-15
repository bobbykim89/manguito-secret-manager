import { useState } from "react";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import { useBuckets } from "../buckets/useBuckets";

import { CreateKeyFlow } from "./CreateKeyFlow";
import { KeyRow } from "./KeyRow";
import { useApiKeys } from "./useApiKeys";

export function KeysPage() {
  const buckets = useBuckets();
  const keys = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [tokenPending, setTokenPending] = useState(false);

  // Three states, not two. useBuckets returns undefined while pending, and
  // treating that as "no buckets" would tell an account with plenty that it has
  // none for as long as the request is in flight.
  const noBuckets = buckets.data !== undefined && buckets.data.length === 0;

  // One condition for both triggers. Gating only the header would leave the
  // empty state's button able to open a dialog in exactly the situation the
  // header button was hidden to prevent.
  const canCreate = buckets.data !== undefined && buckets.data.length > 0 && !tokenPending;

  return (
    // px-6 py-8 is this page's own: <main> is a pure passthrough with no
    // padding, so a page that omits its spacing renders flush against the
    // viewport edge.
    <section className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">API keys</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
          >
            + New key
          </button>
        )}
      </div>

      {buckets.isError && <Alert>Could not refresh your buckets. {buckets.error.message}</Alert>}

      {noBuckets && (
        <p className="rounded-md border border-border p-4 text-text-muted">
          A key has to be scoped to at least one bucket.{" "}
          <Link to="/buckets" className="text-accent underline">
            Create a bucket
          </Link>{" "}
          first.
        </p>
      )}

      {/* Above the list, where the form used to be, so an unacknowledged token
          is the first thing on the page rather than the last. */}
      <CreateKeyFlow
        buckets={buckets.data ?? []}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setTokenPending(true);
        }}
        onAcknowledged={() => setTokenPending(false)}
      />

      {keys.isPending && (
        <p role="status" className="text-sm text-text-muted">
          Loading keys
        </p>
      )}

      {keys.isError && <Alert>Could not refresh your API keys. {keys.error.message}</Alert>}

      {/* Rendered on data existing, not on isSuccess: TanStack reports a failed
          refetch as an error while still holding the previous data, so gating on
          isSuccess would erase a working list. */}
      {keys.data &&
        (keys.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-text-muted">No API keys yet.</p>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
              >
                Create your first key
              </button>
            )}
          </div>
        ) : (
          // role="list" explicitly: Tailwind's preflight sets list-style:none,
          // which makes some browsers drop list semantics entirely.
          <ul role="list" className="flex flex-col gap-3">
            {keys.data.map((apiKey) => (
              <KeyRow key={apiKey.id} apiKey={apiKey} />
            ))}
          </ul>
        ))}
    </section>
  );
}
