import { useState } from "react";

import { Alert } from "../../components/Alert";
import { ConfirmPrompt } from "../../components/ConfirmPrompt";
import { keyStatus, useRevokeApiKey, type ApiKey } from "./useApiKeys";

const STATUS_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

function capabilityText(apiKey: ApiKey): string {
  const granted = [
    apiKey.can_write ? "write" : null,
    apiKey.can_reveal ? "bulk reveal" : null,
  ].filter((capability): capability is string => capability !== null);
  return granted.length === 0 ? "read only" : granted.join(" and ");
}

export function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const [confirming, setConfirming] = useState(false);
  const revoke = useRevokeApiKey();
  const status = keyStatus(apiKey);
  const live = status === "active";

  return (
    <li
      aria-label={apiKey.name}
      className={`flex flex-col gap-1 border-b py-3 ${live ? "" : "opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="font-medium">{apiKey.name}</span>
          <code className="ml-3 text-sm text-slate-500">msm_{apiKey.lookup_id}</code>
        </div>

        {confirming ? (
          <ConfirmPrompt
            prompt="Revoke this key?"
            confirmLabel={`Confirm revoking ${apiKey.name}`}
            cancelLabel={`Cancel revoking ${apiKey.name}`}
            onConfirm={() => revoke.mutate(apiKey.id)}
            onCancel={() => setConfirming(false)}
            confirmDisabled={revoke.isPending}
          />
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span>{STATUS_LABEL[status]}</span>
            {/* Revoking an already dead key changes nothing the user can
                see, so the button is not offered. */}
            {live && (
              <button
                type="button"
                aria-label={`Revoke ${apiKey.name}`}
                onClick={() => setConfirming(true)}
                className="rounded border px-2 py-1"
              >
                Revoke
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-sm text-slate-600">
        {apiKey.buckets.join(", ")} &middot; {capabilityText(apiKey)} &middot;{" "}
        {apiKey.last_used_at === null
          ? "never used"
          : `last used ${new Date(apiKey.last_used_at).toLocaleDateString()}`}
      </p>

      {revoke.isError && <Alert variant="inline">{revoke.error.message}</Alert>}
    </li>
  );
}
