import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "../../api/queryClient";
import { server } from "../../test/setup";
import { useBuckets, useCreateBucket, useDeleteBucket } from "./useBuckets";

const LIST = "http://localhost:8000/v1/buckets";

function wrapper() {
  const client = createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function aBucket(name: string, secretCount = 0) {
  return {
    id: `id-${name}`,
    name,
    created_at: "2026-08-11T00:00:00Z",
    secret_count: secretCount,
  };
}

describe("useBuckets", () => {
  it("returns the list the API sent", async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ ok: true, data: [aBucket("prod", 2)] })));

    const { result } = renderHook(() => useBuckets(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([aBucket("prod", 2)]);
  });

  it("surfaces a failure as an ApiError", async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Nope." } },
          { status: 401 },
        ),
      ),
    );

    const { result } = renderHook(() => useBuckets(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe("UNAUTHENTICATED");
  });
});

describe("useCreateBucket", () => {
  it("posts the name and refetches the list", async () => {
    let posted: unknown;
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: [] });
      }),
      http.post(LIST, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ok: true, data: aBucket("fresh") }, { status: 201 });
      }),
    );
    const Wrapper = wrapper();
    const list = renderHook(() => useBuckets(), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const { result } = renderHook(() => useCreateBucket(), { wrapper: Wrapper });
    result.current.mutate("fresh");

    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
    expect(posted).toEqual({ name: "fresh" });
  });
});

describe("useDeleteBucket", () => {
  it("deletes by name and refetches the list", async () => {
    let deleted: string | undefined;
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: [] });
      }),
      http.delete(`${LIST}/:name`, ({ params }) => {
        deleted = String(params.name);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    const Wrapper = wrapper();
    const list = renderHook(() => useBuckets(), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const { result } = renderHook(() => useDeleteBucket(), { wrapper: Wrapper });
    result.current.mutate("gone");

    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
    expect(deleted).toBe("gone");
  });

  it("refetches the list when the count turns out to be stale", async () => {
    // BUCKET_NOT_EMPTY means secret_count was out of date, so the row is
    // claiming something the server just disproved. Refetching is what
    // corrects it.
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: [aBucket("full", 0)] });
      }),
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );
    const Wrapper = wrapper();
    const list = renderHook(() => useBuckets(), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const before = listCalls;

    const { result } = renderHook(() => useDeleteBucket(), { wrapper: Wrapper });
    result.current.mutate("full");

    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
  });

  it("does not refetch when the failure is unrelated to a stale count", async () => {
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: [] });
      }),
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Nope." } },
          { status: 401 },
        ),
      ),
    );
    const Wrapper = wrapper();
    const list = renderHook(() => useBuckets(), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const before = listCalls;

    const { result } = renderHook(() => useDeleteBucket(), { wrapper: Wrapper });
    result.current.mutate("whatever");

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Give any wrongly-unconditional invalidation a chance to fire before
    // asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listCalls).toBe(before);
  });
});
