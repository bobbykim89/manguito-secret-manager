import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";
import { SESSION_QUERY_KEY } from "../../api/queryClient";

type LogoutData = components["schemas"]["LogoutData"];

/**
 * Destroy the session.
 *
 * On success the session is cleared, which is the same move the global 401
 * handler makes, so the guard performs the redirect in both cases and there is
 * one path out of the application.
 *
 * On failure the session is deliberately left intact. Clearing it would tell
 * the user they are signed out while the server side session is still alive.
 */
export function useSignOut(): UseMutationResult<LogoutData, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<LogoutData, ApiError, void>({
    mutationFn: () => client.post<LogoutData>("/v1/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });
}
