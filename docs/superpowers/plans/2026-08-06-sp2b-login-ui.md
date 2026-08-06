# SP2b: Login screen and authenticated shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SP2's authentication layer reachable from a browser, through a login screen, a route guard, and a minimal signed-in shell.

**Architecture:** A `["session"]` query on `GET /v1/auth/me` is the single source of truth for who you are. A layout route guards everything except `/login`, `/health`, and the not-found page. A global handler on the query cache clears the session when any request returns 401, and the guard performs the redirect, so there is one path out of the application rather than two.

**Tech Stack:** React 19, Vite, TypeScript strict, Tailwind 4, React Router 7, TanStack Query 5, Vitest, React Testing Library, MSW. No new dependencies.

## Global Constraints

Every task's requirements implicitly include this section.

- **No new dependencies.** Zustand, Zod, and React Hook Form stay uninstalled: SP2b has no client state and no form, since the sign-in control is a link rather than a submit. (ADR 003 A5)
- **TypeScript strict, no `any` in committed code.** `noUncheckedIndexedAccess` is on, so indexing a record yields `T | undefined`.
- **The sign-in control is an anchor, never a button with an onClick.** The flow is a top level browser navigation through Google and back; a `fetch` would receive an opaque redirect and silently do nothing.
- **The raw `?error=` parameter is never rendered.** It is attacker controllable. Codes map to fixed messages with a generic fallback.
- **No auth state in `localStorage`, `sessionStorage`, or URL state.** (ADR 003)
- **Envelope narrowing stays in `client.ts` only.** No `ok` checks in hooks or components. (ADR 003 A1)
- **`web/src/api/generated.ts` is generated. Never hand-edit it.**
- Tests mock at the fetch boundary with MSW. Test behavior, not hooks or class names. Do not assert on Tailwind classes.
- Feature-first directories under `src/features/`.
- Tailwind only. No CSS modules, no styled-components.
- **No em dashes** in code, comments, docs, or commit messages.
- Comments explain why, not what.
- Commit messages: commitizen format, imperative, scoped (`feat(web): ...`).
- No backend change. `api/` is untouched, so `make types` must produce no diff.

**Test counts:** each task states how many tests *it* adds. Do not assert a cumulative total; verify the task's own tests pass and that nothing previously passing broke.

---

### Task 1: `client.post` and the API base URL helper

**Files:**
- Modify: `web/src/api/client.ts`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Consumes: the existing `request<T>` and `BASE_URL` in `client.ts`.
- Produces: `apiUrl(path: string): string`, and `client.post<T>(path: string, body?: unknown): Promise<T>`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/api/client.test.ts`:

```ts
describe("client.post", () => {
  it("sends a POST and returns the data arm", async () => {
    let method: string | undefined;
    server.use(
      http.post(`${BASE}/v1/auth/logout`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true, data: { signed_out: true } });
      }),
    );

    await expect(client.post<{ signed_out: boolean }>("/v1/auth/logout")).resolves.toEqual({
      signed_out: true,
    });
    expect(method).toBe("POST");
  });

  it("sends no body and no content type when none is given", async () => {
    let contentType: string | null = null;
    let raw = "";
    server.use(
      http.post(`${BASE}/v1/auth/logout`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        raw = await request.text();
        return HttpResponse.json({ ok: true, data: { signed_out: true } });
      }),
    );

    await client.post("/v1/auth/logout");

    expect(contentType).toBeNull();
    expect(raw).toBe("");
  });

  it("serialises a body as JSON when one is given", async () => {
    let received: unknown;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v1/thing`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        received = await request.json();
        return HttpResponse.json({ ok: true, data: { ok: 1 } });
      }),
    );

    await client.post("/v1/thing", { name: "x" });

    expect(received).toEqual({ name: "x" });
    expect(contentType).toContain("application/json");
  });

  it("throws ApiError on the failure arm, like get", async () => {
    server.use(
      http.post(`${BASE}/v1/auth/logout`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );

    await expect(client.post("/v1/auth/logout")).rejects.toMatchObject({
      name: "ApiError",
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });
});

describe("apiUrl", () => {
  it("composes a path onto the configured API base", () => {
    expect(apiUrl("/v1/auth/google/start")).toBe(`${BASE}/v1/auth/google/start`);
  });
});
```

Add `apiUrl` to the file's import from `./client`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- src/api/client.test.ts`
Expected: FAIL, `client.post is not a function` and `apiUrl is not exported`.

- [ ] **Step 3: Implement**

In `web/src/api/client.ts`, add below the `BASE_URL` declaration:

```ts
/**
 * Absolute URL for a path on the API.
 *
 * Exported so callers that cannot go through `request`, such as the sign-in
 * anchor that must be a real browser navigation, do not read VITE_API_URL a
 * second time and drift from this module.
 */
export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}
```

Replace the `client` export with:

```ts
export const client = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(
      path,
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          },
    ),
};
```

Sending no body and no `Content-Type` when there is nothing to send matters: `POST /v1/auth/logout` takes no payload, and an empty body with a JSON content type is a lie some servers reject.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm test -- src/api/client.test.ts`
Expected: 5 new tests pass alongside the existing ones.

- [ ] **Step 5: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): add client.post and an API base URL helper

The helper exists so the sign-in anchor, which must be a real browser
navigation rather than a fetch, does not read VITE_API_URL a second time."
```

---

### Task 2: The query client and the global 401 handler

**Files:**
- Create: `web/src/api/queryClient.ts`
- Modify: `web/src/test/render.tsx`
- Test: `web/src/api/queryClient.test.ts`

**Interfaces:**
- Consumes: `ApiError` from `./client`.
- Produces: `SESSION_QUERY_KEY` (a readonly `["session"]` tuple) and `createQueryClient(): QueryClient`. `renderWithProviders(ui, options?)` gains an optional `{ queryClient }`.

**Why the handler clears rather than navigates.** The guard in Task 4 already owns redirection. A handler that called `router.navigate` would bury navigation in a cache callback and create an import cycle between the router and the query client. Clearing the session lets the existing mechanism react.

- [ ] **Step 1: Write the failing tests**

Create `web/src/api/queryClient.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- src/api/queryClient.test.ts`
Expected: FAIL, cannot resolve `./queryClient`.

- [ ] **Step 3: Implement**

Create `web/src/api/queryClient.ts`:

```ts
import { QueryCache, QueryClient } from "@tanstack/react-query";

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
 * A fresh client per call, so tests never share a cache.
 */
export function createQueryClient(): QueryClient {
  // The handler needs the client it is attached to. It is assigned two
  // statements below, and the callback cannot fire before a query runs.
  let client: QueryClient | undefined;

  const queryCache = new QueryCache({
    onError: (error, query) => {
      if (client === undefined) {
        return;
      }
      // The guard reads the session query's own error directly, so clearing it
      // here would tell it nothing and would replace an error state with data.
      if (query.queryKey[0] === SESSION_QUERY_KEY[0]) {
        return;
      }
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        client.setQueryData(SESSION_QUERY_KEY, null);
      }
    },
  });

  client = new QueryClient({
    queryCache,
    defaultOptions: { queries: { retry: false } },
  });

  return client;
}
```

- [ ] **Step 4: Point the test render helper at the real client**

Replace `web/src/test/render.tsx` with:

```tsx
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { createQueryClient } from "../api/queryClient";

/**
 * A fresh client per test, built by the same factory the application uses, so
 * tests exercise the real global 401 handler rather than a stand-in.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { queryClient?: QueryClient } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createQueryClient();

  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}
```

Returning the client lets later tasks assert on cache state after an interaction.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && pnpm test`
Expected: 6 new tests pass, and the existing health and router tests still pass since `renderWithProviders` keeps its single argument form.

- [ ] **Step 6: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/queryClient.ts web/src/api/queryClient.test.ts web/src/test/render.tsx
git commit -m "feat(web): add the query client and a global 401 handler

The handler clears the session and does not navigate, because the route guard
already owns redirection. Tests build the client through the same factory the
application uses, so they exercise the real handler."
```

---

### Task 3: `useSession`

**Files:**
- Create: `web/src/features/auth/useSession.ts`
- Test: `web/src/features/auth/useSession.test.tsx`

**Interfaces:**
- Consumes: `client` from `../../api/client`, `SESSION_QUERY_KEY` from `../../api/queryClient`, `components` from `../../api/generated`.
- Produces: `SessionUser` (alias of `components["schemas"]["MeData"]`) and `useSession(): Session`, where `Session` is a discriminated union with `status` of `"pending" | "authenticated" | "unauthenticated" | "error"`.

**The union is the point.** A 401 means logged out; anything else means we do not know. Collapsing them loops the user between the login page and a failing callback while the backend is down.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/auth/useSession.test.tsx`:

```tsx
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

  it("reports unauthenticated when the session has been cleared to null", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, null);
    const { Wrapper } = wrapper(queryClient);

    const { result } = renderHook(() => useSession(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });
});
```

The last test is the one that joins this hook to Task 2's handler: clearing the session to `null` has to read as logged out, or the global 401 path does nothing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- src/features/auth/useSession.test.tsx`
Expected: FAIL, cannot resolve `./useSession`.

- [ ] **Step 3: Implement**

Create `web/src/features/auth/useSession.ts`:

```ts
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
 */
export function useSession(): Session {
  const query = useQuery<SessionUser | null, ApiError>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => client.get<SessionUser>("/v1/auth/me"),
  });

  if (query.error) {
    return query.error.code === "UNAUTHENTICATED"
      ? { status: "unauthenticated" }
      : { status: "error", message: query.error.message };
  }
  if (query.isPending) {
    return { status: "pending" };
  }
  // null is written by the global 401 handler and by sign out.
  return query.data ? { status: "authenticated", user: query.data } : { status: "unauthenticated" };
}
```

The error branch is checked before `isPending` because a query whose data was cleared to `null` while an error is present would otherwise report the wrong state.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm test -- src/features/auth/useSession.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/auth/useSession.ts web/src/features/auth/useSession.test.tsx
git commit -m "feat(web): add useSession

A 401 means logged out; any other failure means we do not know. Collapsing
them loops the user between the login page and a failing callback whenever the
backend is down."
```

---

### Task 4: The route guard

**Files:**
- Create: `web/src/features/auth/RequireSession.tsx`
- Test: `web/src/features/auth/RequireSession.test.tsx`

**Interfaces:**
- Consumes: `useSession` from `./useSession`.
- Produces: `RequireSession`, a component rendering `<Outlet />` for authenticated callers. Used as a layout route with no `path`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/auth/RequireSession.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { RequireSession } from "./RequireSession";

const ME = "http://localhost:8000/v1/auth/me";

function renderGuard() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<RequireSession />}>
          <Route path="/" element={<p>protected content</p>} />
        </Route>
        <Route path="/login" element={<p>login screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireSession", () => {
  it("renders a loading state while the session is unknown", () => {
    server.use(http.get(ME, async () => new Promise(() => {})));

    renderGuard();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the children when authenticated", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
    );

    renderGuard();

    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("redirects to the login screen on a 401", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );

    renderGuard();

    expect(await screen.findByText("login screen")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("shows an error and does NOT redirect when the server is unreachable", async () => {
    server.use(http.get(ME, () => HttpResponse.error()));

    renderGuard();

    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText("login screen")).not.toBeInTheDocument();
  });
});
```

The last test is the important one. Without it, a future edit that collapses "error" into "unauthenticated" would pass every other test in this file while trapping users in a login loop whenever the API is down.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- src/features/auth/RequireSession.test.tsx`
Expected: FAIL, cannot resolve `./RequireSession`.

- [ ] **Step 3: Implement**

Create `web/src/features/auth/RequireSession.tsx`:

```tsx
import { Navigate, Outlet } from "react-router";

import { useSession } from "./useSession";

/**
 * Layout route guarding everything that needs a session.
 *
 * A guard rather than a check per page, so later sub-projects add routes as
 * children and inherit it. The loading state is unavoidable: ADR 003 forbids
 * caching an auth hint in JS accessible storage, so the first paint genuinely
 * cannot know who you are.
 */
export function RequireSession() {
  const session = useSession();

  if (session.status === "pending") {
    return <p className="p-8 text-slate-500">Loading</p>;
  }

  if (session.status === "error") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Cannot reach the server</h1>
        <p className="mt-2 text-slate-600">{session.message}</p>
      </main>
    );
  }

  if (session.status === "unauthenticated") {
    // replace, so the back button does not bounce between here and login.
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm test -- src/features/auth/RequireSession.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/auth/RequireSession.tsx web/src/features/auth/RequireSession.test.tsx
git commit -m "feat(web): add the session route guard

A server outage renders an error rather than redirecting, so an unreachable
backend does not trap the user in a login loop."
```

---

### Task 5: The login screen and its error messages

**Files:**
- Create: `web/src/features/auth/errorMessages.ts`
- Create: `web/src/features/auth/LoginPage.tsx`
- Test: `web/src/features/auth/errorMessages.test.ts`
- Test: `web/src/features/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `apiUrl` from `../../api/client`, `useSession` from `./useSession`.
- Produces: `messageForErrorCode(code: string | null): string | null`, `FALLBACK_ERROR_MESSAGE`, and `LoginPage`.

**Why the lookup is its own module.** It is the boundary that stops attacker supplied text reaching the screen. A named module with its own tests is harder to bypass by accident than an object inlined in a component.

- [ ] **Step 1: Write the failing message tests**

Create `web/src/features/auth/errorMessages.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { FALLBACK_ERROR_MESSAGE, messageForErrorCode } from "./errorMessages";

describe("messageForErrorCode", () => {
  it("returns nothing when there is no code", () => {
    expect(messageForErrorCode(null)).toBeNull();
  });

  it.each([
    ["CONSENT_DENIED", /cancelled/i],
    ["INVALID_STATE", /expired/i],
    ["EXCHANGE_FAILED", /could not complete/i],
    ["EMAIL_NOT_VERIFIED", /not verified/i],
  ])("maps %s to its own message", (code, pattern) => {
    expect(messageForErrorCode(code)).toMatch(pattern);
  });

  it("falls back for an unrecognised code", () => {
    expect(messageForErrorCode("SOMETHING_ELSE")).toBe(FALLBACK_ERROR_MESSAGE);
  });

  it("never returns attacker supplied text", () => {
    const injected = "Your account is locked. Call 555-0100.";

    expect(messageForErrorCode(injected)).toBe(FALLBACK_ERROR_MESSAGE);
    expect(messageForErrorCode(injected)).not.toContain("555");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/auth/errorMessages.test.ts`
Expected: FAIL, cannot resolve `./errorMessages`.

- [ ] **Step 3: Implement the lookup**

Create `web/src/features/auth/errorMessages.ts`:

```ts
/**
 * Callback failure codes mapped to text.
 *
 * The raw `?error=` value is never rendered. It is attacker controllable, so
 * echoing it would let anyone put arbitrary text on the login screen, for
 * example a fake support phone number. React escapes markup, so this is not
 * XSS; it is a content injection and a phishing surface.
 *
 * These are exactly the four codes api/app/routers/auth.py can emit.
 */
const MESSAGES: Record<string, string> = {
  CONSENT_DENIED: "Sign in was cancelled. You can try again whenever you're ready.",
  INVALID_STATE: "That sign in attempt expired. Please start again.",
  EXCHANGE_FAILED: "We could not complete sign in with Google. Please try again.",
  EMAIL_NOT_VERIFIED:
    "Your Google account's email address is not verified. Verify it with Google, then try again.",
};

export const FALLBACK_ERROR_MESSAGE = "Sign in did not complete. Please try again.";

export function messageForErrorCode(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return MESSAGES[code] ?? FALLBACK_ERROR_MESSAGE;
}
```

`INVALID_STATE` says "expired" rather than naming CSRF: the common cause is a stale tab, telling an ordinary user they may have been attacked is alarming and usually wrong, and telling a real attacker their attempt was detected helps nobody.

- [ ] **Step 4: Write the failing page tests**

Create `web/src/features/auth/LoginPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { LoginPage } from "./LoginPage";

const ME = "http://localhost:8000/v1/auth/me";

function unauthenticated() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
        { status: 401 },
      ),
    ),
  );
}

function renderLogin(search = "") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>signed in area</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("offers a sign in link pointing at the API start endpoint", async () => {
    unauthenticated();

    renderLogin();

    const link = await screen.findByRole("link", { name: /continue with google/i });
    expect(link).toHaveAttribute("href", "http://localhost:8000/v1/auth/google/start");
  });

  it("shows no error when there is no error parameter", async () => {
    unauthenticated();

    renderLogin();

    await screen.findByRole("link", { name: /continue with google/i });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["CONSENT_DENIED", /cancelled/i],
    ["INVALID_STATE", /expired/i],
    ["EXCHANGE_FAILED", /could not complete/i],
    ["EMAIL_NOT_VERIFIED", /not verified/i],
  ])("renders the message for %s", async (code, pattern) => {
    unauthenticated();

    renderLogin(`?error=${code}`);

    expect(await screen.findByRole("alert")).toHaveTextContent(pattern);
  });

  it("renders the fallback and not the raw parameter for an unknown code", async () => {
    unauthenticated();

    renderLogin("?error=Your%20account%20is%20locked.%20Call%20555-0100.");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not complete/i);
    expect(alert).not.toHaveTextContent(/555/);
  });

  it("redirects an already authenticated visitor away from the login screen", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
    );

    renderLogin();

    expect(await screen.findByText("signed in area")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/auth/LoginPage.test.tsx`
Expected: FAIL, cannot resolve `./LoginPage`.

- [ ] **Step 6: Implement the page**

Create `web/src/features/auth/LoginPage.tsx`:

```tsx
import { Navigate, useSearchParams } from "react-router";

import { apiUrl } from "../../api/client";
import { messageForErrorCode } from "./errorMessages";
import { useSession } from "./useSession";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const message = messageForErrorCode(searchParams.get("error"));

  if (session.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Manguito Secret Manager</h1>
      <p className="mt-2 text-slate-600">Sign in to manage your secrets.</p>

      {message !== null && (
        <p role="alert" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          {message}
        </p>
      )}

      {/*
        An anchor, not a button with an onClick. The flow is a top level
        browser navigation to Google and back through the API's callback. A
        fetch would receive an opaque redirect and silently do nothing.
      */}
      <a
        href={apiUrl("/v1/auth/google/start")}
        className="mt-6 inline-block rounded bg-slate-900 px-4 py-2 text-white"
      >
        Continue with Google
      </a>
    </main>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd web && pnpm test -- src/features/auth`
Expected: 7 message tests and 9 page tests pass, alongside the earlier auth tests.

- [ ] **Step 8: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/auth/errorMessages.ts web/src/features/auth/errorMessages.test.ts web/src/features/auth/LoginPage.tsx web/src/features/auth/LoginPage.test.tsx
git commit -m "feat(web): add the login screen

Callback error codes map to fixed messages and the raw query parameter is
never rendered, because it is attacker controllable and would otherwise turn
the login screen into a billboard for whatever text an attacker chooses."
```

---

### Task 6: Sign out and the shell

**Files:**
- Create: `web/src/features/auth/useSignOut.ts`
- Create: `web/src/features/shell/AppShell.tsx`
- Test: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `client` from `../../api/client`, `SESSION_QUERY_KEY` from `../../api/queryClient`, `useSession` from `../auth/useSession`.
- Produces: `useSignOut()` returning a TanStack mutation, and `AppShell`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/shell/AppShell.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SESSION_QUERY_KEY } from "../../api/queryClient";
import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { AppShell } from "./AppShell";

const ME = "http://localhost:8000/v1/auth/me";
const LOGOUT = "http://localhost:8000/v1/auth/logout";

function signedIn() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json({
        ok: true,
        data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
      }),
    ),
  );
}

function renderShell() {
  return renderWithProviders(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("shows the signed in email", async () => {
    signedIn();

    renderShell();

    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
  });

  it("says secret management is still to come", async () => {
    signedIn();

    renderShell();

    expect(await screen.findByText(/next sub-project/i)).toBeInTheDocument();
  });

  it("clears the session when sign out succeeds", async () => {
    signedIn();
    server.use(http.post(LOGOUT, () => HttpResponse.json({ ok: true, data: { signed_out: true } })));
    const { queryClient } = renderShell();
    await screen.findByText("a@example.com");

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull());
  });

  it("keeps the session and explains when sign out fails", async () => {
    signedIn();
    server.use(http.post(LOGOUT, () => HttpResponse.error()));
    const { queryClient } = renderShell();
    await screen.findByText("a@example.com");

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not sign out/i);
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).not.toBeNull();
  });
});
```

The last test matters: clearing the session locally after a failed logout would tell the user they are signed out while the server side session is still alive, which is the wrong lie for a secret manager to tell.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/shell/AppShell.test.tsx`
Expected: FAIL, cannot resolve `./AppShell`.

- [ ] **Step 3: Implement the mutation**

Create `web/src/features/auth/useSignOut.ts`:

```ts
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
```

- [ ] **Step 4: Implement the shell**

Create `web/src/features/shell/AppShell.tsx`:

```tsx
import { useSession } from "../auth/useSession";
import { useSignOut } from "../auth/useSignOut";

/**
 * The signed in shell.
 *
 * Only ever rendered inside RequireSession, so the session is authenticated in
 * practice. useSession is read again rather than threaded through an outlet
 * context because the query is already cached under the same key, so this
 * costs nothing and keeps the component independently testable.
 */
export function AppShell() {
  const session = useSession();
  const signOut = useSignOut();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold">Manguito Secret Manager</span>
        <div className="flex items-center gap-4">
          {session.status === "authenticated" && (
            <span className="text-sm text-slate-600">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="rounded border px-3 py-1 text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      {signOut.isError && (
        <p role="alert" className="mx-6 mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm">
          Could not sign out. Please try again.
        </p>
      )}

      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">You are signed in</h1>
        <p className="mt-2 text-slate-600">
          Secret management arrives in the next sub-project.
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && pnpm test -- src/features/shell/AppShell.test.tsx`
Expected: 4 passed.

- [ ] **Step 6: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/auth/useSignOut.ts web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx
git commit -m "feat(web): add sign out and the signed in shell

A failed sign out leaves the session intact rather than clearing it locally,
because telling the user they are signed out while the server side session
lives is the wrong lie for a secret manager to tell."
```

---

### Task 7: Wire the routes, and prove the seams

**Files:**
- Modify: `web/src/routes/router.tsx`
- Modify: `web/src/routes/router.test.tsx`
- Modify: `web/src/main.tsx`
- Test: `web/src/routes/access.test.tsx`

**Interfaces:**
- Consumes: `LoginPage`, `RequireSession`, `AppShell`, `HealthPage`, `NotFound`, `createQueryClient`.
- Produces: the final four route `routes` array, and a `main.tsx` that builds its client through `createQueryClient`.

- [ ] **Step 1: Write the access tests**

Create `web/src/routes/access.test.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import { client } from "../api/client";
import { RequireSession } from "../features/auth/RequireSession";
import { LoginPage } from "../features/auth/LoginPage";
import { renderWithProviders } from "../test/render";
import { server } from "../test/setup";
import { routes } from "./router";

const ME = "http://localhost:8000/v1/auth/me";

function signedOut() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
        { status: 401 },
      ),
    ),
  );
}

function signedIn() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json({
        ok: true,
        data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
      }),
    ),
  );
}

describe("route access", () => {
  it("sends a signed out visitor from / to the login screen", async () => {
    signedOut();
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("returns the user to the login screen after signing out", async () => {
    signedIn();
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    renderWithProviders(<RouterProvider router={router} />);
    await screen.findByText("a@example.com");

    // The cookie is gone once logout succeeds, so /me must start refusing.
    // Without this the login page mounts a fresh observer, refetches at the
    // default staleTime of 0, gets a signed in user back, and bounces
    // straight to "/" again. The test would fail for a reason the
    // application does not actually have.
    server.use(
      http.post("http://localhost:8000/v1/auth/logout", () => {
        signedOut();
        return HttpResponse.json({ ok: true, data: { signed_out: true } });
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("keeps /health reachable while signed out", async () => {
    signedOut();
    server.use(
      http.get("http://localhost:8000/v1/health", () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/health"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });
});

/**
 * A protected page whose own request is rejected, so this exercises the global
 * handler through a query that is not the session check. Written against a
 * throwaway route because SP2b has no other authenticated call yet, and a test
 * using /me alone would pass even if the handler only ever worked for /me.
 */
function Probe() {
  useQuery({ queryKey: ["probe"], queryFn: () => client.get("/v1/probe") });
  return <p>probe rendered</p>;
}

describe("global 401 handling", () => {
  it("sends the user to login when a non-session query is unauthorised", async () => {
    signedIn();
    server.use(
      http.get("http://localhost:8000/v1/probe", () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );
    const probeRoutes: RouteObject[] = [
      { path: "/login", element: <LoginPage /> },
      { element: <RequireSession />, children: [{ path: "/", element: <Probe /> }] },
    ];
    const router = createMemoryRouter(probeRoutes, { initialEntries: ["/"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- src/routes`
Expected: FAIL. There is no `/login` route yet, so `/` still renders the health page and no sign-in link exists to find.

- [ ] **Step 3: Rewrite the routes**

Replace `web/src/routes/router.tsx` with:

```tsx
import { createBrowserRouter, type RouteObject } from "react-router";

import { LoginPage } from "../features/auth/LoginPage";
import { RequireSession } from "../features/auth/RequireSession";
import { HealthPage } from "../features/health/HealthPage";
import { AppShell } from "../features/shell/AppShell";
import { NotFound } from "./NotFound";

/**
 * Everything is behind RequireSession except login, health, and not found.
 *
 * The guard is a layout route rather than a check repeated per page, so later
 * sub-projects add routes as children and inherit it. Health stays public: it
 * is a development affordance, and putting a database check behind a login
 * would defeat its purpose.
 */
export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/health", element: <HealthPage /> },
  {
    element: <RequireSession />,
    children: [{ path: "/", element: <AppShell /> }],
  },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
```

- [ ] **Step 4: Update the existing router test**

`web/src/routes/router.test.tsx` currently asserts the health page renders at the index route, which is no longer true. Replace its first test with one that covers the new location, and keep the not-found test:

```tsx
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";
import { server } from "../test/setup";
import { routes } from "./router";

describe("router", () => {
  it("renders the health page at /health", async () => {
    server.use(
      http.get("http://localhost:8000/v1/health", () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/health"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });

  it("renders a not-found message for an unknown path", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/nope"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Point main.tsx at the shared factory**

In `web/src/main.tsx`, replace the inline client construction:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { createQueryClient } from "./api/queryClient";
import "./index.css";
import { router } from "./routes/router";

const queryClient = createQueryClient();
```

Leave the rest of the file unchanged. `QueryClient` is no longer imported directly.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && pnpm test`
Expected: the two router tests and three access tests pass, along with every earlier suite.

- [ ] **Step 7: Confirm no backend drift**

Run: `make types && git diff --exit-code -- web/src/api/generated.ts`
Expected: no diff. SP2b changes no Pydantic model.

- [ ] **Step 8: Run lint and the full suite**

Run: `make lint && make test`
Expected: clean, with no warnings.

- [ ] **Step 9: Verify by hand against a real login**

Automated tests stop at the fetch boundary, so nothing above proves the Google redirect chain works. That needs a browser and a real client.

```bash
make dev
```

Open `http://localhost:5173`. Expected: redirected to `/login`. Click Continue with Google, complete the flow, and confirm you land on the shell with your email in the header. Click Sign out and confirm you return to `/login`.

If you have not configured a Google client yet, `docs/google-oauth-setup.md` covers it.

Record the outcome in your report. This is the only check that covers acceptance criterion 4.

- [ ] **Step 10: Commit**

```bash
git add web/src/routes web/src/main.tsx
git commit -m "feat(web): put the app behind the session guard

Health moves to a public /health. The global 401 test uses a throwaway route
rather than /me, so it would fail if the handler only ever worked for the
session check itself."
```

---

## What SP2b deliberately leaves undone

| Deferred to | Items |
|---|---|
| **SP3** | Buckets, secrets, envelope encryption, API keys, and the shell body that replaces the placeholder. Zustand arrives with reveal toggles, Zod and React Hook Form with the first real form |
| **SP4** | Audit log, rate limiting, security headers, the threat model in the README |
| **Later** | Any visual design beyond default Tailwind, a sessions list, and a nicer first-paint loading treatment if the current one reads as a flash |
