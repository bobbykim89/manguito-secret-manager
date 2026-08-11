import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";

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
