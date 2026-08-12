import { useParams } from "react-router";

import { Alert } from "../../components/Alert";
import { PutSecretForm } from "./PutSecretForm";
import { SecretRow } from "./SecretRow";
import { useSecrets } from "./useSecrets";

export function SecretsPage() {
  const { name } = useParams();
  const bucket = name ?? "";
  const secrets = useSecrets(bucket);

  // The route is real and the resource is not, which is a different failure
  // from a wrong URL. Falling through to the router's NotFound would say the
  // wrong thing, and a form for writing into a bucket that does not exist is
  // worse than nothing.
  const missing = secrets.error?.code === "BUCKET_NOT_FOUND";

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{bucket}</h1>

      {missing ? (
        <Alert>{secrets.error?.message}</Alert>
      ) : (
        <>
          <PutSecretForm bucket={bucket} existingKeys={(secrets.data ?? []).map((s) => s.key_name)} />

          {secrets.isPending && (
            <p role="status" className="text-sm text-slate-600">
              Loading secrets
            </p>
          )}

          {secrets.isError && (
            <Alert>Could not refresh this bucket. {secrets.error.message}</Alert>
          )}

          {/* Rendered on data existing, not on isSuccess: TanStack reports a
              failed refetch as an error while still holding the previous data,
              so gating on isSuccess would erase a working list. SP6 was
              corrected to this shape for this page's benefit. */}
          {secrets.data &&
            (secrets.data.length === 0 ? (
              <p className="text-slate-600">No secrets yet. Add one above.</p>
            ) : (
              <ul>
                {secrets.data.map((secret) => (
                  <SecretRow key={secret.key_name} bucket={bucket} secret={secret} />
                ))}
              </ul>
            ))}
        </>
      )}
    </section>
  );
}
