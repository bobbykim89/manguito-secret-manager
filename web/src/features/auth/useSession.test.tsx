import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SESSION_QUERY_KEY, createQueryClient } from "../../api/queryClient";
import { server } from "../../test/setup";
import { useSession } from "./useSession";

const ME = "http://localhost:8000/v1/auth/me";

function wrapper(queryClient = createQueryClient()) {
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("useSession", () => {
  it("reports authenticated with the user on success", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
    );
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current).toMatchObject({ user: { email: "a@example.com" } });
  });

  it("reports pending before the request settles", () => {
    server.use(http.get(ME, async () => new Promise(() => {})));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    expect(result.current.status).toBe("pending");
  });

  it("reports unauthenticated on a 401", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });

  it("reports error on a 500, not unauthenticated", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
          { status: 500 },
        ),
      ),
    );
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("reports error when the API is unreachable", async () => {
    server.use(http.get(ME, () => HttpResponse.error()));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("reports unauthenticated when the session has been cleared to null", () => {
    // A handler is registered so the refetch this mount triggers is answered
    // rather than logging an unhandled request. It deliberately returns a
    // user: the assertion runs on the first render, which reads the cached
    // null, so a regression that treated null as authenticated would fail
    // here instead of being masked by a 401 arriving later.
    server.use(
      http.get(ME, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
    );
    const queryClient = createQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
    const { Wrapper } = wrapper(queryClient);

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    expect(result.current.status).toBe("unauthenticated");
  });

  it("keeps the cached user through a failed refetch", async () => {
    // refetchOnWindowFocus is on, so a stale, momentarily-failing /me is
    // routine, not exceptional. The first response is the initial mount; the
    // second is the refetch triggered explicitly below.
    let requestCount = 0;
    server.use(
      http.get(ME, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json({
            ok: true,
            data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
          });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
          { status: 500 },
        );
      }),
    );
    const queryClient = createQueryClient();
    const { Wrapper } = wrapper(queryClient);

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    await queryClient.refetchQueries({ queryKey: SESSION_QUERY_KEY });

    await waitFor(() => expect(requestCount).toBe(2));
    expect(result.current.status).toBe("authenticated");
  });

  it("becomes unauthenticated when a refetch returns 401", async () => {
    // The regression a plain reorder would introduce: cached data must not
    // paper over a 401, which is the one failure that means logged out.
    let requestCount = 0;
    server.use(
      http.get(ME, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json({
            ok: true,
            data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
          });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        );
      }),
    );
    const queryClient = createQueryClient();
    const { Wrapper } = wrapper(queryClient);

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    await queryClient.refetchQueries({ queryKey: SESSION_QUERY_KEY });

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });
});
