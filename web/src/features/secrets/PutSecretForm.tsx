import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";
import { secretFormSchema, type SecretFormValues } from "./secretForm";
import { usePutSecret } from "./useSecrets";

/**
 * One form for both writing and replacing, matching the backend's upsert, and
 * rendered as a dialog body by SecretsPage.
 *
 * Both callbacks are optional so the form stays renderable on its own, which
 * is how its tests exercise validation without a dialog around it. Cancel is
 * only drawn when there is something to cancel back to.
 */
export function PutSecretForm({
  bucket,
  existingKeys,
  onCreated,
  onCancel,
}: {
  bucket: string;
  existingKeys: string[];
  onCreated?: (result: { keyName: string; replaced: boolean }) => void;
  onCancel?: () => void;
}) {
  const put = usePutSecret(bucket);
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
    watch,
  } = useForm<SecretFormValues>({ resolver: zodResolver(secretFormSchema) });

  // Exact and case sensitive, because the backend's key names are: DATABASE_URL
  // and database_url are two different secrets.
  const replacing = existingKeys.includes(watch("keyName") ?? "");

  const onSubmit = handleSubmit((values) => {
    // Read from the submitted values rather than from `replacing`, so the
    // reported outcome cannot drift from the key that was actually written.
    const replaced = existingKeys.includes(values.keyName);
    put.mutate(
      { keyName: values.keyName, value: values.value },
      {
        // Reset only on success. A failed submit keeps what was typed, because
        // retyping a value the server just rejected is pure friction.
        onSuccess: () => {
          reset({ keyName: "", value: "" });
          onCreated?.({ keyName: values.keyName, replaced });
        },
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      // Named, so a test can scope to it and a screen reader announces what it
      // is. The dialog around it holds similar looking controls.
      aria-label="Add or replace a secret"
      className="mt-4 flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="secret-key-name" className="text-xs">
          Key name
        </label>
        <input
          id="secret-key-name"
          {...register("keyName")}
          placeholder="DATABASE_URL"
          disabled={put.isPending}
          aria-invalid={errors.keyName ? true : undefined}
          className="rounded-sm border border-border bg-bg px-3 py-2"
        />
      </div>
      {errors.keyName && <Alert variant="inline">{errors.keyName.message}</Alert>}

      <div className="flex flex-col gap-1">
        <label htmlFor="secret-value" className="text-xs">
          Value
        </label>
        {/* A textarea, not an input. 64 KiB is PEM keys and service account
            JSON, not a password field. */}
        <textarea
          id="secret-value"
          {...register("value")}
          rows={4}
          disabled={put.isPending}
          aria-invalid={errors.value ? true : undefined}
          className="rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm"
        />
      </div>
      {errors.value && <Alert variant="inline">{errors.value.message}</Alert>}

      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 font-sans text-sm"
          >
            Cancel
          </button>
        )}
        {/* The button text is the only silent-clobber guard this flow has: the
            endpoint is an upsert, so there is no "already exists" error to
            catch. It changes at the point of commitment, which is where the
            warning earns its place. */}
        <button
          type="submit"
          disabled={put.isPending}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          {replacing ? "Replace secret" : "Add secret"}
        </button>
      </div>
    </form>
  );
}
