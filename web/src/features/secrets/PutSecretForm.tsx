import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";
import { secretFormSchema, type SecretFormValues } from "./secretForm";
import { usePutSecret } from "./useSecrets";

/**
 * One form for both writing and replacing, matching the backend's upsert.
 *
 * The list is already on screen, so the button can say which one this is
 * before the user commits rather than after. That removes most of what a
 * single form costs in silent clobbering, without a second flow.
 */
export function PutSecretForm({
  bucket,
  existingKeys,
}: {
  bucket: string;
  existingKeys: string[];
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
    put.mutate(
      { keyName: values.keyName, value: values.value },
      {
        onSuccess: () => reset({ keyName: "", value: "" }),
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      // Named, so a test can scope to it and a screen reader announces what it
      // is. SecretsPage renders it above a list of similar looking controls.
      aria-label="Add or replace a secret"
      className="flex flex-col gap-2 rounded border p-4"
    >
      <label htmlFor="secret-key-name" className="text-sm font-medium">
        Key name
      </label>
      <input
        id="secret-key-name"
        {...register("keyName")}
        placeholder="DATABASE_URL"
        disabled={put.isPending}
        aria-invalid={errors.keyName ? true : undefined}
        className="rounded border px-3 py-2"
      />
      {errors.keyName && <Alert variant="inline">{errors.keyName.message}</Alert>}

      <label htmlFor="secret-value" className="text-sm font-medium">
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
        className="rounded border px-3 py-2 font-mono text-sm"
      />
      {errors.value && <Alert variant="inline">{errors.value.message}</Alert>}

      <div>
        <button
          type="submit"
          disabled={put.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          {replacing ? "Replace secret" : "Add secret"}
        </button>
      </div>

      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}
    </form>
  );
}
