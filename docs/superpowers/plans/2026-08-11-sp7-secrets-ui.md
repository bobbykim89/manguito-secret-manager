# SP7: The secrets UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a bucket's secrets at `/buckets/:name`, and let a person reveal, copy, write and delete one, without the list ever fetching a value.

**Architecture:** `/buckets/:name` is a page under the existing session guard, reached by making SP6's bucket rows links. Three query keys on two separate roots hold the bucket's metadata and each revealed value. Reveal is row local `useState` driving a query's `enabled` flag, which is where invariant 7 lives in code; no store arrives, so Zustand still does not ship (ADR 003 A9).

**Tech Stack:** React 19, Vite 6, TypeScript strict, Tailwind 4, React Router 7, TanStack Query 5, Zod 4, React Hook Form, Vitest, MSW.

## Global Constraints

- Frontend only. Nothing under `api/` changes, and `make types` must produce no diff.
- **No new dependency, and Zustand is not installed** (ADR 003 A9).
- **Invariant 7: list endpoints return metadata only. The frontend must not fetch a value until the user clicks reveal.** The list renders `key_name`, `created_at`, `updated_at`. **No length, ever**, including a length derived mask.
- **Invariant 8: no secret values in `localStorage`, `sessionStorage`, URL state, or client-side error reporting.** The clipboard is the one named exception (ADR 003 A10).
- **ADR 003 A4: the frontend must never request `?reveal=true`.** No request this app makes may contain the string `reveal`.
- TypeScript strict, no `any` in committed code.
- Feature-first directories under `src/features/`, not type-first.
- TanStack Query owns server state.
- **`src/api/generated.ts` is generated. Never hand-edit it.**
- Tests mock at the fetch boundary with MSW. Test behavior, not hooks or class names. Never assert on Tailwind classes.
- Test output must be pristine. A warning or an stderr line is a defect, including an MSW unhandled-request error and a React `act` warning.
- Tailwind only. No CSS modules, no styled-components.
- Errors surface where the thing that failed is. No toasts, no global error store.
- No em dashes in code, comments, or commit messages.
- Comments explain why, not what.
- Commit messages: conventional commits, imperative mood, scoped (`feat(web): ...`).

---

## File Structure

```
web/src/
├── api/
│   ├── client.ts                    modify: add put
│   └── client.test.ts               modify: put's tests
├── components/
│   ├── Alert.tsx                    new: the shared role="alert" block
│   └── Alert.test.tsx               new
├── features/
│   ├── auth/
│   │   └── LoginPage.tsx            modify: migrate to Alert
│   ├── shell/
│   │   └── AppShell.tsx             modify: migrate to Alert
│   ├── buckets/
│   │   ├── BucketRow.tsx            modify: the name becomes a Link, migrate to Alert
│   │   ├── BucketsPage.tsx          modify: migrate to Alert
│   │   ├── BucketsPage.test.tsx     modify: render inside a router
│   │   └── CreateBucketForm.tsx     modify: migrate to Alert
│   └── secrets/
│       ├── secretForm.ts            new: the key pattern, the byte limit, the Zod schema
│       ├── secretForm.test.ts       new
│       ├── useSecrets.ts            new: the four hooks and the three query keys
│       ├── useSecrets.test.tsx      new
│       ├── PutSecretForm.tsx        new: one form for add and replace
│       ├── PutSecretForm.test.tsx   new
│       ├── SecretRow.tsx            new: reveal, copy, delete, all row local
│       ├── SecretRow.test.tsx       new
│       ├── SecretsPage.tsx          new: heading, back link, form, list
│       ├── SecretsPage.test.tsx     new
│       └── invariants.test.tsx      new: the tests that pin 7, 8 and A4
└── routes/
    ├── router.tsx                   modify: /buckets/:name
    └── access.test.tsx              modify: the route is guarded
```

`SecretRow` is its own file for the reason `BucketRow` was: it owns behaviour,
not markup. Three independent pieces of state (revealed, confirming, copied),
one query and one mutation. `SecretsPage` stays readable as a result.

`invariants.test.tsx` is a separate file rather than a describe block inside
`SecretsPage.test.tsx`, because those tests are the reason this sub-project got
its own review cycle. A reviewer should be able to open one file and see every
assertion that stands between this UI and CLAUDE.md's invariants.

---

### Task 1: `client.put`

**Files:**
- Modify: `web/src/api/client.ts:106-120`
- Test: `web/src/api/client.test.ts` (append a `describe` before the `apiUrl` block)

**Interfaces:**
- Consumes: the existing `request<T>` function and `client` object.
- Produces: `client.put<T>(path: string, body: unknown): Promise<T>`.

`put` goes **inside** the single `request` function, exactly as `del` did in
SP6, so it inherits the envelope narrowing and the `credentials: "include"`
that every later call site depends on. A second fetch path is the thing this
module exists to prevent.

Unlike `post`, `body` is required and not optional. Every `PUT` this API has
carries one.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/api/client.test.ts`, immediately before the
`describe("apiUrl", ...)` block:

```ts
describe("client.put", () => {
  it("sends PUT with a JSON body and returns the narrowed data", async () => {
    let method: string | undefined;
    let body: unknown;
    server.use(
      http.put(`${BASE}/v1/buckets/b/secrets/K`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({
          ok: true,
          data: {
            key_name: "K",
            created_at: "2026-08-11T00:00:00Z",
            updated_at: "2026-08-11T00:00:00Z",
          },
        });
      }),
    );

    const data = await client.put<{ key_name: string }>("/v1/buckets/b/secrets/K", {
      value: "s3cr3t",
    });

    expect(method).toBe("PUT");
    expect(body).toEqual({ value: "s3cr3t" });
    expect(data.key_name).toBe("K");
  });

  it("throws ApiError on the envelope's failure arm", async () => {
    server.use(
      http.put(`${BASE}/v1/buckets/b/secrets/BIG`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "VALIDATION_ERROR", message: "value is too large" } },
          { status: 422 },
        ),
      ),
    );

    await expect(
      client.put("/v1/buckets/b/secrets/BIG", { value: "x" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "VALIDATION_ERROR",
      status: 422,
    });
  });

  it("sends credentials, like every other method", async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.put(`${BASE}/v1/buckets/b/secrets/C`, ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({
          ok: true,
          data: {
            key_name: "C",
            created_at: "2026-08-11T00:00:00Z",
            updated_at: "2026-08-11T00:00:00Z",
          },
        });
      }),
    );

    await client.put("/v1/buckets/b/secrets/C", { value: "x" });

    expect(credentials).toBe("include");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd web && pnpm vitest run src/api/client.test.ts`
Expected: FAIL, `client.put is not a function`.

- [ ] **Step 3: Add `put` to the client**

In `web/src/api/client.ts`, add between `post` and `del`:

```ts
  put: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && pnpm vitest run src/api/client.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(web): add client.put

Inside the single request function, so it inherits the envelope narrowing
rather than forking a second fetch path, the same way del did in SP6."
```

---

### Task 2: The shared `Alert`

**Files:**
- Create: `web/src/components/Alert.tsx`
- Create: `web/src/components/Alert.test.tsx`
- Modify: `web/src/features/buckets/BucketsPage.tsx:20-28`
- Modify: `web/src/features/buckets/BucketRow.tsx:68-72`
- Modify: `web/src/features/buckets/CreateBucketForm.tsx:56-65`
- Modify: `web/src/features/shell/AppShell.tsx:38-42`
- Modify: `web/src/features/auth/LoginPage.tsx:21-25`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Alert({ variant, tone, children }: { variant?: "banner" | "inline"; tone?: "error" | "warning"; children: ReactNode })`, from `web/src/components/Alert.tsx`. Defaults are `variant="banner"` and `tone="error"`. Always renders `role="alert"`.

Six near identical `role="alert"` paragraphs exist today. SP7 adds four more.
SP6's review said extract rather than add a seventh, and this is the third
consumer that justifies a `components/` directory at all.

The two axes are real, not speculative: `banner` (bordered, tinted, padded) and
`inline` (small red text under a field) both exist in the code being replaced,
as do `error` (red) and `warning` (amber, the sign in notice on `LoginPage`).
Four combinations, six call sites, no other props.

**No `className` passthrough.** A component that accepts arbitrary classes is
the styled `<p>` it replaced. Two call sites need outer margin (`AppShell`'s
`mx-6 mt-4` and `LoginPage`'s `mt-4`); those wrap the `Alert` in a plain `div`
carrying the margin, because margin is the parent's business and the alert's
own appearance is not.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/Alert.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert } from "./Alert";

describe("Alert", () => {
  it("announces its content to assistive technology", () => {
    render(<Alert>Something failed.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Something failed.");
  });

  it("announces an inline alert too, so a field error is not silently downgraded", () => {
    render(<Alert variant="inline">Name is taken.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Name is taken.");
  });

  it("announces a warning as an alert as well", () => {
    render(<Alert tone="warning">Sign in did not complete.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Sign in did not complete.");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && pnpm vitest run src/components/Alert.test.tsx`
Expected: FAIL, cannot resolve `./Alert`.

- [ ] **Step 3: Write the component**

Create `web/src/components/Alert.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * The one place role="alert" is spelled in this app.
 *
 * Both axes come from code this replaces rather than from anticipation:
 * banner and inline both existed, as did the amber sign in notice. There is
 * deliberately no className prop. A component that takes arbitrary classes is
 * the styled paragraph it was extracted from.
 */
export function Alert({
  variant = "banner",
  tone = "error",
  children,
}: {
  variant?: "banner" | "inline";
  tone?: "error" | "warning";
  children: ReactNode;
}) {
  const palette =
    tone === "warning"
      ? { banner: "border-amber-300 bg-amber-50", inline: "text-amber-700" }
      : { banner: "border-red-300 bg-red-50", inline: "text-red-700" };

  const className =
    variant === "banner"
      ? `rounded border p-3 text-sm ${palette.banner}`
      : `text-sm ${palette.inline}`;

  return (
    <p role="alert" className={className}>
      {children}
    </p>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd web && pnpm vitest run src/components/Alert.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Migrate `BucketsPage`**

In `web/src/features/buckets/BucketsPage.tsx`, add
`import { Alert } from "../../components/Alert";` and replace the error block:

```tsx
      {buckets.isError && (
        <Alert>
          {/* A cached list survives a transient failure the same way useSession's
              cached user does: refetchOnWindowFocus makes a dropped request
              routine, and replacing a working list with an error over one
              flaky refetch would be a worse experience than showing both. */}
          Could not refresh your buckets. {buckets.error.message}
        </Alert>
      )}
```

- [ ] **Step 6: Migrate `BucketRow`**

In `web/src/features/buckets/BucketRow.tsx`, add
`import { Alert } from "../../components/Alert";` and replace:

```tsx
      {remove.isError && <Alert variant="inline">{remove.error.message}</Alert>}
```

- [ ] **Step 7: Migrate `CreateBucketForm`**

In `web/src/features/buckets/CreateBucketForm.tsx`, add
`import { Alert } from "../../components/Alert";` and replace both blocks:

```tsx
      {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}
      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}
```

- [ ] **Step 8: Migrate `AppShell` and `LoginPage`**

In `web/src/features/shell/AppShell.tsx`, add
`import { Alert } from "../../components/Alert";` and replace:

```tsx
      {signOut.isError && (
        <div className="mx-6 mt-4">
          <Alert>Could not sign out. Please try again.</Alert>
        </div>
      )}
```

In `web/src/features/auth/LoginPage.tsx`, add
`import { Alert } from "../../components/Alert";` and replace:

```tsx
      {message !== null && (
        <div className="mt-4">
          <Alert tone="warning">{message}</Alert>
        </div>
      )}
```

- [ ] **Step 9: Run the whole frontend suite**

Run: `cd web && pnpm test`
Expected: PASS, all 112 existing tests plus the 3 new ones. The existing tests
assert on `getByRole("alert")` and text, never on classes, so a correct
migration changes nothing they can see. If any of them fail, the migration
changed behaviour and the fix belongs in the component, not the test.

- [ ] **Step 10: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/components src/features
git commit -m "feat(web): extract the shared Alert component

SP6's review said extract rather than add a sixth and seventh role=alert
paragraph. SP7 adds four more, so this is the third consumer that justifies a
components directory. No className prop: a component taking arbitrary classes
is the styled paragraph it replaced."
```

---

### Task 3: The key name pattern and the byte limit

**Files:**
- Create: `web/src/features/secrets/secretForm.ts`
- Create: `web/src/features/secrets/secretForm.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `web/src/features/secrets/secretForm.ts`:
  - `SECRET_KEY_NAME_PATTERN: RegExp`
  - `SECRET_KEY_NAME_MESSAGE: string`
  - `MAX_VALUE_BYTES: number` (65536)
  - `VALUE_TOO_LARGE_MESSAGE: string`
  - `secretFormSchema` (a Zod object with `keyName` and `value`)
  - `type SecretFormValues = { keyName: string; value: string }`

Two rules, duplicated from the backend for the reason SP6 recorded: a regex and
a byte count are runtime values, and `openapi-typescript` produces types. One
copy each on this side, tested against the backend's own case table.

**The key pattern is deliberately not the bucket rule.** Uppercase and dots are
allowed, because these are environment variable names. Do not reuse or refactor
`bucketName.ts`; ADR 002 A22 records why the asymmetry exists, and a shared
helper would invite someone to unify two rules that must not be unified.

**The byte limit is the trap.** `z.string().max(65536)` is wrong: JavaScript's
`.length` counts UTF-16 code units, so 30,000 characters of `中` passes at
30,000 while weighing 90,000 bytes and failing at the server. The check is
`new TextEncoder().encode(v).length <= MAX_VALUE_BYTES`.

There is deliberately no minimum length on the value. The backend accepts an
empty string, and a client rule the server does not have is a drift in the
direction that produces false rejections.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/secrets/secretForm.test.ts`. The two case tables are
copied from `api/tests/test_secret_key_names.py`:

```ts
import { describe, expect, it } from "vitest";

import { MAX_VALUE_BYTES, secretFormSchema } from "./secretForm";

function keyNameAccepted(keyName: string): boolean {
  return secretFormSchema.safeParse({ keyName, value: "v" }).success;
}

function valueAccepted(value: string): boolean {
  return secretFormSchema.safeParse({ keyName: "KEY", value }).success;
}

describe("the secret key name rule", () => {
  // The backend's VALID_CASES, verbatim from api/tests/test_secret_key_names.py.
  it.each([
    ["upper with underscore", "DATABASE_URL"],
    ["dotted", "stripe.webhook"],
    ["hyphenated", "next-auth"],
    ["single char", "A"],
    ["at the 128 limit", "x".repeat(128)],
  ])("accepts %s", (_label, keyName) => {
    expect(keyNameAccepted(keyName)).toBe(true);
  });

  // The backend's INVALID_CASES, verbatim.
  it.each([
    ["one over the limit", "x".repeat(129)],
    ["leading hyphen", "-leading"],
    ["leading dot", ".leading"],
    ["leading underscore", "_leading"],
    ["empty", ""],
    ["slash", "with/slash"],
    ["space", "with space"],
    ["comma", "with,comma"],
    ["trailing newline", "KEY\n"],
  ])("rejects %s", (_label, keyName) => {
    expect(keyNameAccepted(keyName)).toBe(false);
  });

  it("is not the bucket rule: uppercase and dots are the whole point", () => {
    // ADR 002 A22. If someone ever "unifies" this with bucketName.ts, this is
    // the test that stops it.
    expect(keyNameAccepted("DATABASE_URL")).toBe(true);
    expect(keyNameAccepted("stripe.webhook")).toBe(true);
  });
});

describe("the value size rule", () => {
  it("accepts a value exactly at the limit", () => {
    expect(valueAccepted("a".repeat(MAX_VALUE_BYTES))).toBe(true);
  });

  it("rejects one ASCII byte over the limit", () => {
    expect(valueAccepted("a".repeat(MAX_VALUE_BYTES + 1))).toBe(false);
  });

  it("rejects a multi byte value that is under the limit in characters", () => {
    // The trap. 30,000 characters is well under 65,536, and 90,000 bytes is
    // well over. A .max() on the string would accept this and the server
    // would reject it.
    const value = "中".repeat(30_000);

    expect(value.length).toBeLessThan(MAX_VALUE_BYTES);
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(MAX_VALUE_BYTES);
    expect(valueAccepted(value)).toBe(false);
  });

  it("accepts an empty value, because the backend does", () => {
    expect(valueAccepted("")).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/secrets/secretForm.test.ts`
Expected: FAIL, cannot resolve `./secretForm`.

- [ ] **Step 3: Write the schema**

Create `web/src/features/secrets/secretForm.ts`:

```ts
import { z } from "zod";

/**
 * Duplicated from the backend's KEY_NAME_PATTERN, deliberately and visibly,
 * for the reason bucketName.ts records: a regex is a runtime value and
 * openapi-typescript produces types, so nothing carries it across the
 * generated boundary.
 *
 * This is NOT the bucket rule. Uppercase and dots are allowed, because these
 * are environment variable names. ADR 002 A22 records why the asymmetry
 * exists, so do not unify the two.
 *
 * JavaScript's `$` without the m flag matches the true end of the string, so
 * "KEY\n" is rejected here as it is by Pydantic's Rust engine. Python's own
 * re.match would have accepted it, which is why the backend's test says so.
 */
export const SECRET_KEY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const SECRET_KEY_NAME_MESSAGE =
  "Use letters, numbers, dots, hyphens and underscores, starting with a letter or number, up to 128 characters.";

export const MAX_VALUE_BYTES = 64 * 1024;

export const VALUE_TOO_LARGE_MESSAGE = "A secret can be at most 64 KiB.";

export const secretFormSchema = z.object({
  keyName: z.string().regex(SECRET_KEY_NAME_PATTERN, SECRET_KEY_NAME_MESSAGE),
  // Bytes, not characters. z.string().max(65536) counts UTF-16 code units, so
  // 30,000 characters of a three byte character would pass here at 30,000 and
  // fail at the server at 90,000.
  value: z
    .string()
    .refine((v) => new TextEncoder().encode(v).length <= MAX_VALUE_BYTES, VALUE_TOO_LARGE_MESSAGE),
});

export type SecretFormValues = z.infer<typeof secretFormSchema>;
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/secrets/secretForm.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Falsify the byte check**

Temporarily replace the `value` field with `z.string().max(MAX_VALUE_BYTES)`
and re-run. Expected: the multi byte test fails and only that one. Restore the
`refine` version and confirm green again. A byte check that passes with a
character check is not a byte check.

- [ ] **Step 6: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/secrets
git commit -m "feat(web): add the secret key name and value size rules

Both duplicated from the backend and tested against its own case tables. The
value limit is measured in UTF-8 bytes, not characters: a .max() on the string
would accept 30,000 three byte characters that weigh 90,000 bytes."
```

---

### Task 4: The data hooks

**Files:**
- Create: `web/src/features/secrets/useSecrets.ts`
- Create: `web/src/features/secrets/useSecrets.test.tsx`

**Interfaces:**
- Consumes: `client.put` (Task 1); `BUCKETS_QUERY_KEY` from `web/src/features/buckets/useBuckets.ts`.
- Produces, from `web/src/features/secrets/useSecrets.ts`:
  - `type Secret = components["schemas"]["SecretData"]` (`key_name`, `created_at`, `updated_at`)
  - `type SecretValue = components["schemas"]["SecretValueData"]` (the same plus `value`)
  - `secretsQueryKey(bucket: string): readonly ["secrets", string]`
  - `secretValueQueryKey(bucket: string, keyName: string): readonly ["secret-value", string, string]`
  - `useSecrets(bucket: string)` → `UseQueryResult<Secret[], ApiError>`
  - `useSecretValue(bucket: string, keyName: string, revealed: boolean)` → `UseQueryResult<SecretValue, ApiError>`
  - `usePutSecret(bucket: string)` → mutation with variables `{ keyName: string; value: string }`, returning `Secret`
  - `useDeleteSecret(bucket: string)` → mutation with variables `string` (the key name), returning `Secret`

**Note that DELETE returns `SecretData`, not `DeletedData`.** `api/app/routers/secrets.py:280` declares `Ok[SecretData]`; the bucket delete is the one that returns `{ deleted: true }`. Getting this wrong types cleanly and fails at runtime.

Three keys on **two separate roots**:

```
["buckets"]                     the bucket list        SP6, unchanged
["secrets", bucket]             one bucket's metadata  new
["secret-value", bucket, key]   one revealed value     new
```

SP6's review flagged that `["buckets"]` invalidates with `exact: false`, so
nesting secrets under it would mean every bucket create or delete wiping every
open secret list. Separate roots make that impossible rather than depending on
someone remembering `exact: true`. `secret-value` is separate from `secrets`
for the same reason one level down: writing `DATABASE_URL` must not discard a
`STRIPE_KEY` value the user revealed thirty seconds ago.

Three properties of the value query carry weight:

- **`enabled: revealed`** is where invariant 7 lives in code. Nothing about
  rendering the list can cause a value fetch.
- **`staleTime: Infinity`** means hiding and re-revealing serves the cache, so
  one visit produces one `secret.read` audit row.
- **`gcTime` stays at the five minute default.** Do not set it. Navigating away
  unmounts the observer and the plaintext leaves memory five minutes later
  without anyone writing code to do it.

Both mutations invalidate `["secrets", bucket]` **and** `["buckets"]`, because
the bucket list caches `secret_count`. Without the second, deleting a bucket's
last secret and navigating back would still show Delete disabled.

Both also `removeQueries` the written or deleted key's cached value. For delete
the spec states it: leaving a decrypted plaintext in memory under a key nothing
can display again is pointless. **For put this plan adds it**, and the addition
is deliberate: `staleTime: Infinity` means a revealed row that you then replace
would otherwise display the old value for the rest of the visit. The spec's
accepted staleness risk is about writes from *elsewhere*, which the client
cannot know about. This one it does know about.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/secrets/useSecrets.test.tsx`:

```tsx
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
    expect(result.current.data?.[0].key_name).toBe("A");
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/secrets/useSecrets.test.tsx`
Expected: FAIL, cannot resolve `./useSecrets`.

- [ ] **Step 3: Write the hooks**

Create `web/src/features/secrets/useSecrets.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";
import { BUCKETS_QUERY_KEY } from "../buckets/useBuckets";

export type Secret = components["schemas"]["SecretData"];
export type SecretValue = components["schemas"]["SecretValueData"];

export type PutSecretVariables = { keyName: string; value: string };

/**
 * Two roots, not one tree.
 *
 * SP6's useBuckets invalidates BUCKETS_QUERY_KEY with the default
 * exact: false, so nesting secrets under it would mean every bucket create or
 * delete wiping every open secret list. Separate roots make that impossible
 * rather than depending on someone remembering exact: true. secret-value is
 * separate from secrets for the same reason one level down: writing
 * DATABASE_URL must not discard a STRIPE_KEY value revealed thirty seconds
 * ago.
 */
export const secretsQueryKey = (bucket: string) => ["secrets", bucket] as const;

export const secretValueQueryKey = (bucket: string, keyName: string) =>
  ["secret-value", bucket, keyName] as const;

const secretsPath = (bucket: string) => `/v1/buckets/${encodeURIComponent(bucket)}/secrets`;

const secretPath = (bucket: string, keyName: string) =>
  `${secretsPath(bucket)}/${encodeURIComponent(keyName)}`;

export function useSecrets(bucket: string) {
  return useQuery<Secret[], ApiError>({
    queryKey: secretsQueryKey(bucket),
    queryFn: () => client.get<Secret[]>(secretsPath(bucket)),
  });
}

/**
 * One secret's plaintext, fetched only once the user asks for it.
 *
 * `enabled` is where invariant 7 lives in code: nothing about rendering the
 * list can cause a value fetch, because only a click flips this flag.
 *
 * staleTime is Infinity so hiding and re-revealing serves the cache and one
 * visit produces one secret.read audit row. Once a value has been revealed it
 * is in the tab's memory, so hiding is a visual affordance rather than a
 * security boundary, and counting clicks would make a misclick
 * indistinguishable from a genuine second look at a credential.
 *
 * gcTime is deliberately left at the five minute default: navigating away
 * unmounts the observer and the plaintext leaves memory without anyone
 * writing code to do it.
 */
export function useSecretValue(bucket: string, keyName: string, revealed: boolean) {
  return useQuery<SecretValue, ApiError>({
    queryKey: secretValueQueryKey(bucket, keyName),
    queryFn: () => client.get<SecretValue>(secretPath(bucket, keyName)),
    enabled: revealed,
    staleTime: Infinity,
  });
}

export function usePutSecret(bucket: string) {
  const queryClient = useQueryClient();
  return useMutation<Secret, ApiError, PutSecretVariables>({
    mutationFn: ({ keyName, value }) =>
      client.put<Secret>(secretPath(bucket, keyName), { value }),
    onSuccess: (_data, { keyName }) => {
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(bucket) });
      // secret_count is cached on the bucket list, so a write makes it stale
      // there too.
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      // staleTime is Infinity, so a revealed row would otherwise keep showing
      // the value this call just replaced for the rest of the visit.
      queryClient.removeQueries({ queryKey: secretValueQueryKey(bucket, keyName), exact: true });
    },
  });
}

export function useDeleteSecret(bucket: string) {
  const queryClient = useQueryClient();
  // The API answers a secret delete with the deleted row's metadata, not with
  // { deleted: true }. That shape belongs to the bucket delete.
  return useMutation<Secret, ApiError, string>({
    mutationFn: (keyName) => client.del<Secret>(secretPath(bucket, keyName)),
    onSuccess: (_data, keyName) => {
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(bucket) });
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      // A decrypted plaintext held under a key nothing can display again is
      // pointless to keep in memory.
      queryClient.removeQueries({ queryKey: secretValueQueryKey(bucket, keyName), exact: true });
    },
  });
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/secrets/useSecrets.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Falsify the `enabled` guard**

Temporarily delete `enabled: revealed` from `useSecretValue` and re-run.
Expected: "sends no request at all while revealed is false" fails on
`expect(calls).toBe(0)`. Restore it and confirm green. This is the single line
that implements invariant 7; a test that passes without it is worthless.

- [ ] **Step 6: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/secrets
git commit -m "feat(web): add the secret query hooks

Three keys on two separate roots, so a bucket invalidation cannot wipe an open
secret list and a write to one secret cannot discard another's revealed value.
The value query is gated on enabled, which is where invariant 7 lives in code."
```

---

### Task 5: The add and replace form

**Files:**
- Create: `web/src/features/secrets/PutSecretForm.tsx`
- Create: `web/src/features/secrets/PutSecretForm.test.tsx`

**Interfaces:**
- Consumes: `secretFormSchema`, `SecretFormValues` (Task 3); `usePutSecret` (Task 4).
- Produces: `PutSecretForm({ bucket, existingKeys }: { bucket: string; existingKeys: string[] })`.

One form for both creating and replacing, matching the backend's upsert. The
submit button reads **"Add secret"** until the typed key name matches an
existing one, then **"Replace secret"**. The list is already on screen, so the
client knows before submitting rather than after. That removes most of the
silent clobber risk one form costs, without a second flow or a confirm step.

The value is a **textarea**, not an input. 64 KiB is PEM keys and service
account JSON, not a password field.

The comparison is exact and case sensitive, because the backend's key names are.

Wire the form exactly as `CreateBucketForm` does: `zodResolver`, disable while
pending, reset only on success, server errors through `setError`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/secrets/PutSecretForm.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { PutSecretForm } from "./PutSecretForm";

const SECRETS = "http://localhost:8000/v1/buckets/alpha/secrets";

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-11T00:00:00Z",
  };
}

describe("PutSecretForm", () => {
  it("writes the typed key and value", async () => {
    let path: string | undefined;
    let body: unknown;
    server.use(
      http.put(`${SECRETS}/:key`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") });
      }),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "DATABASE_URL");
    await userEvent.type(screen.getByLabelText(/value/i), "postgres://x");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    await waitFor(() => expect(path).toBe("/v1/buckets/alpha/secrets/DATABASE_URL"));
    expect(body).toEqual({ value: "postgres://x" });
  });

  it("says Replace once the typed key already exists", async () => {
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={["DATABASE_URL"]} />);

    expect(screen.getByRole("button", { name: /add secret/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/key name/i), "DATABASE_URL");

    expect(await screen.findByRole("button", { name: /replace secret/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add secret/i })).not.toBeInTheDocument();
  });

  it("keeps saying Add for a key that only differs in case", async () => {
    // The backend's key names are case sensitive, so database_url and
    // DATABASE_URL are two different secrets and this is not a replace.
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={["DATABASE_URL"]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "database_url");

    expect(await screen.findByRole("button", { name: /add secret/i })).toBeInTheDocument();
  });

  it("rejects an invalid key name without reaching the network", async () => {
    let calls = 0;
    server.use(
      http.put(`${SECRETS}/:key`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: aSecret("x") });
      }),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "has space");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/letters, numbers/i);
    expect(calls).toBe(0);
    expect(screen.getByLabelText(/key name/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps what was typed when the server refuses", async () => {
    server.use(
      http.put(`${SECRETS}/:key`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "WRITE_NOT_PERMITTED", message: "Not allowed." } },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "KEEP_ME");
    await userEvent.type(screen.getByLabelText(/value/i), "typed");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed/i);
    // Retyping a value the server just explained is pure friction.
    expect(screen.getByLabelText(/key name/i)).toHaveValue("KEEP_ME");
    expect(screen.getByLabelText(/value/i)).toHaveValue("typed");
  });

  it("clears both fields on success", async () => {
    server.use(
      http.put(`${SECRETS}/:key`, () => HttpResponse.json({ ok: true, data: aSecret("GONE") })),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "GONE");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    await waitFor(() => expect(screen.getByLabelText(/key name/i)).toHaveValue(""));
    expect(screen.getByLabelText(/value/i)).toHaveValue("");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/secrets/PutSecretForm.test.tsx`
Expected: FAIL, cannot resolve `./PutSecretForm`.

- [ ] **Step 3: Write the form**

Create `web/src/features/secrets/PutSecretForm.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";
import { secretFormSchema, type SecretFormValues } from "./secretForm";
import { usePutSecret } from "./useSecrets";

/**
 * One form for both writing and replacing, matching the backend's upsert.
 *
 * The list is already on screen, so the button can say which one this is
 * before the user commits rather than after. That removes most of what a
 * single form costs in silent clobbering, without a second flow.
 */
export function PutSecretForm({
  bucket,
  existingKeys,
}: {
  bucket: string;
  existingKeys: string[];
}) {
  const put = usePutSecret(bucket);
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
    watch,
  } = useForm<SecretFormValues>({ resolver: zodResolver(secretFormSchema) });

  // Exact and case sensitive, because the backend's key names are: DATABASE_URL
  // and database_url are two different secrets.
  const replacing = existingKeys.includes(watch("keyName") ?? "");

  const onSubmit = handleSubmit((values) => {
    put.mutate(
      { keyName: values.keyName, value: values.value },
      {
        onSuccess: () => reset({ keyName: "", value: "" }),
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      // Named, so a test can scope to it and a screen reader announces what it
      // is. SecretsPage renders it above a list of similar looking controls.
      aria-label="Add or replace a secret"
      className="flex flex-col gap-2 rounded border p-4"
    >
      <label htmlFor="secret-key-name" className="text-sm font-medium">
        Key name
      </label>
      <input
        id="secret-key-name"
        {...register("keyName")}
        placeholder="DATABASE_URL"
        disabled={put.isPending}
        aria-invalid={errors.keyName ? true : undefined}
        className="rounded border px-3 py-2"
      />
      {errors.keyName && <Alert variant="inline">{errors.keyName.message}</Alert>}

      <label htmlFor="secret-value" className="text-sm font-medium">
        Value
      </label>
      {/* A textarea, not an input. 64 KiB is PEM keys and service account
          JSON, not a password field. */}
      <textarea
        id="secret-value"
        {...register("value")}
        rows={4}
        disabled={put.isPending}
        aria-invalid={errors.value ? true : undefined}
        className="rounded border px-3 py-2 font-mono text-sm"
      />
      {errors.value && <Alert variant="inline">{errors.value.message}</Alert>}

      <div>
        <button
          type="submit"
          disabled={put.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          {replacing ? "Replace secret" : "Add secret"}
        </button>
      </div>

      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}
    </form>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/secrets/PutSecretForm.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/secrets
git commit -m "feat(web): add the secret add and replace form

One form for both, matching the backend's upsert. The button says Replace once
the typed key matches one already on screen, so the client knows before
submitting rather than after."
```

---

### Task 6: The secret row

**Files:**
- Create: `web/src/features/secrets/SecretRow.tsx`
- Create: `web/src/features/secrets/SecretRow.test.tsx`

**Interfaces:**
- Consumes: `Secret`, `useSecretValue`, `useDeleteSecret` (Task 4); `Alert` (Task 2).
- Produces: `SecretRow({ bucket, secret }: { bucket: string; secret: Secret })`.

Three pieces of state, all row local `useState`, all ephemeral: `revealed`,
`confirming`, `copied`. Nothing global exists whose purpose is remembering that
a plaintext should be on screen, which is ADR 003 A9 in code.

**The mask is the module constant `"••••••••"`.** Never
`"•".repeat(value.length)`. Before a first reveal the client genuinely has no
value, so a length derived mask is impossible by accident; after a reveal and a
hide the value **is** in the cache, and that one natural looking line would leak
exactly what invariant 7 forbids.

**Accessible names carry the key name.** "Reveal DATABASE_URL", not "Reveal".
With twenty rows a bare label is ambiguous to a screen reader and forces every
test into `within()` gymnastics.

**A failed reveal says one fixed sentence** and never `error.message`. SP4 made
decrypt failures a 500 carrying no detail, so there is nothing to add, and
routing a server string into the UI here is the shape that eventually routes a
value into it.

**Copy has no timer.** The spec called the confirmation brief; a `setTimeout`
that resolves after a test ends produces an `act` warning, and pristine test
output is a global constraint. The confirmation clears when the row is hidden
or when the user copies again. This is a deliberate, stated deviation.

`navigator.clipboard.writeText` can reject (permissions, a non secure context),
so it is awaited in a `try`/`catch`. An unhandled rejection is an stderr line,
which is also a defect here.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/secrets/SecretRow.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { SecretRow } from "./SecretRow";

const SECRETS = "http://localhost:8000/v1/buckets/alpha/secrets";

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
  };
}

function renderRow(keyName = "DATABASE_URL") {
  return renderWithProviders(
    <ul>
      <SecretRow bucket="alpha" secret={aSecret(keyName)} />
    </ul>,
  );
}

describe("SecretRow", () => {
  it("shows the key name and stays masked until asked", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    expect(within(row).getByText("DATABASE_URL")).toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /reveal DATABASE_URL/i })).toBeInTheDocument();
  });

  it("reveals the value on click", async () => {
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));

    expect(await within(row).findByText("postgres://x")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /hide DATABASE_URL/i })).toBeInTheDocument();
  });

  it("hides it again, and the mask comes back", async () => {
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
    await within(row).findByText("postgres://x");
    await userEvent.click(within(row).getByRole("button", { name: /hide DATABASE_URL/i }));

    expect(within(row).queryByText("postgres://x")).not.toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
  });

  it("says nothing about why a reveal failed", async () => {
    server.use(
      http.get(`${SECRETS}/BROKEN`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "server detail" } },
          { status: 500 },
        ),
      ),
    );
    renderRow("BROKEN");
    const row = screen.getByRole("listitem", { name: /BROKEN/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal BROKEN/i }));

    const alert = await within(row).findByRole("alert");
    expect(alert).toHaveTextContent(/could not reveal this secret/i);
    // SP4 made decrypt failures carry no detail. Routing the server's string
    // into the UI here is how a value eventually gets routed into it.
    expect(alert).not.toHaveTextContent(/server detail/i);
  });

  it("copies the revealed value to the clipboard", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
    await within(row).findByText("postgres://x");
    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    // The stub userEvent.setup() installs, not a hand mocked global.
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("postgres://x"),
    );
    expect(within(row).getByRole("status")).toHaveTextContent(/copied/i);
  });

  it("offers no copy button while the value is hidden", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    expect(within(row).queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("confirms before deleting and can be cancelled", async () => {
    let deletes = 0;
    server.use(
      http.delete(`${SECRETS}/DATABASE_URL`, () => {
        deletes += 1;
        return HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete DATABASE_URL/i }));
    expect(within(row).getByText(/delete this secret/i)).toBeInTheDocument();
    await userEvent.click(
      within(row).getByRole("button", { name: /cancel deleting DATABASE_URL/i }),
    );

    expect(within(row).queryByText(/delete this secret/i)).not.toBeInTheDocument();
    expect(deletes).toBe(0);
  });

  it("deletes when confirmed", async () => {
    let deleted = false;
    server.use(
      http.delete(`${SECRETS}/DATABASE_URL`, () => {
        deleted = true;
        return HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete DATABASE_URL/i }));
    await userEvent.click(
      within(row).getByRole("button", { name: /confirm deleting DATABASE_URL/i }),
    );

    await waitFor(() => expect(deleted).toBe(true));
  });

  it("shows a failed delete on the row it belongs to", async () => {
    server.use(
      http.delete(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "SECRET_NOT_FOUND", message: "Already gone." } },
          { status: 404 },
        ),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete DATABASE_URL/i }));
    await userEvent.click(
      within(row).getByRole("button", { name: /confirm deleting DATABASE_URL/i }),
    );

    expect(await within(row).findByRole("alert")).toHaveTextContent(/already gone/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/secrets/SecretRow.test.tsx`
Expected: FAIL, cannot resolve `./SecretRow`.

- [ ] **Step 3: Write the row**

Create `web/src/features/secrets/SecretRow.tsx`:

```tsx
import { useState } from "react";

import { Alert } from "../../components/Alert";
import { useDeleteSecret, useSecretValue, type Secret } from "./useSecrets";

/**
 * A constant, never "•".repeat(value.length).
 *
 * Before a first reveal the client has no value, so a length derived mask is
 * impossible by accident. After a reveal and a hide the value is in the cache,
 * and that one natural looking line would publish exactly the length invariant
 * 7 exists to withhold.
 */
const MASK = "••••••••";

/**
 * One secret, owning its reveal flag, its confirm flag and its copy notice.
 *
 * All three are ephemeral: leaving the bucket and returning hides everything
 * again, which for a secret manager is the safer default and is why no store
 * arrives with this sub-project. See ADR 003 A9.
 */
export function SecretRow({ bucket, secret }: { bucket: string; secret: Secret }) {
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const value = useSecretValue(bucket, secret.key_name, revealed);
  const remove = useDeleteSecret(bucket);

  const plaintext = revealed ? value.data?.value : undefined;

  function toggleReveal() {
    setRevealed((was) => !was);
    setCopyState("idle");
  }

  async function copy(text: string) {
    // Awaited in a try/catch: writeText rejects on a denied permission or a
    // non secure context, and an unhandled rejection is an stderr line.
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <li aria-label={secret.key_name} className="flex flex-col gap-2 border-b py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="font-medium">{secret.key_name}</span>
          <time dateTime={secret.updated_at} className="ml-3 text-sm text-slate-500">
            {new Date(secret.updated_at).toLocaleDateString()}
          </time>
        </div>

        {confirming ? (
          <div className="flex items-center gap-2 text-sm">
            <span>Delete this secret?</span>
            <button
              type="button"
              aria-label={`Confirm deleting ${secret.key_name}`}
              onClick={() => remove.mutate(secret.key_name)}
              disabled={remove.isPending}
              className="rounded border px-2 py-1"
            >
              Yes
            </button>
            <button
              type="button"
              aria-label={`Cancel deleting ${secret.key_name}`}
              onClick={() => setConfirming(false)}
              className="rounded border px-2 py-1"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              aria-label={`${revealed ? "Hide" : "Reveal"} ${secret.key_name}`}
              onClick={toggleReveal}
              className="rounded border px-2 py-1"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            {plaintext !== undefined && (
              <button
                type="button"
                aria-label={`Copy ${secret.key_name}`}
                onClick={() => void copy(plaintext)}
                className="rounded border px-2 py-1"
              >
                Copy
              </button>
            )}
            <button
              type="button"
              aria-label={`Delete ${secret.key_name}`}
              onClick={() => setConfirming(true)}
              className="rounded border px-2 py-1"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm">
        {plaintext ?? MASK}
      </code>

      {revealed && value.isFetching && (
        <p role="status" className="text-sm text-slate-600">
          Revealing
        </p>
      )}

      {/* The server has nothing to say here: SP4 made decrypt failures a 500
          carrying no detail. A fixed sentence keeps the error path from being
          a channel. */}
      {revealed && value.isError && <Alert variant="inline">Could not reveal this secret.</Alert>}

      {copyState === "copied" && (
        <p role="status" className="text-sm text-slate-600">
          Copied
        </p>
      )}
      {copyState === "failed" && <Alert variant="inline">Could not copy to the clipboard.</Alert>}

      {remove.isError && <Alert variant="inline">{remove.error.message}</Alert>}
    </li>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/secrets/SecretRow.test.tsx`
Expected: PASS, 9 tests, and no `act` warning or unhandled rejection in the
output.

- [ ] **Step 5: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/secrets
git commit -m "feat(web): add the secret row with reveal, copy and delete

Reveal, confirm and copy state are all row local and ephemeral, so leaving the
bucket hides everything again. The mask is a constant rather than a repeat of
the value's length, which after a reveal and a hide would leak what invariant 7
withholds."
```

---

### Task 7: The page, the route, and links from the bucket list

**Files:**
- Create: `web/src/features/secrets/SecretsPage.tsx`
- Create: `web/src/features/secrets/SecretsPage.test.tsx`
- Modify: `web/src/routes/router.tsx:26-32`
- Modify: `web/src/routes/access.test.tsx` (append)
- Modify: `web/src/features/buckets/BucketRow.tsx:22-23`
- Modify: `web/src/features/buckets/BucketsPage.test.tsx` (every render call)

**Interfaces:**
- Consumes: `useSecrets` (Task 4), `PutSecretForm` (Task 5), `SecretRow` (Task 6), `Alert` (Task 2).
- Produces: `SecretsPage()`, reading `:name` from `useParams`; the route `/buckets/:name`.

The page is headed by the bucket's name and carries a link back to `/buckets`.
Browser back works, but a page you can only leave with the back button feels
like a dead end, and SP8's navigation bar is not here yet.

The add form sits permanently above the list, as `CreateBucketForm` does. An
empty bucket says it has no secrets yet.

**The list follows SP6's corrected shape, not its original one.** SP6's final
review found that gating a list on `isSuccess` hides a fully loaded list the
moment a background refetch fails, because TanStack Query reports any refetch
failure as an error while still holding the previous data. That fix was flagged
specifically because this page was going to copy the file. Render whenever
`data` exists; a failed refetch adds a banner rather than replacing what is on
screen.

**`BUCKET_NOT_FOUND` is its own state**, not the router's `NotFound`. The route
is real and the resource is not, and those are different failures. It replaces
the page body, because a form for writing into a bucket that does not exist is
worse than nothing.

**`BucketRow` now renders a `Link`, so it needs a router in context.**
`BucketsPage.test.tsx` currently renders the page bare and will throw. Wrap each
render in `MemoryRouter`. That is a test-harness change, not a behaviour change:
no assertion in that file moves.

- [ ] **Step 1: Write the failing tests for the page**

Create `web/src/features/secrets/SecretsPage.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { SecretsPage } from "./SecretsPage";

const SECRETS = "http://localhost:8000/v1/buckets/alpha/secrets";

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
  };
}

function renderPage(bucket = "alpha") {
  const router = createMemoryRouter(
    [
      { path: "/buckets", element: <p>the bucket list</p> },
      { path: "/buckets/:name", element: <SecretsPage /> },
    ],
    { initialEntries: [`/buckets/${bucket}`] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("SecretsPage", () => {
  it("heads the page with the bucket name and lists its secrets", async () => {
    server.use(
      http.get(SECRETS, () =>
        HttpResponse.json({ ok: true, data: [aSecret("DATABASE_URL"), aSecret("STRIPE_KEY")] }),
      ),
    );
    renderPage();

    expect(await screen.findByRole("heading", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /DATABASE_URL/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /STRIPE_KEY/ })).toBeInTheDocument();
  });

  it("offers a way back to the bucket list", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    const back = await screen.findByRole("link", { name: /all buckets/i });

    expect(back).toHaveAttribute("href", "/buckets");
  });

  it("says an empty bucket is empty rather than looking like it is loading", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    expect(await screen.findByText(/no secrets yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an unknown bucket as this page's own error, not a 404 route", async () => {
    server.use(
      http.get("http://localhost:8000/v1/buckets/ghost/secrets", () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_FOUND", message: "No bucket named 'ghost'." } },
          { status: 404 },
        ),
      ),
    );
    renderPage("ghost");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no bucket named/i);
    // The router's not found page is a different failure: there, the route is
    // wrong. Here the route is right and the resource is missing.
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    // Nothing to write into, so no form.
    expect(screen.queryByRole("button", { name: /add secret/i })).not.toBeInTheDocument();
  });

  it("keeps a loaded list on screen through a failed background refetch", async () => {
    // SP6's final review: gating on isSuccess would replace a working list
    // with an error the first time refetchOnWindowFocus dropped a request.
    let calls = 0;
    server.use(
      http.get(SECRETS, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ ok: true, data: [aSecret("STABLE")] });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        );
      }),
    );
    const { queryClient } = renderPage();
    await screen.findByRole("listitem", { name: /STABLE/ });

    await queryClient.refetchQueries({ queryKey: ["secrets", "alpha"] });

    expect(screen.getByRole("listitem", { name: /STABLE/ })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh/i);
  });

  it("hands the form the keys already in the bucket", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("DATABASE_URL")] })),
    );
    renderPage();
    await screen.findByRole("listitem", { name: /DATABASE_URL/ });

    // Proven through the behaviour the prop exists for, not by inspecting props.
    const form = screen.getByRole("form", { name: /add or replace a secret/i });
    expect(within(form).getByRole("button", { name: /add secret/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/secrets/SecretsPage.test.tsx`
Expected: FAIL, cannot resolve `./SecretsPage`.

- [ ] **Step 3: Write the page**

Create `web/src/features/secrets/SecretsPage.tsx`:

```tsx
import { Link, useParams } from "react-router";

import { Alert } from "../../components/Alert";
import { PutSecretForm } from "./PutSecretForm";
import { SecretRow } from "./SecretRow";
import { useSecrets } from "./useSecrets";

export function SecretsPage() {
  const { name } = useParams();
  const bucket = name ?? "";
  const secrets = useSecrets(bucket);

  // The route is real and the resource is not, which is a different failure
  // from a wrong URL. Falling through to the router's NotFound would say the
  // wrong thing, and a form for writing into a bucket that does not exist is
  // worse than nothing.
  const missing = secrets.error?.code === "BUCKET_NOT_FOUND";

  return (
    <section className="flex flex-col gap-6">
      <div>
        {/* Browser back works, but a page you can only leave with the back
            button feels like a dead end, and SP8's nav bar is not here yet. */}
        <Link to="/buckets" className="text-sm text-slate-600 underline">
          All buckets
        </Link>
        <h1 className="text-xl font-semibold">{bucket}</h1>
      </div>

      {missing ? (
        <Alert>{secrets.error?.message}</Alert>
      ) : (
        <>
          <PutSecretForm bucket={bucket} existingKeys={(secrets.data ?? []).map((s) => s.key_name)} />

          {secrets.isPending && (
            <p role="status" className="text-sm text-slate-600">
              Loading secrets
            </p>
          )}

          {secrets.isError && (
            <Alert>Could not refresh this bucket. {secrets.error.message}</Alert>
          )}

          {/* Rendered on data existing, not on isSuccess: TanStack reports a
              failed refetch as an error while still holding the previous data,
              so gating on isSuccess would erase a working list. SP6 was
              corrected to this shape for this page's benefit. */}
          {secrets.data &&
            (secrets.data.length === 0 ? (
              <p className="text-slate-600">No secrets yet. Add one above.</p>
            ) : (
              <ul>
                {secrets.data.map((secret) => (
                  <SecretRow key={secret.key_name} bucket={bucket} secret={secret} />
                ))}
              </ul>
            ))}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/secrets/SecretsPage.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the route**

In `web/src/routes/router.tsx`, add `SecretsPage` to the imports and a sibling
route below `/buckets`:

```tsx
          { path: "/buckets", element: <BucketsPage /> },
          // ADR 003 A7 again: a sibling of /buckets, not a child of an
          // inconsistent parent.
          { path: "/buckets/:name", element: <SecretsPage /> },
```

- [ ] **Step 6: Make bucket rows links**

In `web/src/features/buckets/BucketRow.tsx`, add `import { Link } from "react-router";`
and replace the name span:

```tsx
          <Link
            to={`/buckets/${encodeURIComponent(bucket.name)}`}
            className="font-medium underline"
          >
            {bucket.name}
          </Link>
```

SP6 left these inert on purpose, because a route that opens onto nothing is
worse than a row that does not invite a click. There is now something behind
them.

- [ ] **Step 7: Give `BucketsPage.test.tsx` a router**

`BucketRow` now renders a `Link`, which throws outside a router. Add
`import { MemoryRouter } from "react-router";` to
`web/src/features/buckets/BucketsPage.test.tsx` and wrap every
`renderWithProviders(<BucketsPage />)`:

```tsx
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
```

There are nine such calls, including the one that destructures `{ queryClient }`,
which keeps working unchanged. **No assertion in that file changes.** If one
has to, stop: the migration changed behaviour rather than harness.

- [ ] **Step 8: Test the route through the real router**

Append to `web/src/routes/access.test.tsx`:

```tsx
it("renders a bucket's secrets at /buckets/:name", async () => {
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/buckets/alpha/secrets", () =>
      HttpResponse.json({ ok: true, data: [] }),
    ),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets/alpha"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByRole("heading", { name: "alpha" })).toBeInTheDocument();
});

it("keeps /buckets/:name behind the session guard", async () => {
  signedOut();
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets/alpha"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
});

it("walks from the bucket list into a bucket", async () => {
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/buckets", () =>
      HttpResponse.json({
        ok: true,
        data: [{ id: "1", name: "alpha", created_at: "2026-08-11T00:00:00Z", secret_count: 1 }],
      }),
    ),
    http.get("http://localhost:8000/v1/buckets/alpha/secrets", () =>
      HttpResponse.json({ ok: true, data: [] }),
    ),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets"] });
  renderWithProviders(<RouterProvider router={router} />);
  const row = await screen.findByRole("listitem", { name: /alpha/i });

  await userEvent.click(within(row).getByRole("link", { name: "alpha" }));

  expect(await screen.findByRole("heading", { name: "alpha" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/buckets/alpha");
});
```

- [ ] **Step 9: Run the whole suite**

Run: `cd web && pnpm test`
Expected: PASS, everything, with no MSW unhandled-request error. If one appears
for `/v1/buckets/:bucket/secrets`, a test navigated somewhere it did not intend
to and needs a handler, not a looser MSW setting.

- [ ] **Step 10: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features src/routes
git commit -m "feat(web): add the bucket detail page at /buckets/:name

Bucket rows become links now that there is something behind them. The list
renders on data existing rather than on isSuccess, which is the shape SP6 was
corrected to for this page's benefit. An unknown bucket is this page's own
error state, because the route is real and the resource is not."
```

---

### Task 8: The tests that pin the invariants

**Files:**
- Create: `web/src/features/secrets/invariants.test.tsx`

**Interfaces:**
- Consumes: `SecretsPage` (Task 7), `routes` from `web/src/routes/router.tsx`, `BucketsPage` (SP6).
- Produces: nothing. This task adds no source file.

These are the reason SP7 got its own review cycle. Every one is written so that
removing the thing it guards makes it fail, and Step 6 checks that claim rather
than asserting it.

Two of them assert over **every** request the test made, using MSW's
`server.events`, so the guarantee covers code nobody has written yet rather than
the one URL the test had in mind.

The mask test compares **two masks from two genuinely different value lengths**.
A test comparing a mask against the constant would still pass if someone
weakened it, and a test comparing a mask against itself proves nothing.

- [ ] **Step 1: Write the tests**

Create `web/src/features/secrets/invariants.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { routes } from "../../routes/router";
import { SecretsPage } from "./SecretsPage";

const API = "http://localhost:8000";
const SECRETS = `${API}/v1/buckets/alpha/secrets`;

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
  };
}

/**
 * The stub bucket list is a link back, so a test can leave the page and
 * return through clicks alone. Driving router.navigate directly would need
 * act() wrapping and would prove less.
 */
function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/buckets", element: <Link to="/buckets/alpha">back to alpha</Link> },
      { path: "/buckets/:name", element: <SecretsPage /> },
    ],
    { initialEntries: ["/buckets/alpha"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

/** Every URL the app asked for during a test, in order. */
let requested: string[] = [];

beforeEach(() => {
  requested = [];
  server.events.on("request:start", ({ request }) => {
    requested.push(request.url);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

describe("invariant 7: the list never fetches a value", () => {
  it("sends zero single key requests while rendering three secrets", async () => {
    server.use(
      http.get(SECRETS, () =>
        HttpResponse.json({
          ok: true,
          data: [aSecret("A"), aSecret("B"), aSecret("C")],
        }),
      ),
    );
    renderPage();
    await screen.findByRole("listitem", { name: /^A$/ });

    // A request count, not the absence of a rendered value. A value can be
    // absent for the wrong reason; a request that was never sent cannot.
    const singleKeyCalls = requested.filter((url) => /\/secrets\/[^/]+$/.test(url));
    expect(singleKeyCalls).toEqual([]);
  });

  it("fetches once on reveal and serves the cache on a re-reveal", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");
    await userEvent.click(within(row).getByRole("button", { name: /hide A/i }));
    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    // One visit, one secret.read audit row, however many times it is toggled.
    expect(requested.filter((url) => url.endsWith("/secrets/A"))).toHaveLength(1);
  });

  it("shows the same mask for a short value and a long one", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("SHORT"), aSecret("LONG")] })),
      http.get(`${SECRETS}/SHORT`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("SHORT"), value: "ab" } }),
      ),
      http.get(`${SECRETS}/LONG`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("LONG"), value: "z".repeat(200) } }),
      ),
    );
    renderPage();
    const short = await screen.findByRole("listitem", { name: /^SHORT$/ });
    const long = screen.getByRole("listitem", { name: /^LONG$/ });

    // Reveal both, then hide both, so the values are in the cache and a
    // length derived mask would be possible.
    await userEvent.click(within(short).getByRole("button", { name: /reveal SHORT/i }));
    await within(short).findByText("ab");
    await userEvent.click(within(long).getByRole("button", { name: /reveal LONG/i }));
    await within(long).findByText("z".repeat(200));
    await userEvent.click(within(short).getByRole("button", { name: /hide SHORT/i }));
    await userEvent.click(within(long).getByRole("button", { name: /hide LONG/i }));

    // Two masks from two genuinely different lengths, compared against each
    // other. Comparing either against the constant would still pass if the
    // constant became a repeat.
    const shortMask = within(short).getByText(/•/).textContent;
    const longMask = within(long).getByText(/•/).textContent;
    expect(shortMask).toBe(longMask);
    expect(shortMask).not.toContain("z");
  });

  it("hides everything again after leaving the bucket and coming back", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });
    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    await userEvent.click(screen.getByRole("link", { name: /all buckets/i }));
    await userEvent.click(await screen.findByRole("link", { name: /back to alpha/i }));

    const returned = await screen.findByRole("listitem", { name: /^A$/ });
    expect(within(returned).queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(within(returned).getByText(/•/)).toBeInTheDocument();
    // Still one fetch: the value is inside gcTime and therefore still cached,
    // so this proves the reveal flag reset rather than the cache emptying.
    // Walking away and coming back must not leave plaintext on screen.
    expect(requested.filter((url) => url.endsWith("/secrets/A"))).toHaveLength(1);
  });
});

describe("ADR 003 A4: the web session never asks for bulk reveal", () => {
  it("makes no request whose URL mentions reveal, in any interaction", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
      http.put(`${SECRETS}/B`, () => HttpResponse.json({ ok: true, data: aSecret("B") })),
      http.delete(`${SECRETS}/A`, () => HttpResponse.json({ ok: true, data: aSecret("A") })),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");
    await userEvent.type(screen.getByLabelText(/key name/i), "B");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    await userEvent.click(within(row).getByRole("button", { name: /confirm deleting A/i }));

    await waitFor(() => expect(requested.length).toBeGreaterThan(3));
    // Asserted across every request rather than one URL, so the guarantee
    // covers code nobody has written yet.
    expect(requested.filter((url) => url.includes("reveal"))).toEqual([]);
  });
});

describe("invariant 8: a plaintext reaches no persistent store", () => {
  it("leaves localStorage and sessionStorage empty after a reveal", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    // The invariant asserted literally rather than by reading the source.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps the revealed value out of the URL", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    const router = createMemoryRouter(
      [
        { path: "/buckets", element: <p>the bucket list</p> },
        { path: "/buckets/:name", element: <SecretsPage /> },
      ],
      { initialEntries: ["/buckets/alpha"] },
    );
    renderWithProviders(<RouterProvider router={router} />);
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    const { hash, pathname, search } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe("/buckets/alpha");
  });
});

describe("the byte limit stops before the network", () => {
  it("rejects a multi byte value under 65,536 characters with zero requests", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();
    await screen.findByText(/no secrets yet/i);
    // Counted over single key URLs rather than every request, so an unrelated
    // background refetch of the list cannot make this pass or fail by accident.
    const singleKey = () => requested.filter((url) => /\/secrets\/[^/]+$/.test(url));
    const before = singleKey().length;

    await userEvent.type(screen.getByLabelText(/key name/i), "BIG");
    // 30,000 characters, 90,000 bytes. Typing that through userEvent is far
    // too slow, so the value is set the way a paste would set it.
    await userEvent.click(screen.getByLabelText(/value/i));
    await userEvent.paste("中".repeat(30_000));
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByText(/at most 64 KiB/i)).toBeInTheDocument();
    expect(singleKey()).toHaveLength(before);
  });
});

describe("the bucket list learns about a deleted secret", () => {
  it("re-enables Delete on a bucket whose last secret was removed", async () => {
    // The cross feature invalidation. secret_count is cached on the bucket
    // list, so without invalidating ["buckets"] the row would still refuse.
    let secretsLeft = 1;
    server.use(
      http.get(`${API}/v1/auth/me`, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
      http.get(`${API}/v1/buckets`, () =>
        HttpResponse.json({
          ok: true,
          data: [
            {
              id: "1",
              name: "alpha",
              created_at: "2026-08-11T00:00:00Z",
              secret_count: secretsLeft,
            },
          ],
        }),
      ),
      http.get(SECRETS, () =>
        HttpResponse.json({ ok: true, data: secretsLeft > 0 ? [aSecret("A")] : [] }),
      ),
      http.delete(`${SECRETS}/A`, () => {
        secretsLeft = 0;
        return HttpResponse.json({ ok: true, data: aSecret("A") });
      }),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/buckets/alpha"] });
    renderWithProviders(<RouterProvider router={router} />);
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    await userEvent.click(within(row).getByRole("button", { name: /confirm deleting A/i }));
    await screen.findByText(/no secrets yet/i);
    await userEvent.click(screen.getByRole("link", { name: /all buckets/i }));

    const bucketRow = await screen.findByRole("listitem", { name: /alpha/i });
    await waitFor(() =>
      expect(within(bucketRow).getByRole("button", { name: /^delete$/i })).toBeEnabled(),
    );
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd web && pnpm vitest run src/features/secrets/invariants.test.tsx`
Expected: PASS, 9 tests. If the paste test is slow, that is the 90,000 byte
string and is acceptable; if it is slower than about five seconds, say so in
the report rather than shrinking the string, because the character count is the
point of the test.

- [ ] **Step 3: Falsify the reveal guard**

Delete `enabled: revealed` from `useSecretValue` in `useSecrets.ts` and re-run.
Expected: "sends zero single key requests while rendering three secrets" fails
with three URLs in `singleKeyCalls`. Restore it.

- [ ] **Step 4: Falsify the mask**

Change `MASK` in `SecretRow.tsx` to a length derived mask, temporarily:

```tsx
{plaintext ?? "•".repeat(value.data?.value.length ?? 8)}
```

Re-run. Expected: "shows the same mask for a short value and a long one" fails,
with a 2 character mask against a 200 character one. Restore the constant.

- [ ] **Step 5: Falsify the cross feature invalidation**

Remove the `BUCKETS_QUERY_KEY` invalidation from `useDeleteSecret` and re-run.
Expected: "re-enables Delete on a bucket whose last secret was removed" fails,
because the row still holds `secret_count: 1`. Restore it.

- [ ] **Step 6: Falsify the byte check end to end**

Change the schema's `value` field to `z.string().max(MAX_VALUE_BYTES)` and
re-run. Expected: "rejects a multi byte value under 65,536 characters with zero
requests" fails, because the form submits. Restore the `refine`.

- [ ] **Step 7: Record the falsification results**

Write what each of Steps 3 to 6 actually printed into the task report,
including the failure message. A falsification step that was performed but not
recorded is indistinguishable from one that was skipped, and this project has
already shipped one falsification run whose red result turned out to be luck.

- [ ] **Step 8: Run everything and commit**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test
git add src/features/secrets/invariants.test.tsx
git commit -m "test(web): pin invariants 7 and 8 and the no-bulk-reveal rule

Request counts rather than absent values, assertions across every request the
test made rather than one URL, and two masks from two genuinely different
value lengths compared against each other. Each was falsified by removing the
thing it guards."
```

---

## What SP7 deliberately leaves undone

- **Zustand.** ADR 003 A9: reveal state turned out to be ephemeral and
  component local, so there is no consumer. If SP8 finds none either, remove it
  from ADR 003's stack.
- **Renaming a key.** The API has no rename. Writing the new key and deleting
  the old is two acts the UI already supports.
- **A navigation bar, API keys, the show once token.** SP8.
- **Clearing the clipboard.** ADR 003 A10 records why: `writeText("")` only
  succeeds while the document has focus, so a timed clear fails precisely when
  the user has switched to the application they meant to paste into.
- **Refetching a revealed value within a visit.** `staleTime: Infinity` is a
  deliberate trade for an audit log that records disclosures rather than clicks.
  A write made through the API while the page is open is not reflected until the
  user leaves and returns. A write made *from this page* is, because
  `usePutSecret` drops that key's cached value.

## Notes for the executing agent

- `make types` must produce no diff. Nothing under `api/` changes, so if it
  does produce one, something regenerated against a stale schema and the fix is
  not to commit the diff.
- Run `make lint` and `make test` from the repo root before declaring the plan
  finished, not only `pnpm test` from `web/`.
- The backend's key name and value rules live at
  `api/app/models/secret.py:22` and `:27`, and their case tables at
  `api/tests/test_secret_key_names.py`. Those are the source; Task 3 copies
  from them.
- A secret `DELETE` returns `Ok[SecretData]`, not `Ok[DeletedData]`. See
  `api/app/routers/secrets.py:280`.
- Two deviations from the spec's wording are deliberate and recorded above:
  `usePutSecret` also drops the written key's cached value (Task 4), and the
  copy confirmation has no timer (Task 6). Both are stated in the task text
  with the reasoning.
