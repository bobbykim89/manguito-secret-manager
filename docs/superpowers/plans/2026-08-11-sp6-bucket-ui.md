# SP6: The bucket UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make buckets usable from a browser, and land the form and mutation foundations the next two UI sub-projects build on.

**Architecture:** `/buckets` is a page under the existing session guard, reached by a redirect from `/`. TanStack Query owns the server state through three hooks; Zod and React Hook Form arrive with the create form; each row owns its own delete mutation and confirm flag, so no shared client state is needed and Zustand keeps waiting for SP7.

**Tech Stack:** React 19, Vite 6, TypeScript strict, Tailwind 4, React Router 7, TanStack Query 5, Zod, React Hook Form, Vitest, MSW.

## Global Constraints

- Frontend only. Nothing under `api/` changes, and `make types` must produce no diff.
- `zod`, `react-hook-form` and `@hookform/resolvers` are the only new dependencies. **Zustand is not among them**: ADR 003 A5 names its first consumer as reveal toggles, which is SP7.
- TypeScript strict, no `any` in committed code.
- Feature-first directories under `src/features/`, not type-first.
- TanStack Query owns server state. Zustand owns client state only, and has none here.
- **`src/api/generated.ts` is generated. Never hand-edit it.**
- Tests mock at the fetch boundary with MSW. Test behavior, not hooks or class names. Never assert on Tailwind classes.
- Test output must be pristine. A warning or an stderr line is a defect, including an MSW unhandled-request error.
- Tailwind only. No CSS modules, no styled-components.
- **No secret values in `localStorage`, `sessionStorage`, URL state, or client-side error reporting.** Nothing in SP6 handles one, and nothing here may establish a pattern that makes SP7 awkward.
- Errors surface where the thing that failed is. No toasts, no global error store.
- No em dashes in code, comments, or commit messages.
- Comments explain why, not what.
- Commit messages: conventional commits, imperative mood, scoped (`feat(web): ...`).

---

## File Structure

```
web/src/
├── api/
│   ├── client.ts                 modify: add del
│   ├── client.test.ts            modify: del's tests
│   ├── queryClient.ts            modify: the MutationCache handler
│   └── queryClient.test.ts       modify: the mutation 401 test
├── features/
│   ├── buckets/
│   │   ├── bucketName.ts         new: the pattern, message and Zod schema
│   │   ├── bucketName.test.ts    new
│   │   ├── useBuckets.ts         new: the three hooks
│   │   ├── useBuckets.test.tsx   new
│   │   ├── CreateBucketForm.tsx  new
│   │   ├── CreateBucketForm.test.tsx new
│   │   ├── BucketRow.tsx         new: one row, its confirm flag and its mutation
│   │   ├── BucketsPage.tsx       new: form, list, empty and error states
│   │   └── BucketsPage.test.tsx  new
│   └── shell/
│       ├── AppShell.tsx          modify: body becomes an Outlet
│       └── AppShell.test.tsx     modify
└── routes/
    ├── router.tsx                modify: the redirect and /buckets
    └── access.test.tsx           modify: / redirects to /buckets
```

`BucketRow` is its own file because it owns behaviour, not markup: a confirm
flag, a mutation, and three states of its own. `BucketsPage` stays small enough
to read in one screen as a result.

---

### Task 1: `client.del`

**Files:**
- Modify: `web/src/api/client.ts`, `web/src/api/client.test.ts`

**Interfaces:**
- Consumes: the existing `request` function and `ApiError`.
- Produces: `client.del<T>(path: string): Promise<T>`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/api/client.test.ts`, following the file's existing style:

```ts
describe("client.del", () => {
  it("sends DELETE and returns the narrowed data", async () => {
    let method: string | undefined;
    server.use(
      http.delete("http://localhost:8000/v1/buckets/gone", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );

    const data = await client.del<{ deleted: boolean }>("/v1/buckets/gone");

    expect(method).toBe("DELETE");
    expect(data).toEqual({ deleted: true });
  });

  it("throws ApiError on the envelope's failure arm", async () => {
    server.use(
      http.delete("http://localhost:8000/v1/buckets/full", () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );

    await expect(client.del("/v1/buckets/full")).rejects.toMatchObject({
      code: "BUCKET_NOT_EMPTY",
      status: 409,
    });
  });

  it("sends credentials, like every other method", async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.delete("http://localhost:8000/v1/buckets/creds", ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );

    await client.del("/v1/buckets/creds");

    expect(credentials).toBe("include");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/api/client.test.ts`
Expected: FAIL with `client.del is not a function`.

- [ ] **Step 3: Add the method**

In `web/src/api/client.ts`, add to the exported `client` object, after `post`:

```ts
  del: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
```

Named `del` rather than `delete`, which is a reserved word and cannot be a bare
property shorthand. It goes through `request` like the others, so it inherits
the envelope narrowing rather than forking a second path.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd web && pnpm test -- src/api/client.test.ts`
Expected: PASS, no warnings.

- [ ] **Step 5: Lint and commit**

Run: `make lint`

```bash
git add web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): add client.del

Goes through the same request function as get and post, so it inherits the
response envelope narrowing rather than forking a second path."
```

---

### Task 2: The 401 handler covers mutations

**Files:**
- Modify: `web/src/api/queryClient.ts`, `web/src/api/queryClient.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `SESSION_QUERY_KEY`.
- Produces: `createQueryClient()` returning a client whose `MutationCache` clears the session on an `UNAUTHENTICATED` error.

- [ ] **Step 1: Write the failing test**

Append to `web/src/api/queryClient.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/api/queryClient.test.ts`
Expected: the first FAILS with `expected undefined to be null` or the seeded
user, because nothing clears the session for a mutation. The second passes
already, which is fine: it exists to stop the fix over-reaching.

- [ ] **Step 3: Add the MutationCache**

In `web/src/api/queryClient.ts`, extend the import:

```ts
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
```

Add the cache after `queryCache` is built and before the client is constructed:

```ts
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
```

Pass it to the client:

```ts
  client = new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: { queries: { retry: false } },
  });
```

Replace the paragraph in the module docstring that currently says a mutation
touching real secret data will need the same handling added to a
`MutationCache`, since it now has it:

```
 * The same handler is installed on the MutationCache, so a 401 from any
 * mutation clears the session too. SP2b had only sign out, whose endpoint
 * needs no auth, so the query half was enough then and is not now. See ADR
 * 003 A8.
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd web && pnpm test -- src/api/queryClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the test would fail without the fix**

The test asserts an absence becoming a `null`, which is the shape that passes
for the wrong reason if something else clears the session. Remove
`mutationCache` from the `QueryClient` options, leaving the cache built but
unattached.

Run: `cd web && pnpm test -- src/api/queryClient.test.ts`
Expected: FAIL on the first test only, with the seeded user still in place.
Restore the option and confirm both pass. Record both outputs in your report;
do not commit the temporary change.

- [ ] **Step 6: Run everything and commit**

Run: `make lint && make test`

```bash
git add web/src/api/queryClient.ts web/src/api/queryClient.test.ts
git commit -m "feat(web): clear the session on a 401 from a mutation

The handler was on the QueryCache only, which fires for queries and not
mutations. That was safe while the only mutation was sign out, whose endpoint
needs no auth. It stops being safe the moment the UI mutates real data: a user
whose cookie expired would click a button, get a 401, and go on looking signed
in until some unrelated query noticed."
```

---

### Task 3: The bucket name schema

**Files:**
- Create: `web/src/features/buckets/bucketName.ts`, `web/src/features/buckets/bucketName.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `BUCKET_NAME_PATTERN: RegExp`, `BUCKET_NAME_MESSAGE: string`, `bucketNameSchema` (a Zod object with one `name` field), `type BucketNameValues = { name: string }`.

- [ ] **Step 1: Install Zod**

Run: `cd web && pnpm add zod`

- [ ] **Step 2: Write the failing tests**

Create `web/src/features/buckets/bucketName.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bucketNameSchema } from "./bucketName";

// The same cases api/tests/test_buckets_api.py uses. If these two ever
// disagree, the server still refuses and this only guesses wrong about when.
const ACCEPTED = ["prod", "a", "blog-prod", "manguito_staging", "x".repeat(63)];
const REJECTED = ["Prod", "with space", "with/slash", "-leading", "", "x".repeat(64)];

describe("bucketNameSchema", () => {
  it.each(ACCEPTED)("accepts %j", (name) => {
    expect(bucketNameSchema.safeParse({ name }).success).toBe(true);
  });

  it.each(REJECTED)("rejects %j", (name) => {
    expect(bucketNameSchema.safeParse({ name }).success).toBe(false);
  });

  it("explains the rule rather than restating the regex", () => {
    const result = bucketNameSchema.safeParse({ name: "Prod" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toMatch(/lowercase/i);
      expect(message).not.toContain("^[a-z0-9]");
    }
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/buckets/bucketName.test.ts`
Expected: FAIL with a module resolution error for `./bucketName`.

- [ ] **Step 4: Write the schema**

Create `web/src/features/buckets/bucketName.ts`:

```ts
import { z } from "zod";

/**
 * Duplicated from the backend's NAME_PATTERN, deliberately and visibly.
 *
 * FastAPI emits the pattern into the OpenAPI schema, but openapi-typescript
 * produces types and a regex is a runtime value, so nothing carries it across
 * the generated boundary. This is the only copy on this side, and its test
 * uses the same cases the backend's does. If the two drift, the server still
 * refuses and this merely guesses wrong about when, which is the failure mode
 * worth having rather than its reverse. See ADR 002 A16.
 */
export const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

// Teaches the rule rather than restating the regex, because lowercase only is
// the part people get wrong.
export const BUCKET_NAME_MESSAGE =
  "Use lowercase letters, numbers, hyphens and underscores, starting with a letter or number.";

export const bucketNameSchema = z.object({
  name: z.string().regex(BUCKET_NAME_PATTERN, BUCKET_NAME_MESSAGE),
});

export type BucketNameValues = z.infer<typeof bucketNameSchema>;
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd web && pnpm test -- src/features/buckets/bucketName.test.ts`
Expected: 12 cases PASS.

- [ ] **Step 6: Lint and commit**

Run: `make lint`

```bash
git add web/src/features/buckets/bucketName.ts web/src/features/buckets/bucketName.test.ts web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): add the bucket name schema

The pattern is duplicated from the backend because a regex is a runtime value
and the generated types carry none. One copy on this side, tested against the
same cases the backend uses, so a drift shows up as a behaviour difference
rather than silently."
```

---

### Task 4: The data hooks

**Files:**
- Create: `web/src/features/buckets/useBuckets.ts`, `web/src/features/buckets/useBuckets.test.tsx`

**Interfaces:**
- Consumes: `client` from `../../api/client`, `components` from `../../api/generated`.
- Produces: `type Bucket = components["schemas"]["BucketData"]`, `BUCKETS_QUERY_KEY = ["buckets"]`, `useBuckets()`, `useCreateBucket()` taking a name, `useDeleteBucket()` taking a name.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/buckets/useBuckets.test.tsx`:

```tsx
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
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/buckets/useBuckets.test.tsx`
Expected: FAIL with a module resolution error for `./useBuckets`.

- [ ] **Step 3: Write the hooks**

Create `web/src/features/buckets/useBuckets.ts`:

```ts
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
```

`encodeURIComponent` is defensive rather than load bearing: the name charset
excludes everything that would need it, and relying on that from the client
would couple this line to a rule enforced elsewhere.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd web && pnpm test -- src/features/buckets/useBuckets.test.tsx`
Expected: PASS, no warnings and no unhandled-request errors.

- [ ] **Step 5: Lint and commit**

Run: `make lint`

```bash
git add web/src/features/buckets/useBuckets.ts web/src/features/buckets/useBuckets.test.tsx
git commit -m "feat(web): add the bucket query and mutations

Invalidate and refetch rather than optimistic updates: the list is small
enough that the refetch is invisible and there is no second source of truth to
keep in step. A BUCKET_NOT_EMPTY also refetches, because a stale secret_count
is the only way it happens."
```

---

### Task 5: The create form

**Files:**
- Create: `web/src/features/buckets/CreateBucketForm.tsx`, `web/src/features/buckets/CreateBucketForm.test.tsx`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `bucketNameSchema`, `BucketNameValues` from `./bucketName`; `useCreateBucket` from `./useBuckets`.
- Produces: `CreateBucketForm`, taking no props.

- [ ] **Step 1: Install React Hook Form and its Zod resolver**

Run: `cd web && pnpm add react-hook-form @hookform/resolvers`

- [ ] **Step 2: Write the failing tests**

Create `web/src/features/buckets/CreateBucketForm.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { CreateBucketForm } from "./CreateBucketForm";

const LIST = "http://localhost:8000/v1/buckets";

describe("CreateBucketForm", () => {
  it("rejects an invalid name without sending a request", async () => {
    // The point of validating on this side at all. If Zod were decorative,
    // this would reach the network and the server would answer 422.
    let requests = 0;
    server.use(
      http.post(LIST, () => {
        requests += 1;
        return HttpResponse.json({ ok: true, data: {} }, { status: 201 });
      }),
    );
    renderWithProviders(<CreateBucketForm />);

    await userEvent.type(screen.getByRole("textbox", { name: /bucket name/i }), "Prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/lowercase/i);
    expect(requests).toBe(0);
  });

  it("sends a valid name and clears the field", async () => {
    let posted: unknown;
    server.use(
      http.post(LIST, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { ok: true, data: { id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 } },
          { status: 201 },
        );
      }),
      http.get(LIST, () => HttpResponse.json({ ok: true, data: [] })),
    );
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });

    await userEvent.type(input, "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(posted).toEqual({ name: "prod" }));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("puts a name already taken on the field", async () => {
    // It is validation, performed by the only party that can perform it, so
    // it reads as validation rather than as a banner.
    server.use(
      http.post(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_EXISTS", message: "A bucket named 'prod' already exists." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<CreateBucketForm />);

    await userEvent.type(screen.getByRole("textbox", { name: /bucket name/i }), "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  });

  it("keeps what was typed when the server refuses", async () => {
    // Retyping a name the server just explained is pure friction.
    server.use(
      http.post(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_EXISTS", message: "Taken." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });

    await userEvent.type(input, "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await screen.findByRole("alert");
    expect(input).toHaveValue("prod");
  });

  it("shows any other failure without blaming the field", async () => {
    server.use(http.post(LIST, () => HttpResponse.error()));
    renderWithProviders(<CreateBucketForm />);

    await userEvent.type(screen.getByRole("textbox", { name: /bucket name/i }), "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/buckets/CreateBucketForm.test.tsx`
Expected: FAIL with a module resolution error for `./CreateBucketForm`.

- [ ] **Step 4: Write the form**

Create `web/src/features/buckets/CreateBucketForm.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { bucketNameSchema, type BucketNameValues } from "./bucketName";
import { useCreateBucket } from "./useBuckets";

export function CreateBucketForm() {
  const create = useCreateBucket();
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<BucketNameValues>({ resolver: zodResolver(bucketNameSchema) });

  const onSubmit = handleSubmit((values) => {
    create.mutate(values.name, {
      // Reset only on success. A failed submit keeps what was typed, because
      // retyping a name the server just explained is pure friction.
      onSuccess: () => reset(),
      onError: (error) => {
        if (error.code === "BUCKET_EXISTS") {
          // Validation performed by the only party that can perform it, so it
          // belongs on the field rather than in a banner.
          setError("name", { message: error.message });
          return;
        }
        setError("root", { message: error.message });
      },
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="bucket-name" className="sr-only">
          Bucket name
        </label>
        <input
          id="bucket-name"
          {...register("name")}
          placeholder="new-bucket"
          disabled={create.isPending}
          aria-invalid={errors.name ? true : undefined}
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          Create
        </button>
      </div>
      {errors.name && (
        <p role="alert" className="text-sm text-red-700">
          {errors.name.message}
        </p>
      )}
      {errors.root && (
        <p role="alert" className="text-sm text-red-700">
          {errors.root.message}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd web && pnpm test -- src/features/buckets/CreateBucketForm.test.tsx`
Expected: PASS, no warnings.

If the first test finds no alert, the cause is that the resolver is not wired
and the submit reached the mutation. Do not fix it by asserting on the request
count alone; the alert is what proves Zod ran.

- [ ] **Step 6: Lint and commit**

Run: `make lint`

```bash
git add web/src/features/buckets/CreateBucketForm.tsx web/src/features/buckets/CreateBucketForm.test.tsx web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): add the create bucket form

Zod and React Hook Form arrive with their first real consumer, per ADR 003 A5.
An invalid name never reaches the network, and a name already taken lands on
the field rather than in a banner, because it is validation performed by the
only party that can perform it."
```

---

### Task 6: The row and the page

**Files:**
- Create: `web/src/features/buckets/BucketRow.tsx`, `web/src/features/buckets/BucketsPage.tsx`, `web/src/features/buckets/BucketsPage.test.tsx`

**Interfaces:**
- Consumes: `useBuckets`, `useDeleteBucket`, `type Bucket` from `./useBuckets`; `CreateBucketForm` from `./CreateBucketForm`.
- Produces: `BucketRow` taking `{ bucket: Bucket }`, and `BucketsPage` taking no props.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/buckets/BucketsPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { BucketsPage } from "./BucketsPage";

const LIST = "http://localhost:8000/v1/buckets";

function aBucket(name: string, secretCount = 0) {
  return {
    id: `id-${name}`,
    name,
    created_at: "2026-08-11T00:00:00Z",
    secret_count: secretCount,
  };
}

function listReturns(...buckets: ReturnType<typeof aBucket>[]) {
  server.use(http.get(LIST, () => HttpResponse.json({ ok: true, data: buckets })));
}

describe("BucketsPage", () => {
  it("shows a row per bucket with its secret count", async () => {
    listReturns(aBucket("alpha", 3), aBucket("beta", 0));
    renderWithProviders(<BucketsPage />);

    const alpha = await screen.findByRole("listitem", { name: /alpha/i });

    expect(within(alpha).getByText(/3 secrets/i)).toBeInTheDocument();
    expect(within(alpha).getByRole("time")).toHaveAttribute("datetime", "2026-08-11T00:00:00Z");
    expect(screen.getByRole("listitem", { name: /beta/i })).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: /beta/i })).getByText(/0 secrets/i))
      .toBeInTheDocument();
  });

  it("says there are no buckets rather than looking like it is still loading", async () => {
    listReturns();
    renderWithProviders(<BucketsPage />);

    expect(await screen.findByText(/no buckets yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a failure to load", async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<BucketsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("refuses to delete a bucket that still holds secrets, and says why", async () => {
    // The 409 is explained before it can happen rather than discovered
    // through an error.
    listReturns(aBucket("occupied", 2));
    renderWithProviders(<BucketsPage />);
    const row = await screen.findByRole("listitem", { name: /occupied/i });

    expect(within(row).getByRole("button", { name: /delete/i })).toBeDisabled();
    expect(within(row).getByText(/still holds/i)).toBeInTheDocument();
  });

  it("confirms before deleting and can be cancelled", async () => {
    let deletes = 0;
    listReturns(aBucket("spare"));
    server.use(
      http.delete(`${LIST}/:name`, () => {
        deletes += 1;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    renderWithProviders(<BucketsPage />);
    const row = await screen.findByRole("listitem", { name: /spare/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    expect(within(row).getByText(/delete this bucket/i)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: /cancel/i }));

    expect(within(row).queryByText(/delete this bucket/i)).not.toBeInTheDocument();
    expect(deletes).toBe(0);
  });

  it("deletes when confirmed", async () => {
    let deleted: string | undefined;
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: listCalls > 1 ? [] : [aBucket("spare")] });
      }),
      http.delete(`${LIST}/:name`, ({ params }) => {
        deleted = String(params.name);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    renderWithProviders(<BucketsPage />);
    const row = await screen.findByRole("listitem", { name: /spare/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(row).getByRole("button", { name: /yes/i }));

    await waitFor(() => expect(deleted).toBe("spare"));
    expect(await screen.findByText(/no buckets yet/i)).toBeInTheDocument();
  });

  it("shows a stale count's rejection on the row it belongs to", async () => {
    // secret_count came from the last fetch, so something could have written
    // through the API since.
    listReturns(aBucket("racy", 0));
    server.use(
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<BucketsPage />);
    const row = await screen.findByRole("listitem", { name: /racy/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(row).getByRole("button", { name: /yes/i }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(/still holds secrets/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/features/buckets/BucketsPage.test.tsx`
Expected: FAIL with a module resolution error for `./BucketsPage`.

- [ ] **Step 3: Write the row**

Create `web/src/features/buckets/BucketRow.tsx`:

```tsx
import { useState } from "react";

import { useDeleteBucket, type Bucket } from "./useBuckets";

/**
 * One bucket, owning its own confirm flag and its own delete mutation.
 *
 * A page level "which row is confirming" would need this component to receive
 * the flag plus start, cancel, confirm, pending and error as props, which is
 * seven arguments to say one thing. Owning them takes one prop and gets per
 * row pending and error states for free. Two rows can sit in confirm state at
 * once, which is harmless.
 */
export function BucketRow({ bucket }: { bucket: Bucket }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteBucket();
  const holdsSecrets = bucket.secret_count > 0;

  return (
    <li aria-label={bucket.name} className="flex flex-col gap-1 border-b py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="font-medium">{bucket.name}</span>
          <span className="ml-3 text-sm text-slate-600">
            {bucket.secret_count} {bucket.secret_count === 1 ? "secret" : "secrets"}
          </span>
          <time dateTime={bucket.created_at} className="ml-3 text-sm text-slate-500">
            {new Date(bucket.created_at).toLocaleDateString()}
          </time>
        </div>

        {confirming ? (
          <div className="flex items-center gap-2 text-sm">
            <span>Delete this bucket?</span>
            <button
              type="button"
              onClick={() => remove.mutate(bucket.name)}
              disabled={remove.isPending}
              className="rounded border px-2 py-1"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border px-2 py-1"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            {holdsSecrets && (
              <span className="text-slate-600">Still holds secrets</span>
            )}
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={holdsSecrets}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {remove.isError && (
        <p role="alert" className="text-sm text-red-700">
          {remove.error.message}
        </p>
      )}
    </li>
  );
}
```

The disabled button carries a visible reason beside it rather than only a
`title`, because a `title` is invisible to touch and to a screen reader that is
not hovering.

- [ ] **Step 4: Write the page**

Create `web/src/features/buckets/BucketsPage.tsx`:

```tsx
import { BucketRow } from "./BucketRow";
import { CreateBucketForm } from "./CreateBucketForm";
import { useBuckets } from "./useBuckets";

export function BucketsPage() {
  const buckets = useBuckets();

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Buckets</h1>

      <CreateBucketForm />

      {buckets.isPending && (
        <p role="status" className="text-sm text-slate-600">
          Loading buckets
        </p>
      )}

      {buckets.isError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          Could not load your buckets. {buckets.error.message}
        </p>
      )}

      {buckets.isSuccess &&
        (buckets.data.length === 0 ? (
          <p className="text-slate-600">No buckets yet. Create one above.</p>
        ) : (
          <ul>
            {buckets.data.map((bucket) => (
              <BucketRow key={bucket.id} bucket={bucket} />
            ))}
          </ul>
        ))}
    </section>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd web && pnpm test -- src/features/buckets/BucketsPage.test.tsx`
Expected: PASS, no warnings and no unhandled-request errors.

Every test here renders a component that fetches `/v1/buckets`, so each one
registers a handler for it. A test that deletes also needs the DELETE handler.

- [ ] **Step 6: Lint and commit**

Run: `make lint && make test`

```bash
git add web/src/features/buckets/BucketRow.tsx web/src/features/buckets/BucketsPage.tsx web/src/features/buckets/BucketsPage.test.tsx
git commit -m "feat(web): add the bucket list with delete

Each row owns its confirm flag and its own mutation, so it takes one prop and
gets per row pending and error states for free. Delete is disabled with the
reason shown when the bucket still holds secrets, so the 409 is explained
before it can happen, and handled anyway because the count can be stale."
```

---

### Task 7: Routing to it

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`, `web/src/features/shell/AppShell.test.tsx`, `web/src/routes/router.tsx`, `web/src/routes/access.test.tsx`

**Interfaces:**
- Consumes: `BucketsPage` from `../features/buckets/BucketsPage`.
- Produces: the final `routes` array with `/` redirecting to `/buckets`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/routes/access.test.tsx`:

```tsx
it("sends a signed in visitor from / to the bucket list", async () => {
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/buckets", () => HttpResponse.json({ ok: true, data: [] })),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByRole("heading", { name: /buckets/i })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/buckets");
});

it("renders the bucket list at /buckets", async () => {
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/buckets", () => HttpResponse.json({ ok: true, data: [] })),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByText(/no buckets yet/i)).toBeInTheDocument();
});

it("keeps /buckets behind the session guard", async () => {
  signedOut();
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
});

it("sends the user to login when a mutation is unauthorised", async () => {
  // The end to end half of the MutationCache handler. The ONLY 401 in this
  // interaction comes from the DELETE: /me answers 200 throughout, so the
  // query handler cannot be what clears the session. Without that care this
  // test would pass whether or not the mutation handler exists.
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/buckets", () =>
      HttpResponse.json({
        ok: true,
        data: [
          { id: "1", name: "doomed", created_at: "2026-08-11T00:00:00Z", secret_count: 0 },
        ],
      }),
    ),
    http.delete("http://localhost:8000/v1/buckets/doomed", () =>
      HttpResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
        { status: 401 },
      ),
    ),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets"] });
  renderWithProviders(<RouterProvider router={router} />);
  const row = await screen.findByRole("listitem", { name: /doomed/i });

  await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
  await userEvent.click(within(row).getByRole("button", { name: /yes/i }));

  expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
});
```

That last test needs `userEvent` and `within` imported in this file if they are
not already.

In `web/src/features/shell/AppShell.test.tsx`, the existing tests render
`<AppShell />` directly and assert on the placeholder body. Replace any
assertion mentioning the placeholder with one that proves the shell renders its
outlet, by rendering it inside a memory router:

```tsx
it("renders whatever the router puts inside it", async () => {
  const router = createMemoryRouter(
    [{ element: <AppShell />, children: [{ path: "/", element: <p>child content</p> }] }],
    { initialEntries: ["/"] },
  );

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByText("child content")).toBeInTheDocument();
});
```

Use whatever signed-in MSW helper that file already defines to answer
`/v1/auth/me`, since `AppShell` reads the session for the header. If it defines
none, register the same handler its other tests use. Leave every other AppShell
test, including the sign out ones, exactly as it is.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test -- src/routes src/features/shell`
Expected: FAIL. The redirect test lands on the old placeholder body, and the
outlet test finds no child content because `AppShell` renders a fixed body.

- [ ] **Step 3: Make the shell a layout**

In `web/src/features/shell/AppShell.tsx`, import `Outlet` from `react-router`
and replace the `<main>` element's contents:

```tsx
      <main className="mx-auto max-w-2xl p-8">
        <Outlet />
      </main>
```

Update the component's docstring to say it is a layout route whose children
supply the body, replacing any sentence about a placeholder.

- [ ] **Step 4: Add the routes**

In `web/src/routes/router.tsx`, import `Navigate` from `react-router` and
`BucketsPage`, then replace the guarded branch:

```tsx
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppShell />,
        children: [
          // ADR 003 A7: the list lives at /buckets so that SP7's
          // /buckets/:name and SP8's /keys are siblings. replace, so the back
          // button does not bounce between / and /buckets.
          { index: true, element: <Navigate to="/buckets" replace /> },
          { path: "/buckets", element: <BucketsPage /> },
        ],
      },
    ],
  },
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd web && pnpm test -- src/routes src/features/shell`
Expected: PASS.

- [ ] **Step 6: Run everything**

Run: `make lint && make test`
Expected: clean, no warnings.

Then confirm the backend schema is untouched:

```bash
make types && git diff --exit-code -- web/src/api/generated.ts
```

Expected: no diff. SP6 changes no Pydantic model.

- [ ] **Step 7: Verify by hand**

Automated tests stop at the fetch boundary. Run the real thing once.

```bash
make dev
```

Open `http://localhost:5173`. Expected: a redirect to `/buckets`, an empty
state, and a create form. Create a bucket, watch it appear, delete it, and
confirm the two-step. If the API refuses to start, `SECRETS_KEKS` and
`SECRETS_KEK_VERSION` are missing from `.env`; `.env.example` carries the
generator.

Record the outcome in your report. This is the only check that covers the
redirect against a real browser history rather than a memory router.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/shell web/src/routes
git commit -m "feat(web): route / to the bucket list

AppShell becomes a layout whose children supply the body, which is what its
placeholder was waiting for. The list lives at /buckets rather than / so the
next two sub-projects add siblings rather than children of an inconsistent
parent."
```

---

## What SP6 deliberately leaves undone

| Deferred to | Items |
|---|---|
| **SP7** | `/buckets/:name`, the secret list, the reveal interaction, and Zustand with it |
| **SP8** | API keys, the show-once token, and the navigation bar that becomes worth having once there are two destinations |
| **Later** | Rate limiting, security headers, the README threat model, and the KEK rotation CLI |
| **v2** | Workspaces and secret versioning |

## Notes for the executing agent

**Zustand must not be installed.** ADR 003 A5 names its first consumer as
reveal toggles, which is SP7. Nothing here needs client state that a component
cannot own, and the row's confirm flag is deliberately local for that reason.

**Task 2 Step 5 is a falsification, not a formality.** The mutation 401 test
asserts an absence becoming a `null`, which is the shape that passes for the
wrong reason. Remove the cache, watch it fail, restore it. Nine assertions on
this project have looked like they proved something and did not.

**The name pattern is duplicated on purpose** and its comment says so. Do not
try to derive it from `generated.ts`; a regex is a runtime value and the
generated types carry none.

**Rows are not links.** SP7 makes them so when there is something behind them.
Do not add a detail route.
