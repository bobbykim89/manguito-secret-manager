import { useQuery } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";
import { SESSION_QUERY_KEY } from "../../api/queryClient";

/** Derived from the Pydantic model, so a backend rename breaks tsc. */
export type SessionUser = components["schemas"]["MeData"];

export type Session =
  | { status: "pending" }
  | { status: "authenticated"; user: SessionUser }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

/**
 * Who the caller is, or why we cannot say.
 *
 * A 401 means logged out and is the expected answer for a visitor with no
 * cookie. Any other failure means we genuinely do not know: treating a
 * backend outage as logged out sends the user to the login page, where
 * signing in fails, returning them to the login page having learned nothing.
 * A cached user also survives a transient non-401 failure, so a single
 * dropped background refetch (refetchOnWindowFocus fires one on every tab
 * focus) does not evict someone who is already signed in.
 */
export function useSession(): Session {
  const query = useQuery<SessionUser | null, ApiError>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => client.get<SessionUser>("/v1/auth/me"),
  });

  if (query.error) {
    if (query.error.code === "UNAUTHENTICATED") {
      return { status: "unauthenticated" };
    }
    // A cached user survives a transient failure. Reporting "error" here would
    // hand the guard a reason to replace the whole application over one dropped
    // refetch, which refetchOnWindowFocus makes routine.
    if (query.data === undefined) {
      return { status: "error", message: query.error.message };
    }
  }
  if (query.isPending) {
    return { status: "pending" };
  }
  // null is written by the global 401 handler and by sign out.
  return query.data === null || query.data === undefined
    ? { status: "unauthenticated" }
    : { status: "authenticated", user: query.data };
}
