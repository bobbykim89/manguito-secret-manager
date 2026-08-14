# Buckets Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the buckets list onto a card grid, move creation and deletion into `Modal`, fire the first real toasts, and relocate the light mode pin out of the shell.

**Architecture:** Seven tasks. Test infrastructure first, because `Modal` and the toast system both need providers the shared test helper does not yet supply. Then the shell and the outside-the-shell readability fix, which are independent of the buckets work. Then the three buckets files in dependency order. Then a browser pass, which is scoped work here rather than a closing formality.

**Tech Stack:** React 19, React Router 7, Tailwind 4, TanStack Query 5, React Hook Form + Zod, Vitest + React Testing Library + MSW, Playwright (scratchpad only, never a repo dependency).

**Spec:** `docs/superpowers/specs/2026-08-14-ui-buckets-design.md`

## Global Constraints

- Branch `feat/ui-buckets` already carries the spec commit. Work happens on this branch.
- No new npm dependency in the repo. Playwright is installed into the scratchpad with `npm install playwright --no-save` and never appears in `web/package.json` or the lockfile.
- Tailwind only, no CSS modules, no styled-components. No component takes a `className` prop.
- Doc comments explain why, not what. No em dashes anywhere: code, comments, commit messages, docs.
- Tests: Vitest + React Testing Library, MSW at the fetch boundary. `describe`/`it`, `userEvent` for interactions, queries by role or text, never `data-testid`.
- Commit messages: conventional commits, imperative mood, scoped (`feat(web): ...`, `fix(web): ...`).
- **The mockup at `/tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/mockup/` is read-only reference.** Nothing from it is committed.
- **Existing tests are the safety net, with exactly four sanctioned exceptions**, all in `BucketsPage.test.tsx` and all named in Task 6. Any other test failure is a real finding: report it, do not edit the test to make it pass.
- Secrets and API keys pages are NOT reskinned. They must render exactly as they do today, on their own light pins.
- After every task that changes `.ts`/`.tsx`: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`.
- Before reporting any task done: `git add -A`, `git status`, commit, then `git diff --stat <task BASE> HEAD` and confirm the output is non-empty. This project has had three commits that silently contained none of their intended changes because an amend ran before staging.

---

### Task 1: Test infrastructure for Modal and toasts

**Files:**
- Modify: `web/src/test/setup.ts`
- Modify: `web/src/test/render.tsx`

**Interfaces:**
- Consumes: the already-shipped `ToastProvider` and `ToastViewport` from `web/src/components/`.
- Produces: a `#modal-root` element present in every test's DOM, and a `renderWithProviders` that supplies `ToastProvider` and renders `ToastViewport`, so any component calling `useToast()` or rendering a `Modal` works under test.

`Modal` throws `"#modal-root was not found. Add it to index.html."` when the element is missing, and `useToast()` throws `"useToast must be used within a ToastProvider"`. Both are needed from Task 5 onward. This is the same shape as the previous piece, where `AppShell` calling `useTheme()` broke every test that rendered it without a provider.

- [ ] **Step 1: Add the portal root to the shared setup**

In `web/src/test/setup.ts`, add this `beforeEach` immediately after the existing `beforeAll`. Add `beforeEach` to the existing `vitest` import.

```ts
/**
 * Modal portals into #modal-root and throws without it. Created here rather
 * than per file because every piece that opens a dialog would otherwise
 * repeat it. Guarded so a test file that clears document.body can recreate
 * it by rendering again.
 */
beforeEach(() => {
  if (!document.getElementById("modal-root")) {
    const portalRoot = document.createElement("div");
    portalRoot.id = "modal-root";
    document.body.appendChild(portalRoot);
  }
});
```

- [ ] **Step 2: Add the toast provider to the shared render helper**

Replace `web/src/test/render.tsx` with:

```tsx
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { createQueryClient } from "../api/queryClient";
import { ThemeProvider } from "../components/ThemeProvider";
import { ToastProvider } from "../components/ToastProvider";
import { ToastViewport } from "../components/ToastViewport";

/**
 * A fresh client per test, built by the same factory the application uses, so
 * tests exercise the real global 401 handler rather than a stand-in.
 *
 * ToastViewport is rendered alongside the tree, not just the provider, so a
 * test can assert on a toast the way a user would see it.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { queryClient?: QueryClient } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createQueryClient();

  return {
    ...render(
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
          <ToastViewport />
        </ToastProvider>
      </ThemeProvider>,
    ),
    queryClient,
  };
}
```

- [ ] **Step 3: Run the whole suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 271 tests, 33 files, unchanged.

This task adds no tests. It changes shared infrastructure used by roughly twenty files, so an unchanged green suite is exactly the result that proves it safe. If any test fails, that is a real finding: report it rather than adjusting the failing test.

- [ ] **Step 4: Commit**

```bash
git add web/src/test/setup.ts web/src/test/render.tsx
git commit -m "test(web): provide modal root and toast provider to all tests"
```

---

### Task 2: Move width and the light pin out of the shell

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/secrets/SecretsPage.tsx`
- Modify: `web/src/features/api-keys/KeysPage.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `<main>` that constrains neither width nor colour, so Task 5's buckets page can be 960px wide and fully themed.

- [ ] **Step 1: Strip `<main>` in `web/src/features/shell/AppShell.tsx`**

Find this element:

```tsx
      <main className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">
        <Outlet />
      </main>
```

Replace it, comment included, with:

```tsx
      {/*
        No width and no colour: each page sets its own. Secrets and API keys
        still use hardcoded light mode classes and carry their own light pin
        until their own piece reskins them.
      */}
      <main className="w-full flex-1 px-6 py-8">
        <Outlet />
      </main>
```

- [ ] **Step 2: Give `SecretsPage` its own pin**

In `web/src/features/secrets/SecretsPage.tsx`, wrap the component's entire returned JSX in this container. Whatever element it currently returns becomes the child of this new `div`.

```tsx
    <div className="mx-auto w-full max-w-2xl bg-white text-slate-900">
      {/* This page is not reskinned yet, so it pins itself to light mode.
          Delete this wrapper when the secrets piece reskins it. */}
      {/* ...existing returned JSX unchanged... */}
    </div>
```

- [ ] **Step 3: Give `KeysPage` its own pin**

In `web/src/features/api-keys/KeysPage.tsx`, wrap the component's entire returned JSX the same way:

```tsx
    <div className="mx-auto w-full max-w-2xl bg-white text-slate-900">
      {/* This page is not reskinned yet, so it pins itself to light mode.
          Delete this wrapper when the API keys piece reskins it. */}
      {/* ...existing returned JSX unchanged... */}
    </div>
```

- [ ] **Step 4: Run the whole suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 271 tests. These are wrapper elements only; no role, text, or behaviour changes, so nothing should break. A failure here is a real finding.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/shell/AppShell.tsx web/src/features/secrets/SecretsPage.tsx web/src/features/api-keys/KeysPage.tsx
git commit -m "refactor(web): move width and the light pin from the shell to the pages"
```

---

### Task 3: Make the routes outside the shell readable in dark mode

**Files:**
- Modify: `web/src/features/health/HealthPage.tsx`
- Modify: `web/src/features/auth/RequireSession.tsx`

**Interfaces:**
- Consumes: the `text-text-muted` utility, which `web/src/index.css` already defines.
- Produces: nothing later tasks use.

`/health` and `*` are top level routes, siblings of `AppShell` rather than children, so they render directly on the themed `body` and were never behind the light pin. `RequireSession`'s pending and error states render outside it too.

`HealthPage`'s error box is `bg-red-50` with no text colour, so its contents inherit `--color-text`, which is `#f1eee6` in dark mode: near white text on a light red panel. This has been broken since the previous piece restored the `body` rule. It is the same defect class as the invisible API key token, in a place the pin could never reach.

This is its own commit so review can tell it apart from the buckets reskin.

- [ ] **Step 1: Fix `web/src/features/health/HealthPage.tsx`**

Replace the whole file:

```tsx
import { useHealth } from "./useHealth";

export function HealthPage() {
  const { data, error, isPending } = useHealth();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Manguito Secret Manager</h1>

      {isPending && <p className="mt-4 text-text-muted">Checking API…</p>}

      {data && <p className="mt-4">Database: {data.db}</p>}

      {error && (
        // text-red-900 for the same reason Alert's banners carry one: this
        // panel sets its own light background and renders outside the shell,
        // so inheriting the theme's text colour makes it invisible in dark
        // mode.
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          <p className="font-mono text-sm">{error.code}</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Fix the two bare states in `web/src/features/auth/RequireSession.tsx`**

Change only these two class strings, leaving all logic untouched.

Find `<p className="p-8 text-slate-500">Loading</p>` and replace with:

```tsx
    return <p className="p-8 text-text-muted">Loading</p>;
```

Find `<p className="mt-2 text-slate-600">{session.message}</p>` and replace with:

```tsx
        <p className="mt-2 text-text-muted">{session.message}</p>
```

- [ ] **Step 3: Run the whole suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 271 tests. `HealthPage.test.tsx` and `RequireSession.test.tsx` assert on text and roles, not classes, so both should be unaffected.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/health/HealthPage.tsx web/src/features/auth/RequireSession.tsx
git commit -m "fix(web): make the routes outside the shell readable in dark mode"
```

---

### Task 4: CreateBucketForm becomes a dialog body

**Files:**
- Modify: `web/src/features/buckets/CreateBucketForm.tsx`
- Test: `web/src/features/buckets/CreateBucketForm.test.tsx` (must pass unmodified)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CreateBucketForm` accepting `{ onCreated?: (name: string) => void; onCancel?: () => void }`. Both optional. Task 5 passes both. When `onCancel` is absent the Cancel button is not rendered, which is what keeps the six existing tests passing while they still render the form standalone.

- [ ] **Step 1: Read the existing tests first**

Run: `cd web && pnpm test -- CreateBucketForm`
Expected: 6 passing.

Read `web/src/features/buckets/CreateBucketForm.test.tsx` in full before writing code. All six must still pass with zero edits. Three properties they depend on, which the rewrite must preserve: the input's accessible name still matches `/bucket name/i`, exactly one button matches `/create/i`, and `reset()` still runs on success so the field clears.

- [ ] **Step 2: Replace `web/src/features/buckets/CreateBucketForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";

import { bucketNameSchema, type BucketNameValues } from "./bucketName";
import { useCreateBucket } from "./useBuckets";

/**
 * The create form, rendered as a dialog body by BucketsPage.
 *
 * Both callbacks are optional so the form stays renderable on its own, which
 * is how its tests exercise validation without a dialog around it. Cancel is
 * only drawn when there is something to cancel back to.
 */
export function CreateBucketForm({
  onCreated,
  onCancel,
}: {
  onCreated?: (name: string) => void;
  onCancel?: () => void;
}) {
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
      onSuccess: () => {
        reset();
        onCreated?.(values.name);
      },
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
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="bucket-name" className="text-xs">
          Bucket name
        </label>
        <input
          id="bucket-name"
          {...register("name")}
          placeholder="my_project"
          disabled={create.isPending}
          aria-invalid={errors.name ? true : undefined}
          className="rounded-sm border border-border bg-bg px-3 py-2"
        />
      </div>

      {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}
      {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 font-sans text-sm"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          Create bucket
        </button>
      </div>
    </form>
  );
}
```

The label is now visible rather than `sr-only`, matching the mockup's dialog field. Its accessible name is still "Bucket name", so the existing queries are unaffected.

- [ ] **Step 3: Run the form tests**

Run: `cd web && pnpm test -- CreateBucketForm`
Expected: 6 passing, unmodified.

If any fail, do not edit the test. The likely cause is one of the three properties named in Step 1. Fix the component.

- [ ] **Step 4: Run the whole suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 271 tests. `BucketsPage.test.tsx` still renders this form inline and asserts nothing about it, so it is unaffected.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/buckets/CreateBucketForm.tsx
git commit -m "feat(web): make CreateBucketForm usable as a dialog body"
```

---

### Task 5: BucketsPage becomes a card grid with a create dialog

**Files:**
- Modify: `web/src/features/buckets/BucketsPage.tsx`
- Test: `web/src/features/buckets/BucketsPage.test.tsx` (add tests; existing ones must pass unmodified in this task)

**Interfaces:**
- Consumes: Task 1's test providers, Task 2's unconstrained `<main>`, Task 4's `CreateBucketForm({ onCreated, onCancel })`, and the shipped `Modal({ open, onClose, title, children })` and `useToast()`.
- Produces: a `<ul role="list">` grid whose children are `BucketRow` `<li>` elements, which Task 6 rebuilds.

- [ ] **Step 1: Replace `web/src/features/buckets/BucketsPage.tsx`**

```tsx
import { useState } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { BucketRow } from "./BucketRow";
import { CreateBucketForm } from "./CreateBucketForm";
import { useBuckets } from "./useBuckets";

export function BucketsPage() {
  const buckets = useBuckets();
  const notify = useToast();
  const [creating, setCreating] = useState(false);

  function onCreated(name: string) {
    setCreating(false);
    notify(`Bucket ${name} created`);
  }

  return (
    <section className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Buckets</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          + New bucket
        </button>
      </div>

      {buckets.isPending && (
        <p role="status" className="text-sm text-text-muted">
          Loading buckets
        </p>
      )}

      {buckets.isError && (
        <Alert>
          {/* A cached list survives a transient failure the same way useSession's
              cached user does: refetchOnWindowFocus makes a dropped request
              routine, and replacing a working list with an error over one
              flaky refetch would be a worse experience than showing both. */}
          Could not refresh your buckets. {buckets.error.message}
        </Alert>
      )}

      {buckets.data &&
        (buckets.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-text-muted">No buckets yet.</p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
            >
              Create your first bucket
            </button>
          </div>
        ) : (
          // role="list" explicitly: Tailwind's preflight sets list-style:none,
          // which makes some browsers drop list semantics entirely.
          <ul
            role="list"
            className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4"
          >
            {buckets.data.map((bucket) => (
              <BucketRow key={bucket.id} bucket={bucket} />
            ))}
          </ul>
        ))}

      <Modal open={creating} onClose={() => setCreating(false)} title="New bucket">
        <CreateBucketForm onCreated={onCreated} onCancel={() => setCreating(false)} />
      </Modal>
    </section>
  );
}
```

- [ ] **Step 2: Run the buckets page tests**

Run: `cd web && pnpm test -- BucketsPage`
Expected: 9 passing, unmodified. No existing test in this file touches creation, so moving the form into a dialog breaks none of them.

If any fail, that is a real finding at this point in the plan. Report it rather than editing the test.

- [ ] **Step 3: Add the create dialog tests**

Append to `web/src/features/buckets/BucketsPage.test.tsx`, inside the existing `describe("BucketsPage", ...)` block:

```tsx
  it("opens the create dialog from the header button", async () => {
    listReturns(aBucket("alpha"));
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("listitem", { name: /alpha/i });

    await userEvent.click(screen.getByRole("button", { name: /new bucket/i }));

    expect(await screen.findByRole("dialog", { name: /new bucket/i })).toBeInTheDocument();
  });

  it("opens the same dialog from the empty state", async () => {
    listReturns();
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/no buckets yet/i);

    await userEvent.click(screen.getByRole("button", { name: /create your first bucket/i }));

    expect(await screen.findByRole("dialog", { name: /new bucket/i })).toBeInTheDocument();
  });

  it("closes the dialog and announces success after a create", async () => {
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: listCalls > 1 ? [aBucket("prod")] : [] });
      }),
      http.post(LIST, () =>
        HttpResponse.json({ ok: true, data: aBucket("prod") }, { status: 201 }),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/no buckets yet/i);
    await userEvent.click(screen.getByRole("button", { name: /create your first bucket/i }));

    await userEvent.type(await screen.findByRole("textbox", { name: /bucket name/i }), "prod");
    await userEvent.click(screen.getByRole("button", { name: /create bucket/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /new bucket/i })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/bucket prod created/i)).toBeInTheDocument();
  });

  it("keeps the dialog open and puts a rejected name on the field", async () => {
    listReturns();
    server.use(
      http.post(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_EXISTS", message: "A bucket named 'prod' already exists." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/no buckets yet/i);
    await userEvent.click(screen.getByRole("button", { name: /create your first bucket/i }));

    await userEvent.type(await screen.findByRole("textbox", { name: /bucket name/i }), "prod");
    await userEvent.click(screen.getByRole("button", { name: /create bucket/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
    expect(screen.getByRole("dialog", { name: /new bucket/i })).toBeInTheDocument();
  });

  it("cancels the create dialog without creating anything", async () => {
    let posts = 0;
    listReturns();
    server.use(
      http.post(LIST, () => {
        posts += 1;
        return HttpResponse.json({ ok: true, data: aBucket("prod") }, { status: 201 });
      }),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/no buckets yet/i);
    await userEvent.click(screen.getByRole("button", { name: /create your first bucket/i }));
    await screen.findByRole("dialog", { name: /new bucket/i });

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /new bucket/i })).not.toBeInTheDocument(),
    );
    expect(posts).toBe(0);
  });
```

- [ ] **Step 4: Run the buckets page tests**

Run: `cd web && pnpm test -- BucketsPage`
Expected: 14 passing (9 existing, 5 new).

- [ ] **Step 5: Run the whole suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 276 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/buckets/BucketsPage.tsx web/src/features/buckets/BucketsPage.test.tsx
git commit -m "feat(web): rebuild the buckets page as a card grid with a create dialog"
```

---

### Task 6: BucketRow becomes a card with a delete dialog

**Files:**
- Modify: `web/src/features/buckets/BucketRow.tsx`
- Test: `web/src/features/buckets/BucketsPage.test.tsx` (four sanctioned changes, enumerated below)

**Interfaces:**
- Consumes: Task 1's test providers, the shipped `Modal` and `useToast()`.
- Produces: nothing later tasks import. This is the last code task.

- [ ] **Step 1: Replace `web/src/features/buckets/BucketRow.tsx`**

```tsx
import { useState } from "react";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { useDeleteBucket, type Bucket } from "./useBuckets";

/**
 * One bucket, owning its own dialog flag and its own delete mutation.
 *
 * A page level "which row is confirming" would need this component to receive
 * the flag plus start, cancel, confirm, pending and error as props, which is
 * seven arguments to say one thing. Owning them takes one prop and gets per
 * row pending and error states for free.
 *
 * The whole card is clickable through a stretched pseudo element on the name's
 * Link, rather than an onClick on the card itself. That keeps exactly one link
 * in the accessibility tree, keeps it keyboard reachable, and avoids nesting
 * the Delete button inside a clickable region.
 */
export function BucketRow({ bucket }: { bucket: Bucket }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteBucket();
  const notify = useToast();
  const holdsSecrets = bucket.secret_count > 0;

  function onConfirmed() {
    remove.mutate(bucket.name, {
      onSuccess: () => {
        setConfirming(false);
        notify(`Bucket ${bucket.name} deleted`);
      },
    });
  }

  return (
    <li
      aria-label={bucket.name}
      className="relative flex flex-col gap-2 rounded-sm bg-surface p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <span className="text-[10px] uppercase tracking-[0.1em] text-accent">Bucket</span>

      <h3 className="font-sans text-[17px] leading-tight">
        {/* The stretched pseudo element is what makes the whole card
            clickable. The card is relative, so it covers exactly this card. */}
        <Link
          to={`/buckets/${encodeURIComponent(bucket.name)}`}
          className="after:absolute after:inset-0 after:content-['']"
        >
          {bucket.name}
        </Link>
      </h3>

      <p className="flex-1 text-[13px] opacity-80">
        {bucket.secret_count} {bucket.secret_count === 1 ? "secret" : "secrets"}
        {" · "}
        <time dateTime={bucket.created_at}>
          {new Date(bucket.created_at).toLocaleDateString()}
        </time>
      </p>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span aria-hidden="true" className="text-accent">
          View →
        </span>
        <div className="flex items-center gap-2">
          {holdsSecrets && <span>Still holds secrets</span>}
          {/* relative so it paints above the Link's stretched pseudo element
              and stays independently clickable. */}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={holdsSecrets}
            className="relative rounded-md px-2 py-1 text-accent disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete bucket?"
      >
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            {bucket.name} will be deleted. This cannot be undone.
          </p>

          {/* The dialog stays open on failure, so the error belongs here
              rather than behind it on the card. */}
          {remove.isError && <Alert variant="inline">{remove.error.message}</Alert>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmed}
              disabled={remove.isPending || holdsSecrets}
              className="rounded-md bg-danger px-4 py-2 font-sans text-sm font-semibold text-bg disabled:opacity-50"
            >
              Delete bucket
            </button>
          </div>
        </div>
      </Modal>
    </li>
  );
}
```

- [ ] **Step 2: Run the buckets page tests and confirm exactly four fail**

Run: `cd web && pnpm test -- BucketsPage`
Expected: 10 passing, 4 failing.

The four failures must be exactly these, and no others:

| Test | Why it fails |
|---|---|
| `confirms before deleting and can be cancelled` | Looks for "delete this bucket" via `within(row)`. The confirm is now a portalled dialog outside the row, and its copy is "Delete bucket?" |
| `deletes when confirmed` | Clicks a button named "Yes" via `within(row)`. `ConfirmPrompt` is gone; the dialog's button is "Delete bucket" and lives in the portal |
| `shows a stale count's rejection on the row it belongs to` | Expects the error via `within(row)`. The spec deliberately moved it inside the still open dialog |
| `disables a confirmed delete once the corrected count shows it is not empty` | Same `within(row)` and "Yes" button reasons |

**If any other test fails, stop and report it.** All four of these fail because of a deliberate design change, not a regression. Every other test in the file was written against behaviour this task does not change.

- [ ] **Step 3: Update those four tests, and only those four**

Replace the four tests with these. Assertions about what the app does are preserved; only the queries move from `within(row)` to the dialog, and the button names change to match the new copy.

```tsx
  it("confirms before deleting and can be cancelled", async () => {
    let deletes = 0;
    listReturns(aBucket("spare"));
    server.use(
      http.delete(`${LIST}/:name`, () => {
        deletes += 1;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /spare/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete bucket/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /delete bucket/i })).not.toBeInTheDocument(),
    );
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
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /spare/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete bucket/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete bucket/i }));

    await waitFor(() => expect(deleted).toBe("spare"));
    expect(await screen.findByText(/no buckets yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/bucket spare deleted/i)).toBeInTheDocument();
  });

  it("shows a stale count's rejection in the dialog it was confirmed from", async () => {
    // secret_count came from the last fetch, so something could have written
    // through the API since. The dialog stays open so the explanation lands
    // where the action was taken.
    listReturns(aBucket("racy", 0));
    server.use(
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /racy/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete bucket/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete bucket/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/still holds secrets/i);
    expect(screen.getByRole("dialog", { name: /delete bucket/i })).toBeInTheDocument();
  });

  it("disables a confirmed delete once the corrected count shows it is not empty", async () => {
    let calls = 0;
    server.use(
      http.get(LIST, () => {
        calls += 1;
        return HttpResponse.json({
          ok: true,
          data: [aBucket("racy2", calls === 1 ? 0 : 3)],
        });
      }),
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /racy2/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete bucket/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete bucket/i }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /delete bucket/i })).toBeDisabled(),
    );
  });
```

- [ ] **Step 4: Run the buckets page tests**

Run: `cd web && pnpm test -- BucketsPage`
Expected: 14 passing.

- [ ] **Step 5: Run the whole suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 276 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/buckets/BucketRow.tsx web/src/features/buckets/BucketsPage.test.tsx
git commit -m "feat(web): rebuild BucketRow as a card with a delete dialog"
```

---

### Task 7: Browser verification

**Files:**
- Possibly modify: `web/src/components/Modal.tsx` (only if check 1 fails, which is expected)
- Creates nothing in the repository. All tooling lives in the scratchpad.

**Interfaces:**
- Consumes: everything Tasks 1 through 6 built.
- Produces: screenshots for the pull request, and a `z-index` fix if check 1 fails.

`Modal` and the toast system have never rendered in a browser. `ToggleSwitch` shipped two pieces ago in that same state and was visually broken the whole time, through two merged pull requests, while every test passed. jsdom performs no layout, so none of the checks below have any test equivalent.

- [ ] **Step 1: Install Playwright into the scratchpad**

```bash
cd /tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad
npm install playwright --no-save --silent
ls node_modules/playwright/package.json
```

Expected: the path prints. **This must never be run inside `web/`.** Confirm with `git -C /mnt/projects/manguito-secret-manager status` that `web/package.json` and `web/pnpm-lock.yaml` are untouched.

- [ ] **Step 2: Start the dev server**

```bash
cd /mnt/projects/manguito-secret-manager/web
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
nohup pnpm run dev > /tmp/vite-buckets.log 2>&1 &
disown
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done' && echo "UP"
```

Expected: `UP`.

- [ ] **Step 3: Write the verification script**

Write to `/tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/verify-buckets.js`:

```js
const { chromium } = require("playwright");
const DIR = "/tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad";

const BUCKETS = [
  { id: "1", name: "pollito_project", created_at: "2026-08-11T00:00:00Z", secret_count: 2 },
  { id: "2", name: "ci_pipeline", created_at: "2026-08-09T00:00:00Z", secret_count: 3 },
  { id: "3", name: "billing_service", created_at: "2026-07-22T00:00:00Z", secret_count: 0 },
];

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.route("**/v1/auth/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { id: "1", email: "bobby.sihun.kim@gmail.com", name: "Bobby" } }) }));
  await page.route("**/v1/buckets", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: BUCKETS }) }));

  await page.goto("http://localhost:5173/buckets", { waitUntil: "networkidle" });
  await page.waitForSelector('button:has-text("+ New bucket")');
  await page.screenshot({ path: `${DIR}/buckets-light.png`, fullPage: true });

  // Check 4: the grid
  const cols = await page.evaluate(() => {
    const ul = document.querySelector('ul[role="list"]');
    return { template: getComputedStyle(ul).gridTemplateColumns, count: getComputedStyle(ul).gridTemplateColumns.split(" ").length };
  });

  // Check 3: the stretched link covers the card, Delete still on top
  const overlay = await page.evaluate(() => {
    const li = document.querySelector('ul[role="list"] li');
    const link = li.querySelector("a");
    const del = li.querySelector("button");
    const lr = li.getBoundingClientRect(), dr = del.getBoundingClientRect();
    const mid = document.elementFromPoint(lr.x + lr.width / 2, lr.y + 20);
    const onDelete = document.elementFromPoint(dr.x + dr.width / 2, dr.y + dr.height / 2);
    return {
      cardCentreHitsLink: mid === link || link.contains(mid) || mid?.tagName === "A",
      deleteHitsDelete: onDelete === del || del.contains(onDelete),
      linkCount: li.querySelectorAll("a").length,
    };
  });

  // Check 1: modal above the sticky header
  await page.click('button:has-text("+ New bucket")');
  await page.waitForSelector('[role="dialog"]');
  await page.screenshot({ path: `${DIR}/buckets-create-dialog.png` });
  const stacking = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const backdrop = dialog.parentElement;
    const header = document.querySelector("header");
    const hr = header.getBoundingClientRect();
    const overHeader = document.elementFromPoint(hr.x + hr.width / 2, hr.y + hr.height / 2);
    return {
      backdropZ: getComputedStyle(backdrop).zIndex,
      headerZ: getComputedStyle(header).zIndex,
      headerAreaHitsBackdropOrDialog: backdrop.contains(overHeader) || overHeader === backdrop,
      whatIsOnTopOfHeader: overHeader?.tagName + "." + (overHeader?.className || "").slice(0, 40),
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Check 5: focus after a successful delete
  await page.route("**/v1/buckets/billing_service", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { deleted: true } }) }));
  const emptyish = BUCKETS.filter((b) => b.name !== "billing_service");
  let listHits = 0;
  await page.route("**/v1/buckets", (r) => {
    listHits += 1;
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: listHits > 1 ? emptyish : BUCKETS }) });
  });
  const card = page.locator('li[aria-label="billing_service"]');
  await card.getByRole("button", { name: /^delete$/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /delete bucket/i }).click();
  await page.waitForTimeout(600);
  // Check 2: the toast, and where focus went
  await page.screenshot({ path: `${DIR}/buckets-after-delete.png` });
  const afterDelete = await page.evaluate(() => ({
    activeElement: document.activeElement?.tagName + "." + (document.activeElement?.className || "").slice(0, 40),
    toastVisible: !!document.querySelector('[role="status"]'),
    toastText: document.querySelector('[role="status"]')?.textContent,
  }));

  // Dark mode, every screen
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/buckets-dark.png`, fullPage: true });
  await page.click('button:has-text("+ New bucket")');
  await page.waitForSelector('[role="dialog"]');
  await page.screenshot({ path: `${DIR}/buckets-create-dialog-dark.png` });
  await page.keyboard.press("Escape");

  for (const path of ["/keys", "/health", "/nope"]) {
    await page.goto(`http://localhost:5173${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/screen-dark${path.replace(/\//g, "-")}.png`, fullPage: true });
  }

  console.log(JSON.stringify({ cols, overlay, stacking, afterDelete, errors }, null, 2));
  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
```

- [ ] **Step 4: Run it and read every number**

```bash
node /tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/verify-buckets.js
```

Interpret against the spec's six checks:

1. **Modal over the header.** `stacking.headerAreaHitsBackdropOrDialog` must be `true`. If it is `false` and `whatIsOnTopOfHeader` names the header, the predicted z-index conflict is real: the header is `z-10` and the backdrop has no `z-index`. Fix it in `web/src/components/Modal.tsx` by adding `z-50` to the backdrop's class list, then re-run this script and confirm the value flips to `true`.
2. **Toast.** `afterDelete.toastVisible` must be `true` and `toastText` must contain "billing_service deleted". Confirm in `buckets-after-delete.png` that it is not hidden behind anything.
3. **Stretched link.** `overlay.cardCentreHitsLink` and `overlay.deleteHitsDelete` must both be `true`, and `overlay.linkCount` must be `1`.
4. **Grid.** `cols.count` must be `3` at 1280px.
5. **Focus after delete.** Record whatever `afterDelete.activeElement` says. `BODY` is the known rough edge from the spec. Report it; do not fix it in this task unless it is worse than that.
6. **Every screen in both themes.** Look at all seven screenshots. Confirm buckets is fully themed in dark mode, that `/keys` still renders light and readable on its pin, and that `/health` and the not found page are readable.

`errors` must be empty.

- [ ] **Step 5: Stop the dev server and clean up**

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
rm -rf /tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/node_modules
git -C /mnt/projects/manguito-secret-manager status
```

Expected: the working tree shows only a `Modal.tsx` change if check 1 required one, and nothing else. Screenshots stay in the scratchpad for the pull request.

- [ ] **Step 6: Commit, only if check 1 required a fix**

```bash
cd /mnt/projects/manguito-secret-manager
git add web/src/components/Modal.tsx
git commit -m "fix(web): raise the modal backdrop above the sticky header"
```

If no fix was needed, there is nothing to commit and that is a valid outcome. Report the numbers either way.

---

## Final verification

```bash
cd /mnt/projects/manguito-secret-manager/web && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build && rm -rf dist
```

Expected: all pass, 276 tests, build exits 0.

`make types` is not run: no Pydantic model changed, so `web/src/api/generated.ts` cannot have drifted.

Report in the final summary: the six browser check results, whether the z-index fix was needed, where focus landed after a delete, and the paths of all seven screenshots.
