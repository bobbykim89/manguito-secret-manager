import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/queryClient";
import { BUCKETS_QUERY_KEY } from "../buckets/useBuckets";
import { server } from "../../test/setup";
import {
  secretsQueryKey,
  secretValueQueryKey,
  useDeleteSecret,
  usePutSecret,
  useSecrets,
  useSecretValue,
} from "./useSecrets";

const BASE = "http://localhost:8000";
const SECRETS = `${BASE}/v1/buckets/alpha/secrets`;

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-11T00:00:00Z",
  };
}

function harness() {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useSecrets", () => {
  it("lists a bucket's secrets", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })));
    const { wrapper } = harness();

    const { result } = renderHook(() => useSecrets("alpha"), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0]?.key_name).toBe("A");
  });

  it("escapes a bucket name into the path", async () => {
    let path: string | undefined;
    server.use(
      http.get(`${BASE}/v1/buckets/:bucket/secrets`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ ok: true, data: [] });
      }),
    );
    const { wrapper } = harness();

    const { result } = renderHook(() => useSecrets("a b"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("/v1/buckets/a%20b/secrets");
  });
});

describe("useSecretValue", () => {
  it("sends no request at all while revealed is false", async () => {
    let calls = 0;
    server.use(
      http.get(`${SECRETS}/K`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: { ...aSecret("K"), value: "v" } });
      }),
    );
    const { wrapper } = harness();

    const { result } = renderHook(() => useSecretValue("alpha", "K", false), { wrapper });

    // Nothing to wait for is the assertion. Give the query a chance to fire
    // before concluding it did not.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(calls).toBe(0);
  });

  it("fetches once revealed, and serves the cache on a re-reveal", async () => {
    let calls = 0;
    server.use(
      http.get(`${SECRETS}/K`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: { ...aSecret("K"), value: "s3cr3t" } });
      }),
    );
    const { wrapper } = harness();

    const { rerender, result } = renderHook(
      ({ revealed }: { revealed: boolean }) => useSecretValue("alpha", "K", revealed),
      { wrapper, initialProps: { revealed: true } },
    );
    await waitFor(() => expect(result.current.data?.value).toBe("s3cr3t"));

    rerender({ revealed: false });
    rerender({ revealed: true });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    // staleTime: Infinity, so one visit is one secret.read audit row however
    // many times the user toggles.
    expect(calls).toBe(1);
  });
});

describe("usePutSecret", () => {
  it("PUTs the value and invalidates both the secret list and the bucket list", async () => {
    let body: unknown;
    server.use(
      http.put(`${SECRETS}/NEW`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, data: aSecret("NEW") });
      }),
    );
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(secretsQueryKey("alpha"), [aSecret("OLD")]);
    queryClient.setQueryData(BUCKETS_QUERY_KEY, []);

    const { result } = renderHook(() => usePutSecret("alpha"), { wrapper });
    result.current.mutate({ keyName: "NEW", value: "s3cr3t" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ value: "s3cr3t" });
    // secret_count lives on the bucket list, so a write there is stale too.
    expect(queryClient.getQueryState(secretsQueryKey("alpha"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(BUCKETS_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it("drops the replaced key's cached value, and keeps every other one", async () => {
    server.use(http.put(`${SECRETS}/A`, () => HttpResponse.json({ ok: true, data: aSecret("A") })));
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(secretValueQueryKey("alpha", "A"), { ...aSecret("A"), value: "old" });
    queryClient.setQueryData(secretValueQueryKey("alpha", "B"), { ...aSecret("B"), value: "keep" });

    const { result } = renderHook(() => usePutSecret("alpha"), { wrapper });
    result.current.mutate({ keyName: "A", value: "new" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // staleTime is Infinity, so without this the row would show "old" for the
    // rest of the visit.
    expect(queryClient.getQueryData(secretValueQueryKey("alpha", "A"))).toBeUndefined();
    expect(queryClient.getQueryData(secretValueQueryKey("alpha", "B"))).toEqual({
      ...aSecret("B"),
      value: "keep",
    });
  });
});

describe("useDeleteSecret", () => {
  it("deletes, invalidates both lists, and drops only that key's cached value", async () => {
    let method: string | undefined;
    server.use(
      http.delete(`${SECRETS}/A`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true, data: aSecret("A") });
      }),
    );
    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(secretsQueryKey("alpha"), [aSecret("A")]);
    queryClient.setQueryData(BUCKETS_QUERY_KEY, []);
    queryClient.setQueryData(secretValueQueryKey("alpha", "A"), { ...aSecret("A"), value: "gone" });
    queryClient.setQueryData(secretValueQueryKey("alpha", "B"), { ...aSecret("B"), value: "keep" });

    const { result } = renderHook(() => useDeleteSecret("alpha"), { wrapper });
    result.current.mutate("A");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(method).toBe("DELETE");
    expect(queryClient.getQueryState(secretsQueryKey("alpha"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(BUCKETS_QUERY_KEY)?.isInvalidated).toBe(true);
    // A plaintext under a key nothing can display again is pointless to hold.
    expect(queryClient.getQueryData(secretValueQueryKey("alpha", "A"))).toBeUndefined();
    expect(queryClient.getQueryData(secretValueQueryKey("alpha", "B"))).toEqual({
      ...aSecret("B"),
      value: "keep",
    });
  });
});

describe("the query key roots", () => {
  it("keeps secrets off the bucket key, so a bucket write cannot wipe them", () => {
    // SP6's useBuckets invalidates BUCKETS_QUERY_KEY with the default
    // exact: false. If secrets nested under it, every bucket create or delete
    // would discard every open secret list.
    expect(secretsQueryKey("alpha")[0]).not.toBe(BUCKETS_QUERY_KEY[0]);
    expect(secretValueQueryKey("alpha", "A")[0]).not.toBe(secretsQueryKey("alpha")[0]);
  });
});
