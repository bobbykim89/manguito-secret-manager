import { useState } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { BucketRow } from "./BucketRow";
import { CreateBucketForm } from "./CreateBucketForm";
import { useBuckets } from "./useBuckets";

export function BucketsPage() {
  const buckets = useBuckets();
  const notify = useToast();
  const [creating, setCreating] = useState(false);

  function onCreated(name: string) {
    setCreating(false);
    notify(`Bucket ${name} created`);
  }

  return (
    <section className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Buckets</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          + New bucket
        </button>
      </div>

      {buckets.isPending && (
        <p role="status" className="text-sm text-text-muted">
          Loading buckets
        </p>
      )}

      {buckets.isError && (
        <Alert>
          {/* A cached list survives a transient failure the same way useSession's
              cached user does: refetchOnWindowFocus makes a dropped request
              routine, and replacing a working list with an error over one
              flaky refetch would be a worse experience than showing both. */}
          Could not refresh your buckets. {buckets.error.message}
        </Alert>
      )}

      {buckets.data &&
        (buckets.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-text-muted">No buckets yet.</p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
            >
              Create your first bucket
            </button>
          </div>
        ) : (
          // role="list" explicitly: Tailwind's preflight sets list-style:none,
          // which makes some browsers drop list semantics entirely.
          <ul
            role="list"
            className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4"
          >
            {buckets.data.map((bucket) => (
              <BucketRow key={bucket.id} bucket={bucket} />
            ))}
          </ul>
        ))}

      <Modal open={creating} onClose={() => setCreating(false)} title="New bucket">
        <CreateBucketForm onCreated={onCreated} onCancel={() => setCreating(false)} />
      </Modal>
    </section>
  );
}
