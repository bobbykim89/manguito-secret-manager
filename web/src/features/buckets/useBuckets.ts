import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";
import { API_KEYS_QUERY_KEY } from "../api-keys/useApiKeys";

export type Bucket = components["schemas"]["BucketData"];
type Deleted = components["schemas"]["DeletedData"];

export const BUCKETS_QUERY_KEY = ["buckets"] as const;

export function useBuckets() {
  return useQuery<Bucket[], ApiError>({
    queryKey: BUCKETS_QUERY_KEY,
    queryFn: () => client.get<Bucket[]>("/v1/buckets"),
  });
}

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation<Bucket, ApiError, string>({
    mutationFn: (name) => client.post<Bucket>("/v1/buckets", { name }),
    onSuccess: () => {
      // Invalidate rather than write the new row into the cache. The list is
      // small, the refetch is invisible, and there is no second source of
      // truth to keep in step.
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
    },
  });
}

export function useDeleteBucket() {
  const queryClient = useQueryClient();
  return useMutation<Deleted, ApiError, string>({
    mutationFn: (name) => client.del<Deleted>(`/v1/buckets/${encodeURIComponent(name)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      // api_key_buckets cascades, so deleting a bucket silently shrinks the
      // scope of every key that named it.
      //
      // No click driven test can falsify this line: /buckets and /keys are
      // mutually exclusive routes and the key list's staleTime is 0, so a
      // walk-through refetches on mount either way. Its test asserts
      // isInvalidated on the cache directly, which is the only assertion that
      // fails when this line is removed.
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: (error) => {
      // A stale secret_count is the only way this happens, so the row is
      // showing a number the server just disproved. Refetch to correct it.
      if (error.code === "BUCKET_NOT_EMPTY") {
        void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      }
    },
  });
}
