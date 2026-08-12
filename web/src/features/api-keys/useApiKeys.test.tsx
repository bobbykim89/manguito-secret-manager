import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/queryClient";
import { server } from "../../test/setup";
import { BUCKETS_QUERY_KEY, useDeleteBucket } from "../buckets/useBuckets";
import {
  API_KEYS_QUERY_KEY,
  keyStatus,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "./useApiKeys";

const BASE = "http://localhost:8000";
const KEYS = `${BASE}/v1/keys`;

function aKey(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    lookup_id: "a3f9c2e1",
    name: "ci-deploy",
    buckets: ["prod"],
    can_write: false,
    can_reveal: false,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

function harness() {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useApiKeys", () => {
  it("lists the account's keys", async () => {
    server.use(http.get(KEYS, () => HttpResponse.json({ ok: true, data: [aKey()] })));
    const { wrapper } = harness();

    const { result } = renderHook(() => useApiKeys(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0]?.name).toBe("ci-deploy");
  });
});

describe("useCreateApiKey", () => {
  it("posts the body and invalidates the list", async () => {
    let body: unknown;
    server.use(
      http.post(KEYS, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { ok: true, data: { ...aKey(), token: "msm_a3f9c2e1_secret" } },
          { status: 201 },
        );
      }),
    );
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(API_KEYS_QUERY_KEY, []);

    const { result } = renderHook(() => useCreateApiKey(), { wrapper });
    result.current.mutate({
      name: "ci-deploy",
      buckets: ["prod"],
      can_write: false,
      can_reveal: false,
      expires_at: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({
      name: "ci-deploy",
      buckets: ["prod"],
      can_write: false,
      can_reveal: false,
      expires_at: null,
    });
    expect(result.current.data?.token).toBe("msm_a3f9c2e1_secret");
    expect(queryClient.getQueryState(API_KEYS_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it("drops the token when reset, so nothing holds it after acknowledgement", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          { ok: true, data: { ...aKey(), token: "msm_a3f9c2e1_secret" } },
          { status: 201 },
        ),
      ),
    );
    const { wrapper } = harness();

    const { result } = renderHook(() => useCreateApiKey(), { wrapper });
    result.current.mutate({
      name: "x",
      buckets: ["prod"],
      can_write: false,
      can_reveal: false,
      expires_at: null,
    });
    await waitFor(() => expect(result.current.data?.token).toBe("msm_a3f9c2e1_secret"));

    result.current.reset();

    await waitFor(() => expect(result.current.data).toBeUndefined());
  });
});

describe("useRevokeApiKey", () => {
  it("deletes by id and invalidates the list", async () => {
    let method: string | undefined;
    let path: string | undefined;
    server.use(
      http.delete(`${KEYS}/:id`, ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(API_KEYS_QUERY_KEY, [aKey()]);

    const { result } = renderHook(() => useRevokeApiKey(), { wrapper });
    result.current.mutate("11111111-1111-1111-1111-111111111111");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(method).toBe("DELETE");
    expect(path).toBe("/v1/keys/11111111-1111-1111-1111-111111111111");
    expect(queryClient.getQueryState(API_KEYS_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it("refetches on API_KEY_NOT_FOUND, since the row is showing something gone", async () => {
    server.use(
      http.delete(`${KEYS}/:id`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "API_KEY_NOT_FOUND", message: "No such API key." } },
          { status: 404 },
        ),
      ),
    );
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(API_KEYS_QUERY_KEY, [aKey()]);

    const { result } = renderHook(() => useRevokeApiKey(), { wrapper });
    result.current.mutate("11111111-1111-1111-1111-111111111111");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryState(API_KEYS_QUERY_KEY)?.isInvalidated).toBe(true);
  });
});

describe("deleting a bucket invalidates the key list", () => {
  it("marks api-keys stale, because a cascade shrinks every key scoped to it", async () => {
    // Asserted on the cache, not through a UI walk-through. /buckets and
    // /keys are mutually exclusive routes and the list's staleTime is 0, so a
    // click driven test would pass with or without the invalidation. SP7
    // shipped that exact mistake.
    server.use(
      http.delete(`${BASE}/v1/buckets/:name`, () =>
        HttpResponse.json({ ok: true, data: { deleted: true } }),
      ),
    );
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(BUCKETS_QUERY_KEY, []);
    queryClient.setQueryData(API_KEYS_QUERY_KEY, [aKey()]);

    const { result } = renderHook(() => useDeleteBucket(), { wrapper });
    result.current.mutate("spare");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(API_KEYS_QUERY_KEY)?.isInvalidated).toBe(true);
  });
});

describe("keyStatus", () => {
  const NOW = Date.parse("2026-08-11T00:00:00.000Z");

  it("is revoked when revoked_at is set, whatever the expiry says", () => {
    expect(keyStatus(aKey({ revoked_at: "2026-08-01T00:00:00Z" }), NOW)).toBe("revoked");
    expect(
      keyStatus(
        aKey({ revoked_at: "2026-08-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("is expired when the expiry has passed", () => {
    expect(keyStatus(aKey({ expires_at: "2026-08-10T23:59:59Z" }), NOW)).toBe("expired");
  });

  it("is active with a future expiry or none at all", () => {
    expect(keyStatus(aKey({ expires_at: "2026-12-01T00:00:00Z" }), NOW)).toBe("active");
    expect(keyStatus(aKey({ expires_at: null }), NOW)).toBe("active");
  });
});
