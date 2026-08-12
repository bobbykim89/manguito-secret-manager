import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";

export type ApiKey = components["schemas"]["ApiKeyData"];
export type CreatedApiKey = components["schemas"]["CreatedApiKeyData"];
export type CreateKeyBody = components["schemas"]["CreateKeyRequest"];
type Revoked = components["schemas"]["RevokedData"];

/**
 * One flat root. Nothing nests under ["buckets"], which invalidates with the
 * default exact: false, so nesting would mean every bucket write wiping this.
 */
export const API_KEYS_QUERY_KEY = ["api-keys"] as const;

export function useApiKeys() {
  return useQuery<ApiKey[], ApiError>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => client.get<ApiKey[]>("/v1/keys"),
  });
}

/**
 * The one mutation in this application whose result is a live credential.
 *
 * The token lives here and nowhere else: `data` is the unacknowledged
 * condition, `reset()` is acknowledgement, and unmounting collects it. See
 * ADR 003 A12.
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation<CreatedApiKey, ApiError, CreateKeyBody>({
    mutationFn: (body) => client.post<CreatedApiKey>("/v1/keys", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation<Revoked, ApiError, string>({
    mutationFn: (id) => client.del<Revoked>(`/v1/keys/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: (error) => {
      // The row is showing a key the server says is gone, so the list is
      // stale in a way the user can see.
      if (error.code === "API_KEY_NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
      }
    },
  });
}

export type KeyStatus = "active" | "expired" | "revoked";

/**
 * Revoked wins over expired: a revoked key is revoked whatever its expiry.
 *
 * `now` is a parameter so tests pin instants. Derived at render, so a key
 * expiring while the page sits open does not flip until something
 * re-renders. Accepted rather than carrying a timer to update a badge.
 */
export function keyStatus(key: ApiKey, now: number = Date.now()): KeyStatus {
  if (key.revoked_at !== null) {
    return "revoked";
  }
  if (key.expires_at !== null && Date.parse(key.expires_at) <= now) {
    return "expired";
  }
  return "active";
}
