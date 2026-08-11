import { BucketRow } from "./BucketRow";
import { CreateBucketForm } from "./CreateBucketForm";
import { useBuckets } from "./useBuckets";

export function BucketsPage() {
  const buckets = useBuckets();

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Buckets</h1>

      <CreateBucketForm />

      {buckets.isPending && (
        <p role="status" className="text-sm text-slate-600">
          Loading buckets
        </p>
      )}

      {buckets.isError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          {/* A cached list survives a transient failure the same way useSession's
              cached user does: refetchOnWindowFocus makes a dropped request
              routine, and replacing a working list with an error over one
              flaky refetch would be a worse experience than showing both. */}
          Could not refresh your buckets. {buckets.error.message}
        </p>
      )}

      {buckets.data &&
        (buckets.data.length === 0 ? (
          <p className="text-slate-600">No buckets yet. Create one above.</p>
        ) : (
          <ul>
            {buckets.data.map((bucket) => (
              <BucketRow key={bucket.id} bucket={bucket} />
            ))}
          </ul>
        ))}
    </section>
  );
}
