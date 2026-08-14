import { useCallback } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";
import { BUCKETS_QUERY_KEY } from "../buckets/useBuckets";

export type Secret = components["schemas"]["SecretData"];
export type SecretValue = components["schemas"]["SecretValueData"];

export type PutSecretVariables = { keyName: string; value: string };

/**
 * Two roots, not one tree.
 *
 * SP6's useBuckets invalidates BUCKETS_QUERY_KEY with the default
 * exact: false, so nesting secrets under it would mean every bucket create or
 * delete wiping every open secret list. Separate roots make that impossible
 * rather than depending on someone remembering exact: true. secret-value is
 * separate from secrets for the same reason one level down: writing
 * DATABASE_URL must not discard a STRIPE_KEY value revealed thirty seconds
 * ago.
 */
export const secretsQueryKey = (bucket: string) => ["secrets", bucket] as const;

export const secretValueQueryKey = (bucket: string, keyName: string) =>
  ["secret-value", bucket, keyName] as const;

const secretsPath = (bucket: string) => `/v1/buckets/${encodeURIComponent(bucket)}/secrets`;

const secretPath = (bucket: string, keyName: string) =>
  `${secretsPath(bucket)}/${encodeURIComponent(keyName)}`;

export function useSecrets(bucket: string) {
  return useQuery<Secret[], ApiError>({
    queryKey: secretsQueryKey(bucket),
    queryFn: () => client.get<Secret[]>(secretsPath(bucket)),
  });
}

/**
 * The single definition of a value fetch, shared by the declarative reveal path
 * and the imperative copy path.
 *
 * staleTime: Infinity lives here so both inherit it. Hiding and re-revealing
 * serves the cache, and so does copying a value that is already revealed, so
 * one visit produces one secret.read audit row however the user reaches the
 * value. Once revealed it is in the tab's memory anyway, so hiding is a visual
 * affordance rather than a security boundary, and counting clicks would make a
 * misclick indistinguishable from a genuine second look at a credential.
 *
 * gcTime is deliberately left at the five minute default: navigating away
 * unmounts the observer and the plaintext leaves memory without anyone writing
 * code to do it.
 */
const secretValueQueryOptions = (bucket: string, keyName: string) => ({
  queryKey: secretValueQueryKey(bucket, keyName),
  queryFn: () => client.get<SecretValue>(secretPath(bucket, keyName)),
  staleTime: Infinity,
});

/**
 * One secret's plaintext, fetched only once the user asks for it.
 *
 * `enabled` gates this hook's own fetch: nothing about rendering the list can
 * cause it to run, because only a click flips this flag. It is not, however,
 * the whole of invariant 7. `useFetchSecretValue` below is a second fetch
 * path, gated by nothing declarative at all, only by the fact that its only
 * caller is an onClick handler. Invariant 7 lives in both hooks being called
 * from a click and nowhere else, not in `enabled` alone.
 *
 * `enabled` also does not stop this hook from returning a cache entry the copy
 * path put there. SecretRow's `revealed` guard is what handles that; see the
 * comment on its `plaintext`.
 */
export function useSecretValue(bucket: string, keyName: string, revealed: boolean) {
  return useQuery<SecretValue, ApiError>({
    ...secretValueQueryOptions(bucket, keyName),
    enabled: revealed,
  });
}

/**
 * Fetches one value imperatively, for the copy path.
 *
 * ADR 003 line 70 requires copy to work without revealing, which the
 * declarative hook above cannot express: its `enabled` flag is the reveal.
 * This returns the plaintext to its caller and puts it nowhere else, so the
 * caller can hand it to the clipboard without any state that would render it.
 *
 * Serves the cache when there is one, so copying an already revealed value
 * costs no second audit row.
 */
export function useFetchSecretValue(bucket: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (keyName: string) => queryClient.fetchQuery(secretValueQueryOptions(bucket, keyName)),
    [bucket, queryClient],
  );
}

export function usePutSecret(bucket: string) {
  const queryClient = useQueryClient();
  return useMutation<Secret, ApiError, PutSecretVariables>({
    mutationFn: ({ keyName, value }) =>
      client.put<Secret>(secretPath(bucket, keyName), { value }),
    onSuccess: (_data, { keyName }) => {
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(bucket) });
      // secret_count is cached on the bucket list, so a write makes it stale
      // there too.
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      // Dropping the cached value (rather than leaving it under staleTime:
      // Infinity) means an already-revealed row rebuilds its query observer
      // for this key, auto-refetches, and displays the value just written —
      // a second secret.read audit entry with no second click from the user.
      queryClient.removeQueries({ queryKey: secretValueQueryKey(bucket, keyName), exact: true });
    },
  });
}

export function useDeleteSecret(bucket: string) {
  const queryClient = useQueryClient();
  // The API answers a secret delete with the deleted row's metadata, not with
  // { deleted: true }. That shape belongs to the bucket delete.
  return useMutation<Secret, ApiError, string>({
    mutationFn: (keyName) => client.del<Secret>(secretPath(bucket, keyName)),
    onSuccess: (_data, keyName) => {
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(bucket) });
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      // A decrypted plaintext held under a key nothing can display again is
      // pointless to keep in memory.
      queryClient.removeQueries({ queryKey: secretValueQueryKey(bucket, keyName), exact: true });
    },
  });
}
