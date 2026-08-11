import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "./client";

export const SESSION_QUERY_KEY = ["session"] as const;

/**
 * The query client, with one global rule: a 401 from anywhere means the
 * session is gone.
 *
 * The handler clears the session and does not navigate. The route guard
 * already owns redirection, so this only has to answer whether we are still
 * authenticated and let that mechanism react. Navigating from inside a cache
 * callback would hide routing somewhere nobody looks and create an import
 * cycle between the router and this module.
 *
 * The same handler is installed on the MutationCache, so a 401 from any
 * mutation clears the session too. SP2b had only sign out, whose endpoint
 * needs no auth, so the query half was enough then and is not now. See ADR
 * 003 A8.
 *
 * A fresh client per call, so tests never share a cache.
 */
export function createQueryClient(): QueryClient {
  // The handler needs the client it is attached to. It is assigned two
  // statements below, and the callback cannot fire before a query runs. The
  // explicit `= undefined` (rather than a bare declaration) keeps eslint's
  // prefer-const from proposing a rewrite that would reintroduce the
  // circular reference this two-step init exists to avoid.
  let client: QueryClient | undefined = undefined;

  const queryCache = new QueryCache({
    onError: (error, query) => {
      if (client === undefined) {
        return;
      }
      // The guard reads the session query's own error directly, so clearing it
      // here would tell it nothing and would replace an error state with data.
      // Full key equality, not just the first element: a future key such as
      // ["session", "history"] is an ordinary authenticated call, and a 401
      // from it should clear the session like any other.
      if (
        query.queryKey.length === SESSION_QUERY_KEY.length &&
        query.queryKey[0] === SESSION_QUERY_KEY[0]
      ) {
        return;
      }
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        client.setQueryData(SESSION_QUERY_KEY, null);
      }
    },
  });

  const mutationCache = new MutationCache({
    onError: (error) => {
      if (client === undefined) {
        return;
      }
      // No session key exclusion here, unlike the query cache. That exclusion
      // exists only because the route guard reads the session query's own
      // error, and no mutation writes to that key. See ADR 003 A8.
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        client.setQueryData(SESSION_QUERY_KEY, null);
      }
    },
  });

  client = new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: { queries: { retry: false } },
  });

  return client;
}
