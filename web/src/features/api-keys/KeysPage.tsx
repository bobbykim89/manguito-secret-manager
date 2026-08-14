import { Alert } from "../../components/Alert";
import { useBuckets } from "../buckets/useBuckets";
import { CreateKeyForm } from "./CreateKeyForm";
import { KeyRow } from "./KeyRow";
import { useApiKeys } from "./useApiKeys";

export function KeysPage() {
  const buckets = useBuckets();
  const keys = useApiKeys();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">
      {/* This page is not reskinned yet, so it pins itself to light mode.
          Delete this wrapper when the API keys piece reskins it. */}
      <section className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">API keys</h1>

        {buckets.isError && (
          <Alert>Could not refresh your buckets. {buckets.error.message}</Alert>
        )}

        {/* Gated on data existing, not merely rendered with a fallback of []:
            useBuckets is undefined while pending, and an empty array would show
            the "create a bucket first" state to an account that has plenty. */}
        {buckets.data && <CreateKeyForm buckets={buckets.data} />}

        {keys.isPending && (
          <p role="status" className="text-sm text-slate-600">
            Loading keys
          </p>
        )}

        {keys.isError && <Alert>Could not refresh your API keys. {keys.error.message}</Alert>}

        {/* Rendered on data existing, not on isSuccess: TanStack reports a
            failed refetch as an error while still holding the previous data, so
            gating on isSuccess would erase a working list. */}
        {keys.data &&
          (keys.data.length === 0 ? (
            <p className="text-slate-600">No API keys yet. Create one above.</p>
          ) : (
            <ul>
              {keys.data.map((apiKey) => (
                <KeyRow key={apiKey.id} apiKey={apiKey} />
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
