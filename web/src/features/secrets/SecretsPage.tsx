import { useState } from "react";
import { useParams } from "react-router";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { PutSecretForm } from "./PutSecretForm";
import { SecretRow } from "./SecretRow";
import { useSecrets } from "./useSecrets";

export function SecretsPage() {
  const { name } = useParams();
  const bucket = name ?? "";
  const secrets = useSecrets(bucket);
  const notify = useToast();
  const [adding, setAdding] = useState(false);

  // The route is real and the resource is not, which is a different failure
  // from a wrong URL. Falling through to the router's NotFound would say the
  // wrong thing, and a form for writing into a bucket that does not exist is
  // worse than nothing.
  const missing = secrets.error?.code === "BUCKET_NOT_FOUND";

  function onCreated({ keyName, replaced }: { keyName: string; replaced: boolean }) {
    setAdding(false);
    notify(`Secret ${keyName} ${replaced ? "replaced" : "added"}`);
  }

  return (
    // px-6 py-8 is this page's own: since the buckets piece, <main> is a pure
    // passthrough with no padding, so a page that omits its spacing renders
    // flush against the viewport edge.
    <section className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{bucket}</h1>
        {/* No write affordance for a bucket that does not exist. */}
        {!missing && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
          >
            + Add secret
          </button>
        )}
      </div>

      {missing ? (
        <Alert>{secrets.error?.message}</Alert>
      ) : (
        <>
          {secrets.isPending && (
            <p role="status" className="text-sm text-text-muted">
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
              <div className="flex flex-col items-start gap-3">
                <p className="text-text-muted">No secrets yet.</p>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
                >
                  Add your first secret
                </button>
              </div>
            ) : (
              // role="list" explicitly: Tailwind's preflight sets
              // list-style:none, which makes some browsers drop list semantics
              // entirely.
              <ul role="list" className="flex flex-col">
                {secrets.data.map((secret) => (
                  <SecretRow key={secret.key_name} bucket={bucket} secret={secret} />
                ))}
              </ul>
            ))}
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add secret">
        <PutSecretForm
          bucket={bucket}
          existingKeys={(secrets.data ?? []).map((s) => s.key_name)}
          onCreated={onCreated}
          onCancel={() => setAdding(false)}
        />
      </Modal>
    </section>
  );
}
