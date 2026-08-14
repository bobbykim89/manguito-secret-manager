import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import type { Bucket } from "../buckets/useBuckets";

import {
  apiKeyFormSchema,
  EXPIRY_PRESETS,
  expiresAtFromPreset,
  type ApiKeyFormValues,
} from "./apiKeyForm";
import { NewKeyPanel } from "./NewKeyPanel";
import { useCreateApiKey } from "./useApiKeys";

/**
 * The whole create a key flow: the mutation, the dialog that collects input,
 * and the panel that shows the resulting token exactly once.
 *
 * These three live together because of where the token lives. ADR 003 A12 says
 * it exists only as this mutation's `data`, so the component owning the
 * mutation has to outlive the dialog: if it unmounted when the dialog closed,
 * the token would go with it. That is why this is a flow rather than a form,
 * and why `onCreated` carries no payload. Only the fact that a token exists
 * crosses this boundary, never the token.
 */
export function CreateKeyFlow({
  buckets,
  open,
  onClose,
  onCreated,
  onAcknowledged,
}: {
  buckets: Bucket[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onAcknowledged: () => void;
}) {
  const create = useCreateApiKey();
  const {
    control,
    clearErrors,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: { name: "", buckets: [], canWrite: false, canReveal: false, expiry: "90d" },
  });

  useEffect(() => {
    // CreateKeyFlow outlives its dialog (the token lives in this mutation), so
    // React Hook Form's state is never remounted away the way the buckets and
    // secrets forms are when their dialogs close. Clear the last server
    // refusal here, or the next open greets the user with a stale error from a
    // different attempt. Typed field values are deliberately left alone: a
    // failed submit already keeps what was typed (see onSubmit below), and
    // carrying that across a cancel-then-reopen saves retyping without
    // resurrecting the old error.
    if (open) clearErrors("root");
  }, [open, clearErrors]);

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
        // Reset only on acknowledgement, not here. A failed submit keeps what
        // was typed, and a successful one has a token to hand over first.
        onSuccess: () => onCreated(),
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <>
      {/* `!create.data` is belt and braces on top of the page clearing `open`.
          It keeps "no dialog over an unacknowledged token" true inside the
          component that owns the token, rather than depending on the page
          maintaining its mirror flag correctly. */}
      <Modal open={open && !create.data} onClose={onClose} title="New API key">
        <form
          onSubmit={onSubmit}
          // Named, so a test can scope to it and a screen reader announces what
          // it is.
          aria-label="Create an API key"
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="key-name" className="text-xs">
              Name
            </label>
            <input
              id="key-name"
              {...register("name")}
              placeholder="ci-deploy"
              disabled={create.isPending}
              aria-invalid={errors.name ? true : undefined}
              className="rounded-sm border border-border bg-bg px-3 py-2"
            />
          </div>
          {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs">Buckets this key can reach</legend>
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

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs">Capabilities</legend>
            {/* may_reveal gates only the bulk path in list_endpoint. The single
                key endpoint has no such check, so a key with neither flag can
                still read values one at a time. Saying so is the difference
                between this form describing the grant and lying about it. */}
            <p className="text-xs text-text-muted">
              Any key can read secrets in these buckets one at a time. The options below grant more
              than that.
            </p>

            <div className="flex items-start gap-2.5">
              {/* ToggleSwitch renders a button, not a native input, so
                  register() cannot bind it. Controller is React Hook Form's own
                  answer for a controlled component, and keeps defaultValues,
                  validation and reset() all working. */}
              <Controller
                control={control}
                name="canWrite"
                render={({ field }) => (
                  <ToggleSwitch
                    checked={field.value}
                    onChange={field.onChange}
                    label="Write secrets"
                    disabled={create.isPending}
                  />
                )}
              />
              <div>
                <div className="text-sm">Write secrets</div>
                <div className="text-xs text-text-muted">
                  Create, overwrite and delete. Deleting a secret is permanent.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Controller
                control={control}
                name="canReveal"
                render={({ field }) => (
                  <ToggleSwitch
                    checked={field.value}
                    onChange={field.onChange}
                    label="Bulk reveal"
                    disabled={create.isPending}
                  />
                )}
              />
              <div>
                <div className="text-sm">Bulk reveal</div>
                <div className="text-xs text-text-muted">
                  Fetch every secret in a bucket in one request. A browser session can never do
                  this.
                </div>
              </div>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor="key-expiry" className="text-xs">
              Expires
            </label>
            <select
              id="key-expiry"
              {...register("expiry")}
              disabled={create.isPending}
              className="rounded-sm border border-border bg-bg px-3 py-2"
            >
              {EXPIRY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
            >
              Create key
            </button>
          </div>
        </form>
      </Modal>

      {create.data && (
        <NewKeyPanel
          apiKey={create.data}
          onAcknowledge={() => {
            create.reset();
            reset();
            onAcknowledged();
          }}
        />
      )}
    </>
  );
}
