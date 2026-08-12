import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import type { Bucket } from "../buckets/useBuckets";
import {
  apiKeyFormSchema,
  EXPIRY_PRESETS,
  expiresAtFromPreset,
  type ApiKeyFormValues,
} from "./apiKeyForm";
import { NewKeyPanel } from "./NewKeyPanel";
import { useCreateApiKey } from "./useApiKeys";

export function CreateKeyForm({ buckets }: { buckets: Bucket[] }) {
  const create = useCreateApiKey();
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: { name: "", buckets: [], canWrite: false, canReveal: false, expiry: "90d" },
  });

  // The panel replaces the form rather than sitting above it, so a second
  // submit is impossible while a token is still unsaved.
  if (create.data) {
    return (
      <NewKeyPanel
        apiKey={create.data}
        onAcknowledge={() => {
          create.reset();
          reset();
        }}
      />
    );
  }

  if (buckets.length === 0) {
    return (
      <p className="rounded border p-4 text-slate-600">
        A key has to be scoped to at least one bucket.{" "}
        <Link to="/buckets" className="underline">
          Create a bucket
        </Link>{" "}
        first.
      </p>
    );
  }

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        name: values.name,
        buckets: values.buckets,
        can_write: values.canWrite,
        can_reveal: values.canReveal,
        expires_at: expiresAtFromPreset(values.expiry),
      },
      {
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Create an API key"
      className="flex flex-col gap-3 rounded border p-4"
    >
      <label htmlFor="key-name" className="text-sm font-medium">
        Name
      </label>
      <input
        id="key-name"
        {...register("name")}
        placeholder="ci-deploy"
        disabled={create.isPending}
        aria-invalid={errors.name ? true : undefined}
        className="rounded border px-3 py-2"
      />
      {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Buckets this key can reach</legend>
        {buckets.map((bucket) => (
          <label key={bucket.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              value={bucket.name}
              {...register("buckets")}
              disabled={create.isPending}
            />
            {bucket.name}
          </label>
        ))}
      </fieldset>
      {errors.buckets && <Alert variant="inline">{errors.buckets.message}</Alert>}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Capabilities</legend>
        {/* may_reveal gates only the bulk path in list_endpoint. The single
            key endpoint has no such check, so a key with neither flag can
            still read values one at a time. Saying so is the difference
            between this form describing the grant and lying about it. */}
        <p className="text-sm text-slate-600">
          Any key can read secrets in these buckets one at a time. The options below grant more
          than that.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("canWrite")} disabled={create.isPending} />
          <span>
            <span className="font-medium">Write secrets</span>
            <br />
            Create, overwrite and delete. Deleting a secret is permanent.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("canReveal")} disabled={create.isPending} />
          <span>
            <span className="font-medium">Bulk reveal</span>
            <br />
            Fetch every secret in a bucket in one request. A browser session can never do this.
          </span>
        </label>
      </fieldset>

      <label htmlFor="key-expiry" className="text-sm font-medium">
        Expires
      </label>
      <select
        id="key-expiry"
        {...register("expiry")}
        disabled={create.isPending}
        className="rounded border px-3 py-2"
      >
        {EXPIRY_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>

      <div>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          Create key
        </button>
      </div>

      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}
    </form>
  );
}
