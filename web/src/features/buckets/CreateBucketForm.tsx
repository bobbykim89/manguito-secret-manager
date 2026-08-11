import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { bucketNameSchema, type BucketNameValues } from "./bucketName";
import { useCreateBucket } from "./useBuckets";

export function CreateBucketForm() {
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
      onSuccess: () => reset(),
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
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="bucket-name" className="sr-only">
          Bucket name
        </label>
        <input
          id="bucket-name"
          {...register("name")}
          placeholder="new-bucket"
          disabled={create.isPending}
          aria-invalid={errors.name ? true : undefined}
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          Create
        </button>
      </div>
      {errors.name && (
        <p role="alert" className="text-sm text-red-700">
          {errors.name.message}
        </p>
      )}
      {errors.root && (
        <p role="alert" className="text-sm text-red-700">
          {errors.root.message}
        </p>
      )}
    </form>
  );
}
