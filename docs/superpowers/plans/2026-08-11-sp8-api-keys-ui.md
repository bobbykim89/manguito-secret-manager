# SP8: The API keys UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue, list and revoke API keys from a browser, show the token exactly once without losing it to a stray click, and give the app the navigation bar its two earlier UI sub-projects deferred.

**Architecture:** `/keys` is a third sibling route under the existing session guard. The created token lives only in the create mutation's own `data`, so acknowledging it is `reset()` and navigating away is garbage collection; the panel's mere existence arms a `useBlocker` and a `beforeunload` handler, so there is no separate flag to drift out of step. No store arrives, which retires Zustand from ADR 003 entirely.

**Tech Stack:** React 19, Vite 6, TypeScript strict, Tailwind 4, React Router 7 (7.18.2, `useBlocker` available), TanStack Query 5, Zod 4, React Hook Form, Vitest, MSW.

## Global Constraints

- Frontend only. Nothing under `api/` changes, and `make types` must produce no diff.
- **No new dependency. Zustand is not installed and must not be.**
- **Invariant 8: no secret values in `localStorage`, `sessionStorage`, URL state, or client-side error reporting.** The API key token is subject to this in full (ADR 003 A12). The clipboard is the single permitted exit.
- **Invariant 6: API keys are stored as SHA-256 hashes only.** The token exists exactly once, in the create response. Nothing may persist it.
- **Invariant 2: credentials never travel in query strings.** No request this app makes may contain `msm_`.
- TypeScript strict, no `any` in committed code.
- Feature-first directories under `src/features/`, not type-first.
- TanStack Query owns server state. `useState` owns the rest.
- **`src/api/generated.ts` is generated. Never hand-edit it.**
- Tests mock at the fetch boundary with MSW. Test behavior, not hooks or class names. Never assert on Tailwind classes.
- Test output must be pristine. A warning or an stderr line is a defect, including an MSW unhandled-request error, a React `act` warning, and an unhandled promise rejection.
- Tailwind only. No CSS modules, no styled-components.
- Errors surface where the thing that failed is. No toasts, no global error store.
- No em dashes in code, comments, or commit messages.
- Comments explain why, not what.
- Commit messages: conventional commits, imperative mood, scoped (`feat(web): ...`).

---

## File Structure

```
web/src/
├── components/
│   ├── ConfirmPrompt.tsx           new: the shared two step confirm
│   └── ConfirmPrompt.test.tsx      new
├── features/
│   ├── shell/
│   │   ├── AppShell.tsx            modify: the nav bar
│   │   └── AppShell.test.tsx       modify: nav assertions
│   ├── buckets/
│   │   ├── BucketRow.tsx           modify: use ConfirmPrompt
│   │   └── useBuckets.ts           modify: invalidate api-keys on delete
│   ├── secrets/
│   │   ├── SecretRow.tsx           modify: use ConfirmPrompt
│   │   ├── SecretsPage.tsx         modify: remove the back link
│   │   ├── SecretsPage.test.tsx    modify: drop the back link test
│   │   └── invariants.test.tsx     modify: two navigation selectors
│   └── api-keys/
│       ├── apiKeyForm.ts           new: schema, expiry presets
│       ├── apiKeyForm.test.ts      new
│       ├── useApiKeys.ts           new: three hooks, keyStatus
│       ├── useApiKeys.test.tsx     new
│       ├── NewKeyPanel.tsx         new: the token, copy, the loss guard
│       ├── NewKeyPanel.test.tsx    new
│       ├── CreateKeyForm.tsx       new: the form, or the panel
│       ├── CreateKeyForm.test.tsx  new
│       ├── KeyRow.tsx              new
│       ├── KeyRow.test.tsx         new
│       ├── KeysPage.tsx            new
│       ├── KeysPage.test.tsx       new
│       └── invariants.test.tsx     new: the tests that pin the token rules
└── routes/
    ├── router.tsx                  modify: /keys
    └── access.test.tsx             modify: the route is guarded
```

`NewKeyPanel` is its own file because the loss guard is behaviour, not markup:
two effects whose lifetime is the component's, which is the whole trick that
keeps them in step with what is on screen. `CreateKeyForm` owns the mutation
and chooses between the form and the panel, so "the panel replaces the form"
is one component's internal decision rather than a condition duplicated in the
page.

---

### Task 1: The shared `ConfirmPrompt`

**Files:**
- Create: `web/src/components/ConfirmPrompt.tsx`
- Create: `web/src/components/ConfirmPrompt.test.tsx`
- Modify: `web/src/features/buckets/BucketRow.tsx:40-58`
- Modify: `web/src/features/secrets/SecretRow.tsx:59-79`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ConfirmPrompt({ prompt, confirmLabel, cancelLabel, onConfirm, onCancel, confirmDisabled }: { prompt: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void; confirmDisabled?: boolean })`, from `web/src/components/ConfirmPrompt.tsx`.

`BucketRow` and `SecretRow` both carry a two step confirm and Task 7's
`KeyRow` will be the third. That is the threshold that justified extracting
`Alert` in SP7.

The extraction covers **only the confirming branch**, which is near identical
in all three. Each row keeps its own flag, its own mutation, and its own non
confirming branch, because those differ genuinely: `BucketRow` disables
confirm on a stale `secret_count` and shows "Still holds secrets";
`SecretRow` sits beside Reveal and Copy.

**The two rows label their buttons differently and both must keep working.**
`SecretRow` sets `aria-label` on Yes and Cancel (its tests query
`/confirm deleting DATABASE_URL/i`); `BucketRow` does not (its tests query
`/yes/i`). `confirmLabel` and `cancelLabel` are therefore optional, and
`aria-label={undefined}` renders no attribute at all, leaving the button's
accessible name as its text. That is what lets both test files pass
untouched.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ConfirmPrompt.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmPrompt } from "./ConfirmPrompt";

describe("ConfirmPrompt", () => {
  it("asks the question and calls back on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmPrompt prompt="Delete this bucket?" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );

    expect(screen.getByText("Delete this bucket?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^yes$/i }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls back on cancel without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmPrompt prompt="Delete?" onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("leaves the buttons named by their text when no labels are given", () => {
    // BucketRow relies on this: its tests query /yes/i, and an aria-label of
    // undefined must render no attribute rather than an empty one.
    render(<ConfirmPrompt prompt="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^yes$/i })).not.toHaveAttribute("aria-label");
  });

  it("names the buttons when labels are given, so many rows stay distinguishable", () => {
    render(
      <ConfirmPrompt
        prompt="Delete this secret?"
        confirmLabel="Confirm deleting DATABASE_URL"
        cancelLabel="Cancel deleting DATABASE_URL"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Confirm deleting DATABASE_URL" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel deleting DATABASE_URL" }),
    ).toBeInTheDocument();
  });

  it("can disable confirm while leaving cancel reachable", () => {
    render(
      <ConfirmPrompt prompt="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} confirmDisabled />,
    );

    expect(screen.getByRole("button", { name: /^yes$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && pnpm vitest run src/components/ConfirmPrompt.test.tsx`
Expected: FAIL, cannot resolve `./ConfirmPrompt`.

- [ ] **Step 3: Write the component**

Create `web/src/components/ConfirmPrompt.tsx`:

```tsx
/**
 * The confirming half of a two step confirm, shared by every row that has one.
 *
 * Only this branch is shared. Each row keeps its own flag, its own mutation
 * and its own non confirming branch, because those differ: a bucket row
 * disables confirm on a stale secret_count, a secret row sits beside Reveal
 * and Copy.
 *
 * The labels are optional because cancel is never disabled: a row that cannot
 * confirm must still be escapable.
 */
export function ConfirmPrompt({
  prompt,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: {
  prompt: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{prompt}</span>
      <button
        type="button"
        aria-label={confirmLabel}
        onClick={onConfirm}
        disabled={confirmDisabled}
        className="rounded border px-2 py-1"
      >
        Yes
      </button>
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="rounded border px-2 py-1"
      >
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd web && pnpm vitest run src/components/ConfirmPrompt.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Migrate `BucketRow`**

In `web/src/features/buckets/BucketRow.tsx`, add
`import { ConfirmPrompt } from "../../components/ConfirmPrompt";` and replace
the whole confirming branch (the `<div>` at lines 41-58) with:

```tsx
          <ConfirmPrompt
            prompt="Delete this bucket?"
            onConfirm={() => remove.mutate(bucket.name)}
            onCancel={() => setConfirming(false)}
            confirmDisabled={remove.isPending || holdsSecrets}
          />
```

Leave the non confirming branch and everything else untouched.

- [ ] **Step 6: Migrate `SecretRow`**

In `web/src/features/secrets/SecretRow.tsx`, add
`import { ConfirmPrompt } from "../../components/ConfirmPrompt";` and replace
the whole confirming branch (the `<div>` at lines 60-79) with:

```tsx
          <ConfirmPrompt
            prompt="Delete this secret?"
            confirmLabel={`Confirm deleting ${secret.key_name}`}
            cancelLabel={`Cancel deleting ${secret.key_name}`}
            onConfirm={() => remove.mutate(secret.key_name)}
            onCancel={() => setConfirming(false)}
            confirmDisabled={remove.isPending}
          />
```

- [ ] **Step 7: Run the whole suite**

Run: `cd web && pnpm test`
Expected: PASS, every pre-existing test plus the 5 new ones. **No assertion in
`BucketsPage.test.tsx` or `SecretRow.test.tsx` may change.** If one has to,
stop: the extraction altered behaviour and the fix belongs in `ConfirmPrompt`,
not in the test.

- [ ] **Step 8: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/components src/features
git commit -m "feat(web): extract the shared ConfirmPrompt

Revoke will be the third two step confirm, which is the threshold that
justified extracting Alert. Only the confirming branch is shared: each row
keeps its own flag, mutation and non confirming branch, because those differ."
```

---

### Task 2: The navigation bar, and retiring SP7's stopgap

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx:1,23-24`
- Modify: `web/src/features/shell/AppShell.test.tsx` (append)
- Modify: `web/src/features/secrets/SecretsPage.tsx:1,21-28`
- Modify: `web/src/features/secrets/SecretsPage.test.tsx:50-56`
- Modify: `web/src/features/secrets/invariants.test.tsx:29-38,137,304`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `<nav aria-label="Main">` inside `AppShell`'s header carrying links to `/buckets` and `/keys`. `/keys` has no route until Task 7; the link renders and resolves to the router's `NotFound` until then, which is expected and temporary.

`NavLink` supplies `isActive` and sets `aria-current="page"` on the active
link, so current page styling needs no state and no route matching of our
own. That is the entire reason to prefer it over `Link` here.

**`end` is deliberately not set on the Buckets link.** Without it `NavLink`
also matches descendants, so `/buckets/alpha` keeps Buckets marked as current,
which is what a person expects when looking at a bucket's page.

### SP7's back link comes out, and three tests depend on it

SP7's spec named the "All buckets" link a stopgap, in those words, because
SP8's navigation bar was not there yet. It is now, so it goes.

Three existing tests reach for it, and each needs a different answer:

| Test | Why it breaks | Fix |
|---|---|---|
| `SecretsPage.test.tsx:50-56` "offers a way back to the bucket list" | asserts the link exists | **Delete the test.** The behaviour is deliberately removed, so a test asserting it is now wrong. This is the one place in SP8 where deleting a test is correct. |
| `invariants.test.tsx:137` (reveal resets on navigation) | clicks the link to leave | its stub router has no `AppShell`, so give the stub route its own nav link |
| `invariants.test.tsx:304` (bucket list invalidation) | clicks the link to leave | it mounts the **real** `routes`, so the nav bar is there: change the selector |

- [ ] **Step 1: Write the failing nav test**

Append to `web/src/features/shell/AppShell.test.tsx`:

```tsx
describe("AppShell navigation", () => {
  it("offers both destinations", async () => {
    signedIn();

    renderShell();

    expect(await screen.findByRole("link", { name: "Buckets" })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(screen.getByRole("link", { name: "Keys" })).toHaveAttribute("href", "/keys");
  });

  it("marks the current destination", async () => {
    signedIn();
    renderWithProviders(
      <MemoryRouter initialEntries={["/keys"]}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Buckets" })).not.toHaveAttribute("aria-current");
  });

  it("keeps Buckets current inside a bucket, since a secret list is still buckets", async () => {
    // NavLink matches descendants unless `end` is set, and not setting it is
    // deliberate here.
    signedIn();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets/alpha"]}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Buckets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && pnpm vitest run src/features/shell/AppShell.test.tsx`
Expected: FAIL, no link named Buckets.

- [ ] **Step 3: Add the nav bar**

In `web/src/features/shell/AppShell.tsx`, change the import on line 1 to
`import { NavLink, Outlet } from "react-router";` and replace the app name
span (line 24) with:

```tsx
        <div className="flex items-center gap-6">
          <span className="font-semibold">Manguito Secret Manager</span>
          {/* NavLink rather than Link: it supplies isActive and sets
              aria-current, so the current destination needs no state and no
              route matching here. `end` is deliberately unset, so
              /buckets/:name keeps Buckets marked. */}
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <NavLink
              to="/buckets"
              className={({ isActive }) =>
                isActive ? "font-medium underline" : "text-slate-600"
              }
            >
              Buckets
            </NavLink>
            <NavLink
              to="/keys"
              className={({ isActive }) =>
                isActive ? "font-medium underline" : "text-slate-600"
              }
            >
              Keys
            </NavLink>
          </nav>
        </div>
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd web && pnpm vitest run src/features/shell/AppShell.test.tsx`
Expected: PASS, every test in the file.

- [ ] **Step 5: Remove the back link from `SecretsPage`**

In `web/src/features/secrets/SecretsPage.tsx`, change line 1 to
`import { useParams } from "react-router";` and replace the heading block
(lines 21-28) with:

```tsx
      <h1 className="text-xl font-semibold">{bucket}</h1>
```

- [ ] **Step 6: Delete the test that asserted it**

In `web/src/features/secrets/SecretsPage.test.tsx`, delete the whole
`it("offers a way back to the bucket list", ...)` block at lines 50-56.

This is deliberate, not an oversight: the behaviour it asserted is removed on
purpose, so keeping the test would mean keeping a link SP7 called a stopgap.

- [ ] **Step 7: Repoint the two navigation selectors in the secrets invariants**

In `web/src/features/secrets/invariants.test.tsx`, give the stub router a nav
link, replacing the `renderPage` route array (lines 30-37) with:

```tsx
function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/buckets", element: <Link to="/buckets/alpha">back to alpha</Link> },
      {
        path: "/buckets/:name",
        element: (
          <>
            {/* Stands in for AppShell's nav bar, which this stub router does
                not mount. SP8 removed SecretsPage's own back link. */}
            <Link to="/buckets">Buckets</Link>
            <SecretsPage />
          </>
        ),
      },
    ],
    { initialEntries: ["/buckets/alpha"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}
```

Then change **line 137** (inside "hides everything again after leaving the
bucket and coming back") from:

```tsx
    await userEvent.click(screen.getByRole("link", { name: /all buckets/i }));
```

to:

```tsx
    await userEvent.click(screen.getByRole("link", { name: /^buckets$/i }));
```

And change **line 304** (inside "re-enables Delete on a bucket whose last
secret was removed", which mounts the real `routes` and therefore now has the
real nav bar) the same way:

```tsx
    await userEvent.click(screen.getByRole("link", { name: /^buckets$/i }));
```

Both keep their existing assertions. Only the selector changes, because the
link they click moved from the page into the shell.

- [ ] **Step 8: Run the whole suite**

Run: `cd web && pnpm test`
Expected: PASS. `/keys` has no route yet, so nothing navigates there and no
MSW handler is needed for it.

- [ ] **Step 9: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features
git commit -m "feat(web): add the navigation bar and retire SecretsPage's back link

SP7 called that link a stopgap because SP8's nav bar was not there yet. It is
now, so the stopgap goes rather than lingering as a second path to the same
place. NavLink supplies isActive and aria-current, and `end` is unset so a
bucket's page keeps Buckets marked."
```

---

### Task 3: The key form schema and the expiry presets

**Files:**
- Create: `web/src/features/api-keys/apiKeyForm.ts`
- Create: `web/src/features/api-keys/apiKeyForm.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `web/src/features/api-keys/apiKeyForm.ts`:
  - `KEY_NAME_MAX_LENGTH: number` (64)
  - `EXPIRY_PRESETS`: an ordered array of `{ value: ExpiryPreset; label: string; days: number | null }`
  - `type ExpiryPreset = "30d" | "90d" | "1y" | "never"`
  - `apiKeyFormSchema`, a Zod object with `name`, `buckets`, `canWrite`, `canReveal`, `expiry`
  - `type ApiKeyFormValues = { name: string; buckets: string[]; canWrite: boolean; canReveal: boolean; expiry: ExpiryPreset }`
  - `expiresAtFromPreset(preset: ExpiryPreset, now?: number): string | null`

**The presets exist to make two bugs unreachable rather than handled.**
`<input type="datetime-local">` yields `2026-11-09T14:30` with no offset, and
SP5's final review caught a 500 from exactly that shape before it merged
(`datetime | None` accepted the offset-less string, then compared it against
an aware `now`; the fix was `AwareDatetime`, so it is a 422 today).
Separately, the API rejects an `expires_at` already in the past with a 422.
Computing `now + days` produces a value that is always aware and always
future, so neither failure has an input that could cause it.

`expiresAtFromPreset` takes `now` as a parameter so its test can pin an exact
instant instead of asserting a range.

The only constraint duplicated from the backend here is the name's 64
character maximum (`api/app/models/api_key.py:18`), which is a number rather
than a pattern. Bucket names are checkboxes fed from `useBuckets()`, so
nothing is free typed and `NAME_PATTERN` never crosses the boundary.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/api-keys/apiKeyForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  apiKeyFormSchema,
  expiresAtFromPreset,
  EXPIRY_PRESETS,
  KEY_NAME_MAX_LENGTH,
} from "./apiKeyForm";

function parse(overrides: Record<string, unknown> = {}) {
  return apiKeyFormSchema.safeParse({
    name: "ci-deploy",
    buckets: ["prod"],
    canWrite: false,
    canReveal: false,
    expiry: "90d",
    ...overrides,
  });
}

describe("the key form schema", () => {
  it("accepts a minimal valid key", () => {
    expect(parse().success).toBe(true);
  });

  it("requires a name", () => {
    expect(parse({ name: "" }).success).toBe(false);
  });

  it("accepts a name at the 64 character limit and rejects one over", () => {
    expect(parse({ name: "x".repeat(KEY_NAME_MAX_LENGTH) }).success).toBe(true);
    expect(parse({ name: "x".repeat(KEY_NAME_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it("requires at least one bucket, because the API does", () => {
    expect(parse({ buckets: [] }).success).toBe(false);
    expect(parse({ buckets: ["prod", "dev"] }).success).toBe(true);
  });

  it("allows all four combinations of the two capability flags", () => {
    // Write without bulk reveal is precisely a deploy pipeline's scope, so
    // collapsing these into preset roles would remove a real one.
    for (const canWrite of [true, false]) {
      for (const canReveal of [true, false]) {
        expect(parse({ canWrite, canReveal }).success).toBe(true);
      }
    }
  });

  it("rejects an expiry that is not one of the presets", () => {
    expect(parse({ expiry: "tuesday" }).success).toBe(false);
  });
});

describe("expiresAtFromPreset", () => {
  const NOW = Date.parse("2026-08-11T00:00:00.000Z");

  it("returns null for never, so no expires_at is sent at all", () => {
    expect(expiresAtFromPreset("never", NOW)).toBeNull();
  });

  it("returns an exact instant for each dated preset", () => {
    expect(expiresAtFromPreset("30d", NOW)).toBe("2026-09-10T00:00:00.000Z");
    expect(expiresAtFromPreset("90d", NOW)).toBe("2026-11-09T00:00:00.000Z");
    expect(expiresAtFromPreset("1y", NOW)).toBe("2027-08-11T00:00:00.000Z");
  });

  it("always carries an offset, which is the bug this shape removes", () => {
    // A datetime-local input yields "2026-11-09T14:30" with no offset, which
    // SP5's final review caught as a 500 before it merged.
    for (const preset of EXPIRY_PRESETS) {
      const value = expiresAtFromPreset(preset.value, NOW);
      if (value === null) {
        continue;
      }
      expect(value).toMatch(/Z$/);
      expect(Date.parse(value)).toBeGreaterThan(NOW);
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/api-keys/apiKeyForm.test.ts`
Expected: FAIL, cannot resolve `./apiKeyForm`.

- [ ] **Step 3: Write the schema**

Create `web/src/features/api-keys/apiKeyForm.ts`:

```ts
import { z } from "zod";

/** Duplicated from api/app/models/api_key.py:18. A number, not a pattern. */
export const KEY_NAME_MAX_LENGTH = 64;

export type ExpiryPreset = "30d" | "90d" | "1y" | "never";

/**
 * Presets rather than a datetime input, so two failures have no input that
 * could cause them.
 *
 * A datetime-local input yields "2026-11-09T14:30" with no offset, and SP5's
 * final review caught a 500 from exactly that before it merged. And the API
 * refuses an expires_at already in the past, which adding to now cannot
 * produce.
 */
export const EXPIRY_PRESETS: { value: ExpiryPreset; label: string; days: number | null }[] = [
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "1y", label: "1 year", days: 365 },
  { value: "never", label: "Never", days: null },
];

export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .min(1, "Give the key a name so you can tell it apart later.")
    .max(KEY_NAME_MAX_LENGTH, `Use at most ${KEY_NAME_MAX_LENGTH} characters.`),
  // The API requires at least one, and a key scoped to nothing could reach
  // nothing anyway.
  buckets: z.array(z.string()).min(1, "Choose at least one bucket."),
  canWrite: z.boolean(),
  canReveal: z.boolean(),
  expiry: z.enum(["30d", "90d", "1y", "never"]),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * An aware UTC instant in the future, or null for never.
 *
 * `now` is a parameter so the test can pin an exact instant rather than
 * assert a range.
 */
export function expiresAtFromPreset(preset: ExpiryPreset, now: number = Date.now()): string | null {
  const found = EXPIRY_PRESETS.find((candidate) => candidate.value === preset);
  if (found === undefined || found.days === null) {
    return null;
  }
  return new Date(now + found.days * MILLISECONDS_PER_DAY).toISOString();
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/api-keys/apiKeyForm.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/api-keys
git commit -m "feat(web): add the API key form schema and expiry presets

Presets rather than a datetime input, so a naive offset-less value and a
past expiry both have no input that could produce them. All four capability
combinations stay reachable, since write without bulk reveal is exactly a
deploy pipeline's scope."
```

---

### Task 4: The data hooks

**Files:**
- Create: `web/src/features/api-keys/useApiKeys.ts`
- Create: `web/src/features/api-keys/useApiKeys.test.tsx`
- Modify: `web/src/features/buckets/useBuckets.ts:31-46`

**Interfaces:**
- Consumes: `client.get`, `client.post`, `client.del` (all pre-existing).
- Produces, from `web/src/features/api-keys/useApiKeys.ts`:
  - `type ApiKey = components["schemas"]["ApiKeyData"]`
  - `type CreatedApiKey = components["schemas"]["CreatedApiKeyData"]` (`ApiKey` plus `token: string`)
  - `type CreateKeyBody = components["schemas"]["CreateKeyRequest"]`
  - `API_KEYS_QUERY_KEY: readonly ["api-keys"]`
  - `useApiKeys()` → `UseQueryResult<ApiKey[], ApiError>`
  - `useCreateApiKey()` → mutation, variables `CreateKeyBody`, returns `CreatedApiKey`
  - `useRevokeApiKey()` → mutation, variables `string` (the key id), returns `{ revoked: boolean }`
  - `type KeyStatus = "active" | "expired" | "revoked"`
  - `keyStatus(key: ApiKey, now?: number): KeyStatus`

One flat root, `["api-keys"]`. Nothing nests under `["buckets"]`, for the
reason SP7 established: that key invalidates with the default `exact: false`.

`keyStatus` takes `now` as a parameter for the same reason
`expiresAtFromPreset` does, so its test pins instants rather than sleeping.
Status is derived at render from the client's clock, so a key expiring while
the page sits open will not flip until something re-renders. That is accepted
rather than fixed with a timer whose only job would be updating a badge.

### The cross-feature edge, and an honest limit on testing it

`api_key_buckets` cascades on bucket delete, so deleting an empty bucket
silently shrinks the scope of any key that named it. `useDeleteBucket` should
therefore invalidate `["api-keys"]` too.

**No click driven test can falsify that line.** `/buckets` and `/keys` are
mutually exclusive routes and the list's `staleTime` is 0, so navigating
between them refetches on mount whether or not the invalidation exists. SP7
shipped exactly that shape of test believing it pinned the equivalent
behaviour, and it did not; the fix there was a direct
`getQueryState(...).isInvalidated` assertion. Do the same here from the
start, and say so in the comment.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/api-keys/useApiKeys.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/api-keys/useApiKeys.test.tsx`
Expected: FAIL, cannot resolve `./useApiKeys`.

- [ ] **Step 3: Write the hooks**

Create `web/src/features/api-keys/useApiKeys.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";

export type ApiKey = components["schemas"]["ApiKeyData"];
export type CreatedApiKey = components["schemas"]["CreatedApiKeyData"];
export type CreateKeyBody = components["schemas"]["CreateKeyRequest"];
type Revoked = components["schemas"]["RevokedData"];

/**
 * One flat root. Nothing nests under ["buckets"], which invalidates with the
 * default exact: false, so nesting would mean every bucket write wiping this.
 */
export const API_KEYS_QUERY_KEY = ["api-keys"] as const;

export function useApiKeys() {
  return useQuery<ApiKey[], ApiError>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => client.get<ApiKey[]>("/v1/keys"),
  });
}

/**
 * The one mutation in this application whose result is a live credential.
 *
 * The token lives here and nowhere else: `data` is the unacknowledged
 * condition, `reset()` is acknowledgement, and unmounting collects it. See
 * ADR 003 A12.
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation<CreatedApiKey, ApiError, CreateKeyBody>({
    mutationFn: (body) => client.post<CreatedApiKey>("/v1/keys", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation<Revoked, ApiError, string>({
    mutationFn: (id) => client.del<Revoked>(`/v1/keys/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: (error) => {
      // The row is showing a key the server says is gone, so the list is
      // stale in a way the user can see.
      if (error.code === "API_KEY_NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
      }
    },
  });
}

export type KeyStatus = "active" | "expired" | "revoked";

/**
 * Revoked wins over expired: a revoked key is revoked whatever its expiry.
 *
 * `now` is a parameter so tests pin instants. Derived at render, so a key
 * expiring while the page sits open does not flip until something
 * re-renders. Accepted rather than carrying a timer to update a badge.
 */
export function keyStatus(key: ApiKey, now: number = Date.now()): KeyStatus {
  if (key.revoked_at !== null) {
    return "revoked";
  }
  if (key.expires_at !== null && Date.parse(key.expires_at) <= now) {
    return "expired";
  }
  return "active";
}
```

- [ ] **Step 4: Add the cross-feature invalidation**

In `web/src/features/buckets/useBuckets.ts`, add
`import { API_KEYS_QUERY_KEY } from "../api-keys/useApiKeys";` and extend
`useDeleteBucket`'s `onSuccess`:

```ts
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BUCKETS_QUERY_KEY });
      // api_key_buckets cascades, so deleting a bucket silently shrinks the
      // scope of every key that named it.
      //
      // No click driven test can falsify this line: /buckets and /keys are
      // mutually exclusive routes and the key list's staleTime is 0, so a
      // walk-through refetches on mount either way. Its test asserts
      // isInvalidated on the cache directly, which is the only assertion that
      // fails when this line is removed.
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
```

This import direction is `buckets -> api-keys`, and `api-keys` imports
nothing from `buckets`, so there is no cycle.

- [ ] **Step 5: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/api-keys/useApiKeys.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Falsify the cross-feature invalidation**

Remove the `API_KEYS_QUERY_KEY` invalidation you just added to
`useDeleteBucket` and re-run. Expected: "marks api-keys stale, because a
cascade shrinks every key scoped to it" fails with `expected false to be
true`, and only that test. Restore it and confirm green.

Record the actual output in your report. The point of this step is that the
equivalent SP7 test passed without its code, so the claim needs evidence
rather than assertion.

- [ ] **Step 7: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features
git commit -m "feat(web): add the API key query hooks

One flat root, so no bucket invalidation can reach it. Deleting a bucket
invalidates the key list, because api_key_buckets cascades and silently
shrinks a key's scope; that line is asserted on the cache rather than through
a walk-through, which could not falsify it."
```

---

### Task 5: The token panel and the loss guard

**Files:**
- Create: `web/src/features/api-keys/NewKeyPanel.tsx`
- Create: `web/src/features/api-keys/NewKeyPanel.test.tsx`

**Interfaces:**
- Consumes: `CreatedApiKey` (Task 4); `Alert` from `web/src/components/Alert.tsx`.
- Produces: `NewKeyPanel({ apiKey, onAcknowledge }: { apiKey: CreatedApiKey; onAcknowledge: () => void })`.

**The guard is armed by this component's existence.** It renders only while a
token is unacknowledged, so `useBlocker(true)` and a `beforeunload` listener
in a `useEffect` both live exactly as long as the panel does. There is no
"guard armed" boolean that could drift out of step with what is on screen,
because the mount *is* the flag.

**The token is displayed in full, unmasked**, which is the opposite of
`SecretRow` and deliberate. A secret can be revealed again tomorrow. This
cannot, so hiding it would work against the one thing the screen exists to
accomplish.

`navigator.clipboard.writeText` is awaited in a `try`/`catch` for the reason
`SecretRow` does it: it rejects on a denied permission or a non secure
context, and an unhandled rejection is an stderr line, which the pristine
output constraint makes a defect.

**The blocked prompt is a `div` wrapping an `Alert`, not an `Alert` with
buttons inside it.** `Alert` renders a `<p>`, and a `<button>` inside a `<p>`
is invalid HTML that React will not warn about but browsers will reflow
oddly.

`useBlocker` requires a data router (`createBrowserRouter`, which
`web/src/routes/router.tsx` already uses, or `createMemoryRouter` in tests).
It does nothing under a plain `MemoryRouter`, so this component's tests build
a memory data router.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/api-keys/NewKeyPanel.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { NewKeyPanel } from "./NewKeyPanel";

const CREATED = {
  id: "11111111-1111-1111-1111-111111111111",
  lookup_id: "a3f9c2e1",
  name: "ci-deploy",
  buckets: ["prod"],
  can_write: true,
  can_reveal: false,
  expires_at: null,
  revoked_at: null,
  last_used_at: null,
  created_at: "2026-08-11T00:00:00Z",
  token: "msm_a3f9c2e1_averylongsecretsegmenthere",
};

/** useBlocker needs a data router, so a plain MemoryRouter will not do. */
function renderPanel(onAcknowledge = vi.fn()) {
  const router = createMemoryRouter(
    [
      {
        path: "/keys",
        element: (
          <>
            <Link to="/buckets">Buckets</Link>
            <NewKeyPanel apiKey={CREATED} onAcknowledge={onAcknowledge} />
          </>
        ),
      },
      { path: "/buckets", element: <p>the bucket list</p> },
    ],
    { initialEntries: ["/keys"] },
  );
  return { onAcknowledge, router, ...renderWithProviders(<RouterProvider router={router} />) };
}

describe("NewKeyPanel", () => {
  it("shows the token in full, because it will never be shown again", () => {
    renderPanel();

    expect(screen.getByText(CREATED.token)).toBeInTheDocument();
  });

  it("says plainly that it cannot be recovered", () => {
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be recovered/i);
  });

  it("copies the token to the clipboard", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(CREATED.token));
    expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
  });

  it("hands acknowledgement back to the owner of the mutation", async () => {
    const { onAcknowledge } = renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it("blocks a navigation away and can be told to stay", async () => {
    const { router } = renderPanel();

    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));

    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/keys");

    await userEvent.click(screen.getByRole("button", { name: /^stay$/i }));

    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/keys");
  });

  it("lets the navigation through when the user insists", async () => {
    const { router } = renderPanel();

    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));
    await userEvent.click(await screen.findByRole("button", { name: /^leave$/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/buckets"));
  });

  it("asks the browser to confirm a reload while it is on screen", () => {
    const { unmount } = renderPanel();

    const armed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(armed);
    expect(armed.defaultPrevented).toBe(true);

    // Unmounting is what acknowledgement does, so the guard must disarm with
    // the panel rather than outlive it.
    unmount();

    const disarmed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(disarmed);
    expect(disarmed.defaultPrevented).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/api-keys/NewKeyPanel.test.tsx`
Expected: FAIL, cannot resolve `./NewKeyPanel`.

- [ ] **Step 3: Write the panel**

Create `web/src/features/api-keys/NewKeyPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useBlocker } from "react-router";

import { Alert } from "../../components/Alert";
import type { CreatedApiKey } from "./useApiKeys";

/**
 * The one screen in this application that displays a live credential on
 * purpose.
 *
 * The guard is armed by this component's existence rather than by a flag:
 * the panel renders only while a token is unacknowledged, so the blocker and
 * the beforeunload listener live exactly as long as it does and cannot drift
 * out of step with what is on screen.
 *
 * The token is shown in full, which is the opposite of SecretRow and
 * deliberate. A secret can be revealed again tomorrow; this cannot, so
 * masking it would work against the only thing this screen is for. It reaches
 * no storage, no URL and no error payload. See ADR 003 A12.
 */
export function NewKeyPanel({
  apiKey,
  onAcknowledge,
}: {
  apiKey: CreatedApiKey;
  onAcknowledge: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const blocker = useBlocker(true);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      // preventDefault is the modern spelling; returnValue is deprecated and
      // browsers render their own text either way.
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function copy() {
    // Awaited in a try/catch: writeText rejects on a denied permission or a
    // non secure context, and an unhandled rejection is an stderr line.
    try {
      await navigator.clipboard.writeText(apiKey.token);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      aria-label={`Token for ${apiKey.name}`}
      className="flex flex-col gap-3 rounded border p-4"
    >
      <h2 className="font-medium">Key &ldquo;{apiKey.name}&rdquo; created</h2>

      <Alert tone="warning">
        This token is shown once and cannot be recovered. Save it now. If you lose it, revoke this
        key and create another.
      </Alert>

      <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm">
        {apiKey.token}
      </code>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded border px-3 py-1 text-sm"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onAcknowledge}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
        >
          I have saved it
        </button>
      </div>

      {copyState === "copied" && (
        <p role="status" className="text-sm text-slate-600">
          Copied
        </p>
      )}
      {copyState === "failed" && <Alert variant="inline">Could not copy to the clipboard.</Alert>}

      {blocker.state === "blocked" && (
        // A div wrapping an Alert, not an Alert containing buttons: Alert
        // renders a <p>, and a button inside a <p> is invalid HTML.
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
          <Alert variant="inline" tone="warning">
            Leave without saving your token? It cannot be recovered.
          </Alert>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => blocker.reset()}
              className="rounded border px-2 py-1"
            >
              Stay
            </button>
            <button
              type="button"
              onClick={() => blocker.proceed()}
              className="rounded border px-2 py-1"
            >
              Leave
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/api-keys/NewKeyPanel.test.tsx`
Expected: PASS, 7 tests, with no `act` warning and no unhandled rejection.

- [ ] **Step 5: Falsify the blocker**

Replace `useBlocker(true)` with `useBlocker(false)` and re-run. Expected:
"blocks a navigation away and can be told to stay" and "lets the navigation
through when the user insists" both fail, because the router navigates
straight to `/buckets`. Restore `true` and confirm green.

Record the actual output. A guard whose failure is silent needs a test that
demonstrably fails without it.

- [ ] **Step 6: Falsify the beforeunload handler**

Comment out the `window.addEventListener("beforeunload", warn)` line and
re-run. Expected: "asks the browser to confirm a reload while it is on
screen" fails on `expected false to be true`. Restore and confirm green.

Record the actual output.

- [ ] **Step 7: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/api-keys
git commit -m "feat(web): add the show once token panel and its loss guard

The guard is armed by the panel's existence rather than by a flag, so the
blocker and the beforeunload listener cannot drift out of step with what is on
screen. The token is shown unmasked, which is deliberate: it cannot be shown
again, so hiding it would defeat the screen."
```

---

### Task 6: The create form

**Files:**
- Create: `web/src/features/api-keys/CreateKeyForm.tsx`
- Create: `web/src/features/api-keys/CreateKeyForm.test.tsx`

**Interfaces:**
- Consumes: `apiKeyFormSchema`, `ApiKeyFormValues`, `EXPIRY_PRESETS`, `expiresAtFromPreset` (Task 3); `useCreateApiKey` (Task 4); `NewKeyPanel` (Task 5); `Bucket` from `web/src/features/buckets/useBuckets.ts`; `Alert`.
- Produces: `CreateKeyForm({ buckets }: { buckets: Bucket[] })`.

This component owns the create mutation and chooses between the form and the
panel, so "the panel replaces the form" is one component's internal decision
rather than a condition duplicated in the page. It also makes a second submit
impossible while a token is unsaved, because the form is not rendered.

**The capability copy is the only place a user learns what these flags do**,
and one of them is easy to mislabel. `may_reveal` is checked only in
`list_endpoint`'s bulk path (`api/app/routers/secrets.py:55` and `:149`); the
single key `get_endpoint` has no such check. **A key with neither flag can
still read secret values, one request at a time.** So the standing line above
the checkboxes says exactly that, and the reveal checkbox is labelled as bulk
fetch rather than as permission to read. A label reading "Reveal secrets"
would be false.

`can_write` is create, overwrite **and** delete, per ADR 002 A25, and
deleting a secret is unrecoverable because A5 rules out versioning.

Hooks are all called before the early returns, so the rules of hooks hold.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/api-keys/CreateKeyForm.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { CreateKeyForm } from "./CreateKeyForm";

const KEYS = "http://localhost:8000/v1/keys";

function aBucket(name: string) {
  return { id: `id-${name}`, name, created_at: "2026-08-11T00:00:00Z", secret_count: 0 };
}

/** A data router, because a successful create renders NewKeyPanel's blocker. */
function renderForm(buckets = [aBucket("prod"), aBucket("dev")]) {
  const router = createMemoryRouter(
    [{ path: "/keys", element: <CreateKeyForm buckets={buckets} /> }],
    { initialEntries: ["/keys"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("CreateKeyForm", () => {
  it("sends the chosen name, buckets, flags and an expiry instant", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(KEYS, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "ci-deploy",
              buckets: ["prod"],
              can_write: true,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        );
      }),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /write secrets/i }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.name).toBe("ci-deploy");
    expect(body?.buckets).toEqual(["prod"]);
    expect(body?.can_write).toBe(true);
    expect(body?.can_reveal).toBe(false);
    // 90 days is the default preset, so this is an instant, not a duration.
    expect(typeof body?.expires_at).toBe("string");
    expect(String(body?.expires_at)).toMatch(/Z$/);
    expect(Date.parse(String(body?.expires_at))).toBeGreaterThan(Date.now());
  });

  it("sends no expires_at when the key never expires", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(KEYS, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "forever",
              buckets: ["prod"],
              can_write: false,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        );
      }),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "forever");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.selectOptions(screen.getByLabelText(/expires/i), "never");
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.expires_at).toBeNull();
  });

  it("refuses to submit with no bucket chosen, without reaching the network", async () => {
    let calls = 0;
    server.use(
      http.post(KEYS, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: {} }, { status: 201 });
      }),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "no-buckets");
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByText(/at least one bucket/i)).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("states that any key can already read secrets, so the reveal box is not misread", () => {
    renderForm();

    // may_reveal gates only the bulk path. A key without it still reads
    // secrets one at a time, and the form must not imply otherwise.
    expect(screen.getByText(/read secrets in these buckets one at a time/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /bulk reveal/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^reveal secrets$/i })).not.toBeInTheDocument();
  });

  it("replaces itself with the token panel on success", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "ci-deploy",
              buckets: ["prod"],
              can_write: false,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByText("msm_a3f9c2e1_secret")).toBeInTheDocument();
    // A second submit is impossible while a token is unsaved.
    expect(screen.queryByRole("button", { name: /create key/i })).not.toBeInTheDocument();
  });

  it("shows the form again once the token is acknowledged", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "ci-deploy",
              buckets: ["prod"],
              can_write: false,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));
    await screen.findByText("msm_a3f9c2e1_secret");

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(await screen.findByRole("button", { name: /create key/i })).toBeInTheDocument();
    expect(screen.queryByText("msm_a3f9c2e1_secret")).not.toBeInTheDocument();
    // Reset, not merely hidden: the name field is empty again.
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
  });

  it("puts a server refusal on the form and keeps what was typed", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_FOUND", message: "No bucket named 'prod'." } },
          { status: 404 },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "keep-me");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no bucket named/i);
    expect(screen.getByLabelText(/name/i)).toHaveValue("keep-me");
  });

  it("tells an account with no buckets to make one first", () => {
    renderWithProviders(
      <MemoryRouter>
        <CreateKeyForm buckets={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /create a bucket/i })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(screen.queryByRole("button", { name: /create key/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/api-keys/CreateKeyForm.test.tsx`
Expected: FAIL, cannot resolve `./CreateKeyForm`.

- [ ] **Step 3: Write the form**

Create `web/src/features/api-keys/CreateKeyForm.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import type { Bucket } from "../buckets/useBuckets";
import {
  apiKeyFormSchema,
  EXPIRY_PRESETS,
  expiresAtFromPreset,
  type ApiKeyFormValues,
} from "./apiKeyForm";
import { NewKeyPanel } from "./NewKeyPanel";
import { useCreateApiKey } from "./useApiKeys";

export function CreateKeyForm({ buckets }: { buckets: Bucket[] }) {
  const create = useCreateApiKey();
  const {
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: { name: "", buckets: [], canWrite: false, canReveal: false, expiry: "90d" },
  });

  // The panel replaces the form rather than sitting above it, so a second
  // submit is impossible while a token is still unsaved.
  if (create.data) {
    return (
      <NewKeyPanel
        apiKey={create.data}
        onAcknowledge={() => {
          create.reset();
          reset();
        }}
      />
    );
  }

  if (buckets.length === 0) {
    return (
      <p className="rounded border p-4 text-slate-600">
        A key has to be scoped to at least one bucket.{" "}
        <Link to="/buckets" className="underline">
          Create a bucket
        </Link>{" "}
        first.
      </p>
    );
  }

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        name: values.name,
        buckets: values.buckets,
        can_write: values.canWrite,
        can_reveal: values.canReveal,
        expires_at: expiresAtFromPreset(values.expiry),
      },
      {
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Create an API key"
      className="flex flex-col gap-3 rounded border p-4"
    >
      <label htmlFor="key-name" className="text-sm font-medium">
        Name
      </label>
      <input
        id="key-name"
        {...register("name")}
        placeholder="ci-deploy"
        disabled={create.isPending}
        aria-invalid={errors.name ? true : undefined}
        className="rounded border px-3 py-2"
      />
      {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Buckets this key can reach</legend>
        {buckets.map((bucket) => (
          <label key={bucket.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              value={bucket.name}
              {...register("buckets")}
              disabled={create.isPending}
            />
            {bucket.name}
          </label>
        ))}
      </fieldset>
      {errors.buckets && <Alert variant="inline">{errors.buckets.message}</Alert>}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Capabilities</legend>
        {/* may_reveal gates only the bulk path in list_endpoint. The single
            key endpoint has no such check, so a key with neither flag can
            still read values one at a time. Saying so is the difference
            between this form describing the grant and lying about it. */}
        <p className="text-sm text-slate-600">
          Any key can read secrets in these buckets one at a time. The options below grant more
          than that.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("canWrite")} disabled={create.isPending} />
          <span>
            <span className="font-medium">Write secrets</span>
            <br />
            Create, overwrite and delete. Deleting a secret is permanent.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...register("canReveal")} disabled={create.isPending} />
          <span>
            <span className="font-medium">Bulk reveal</span>
            <br />
            Fetch every secret in a bucket in one request. A browser session can never do this.
          </span>
        </label>
      </fieldset>

      <label htmlFor="key-expiry" className="text-sm font-medium">
        Expires
      </label>
      <select
        id="key-expiry"
        {...register("expiry")}
        disabled={create.isPending}
        className="rounded border px-3 py-2"
      >
        {EXPIRY_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>

      <div>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          Create key
        </button>
      </div>

      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}
    </form>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/api-keys/CreateKeyForm.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features/api-keys
git commit -m "feat(web): add the API key create form

The capability copy names what each flag actually grants: may_reveal gates
only the bulk path, so a key without it still reads secrets one at a time, and
a checkbox reading Reveal secrets would be false. The panel replaces the form
on success, so a second submit is impossible while a token is unsaved."
```

---

### Task 7: The key row, the page, and the route

**Files:**
- Create: `web/src/features/api-keys/KeyRow.tsx`
- Create: `web/src/features/api-keys/KeyRow.test.tsx`
- Create: `web/src/features/api-keys/KeysPage.tsx`
- Create: `web/src/features/api-keys/KeysPage.test.tsx`
- Modify: `web/src/routes/router.tsx:19,35`
- Modify: `web/src/routes/access.test.tsx` (append)

**Interfaces:**
- Consumes: `ApiKey`, `keyStatus`, `useApiKeys`, `useRevokeApiKey` (Task 4); `CreateKeyForm` (Task 6); `ConfirmPrompt` (Task 1); `useBuckets`; `Alert`.
- Produces: `KeyRow({ apiKey }: { apiKey: ApiKey })`; `KeysPage()`; the route `/keys`.

**The page must not render `CreateKeyForm` until the bucket list has
loaded.** `useBuckets()` returns `undefined` data while pending, and passing
`[]` then would show the "create a bucket first" state to an account that
has plenty. Gate on `buckets.data` existing.

The key list follows SP6's corrected shape for the reason SP7 did: render
whenever `data` exists, so a failed background refetch adds a banner rather
than erasing a loaded list.

Revoke appears only on Active rows. Revoked and expired rows are muted and
carry no button, because revoking an already dead key changes nothing the
user can see.

- [ ] **Step 1: Write the failing row tests**

Create `web/src/features/api-keys/KeyRow.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { KeyRow } from "./KeyRow";

const KEYS = "http://localhost:8000/v1/keys";
const ID = "11111111-1111-1111-1111-111111111111";

function aKey(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
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

function renderRow(overrides: Record<string, unknown> = {}) {
  return renderWithProviders(
    <ul>
      <KeyRow apiKey={aKey(overrides)} />
    </ul>,
  );
}

describe("KeyRow", () => {
  it("shows the name, the lookup id and the scope", () => {
    renderRow({ buckets: ["prod", "dev"] });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText("ci-deploy")).toBeInTheDocument();
    // Not secret, and exists precisely to identify a key without
    // authenticating as one.
    expect(within(row).getByText(/msm_a3f9c2e1/)).toBeInTheDocument();
    expect(within(row).getByText(/prod, dev/)).toBeInTheDocument();
  });

  it("says read only when neither flag is set", () => {
    renderRow();

    expect(screen.getByText(/read only/i)).toBeInTheDocument();
  });

  it("names both capabilities when both are set", () => {
    renderRow({ can_write: true, can_reveal: true });

    expect(screen.getByText(/write and bulk reveal/i)).toBeInTheDocument();
  });

  it("badges an active key and offers revoke", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/active/i)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /revoke ci-deploy/i })).toBeInTheDocument();
  });

  it("badges a revoked key and offers nothing", () => {
    renderRow({ revoked_at: "2026-08-01T00:00:00Z" });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/revoked/i)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });

  it("badges an expired key and offers nothing", () => {
    renderRow({ expires_at: "2020-01-01T00:00:00Z" });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/expired/i)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });

  it("confirms before revoking and can be cancelled", async () => {
    let calls = 0;
    server.use(
      http.delete(`${KEYS}/:id`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    expect(within(row).getByText(/revoke this key/i)).toBeInTheDocument();
    await userEvent.click(
      within(row).getByRole("button", { name: /cancel revoking ci-deploy/i }),
    );

    expect(within(row).queryByText(/revoke this key/i)).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("revokes when confirmed", async () => {
    let revoked: string | undefined;
    server.use(
      http.delete(`${KEYS}/:id`, ({ params }) => {
        revoked = String(params.id);
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    await userEvent.click(
      within(row).getByRole("button", { name: /confirm revoking ci-deploy/i }),
    );

    await waitFor(() => expect(revoked).toBe(ID));
  });

  it("shows a failed revoke on its own row", async () => {
    server.use(
      http.delete(`${KEYS}/:id`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "API_KEY_NOT_FOUND", message: "No such API key." } },
          { status: 404 },
        ),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    await userEvent.click(
      within(row).getByRole("button", { name: /confirm revoking ci-deploy/i }),
    );

    expect(await within(row).findByRole("alert")).toHaveTextContent(/no such api key/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/api-keys/KeyRow.test.tsx`
Expected: FAIL, cannot resolve `./KeyRow`.

- [ ] **Step 3: Write the row**

Create `web/src/features/api-keys/KeyRow.tsx`:

```tsx
import { useState } from "react";

import { Alert } from "../../components/Alert";
import { ConfirmPrompt } from "../../components/ConfirmPrompt";
import { keyStatus, useRevokeApiKey, type ApiKey } from "./useApiKeys";

const STATUS_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

function capabilityText(apiKey: ApiKey): string {
  const granted = [
    apiKey.can_write ? "write" : null,
    apiKey.can_reveal ? "bulk reveal" : null,
  ].filter((capability): capability is string => capability !== null);
  return granted.length === 0 ? "read only" : granted.join(" and ");
}

export function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const [confirming, setConfirming] = useState(false);
  const revoke = useRevokeApiKey();
  const status = keyStatus(apiKey);
  const live = status === "active";

  return (
    <li
      aria-label={apiKey.name}
      className={`flex flex-col gap-1 border-b py-3 ${live ? "" : "opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="font-medium">{apiKey.name}</span>
          <code className="ml-3 text-sm text-slate-500">msm_{apiKey.lookup_id}</code>
        </div>

        {confirming ? (
          <ConfirmPrompt
            prompt="Revoke this key?"
            confirmLabel={`Confirm revoking ${apiKey.name}`}
            cancelLabel={`Cancel revoking ${apiKey.name}`}
            onConfirm={() => revoke.mutate(apiKey.id)}
            onCancel={() => setConfirming(false)}
            confirmDisabled={revoke.isPending}
          />
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span>{STATUS_LABEL[status]}</span>
            {/* Revoking an already dead key changes nothing the user can
                see, so the button is not offered. */}
            {live && (
              <button
                type="button"
                aria-label={`Revoke ${apiKey.name}`}
                onClick={() => setConfirming(true)}
                className="rounded border px-2 py-1"
              >
                Revoke
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-sm text-slate-600">
        {apiKey.buckets.join(", ")} &middot; {capabilityText(apiKey)} &middot;{" "}
        {apiKey.last_used_at === null
          ? "never used"
          : `last used ${new Date(apiKey.last_used_at).toLocaleDateString()}`}
      </p>

      {revoke.isError && <Alert variant="inline">{revoke.error.message}</Alert>}
    </li>
  );
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/api-keys/KeyRow.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing page tests**

Create `web/src/features/api-keys/KeysPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { KeysPage } from "./KeysPage";

const BASE = "http://localhost:8000";

function aKey(name: string) {
  return {
    id: `id-${name}`,
    lookup_id: "a3f9c2e1",
    name,
    buckets: ["prod"],
    can_write: false,
    can_reveal: false,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-11T00:00:00Z",
  };
}

function bucketsReturn(names: string[]) {
  server.use(
    http.get(`${BASE}/v1/buckets`, () =>
      HttpResponse.json({
        ok: true,
        data: names.map((name) => ({
          id: `id-${name}`,
          name,
          created_at: "2026-08-11T00:00:00Z",
          secret_count: 0,
        })),
      }),
    ),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: "/keys", element: <KeysPage /> }], {
    initialEntries: ["/keys"],
  });
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("KeysPage", () => {
  it("lists the account's keys", async () => {
    bucketsReturn(["prod"]);
    server.use(
      http.get(`${BASE}/v1/keys`, () =>
        HttpResponse.json({ ok: true, data: [aKey("ci-deploy"), aKey("backup-job")] }),
      ),
    );
    renderPage();

    expect(await screen.findByRole("listitem", { name: "ci-deploy" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "backup-job" })).toBeInTheDocument();
  });

  it("says an account with no keys has none rather than looking like it is loading", async () => {
    bucketsReturn(["prod"]);
    server.use(http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it("does not show the no-buckets state while the bucket list is still loading", async () => {
    // useBuckets returns undefined data while pending, and passing [] then
    // would tell an account with buckets that it has none.
    let resolveBuckets: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      resolveBuckets = resolve;
    });
    server.use(
      http.get(`${BASE}/v1/buckets`, async () => {
        await held;
        return HttpResponse.json({
          ok: true,
          data: [{ id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 }],
        });
      }),
      http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })),
    );
    renderPage();

    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create a bucket/i })).not.toBeInTheDocument();

    resolveBuckets?.();

    expect(await screen.findByRole("button", { name: /create key/i })).toBeInTheDocument();
  });

  it("keeps a loaded list on screen through a failed background refetch", async () => {
    bucketsReturn(["prod"]);
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/keys`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ ok: true, data: [aKey("stable")] });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        );
      }),
    );
    const { queryClient } = renderPage();
    await screen.findByRole("listitem", { name: "stable" });

    await queryClient.refetchQueries({ queryKey: ["api-keys"] });

    expect(screen.getByRole("listitem", { name: "stable" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh/i);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `cd web && pnpm vitest run src/features/api-keys/KeysPage.test.tsx`
Expected: FAIL, cannot resolve `./KeysPage`.

- [ ] **Step 7: Write the page**

Create `web/src/features/api-keys/KeysPage.tsx`:

```tsx
import { Alert } from "../../components/Alert";
import { useBuckets } from "../buckets/useBuckets";
import { CreateKeyForm } from "./CreateKeyForm";
import { KeyRow } from "./KeyRow";
import { useApiKeys } from "./useApiKeys";

export function KeysPage() {
  const buckets = useBuckets();
  const keys = useApiKeys();

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">API keys</h1>

      {/* Gated on data existing, not merely rendered with a fallback of []:
          useBuckets is undefined while pending, and an empty array would show
          the "create a bucket first" state to an account that has plenty. */}
      {buckets.data && <CreateKeyForm buckets={buckets.data} />}

      {keys.isPending && (
        <p role="status" className="text-sm text-slate-600">
          Loading keys
        </p>
      )}

      {keys.isError && <Alert>Could not refresh your API keys. {keys.error.message}</Alert>}

      {/* Rendered on data existing, not on isSuccess: TanStack reports a
          failed refetch as an error while still holding the previous data, so
          gating on isSuccess would erase a working list. */}
      {keys.data &&
        (keys.data.length === 0 ? (
          <p className="text-slate-600">No API keys yet. Create one above.</p>
        ) : (
          <ul>
            {keys.data.map((apiKey) => (
              <KeyRow key={apiKey.id} apiKey={apiKey} />
            ))}
          </ul>
        ))}
    </section>
  );
}
```

- [ ] **Step 8: Run them and watch them pass**

Run: `cd web && pnpm vitest run src/features/api-keys/KeysPage.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 9: Add the route**

In `web/src/routes/router.tsx`, add
`import { KeysPage } from "../features/api-keys/KeysPage";` to the imports and
a third sibling below `/buckets/:name`:

```tsx
          { path: "/buckets/:name", element: <SecretsPage /> },
          // ADR 003 A7's third sibling, which SP6 and SP7 both named in
          // advance.
          { path: "/keys", element: <KeysPage /> },
```

- [ ] **Step 10: Test the route through the real router**

Append to `web/src/routes/access.test.tsx`:

```tsx
it("renders the API keys page at /keys", async () => {
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/keys", () => HttpResponse.json({ ok: true, data: [] })),
    http.get("http://localhost:8000/v1/buckets", () => HttpResponse.json({ ok: true, data: [] })),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/keys"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByRole("heading", { name: /api keys/i })).toBeInTheDocument();
});

it("keeps /keys behind the session guard", async () => {
  signedOut();
  const router = createMemoryRouter(routes, { initialEntries: ["/keys"] });

  renderWithProviders(<RouterProvider router={router} />);

  expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
});

it("walks from the bucket list to the keys page through the nav bar", async () => {
  signedIn();
  server.use(
    http.get("http://localhost:8000/v1/buckets", () => HttpResponse.json({ ok: true, data: [] })),
    http.get("http://localhost:8000/v1/keys", () => HttpResponse.json({ ok: true, data: [] })),
  );
  const router = createMemoryRouter(routes, { initialEntries: ["/buckets"] });
  renderWithProviders(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: /buckets/i });

  await userEvent.click(screen.getByRole("link", { name: "Keys" }));

  expect(await screen.findByRole("heading", { name: /api keys/i })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/keys");
});
```

- [ ] **Step 11: Run the whole suite**

Run: `cd web && pnpm test`
Expected: PASS, with no MSW unhandled-request error. `/keys` mounts both
`useBuckets` and `useApiKeys`, so any test that navigates there needs handlers
for both.

- [ ] **Step 12: Lint and commit**

```bash
cd web && pnpm lint && pnpm typecheck
git add src/features src/routes
git commit -m "feat(web): add the API keys page at /keys

Revoke is offered only on live keys, since revoking a dead one changes nothing
visible. The create form waits for the bucket list to load rather than
rendering with an empty array, which would tell an account with buckets that
it has none."
```

---

### Task 8: The tests that pin the token rules

**Files:**
- Create: `web/src/features/api-keys/invariants.test.tsx`

**Interfaces:**
- Consumes: `KeysPage` (Task 7).
- Produces: nothing. This task adds no source file.

These are the reason the token panel got its own component. Each is written so
that removing the thing it guards makes it fail, and Steps 3 to 5 check that
claim rather than asserting it.

Two assert over **every** request the test made, using MSW's `server.events`,
so the guarantee covers code nobody has written yet rather than the one URL
the test had in mind.

**Any source file touched during a falsification step must be restored before
committing.** This task's commit contains one new test file and nothing else.

- [ ] **Step 1: Write the tests**

Create `web/src/features/api-keys/invariants.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { KeysPage } from "./KeysPage";

const BASE = "http://localhost:8000";
const TOKEN = "msm_a3f9c2e1_averylongsecretsegmenthere";

function created(name = "ci-deploy") {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    lookup_id: "a3f9c2e1",
    name,
    buckets: ["prod"],
    can_write: false,
    can_reveal: false,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-11T00:00:00Z",
    token: TOKEN,
  };
}

function handlers() {
  server.use(
    http.get(`${BASE}/v1/buckets`, () =>
      HttpResponse.json({
        ok: true,
        data: [{ id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 }],
      }),
    ),
    http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })),
    http.post(`${BASE}/v1/keys`, () =>
      HttpResponse.json({ ok: true, data: created() }, { status: 201 }),
    ),
  );
}

/** A data router with somewhere else to go, so the blocker has work to do. */
function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/keys",
        element: (
          <>
            <Link to="/buckets">Buckets</Link>
            <KeysPage />
          </>
        ),
      },
      { path: "/buckets", element: <p>the bucket list</p> },
    ],
    { initialEntries: ["/keys"] },
  );
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
}

async function createAKey() {
  await userEvent.type(await screen.findByLabelText(/name/i), "ci-deploy");
  await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
  await userEvent.click(screen.getByRole("button", { name: /create key/i }));
  await screen.findByText(TOKEN);
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
  server.events.removeAllListeners("request:start");
});

describe("invariant 8: the token reaches no persistent store", () => {
  it("leaves localStorage and sessionStorage empty after a create", async () => {
    handlers();
    renderPage();

    await createAKey();

    // The invariant asserted literally rather than by reading the source.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps the token out of the URL", async () => {
    handlers();
    const { router } = renderPage();

    await createAKey();

    const { hash, pathname, search } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe("/keys");
  });
});

describe("invariant 2: credentials never travel in a request", () => {
  it("makes no request whose URL contains a token, in any interaction", async () => {
    handlers();
    renderPage();

    await createAKey();
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    await waitFor(() => expect(requested.length).toBeGreaterThan(2));
    // Asserted across every request rather than one URL, so the guarantee
    // covers code nobody has written yet.
    expect(requested.filter((url) => url.includes("msm_"))).toEqual([]);
  });
});

describe("the show once guarantee", () => {
  it("blocks a navigation away while the token is unacknowledged", async () => {
    handlers();
    const { router } = renderPage();
    await createAKey();

    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));

    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/keys");
  });

  it("stops blocking once the token is acknowledged", async () => {
    handlers();
    const { router } = renderPage();
    await createAKey();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));
    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/buckets"));
    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument();
  });

  it("arms and disarms the reload warning with the panel", async () => {
    handlers();
    renderPage();
    await createAKey();

    const armed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(armed);
    expect(armed.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    const disarmed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(disarmed);
    expect(disarmed.defaultPrevented).toBe(false);
  });

  it("removes the token from the page for good once acknowledged", async () => {
    handlers();
    renderPage();
    await createAKey();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    // Nothing can bring it back: the form is what returns, not the panel.
    expect(await screen.findByRole("button", { name: /create key/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd web && pnpm vitest run src/features/api-keys/invariants.test.tsx`
Expected: PASS, 7 tests, with no MSW unhandled-request error.

- [ ] **Step 3: Falsify the blocker**

In `web/src/features/api-keys/NewKeyPanel.tsx`, change `useBlocker(true)` to
`useBlocker(false)` and re-run. Expected: "blocks a navigation away while the
token is unacknowledged" fails, because the router reaches `/buckets`.
Restore and confirm green.

- [ ] **Step 4: Falsify the reload warning**

Comment out the `window.addEventListener("beforeunload", warn)` line in
`NewKeyPanel.tsx` and re-run. Expected: "arms and disarms the reload warning
with the panel" fails on `expected false to be true`. Restore and confirm
green.

- [ ] **Step 5: Falsify the acknowledgement**

In `web/src/features/api-keys/CreateKeyForm.tsx`, remove the `create.reset()`
call from `onAcknowledge`, leaving only `reset()`. Re-run. Expected: "removes
the token from the page for good once acknowledged", "stops blocking once the
token is acknowledged" and "arms and disarms the reload warning with the
panel" all fail, because `create.data` still holds the token and the panel
never unmounts. Restore and confirm green.

- [ ] **Step 6: Record the falsification results**

Write what each of Steps 3 to 5 actually printed into the task report,
including the failure messages, and confirm every touched source file is back
to its committed state (`git diff --stat` empty for
`src/features/api-keys/NewKeyPanel.tsx` and
`src/features/api-keys/CreateKeyForm.tsx`).

A falsification step performed but not recorded is indistinguishable from one
that was skipped, and this project has already shipped one falsification run
whose red result turned out to be luck.

- [ ] **Step 7: Run everything and commit**

```bash
cd web && pnpm lint && pnpm typecheck && pnpm test
git add src/features/api-keys/invariants.test.tsx
git commit -m "test(web): pin the show once token rules

Storage asserted empty literally, request URLs checked across every request
the test made rather than one, and the blocker, the reload warning and
acknowledgement each falsified by removing the thing that implements them."
```

---

### Task 9: The ADR amendments

**Files:**
- Modify: `docs/adr/0003-frontend-architecture.md:22` (the stack table)
- Modify: `docs/adr/0003-frontend-architecture.md` (append A11 and A12)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing in code.

The spec requires two amendments, and they are documentation rather than a
side effect of some other task, so they get their own commit.

- [ ] **Step 1: Strike Zustand from the stack table**

In `docs/adr/0003-frontend-architecture.md`, change line 22 from:

```
| Client state | Zustand |
```

to:

```
| Client state | None. See A11. |
```

- [ ] **Step 2: Append the two amendments**

Append to `docs/adr/0003-frontend-architecture.md`:

```markdown
### A11. Zustand is removed from the stack

A5 named its first consumer as reveal toggles. A9 corrected that once SP7
showed reveal state is ephemeral and component local, and said that if SP8
found no client state either, Zustand should be removed rather than left
waiting indefinitely.

SP8 found none. The show once token is a mutation result plus the panel's own
existence, revoke confirm is row local, the form is React Hook Form, and
navigation state is `NavLink`'s. Three sub-projects have now each concluded
that state they expected to be global belongs in a component.

**Amended:** the frontend ships v1 with no client state library. TanStack
Query owns server state and `useState` owns the rest.

Worth being exact about what this cost: Zustand was never actually installed,
because A5 deferred it to a first real consumer that never arrived. The waste
was three sub-projects of planning around a dependency, not of shipping one.
If a genuine consumer appears later, adding a store then is a smaller change
than this removal was.

### A12. The show once token is named under A10's clipboard exception

A10 permits copying a revealed secret to the clipboard, and is written about
revealed secrets specifically. The API key token is a different object and the
only other live credential this UI displays, so inferring that A10 stretches
to cover it would be crediting a rule with work it does not do.

**Amended:** copying the token is permitted on the same terms and for the same
reason. Nothing clears the clipboard afterwards.

The token is otherwise subject to invariant 8 in full. It reaches no storage,
no URL state and no error payload, and it exists in memory only as the create
mutation's `data`, until `reset()` on acknowledgement or garbage collection on
unmount removes it. The panel that displays it also arms the only guards
against losing it, so those cannot outlive the credential they protect.
```

- [ ] **Step 3: Confirm no code contradicts the amendments**

Run: `cd web && grep -rin "zustand" package.json pnpm-lock.yaml src/ || echo "absent, as A11 requires"`
Expected: `absent, as A11 requires`. Zustand must appear in neither the
dependency tree nor the source. `grep` exits non-zero on no match, which is
why the `||` is there rather than a bare command.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0003-frontend-architecture.md
git commit -m "docs(adr): retire Zustand and name the token under A10

A11 closes the thread A5 opened and A9 narrowed: three sub-projects each found
the state they expected to be global belongs in a component, so the stack
carries no client state library. A12 names the API key token under A10's
clipboard exception rather than leaving it to inference."
```

---

## What SP8 deliberately leaves undone

- **Editing a key's scope, deleting a key, rotating a key.** No endpoint
  exists for any of them. Revoking and reissuing is the supported path.
- **An audit log view.** Rows have been written since SP3 and nothing reads
  them back. Its own sub-project.
- **Telling a key's holder that a bucket delete shrank its scope.** Real gap,
  needs backend work, out of scope here.
- **A timer that flips a badge from Active to Expired while the page sits
  open.** Status is derived at render. A timer whose only job is updating a
  badge is not worth the effect.

## Notes for the executing agent

- `make types` must produce no diff. Nothing under `api/` changes, so a diff
  means something regenerated against a stale schema.
- Run `make lint` and `make test` from the repo root before declaring the plan
  finished, not only `pnpm test` from `web/`.
- **`useBlocker` needs a data router.** It is inert under a plain
  `<MemoryRouter>`. Tests touching the blocker build a `createMemoryRouter`.
  Tests that do not may keep using `MemoryRouter`.
- The backend's key name maximum is at `api/app/models/api_key.py:18`, and the
  reveal and write checks are at `api/app/routers/secrets.py:55`, `:149`,
  `:248` and `:286`. Task 6's capability copy is written from those.
- A secret `DELETE` returns metadata; a **key** `DELETE` returns
  `{ revoked: true }`. They are not the same shape.
- One pre-existing style defect, listed so a reviewer knows it was seen rather
  than missed: `web/src/features/secrets/useSecrets.ts:77` ends with an em
  dash, which CLAUDE.md forbids. It arrived in SP7's final review fix wave and
  nothing in SP8 touches that line. Leave it. Fixing unrelated files is what
  the smallest-change rule exists to prevent, and it is recorded here so the
  next person to open that file knows it is known.
