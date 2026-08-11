import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { SESSION_QUERY_KEY, createQueryClient } from "./queryClient";

async function failWith(error: unknown, queryKey: readonly unknown[]): Promise<ReturnType<typeof createQueryClient>> {
  const queryClient = createQueryClient();
  await queryClient
    .fetchQuery({
      queryKey,
      queryFn: () => Promise.reject(error),
    })
    .catch(() => undefined);
  return queryClient;
}

describe("createQueryClient", () => {
  it("clears the session when any other query is unauthenticated", async () => {
    const queryClient = await failWith(
      new ApiError("UNAUTHENTICATED", "Authentication is required.", 401),
      ["buckets"],
    );

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  it("leaves the session alone when the session query itself fails", async () => {
    const queryClient = await failWith(
      new ApiError("UNAUTHENTICATED", "Authentication is required.", 401),
      SESSION_QUERY_KEY,
    );

    // The guard reads this query's error directly, so there is nothing to tell
    // it. Writing null here would also overwrite an error state with data.
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
  });

  it("ignores errors that are not unauthenticated", async () => {
    const queryClient = await failWith(
      new ApiError("INTERNAL_ERROR", "An unexpected error occurred.", 500),
      ["buckets"],
    );

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
  });

  it("clears the session for a key that merely starts with session", async () => {
    const queryClient = await failWith(
      new ApiError("UNAUTHENTICATED", "Authentication is required.", 401),
      ["session", "history"],
    );

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  it("ignores errors that are not ApiError at all", async () => {
    const queryClient = await failWith(new Error("boom"), ["buckets"]);

    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
  });

  it("does not retry failed queries", async () => {
    let calls = 0;
    const queryClient = createQueryClient();
    await queryClient
      .fetchQuery({
        queryKey: ["counted"],
        queryFn: () => {
          calls += 1;
          return Promise.reject(new Error("boom"));
        },
      })
      .catch(() => undefined);

    expect(calls).toBe(1);
  });

  it("returns a fresh client each call, so tests cannot share a cache", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});

describe("the mutation 401 handler", () => {
  it("clears the session when a mutation is unauthorised", async () => {
    const client = createQueryClient();
    client.setQueryData(SESSION_QUERY_KEY, { id: "1", email: "a@example.com", name: "A" });

    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError("UNAUTHENTICATED", "Nope.", 401)),
      })
      .execute(undefined)
      .catch(() => undefined);

    expect(client.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  it("leaves the session alone for any other mutation failure", async () => {
    const client = createQueryClient();
    const user = { id: "1", email: "a@example.com", name: "A" };
    client.setQueryData(SESSION_QUERY_KEY, user);

    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError("BUCKET_EXISTS", "Taken.", 409)),
      })
      .execute(undefined)
      .catch(() => undefined);

    expect(client.getQueryData(SESSION_QUERY_KEY)).toEqual(user);
  });
});
