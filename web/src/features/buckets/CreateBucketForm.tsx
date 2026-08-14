import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";

import { bucketNameSchema, type BucketNameValues } from "./bucketName";
import { useCreateBucket } from "./useBuckets";

/**
 * The create form, rendered as a dialog body by BucketsPage.
 *
 * Both callbacks are optional so the form stays renderable on its own, which
 * is how its tests exercise validation without a dialog around it. Cancel is
 * only drawn when there is something to cancel back to.
 */
export function CreateBucketForm({
  onCreated,
  onCancel,
}: {
  onCreated?: (name: string) => void;
  onCancel?: () => void;
}) {
  const create = useCreateBucket();
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<BucketNameValues>({ resolver: zodResolver(bucketNameSchema) });

  const onSubmit = handleSubmit((values) => {
    create.mutate(values.name, {
      // Reset only on success. A failed submit keeps what was typed, because
      // retyping a name the server just explained is pure friction.
      onSuccess: () => {
        reset();
        onCreated?.(values.name);
      },
      onError: (error) => {
        if (error.code === "BUCKET_EXISTS") {
          // Validation performed by the only party that can perform it, so it
          // belongs on the field rather than in a banner.
          setError("name", { message: error.message });
          return;
        }
        setError("root", { message: error.message });
      },
    });
  });

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="bucket-name" className="text-xs">
          Bucket name
        </label>
        <input
          id="bucket-name"
          {...register("name")}
          placeholder="my_project"
          disabled={create.isPending}
          aria-invalid={errors.name ? true : undefined}
          className="rounded-sm border border-border bg-bg px-3 py-2"
        />
      </div>

      {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}
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
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          Create bucket
        </button>
      </div>
    </form>
  );
}
