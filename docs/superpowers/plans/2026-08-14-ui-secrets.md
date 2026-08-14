# Secrets Pages UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the secrets pages onto the Organic design system, and build the
two requirements ADR 003 states but nobody implemented: auto-mask after a
timeout, and copy-to-clipboard without revealing.

**Architecture:** Three components change in place. `PutSecretForm` gains the
optional callback pair that lets it be a dialog body, matching
`CreateBucketForm`. `SecretRow` becomes a divider-list row, moves its delete
confirmation into a `Modal`, and gains the two new behaviors. `SecretsPage`
supplies its own width and padding, hosts the create dialog, and deletes the
light-mode pin that has protected it since piece 2. `useSecrets.ts` grows one
shared query-options factory so the reveal path and the copy path define the
same request exactly once.

**Tech Stack:** React 19, TypeScript strict, Tailwind 4, TanStack Query 5,
React Hook Form + Zod, Vitest + React Testing Library + MSW, Playwright for
browser checks (scratchpad only, never a repo dependency).

**Spec:** `docs/superpowers/specs/2026-08-14-ui-secrets-design.md`

## Global Constraints

- No em dashes anywhere, in code comments, commit messages, or docs.
- Tailwind only. No CSS modules, no styled-components, no new spacing scale.
- No new npm dependency. Playwright installs to the scratchpad with
  `--no-save`. `git status` must show zero diff on `web/package.json` and
  `web/pnpm-lock.yaml`.
- Secret values never reach `localStorage`, `sessionStorage`, URL state, or
  client-side error reporting. The clipboard is a named exception (ADR 003 A10).
- Tests mock at the fetch boundary with MSW. Test behavior, never Tailwind
  classes or hook internals.
- `web/src/api/generated.ts` is generated. Never hand-edit it.
- Comments explain why, not what.
- **`invariants.test.tsx:103-133` must stay byte-identical.** It compares a 2
  character secret's mask against a 200 character one, and it is the canary for
  the mockup's length-derived mask. A diff touching it means something went
  wrong.
- **The empty-state text stays exactly `No secrets yet.`** Two existing tests
  assert `findByText(/no secrets yet/i)`. Rewording breaks them for no reason.
- **`routes/access.test.tsx` is unaffected by this piece.** Its three secrets
  tests (lines 193-205, 207-214, 216-237) only assert a heading and a pathname;
  none interact with the form or delete. This was checked before task one. Do
  not modify that file. If a task appears to require modifying it, stop and
  report rather than editing it.
- Intermediate commits leave the app functional but visually mixed. Tasks 2
  through 4 theme `SecretRow` while `SecretsPage` still pins itself to light
  mode, so a themed row sits inside a white page until Task 5. This is inherent
  to reskinning a page across several commits and is acceptable as long as lint,
  types and tests stay green at every commit.
- Toast copy includes the key name (`Secret DATABASE_URL added`), refining the
  spec's shorthand ("Secret added") to match piece 3's `Bucket X created`
  pattern. This is deliberate, not drift.
- Keep `max-w-[760px]` in the arbitrary-value form. Some editors suggest
  rewriting it as `max-w-190`. That is an IDE hint, not a lint rule, it depends
  on a 16px root font, and `BucketsPage` already ships `max-w-[960px]`. Leave it
  matching the mockup's stated pixel value and its sibling page.

**Verification after every code task:**

```bash
cd web && pnpm run lint && pnpm run typecheck && pnpm test
```

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `web/src/features/secrets/PutSecretForm.tsx` | The add/replace form, usable standalone or as a dialog body | 1 |
| `web/src/features/secrets/SecretRow.tsx` | One secret: reveal, auto-mask, copy, delete | 2, 3, 4 |
| `web/src/features/secrets/useSecrets.ts` | Query keys, hooks, and the shared value-fetch options | 4 |
| `web/src/features/secrets/SecretsPage.tsx` | Page layout, create dialog, toasts, own width and padding | 5 |
| `docs/adr/0003-frontend-architecture.md` | Amendment A16 recording what this piece decided | 7 |

---

## Task 1: PutSecretForm becomes a dialog body

**Files:**
- Modify: `web/src/features/secrets/PutSecretForm.tsx`
- Test: `web/src/features/secrets/PutSecretForm.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PutSecretForm` accepting
  `onCreated?: (result: { keyName: string; replaced: boolean }) => void` and
  `onCancel?: () => void`. Task 5 passes both. Both stay optional so the form
  remains renderable on its own, which is how its own tests exercise validation
  without a dialog around it.

Existing tests render `<PutSecretForm bucket="alpha" existingKeys={[]} />` with
no callbacks and must keep passing untouched. Adding optional props cannot
break them.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/secrets/PutSecretForm.test.tsx`, inside the
existing `describe("PutSecretForm", ...)`:

```tsx
  it("reports a new key as added", async () => {
    const onCreated = vi.fn();
    server.use(
      http.put(`${SECRETS}/NEW_KEY`, () =>
        HttpResponse.json({ ok: true, data: aSecret("NEW_KEY") }),
      ),
    );
    renderWithProviders(
      <PutSecretForm bucket="alpha" existingKeys={["OTHER"]} onCreated={onCreated} />,
    );

    await userEvent.type(screen.getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ keyName: "NEW_KEY", replaced: false }),
    );
  });

  it("reports an overwritten key as replaced", async () => {
    const onCreated = vi.fn();
    server.use(
      http.put(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") }),
      ),
    );
    renderWithProviders(
      <PutSecretForm
        bucket="alpha"
        existingKeys={["DATABASE_URL"]}
        onCreated={onCreated}
      />,
    );

    await userEvent.type(screen.getByLabelText(/key name/i), "DATABASE_URL");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /replace secret/i }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ keyName: "DATABASE_URL", replaced: true }),
    );
  });

  it("stays put and reports nothing when the write fails", async () => {
    const onCreated = vi.fn();
    server.use(
      http.put(`${SECRETS}/NEW_KEY`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(
      <PutSecretForm bucket="alpha" existingKeys={[]} onCreated={onCreated} />,
    );

    await userEvent.type(screen.getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/i);
    expect(onCreated).not.toHaveBeenCalled();
    // What was typed survives a failure. Retyping a value the server just
    // rejected is pure friction.
    expect(screen.getByLabelText(/key name/i)).toHaveValue("NEW_KEY");
  });

  it("draws no cancel button when there is nothing to cancel back to", () => {
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("cancels through the callback when one is given", async () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <PutSecretForm bucket="alpha" existingKeys={[]} onCancel={onCancel} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
```

Add `vi` to the vitest import at the top of the file:

```tsx
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test PutSecretForm`
Expected: the three callback tests fail because `onCreated` is never called and
`onCancel` is not a prop. `draws no cancel button` passes already (there is no
cancel button yet), which is fine.

- [ ] **Step 3: Rewrite PutSecretForm**

Replace the whole file with:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";
import { secretFormSchema, type SecretFormValues } from "./secretForm";
import { usePutSecret } from "./useSecrets";

/**
 * One form for both writing and replacing, matching the backend's upsert, and
 * rendered as a dialog body by SecretsPage.
 *
 * Both callbacks are optional so the form stays renderable on its own, which
 * is how its tests exercise validation without a dialog around it. Cancel is
 * only drawn when there is something to cancel back to.
 */
export function PutSecretForm({
  bucket,
  existingKeys,
  onCreated,
  onCancel,
}: {
  bucket: string;
  existingKeys: string[];
  onCreated?: (result: { keyName: string; replaced: boolean }) => void;
  onCancel?: () => void;
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
    // Read from the submitted values rather than from `replacing`, so the
    // reported outcome cannot drift from the key that was actually written.
    const replaced = existingKeys.includes(values.keyName);
    put.mutate(
      { keyName: values.keyName, value: values.value },
      {
        // Reset only on success. A failed submit keeps what was typed, because
        // retyping a value the server just rejected is pure friction.
        onSuccess: () => {
          reset({ keyName: "", value: "" });
          onCreated?.({ keyName: values.keyName, replaced });
        },
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      // Named, so a test can scope to it and a screen reader announces what it
      // is. The dialog around it holds similar looking controls.
      aria-label="Add or replace a secret"
      className="mt-4 flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="secret-key-name" className="text-xs">
          Key name
        </label>
        <input
          id="secret-key-name"
          {...register("keyName")}
          placeholder="DATABASE_URL"
          disabled={put.isPending}
          aria-invalid={errors.keyName ? true : undefined}
          className="rounded-sm border border-border bg-bg px-3 py-2"
        />
      </div>
      {errors.keyName && <Alert variant="inline">{errors.keyName.message}</Alert>}

      <div className="flex flex-col gap-1">
        <label htmlFor="secret-value" className="text-xs">
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
          className="rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm"
        />
      </div>
      {errors.value && <Alert variant="inline">{errors.value.message}</Alert>}

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
        {/* The button text is the only silent-clobber guard this flow has: the
            endpoint is an upsert, so there is no "already exists" error to
            catch. It changes at the point of commitment, which is where the
            warning earns its place. */}
        <button
          type="submit"
          disabled={put.isPending}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
        >
          {replacing ? "Replace secret" : "Add secret"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. The six pre-existing `PutSecretForm` tests are untouched
and must still pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/secrets/PutSecretForm.tsx web/src/features/secrets/PutSecretForm.test.tsx
git commit -m "feat(web): make PutSecretForm usable as a dialog body"
```

---

## Task 2: SecretRow becomes a divider row with a delete dialog

**Files:**
- Modify: `web/src/features/secrets/SecretRow.tsx`
- Test: `web/src/features/secrets/SecretRow.test.tsx`
- Test: `web/src/features/secrets/invariants.test.tsx` (two delete call sites only)

**Interfaces:**
- Consumes: `Modal({ open, onClose, title, children })` from
  `../../components/Modal`, which portals into `#modal-root`, traps focus, and
  closes on Escape and backdrop click. `useToast()` from
  `../../components/useToast`, returning `notify(message)`.
- Produces: a `SecretRow` whose delete confirmation is a dialog titled
  `Delete secret?` with a `Delete secret` confirm button. Tasks 3 and 4 add
  behavior to this same file.

**Do not touch** the `MASK` constant, its comment, or the line
`const plaintext = revealed ? value.data?.value : undefined;`. Task 4 adds a
comment above that line; its logic is correct as-is and load-bearing.

`ConfirmPrompt` stays in the codebase. `KeyRow` still uses it, and piece 5 is
where it goes.

- [ ] **Step 1: Rescope the three existing delete tests**

In `web/src/features/secrets/SecretRow.test.tsx`, the delete confirmation moves
from an inline `ConfirmPrompt` into a `Modal`. `Modal` portals into
`#modal-root`, which is outside the `<li>`, so `within(row)` can no longer find
the confirm controls. Replace exactly these three tests and nothing else.

Replace `confirms before deleting and can be cancelled` (currently lines
119-138) with:

```tsx
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
    const dialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deletes).toBe(0);
  });
```

Replace `deletes when confirmed` (currently lines 140-157) with:

```tsx
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
    const dialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete secret/i }));

    await waitFor(() => expect(deleted).toBe(true));
  });
```

Replace `shows a failed delete on the row it belongs to` (currently lines
159-177) with the renamed version. The name changes because the error's
location changed: it now renders inside the dialog, which stays open on
failure, rather than on the row behind it.

```tsx
  it("shows a failed delete in the dialog it was confirmed from", async () => {
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
    const dialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete secret/i }));

    // The dialog stays open so the message is next to the button that failed.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/already gone/i);
    expect(screen.getByRole("dialog", { name: /delete secret/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rescope the two delete call sites in invariants.test.tsx**

Two clicks on `confirm deleting A` must become dialog-scoped. Change only the
click sequences. Leave every comment and every assertion untouched.

In the `ADR 003 A4` test (currently lines 178-179), replace:

```tsx
    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    await userEvent.click(within(row).getByRole("button", { name: /confirm deleting A/i }));
```

with:

```tsx
    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    const deleteDialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: /delete secret/i }));
```

In the `re-enables Delete on a bucket whose last secret was removed` test
(currently lines 302-303), replace:

```tsx
    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    await userEvent.click(within(row).getByRole("button", { name: /confirm deleting A/i }));
```

with:

```tsx
    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    const secretDialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(secretDialog).getByRole("button", { name: /delete secret/i }));
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && pnpm test secrets`
Expected: the five rescoped tests fail because no element with
`role="dialog"` and an accessible name matching `/delete secret/i` exists yet.

- [ ] **Step 4: Rewrite SecretRow**

Replace the whole file with the following. `Modal` and `useToast` are new
imports; `ConfirmPrompt` is no longer imported here.

```tsx
import { useState } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";
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
 * One secret, owning its reveal flag, its dialog flag and its copy notice.
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
  const notify = useToast();

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

  function onConfirmed() {
    remove.mutate(secret.key_name, {
      onSuccess: () => {
        setConfirming(false);
        notify(`Secret ${secret.key_name} deleted`);
      },
    });
  }

  return (
    <li aria-label={secret.key_name} className="flex flex-col gap-2 border-b border-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold">{secret.key_name}</span>
          <time dateTime={secret.updated_at} className="text-xs text-text-muted">
            {new Date(secret.updated_at).toLocaleDateString()}
          </time>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            aria-label={`${revealed ? "Hide" : "Reveal"} ${secret.key_name}`}
            onClick={toggleReveal}
            className="rounded-md border border-border px-3 py-1 text-sm"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
          {plaintext !== undefined && (
            <button
              type="button"
              aria-label={`Copy ${secret.key_name}`}
              onClick={() => void copy(plaintext)}
              className="rounded-md border border-border px-3 py-1 text-sm"
            >
              Copy
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete ${secret.key_name}`}
            onClick={() => {
              // Cleared on open so a previous failure's message does not greet
              // the next attempt.
              remove.reset();
              setConfirming(true);
            }}
            className="rounded-md px-2 py-1 text-sm text-accent"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Styled as an input, following the mockup. The wider tracking applies
          to the mask only: it spaces the dots out without changing how many
          there are. */}
      <code
        className={`break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] ${
          plaintext === undefined ? "tracking-[3px]" : ""
        }`}
      >
        {plaintext ?? MASK}
      </code>

      {revealed && value.isFetching && (
        <p role="status" className="text-sm text-text-muted">
          Revealing
        </p>
      )}

      {/* The server has nothing to say here: SP4 made decrypt failures a 500
          carrying no detail. A fixed sentence keeps the error path from being
          a channel. */}
      {revealed && value.isError && <Alert variant="inline">Could not reveal this secret.</Alert>}

      {copyState === "copied" && (
        <p role="status" className="text-sm text-text-muted">
          Copied
        </p>
      )}
      {copyState === "failed" && <Alert variant="inline">Could not copy to the clipboard.</Alert>}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Delete secret?">
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            {secret.key_name} will be deleted. This cannot be undone.
          </p>

          {/* The dialog stays open on failure, so the error belongs here
              rather than behind it on the row. */}
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
              disabled={remove.isPending}
              className="rounded-md bg-danger px-4 py-2 font-sans text-sm font-semibold text-bg disabled:opacity-50"
            >
              Delete secret
            </button>
          </div>
        </div>
      </Modal>
    </li>
  );
}
```

- [ ] **Step 5: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `invariants.test.tsx:103-133` must be untouched and passing.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/secrets/SecretRow.tsx web/src/features/secrets/SecretRow.test.tsx web/src/features/secrets/invariants.test.tsx
git commit -m "feat(web): rebuild SecretRow as a divider row with a delete dialog"
```

---

## Task 3: Revealed values auto-mask after 30 seconds

**Files:**
- Modify: `web/src/features/secrets/SecretRow.tsx`
- Test: `web/src/features/secrets/SecretRow.test.tsx`

**Interfaces:**
- Consumes: `SecretRow` as Task 2 left it.
- Produces: `AUTO_MASK_MS`, a module-level constant in `SecretRow.tsx`. Nothing
  outside this file consumes it.

ADR 003 line 69 requires this and line 91 lists it as a priority test case.
Neither says how long or what re-masks, so both are decided here: 30 seconds,
and visual only. The cached plaintext is left in place, so a re-reveal serves
the cache and one visit still produces one `secret.read` audit row, matching
what `useSecrets.ts` documents about `staleTime: Infinity`.

**Fake timers, read this before writing the tests.** Use
`vi.useFakeTimers({ shouldAdvanceTime: true })`, not a bare
`vi.useFakeTimers()`. With the bare form the clock never moves on its own, so
MSW's promise-based responses and React Testing Library's `findBy*` polling can
deadlock against each other and the test hangs rather than failing. With
`shouldAdvanceTime` the clock tracks real time, so ordinary awaits resolve,
while `vi.advanceTimersByTime` still jumps forward on demand. Also pass
`advanceTimers` to `userEvent.setup` so its internal delays cooperate.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/secrets/SecretRow.test.tsx`, inside the existing
`describe`:

```tsx
  it("re-masks a revealed value once the window is up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      server.use(
        http.get(`${SECRETS}/DATABASE_URL`, () =>
          HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
        ),
      );
      renderRow();
      const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      expect(within(row).queryByText("postgres://x")).not.toBeInTheDocument();
      expect(within(row).getByText(/•/)).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /reveal DATABASE_URL/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the value cached across an auto-mask, so a re-reveal costs no request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      let fetches = 0;
      server.use(
        http.get(`${SECRETS}/DATABASE_URL`, () => {
          fetches += 1;
          return HttpResponse.json({
            ok: true,
            data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
          });
        }),
      );
      renderRow();
      const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");

      // Auto-mask is a visual affordance, not a cache purge. One visit, one
      // secret.read audit row, however many times the window lapses.
      expect(fetches).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a re-revealed value a full fresh window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      server.use(
        http.get(`${SECRETS}/DATABASE_URL`, () =>
          HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
        ),
      );
      renderRow();
      const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      await user.click(within(row).getByRole("button", { name: /hide DATABASE_URL/i }));
      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");

      // 26 seconds past the first reveal's 30 second deadline. A stale timer
      // from that first reveal would have fired by now; the restarted one has
      // not.
      await act(async () => {
        vi.advanceTimersByTime(26_000);
      });
      expect(within(row).getByText("postgres://x")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      expect(within(row).queryByText("postgres://x")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
```

Update the imports at the top of the file to add `act` and `vi`:

```tsx
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test SecretRow`
Expected: all three fail, because nothing re-masks. Note *how* they fail, since
it is not what you might assume: without auto-mask the row is still revealed
after the clock jumps, so its button still reads `Hide`, and the queries for
`reveal DATABASE_URL` in the first two tests fail to find an element rather
than failing an assertion about the value. The third fails on its final
assertion, with the plaintext still on screen.

- [ ] **Step 3: Add the timer**

Add `useEffect` to the React import in `SecretRow.tsx`:

```tsx
import { useEffect, useState } from "react";
```

Add the constant below `MASK`:

```tsx
/**
 * How long a revealed value stays on screen.
 *
 * Visual only, deliberately. The cached plaintext is left in place, so a
 * re-reveal serves the cache and one visit still produces one secret.read
 * audit row. ADR 003 A9 records why hiding is an affordance rather than a
 * boundary, and the threat this addresses is an unattended screen, which
 * re-masking covers fully. Purging the cache instead would charge a second
 * audit row for what the user experiences as one visit.
 */
const AUTO_MASK_MS = 30_000;
```

Add the effect immediately after the `plaintext` line:

```tsx
  // Armed on the value arriving rather than on the click, so a slow fetch does
  // not eat the reading window. The cleanup runs whenever the value leaves the
  // screen, a manual Hide included, so no stale timer can fire against a later
  // reveal.
  useEffect(() => {
    if (plaintext === undefined) return;
    const timer = setTimeout(() => setRevealed(false), AUTO_MASK_MS);
    return () => clearTimeout(timer);
  }, [plaintext]);
```

- [ ] **Step 4: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, including the pre-existing reveal tests that use real
timers. If any test outside `SecretRow.test.tsx` starts hanging, the cause is
fake timers leaking across tests; confirm every new test restores real timers in
its `finally`.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/secrets/SecretRow.tsx web/src/features/secrets/SecretRow.test.tsx
git commit -m "feat(web): auto-mask a revealed secret after 30 seconds"
```

---

## Task 4: Copy to the clipboard without revealing

**Files:**
- Modify: `web/src/features/secrets/useSecrets.ts`
- Modify: `web/src/features/secrets/SecretRow.tsx`
- Test: `web/src/features/secrets/SecretRow.test.tsx`

**Interfaces:**
- Consumes: `SecretRow` as Task 3 left it.
- Produces: two exports from `useSecrets.ts`:
  `secretValueQueryOptions(bucket: string, keyName: string)` returning
  `{ queryKey, queryFn, staleTime }`, and
  `useFetchSecretValue(bucket: string)` returning
  `(keyName: string) => Promise<SecretValue>`.

ADR 003 line 70 requires copy to work without revealing. It currently does not:
`SecretRow` only renders Copy after a reveal.

**This task inverts an existing assertion, which is intended.**
`SecretRow.test.tsx:112-117`, `offers no copy button while the value is
hidden`, asserts Copy is absent while masked. That assertion encodes the
behavior this task exists to change, so it is replaced by its opposite. This is
the one reversed assertion in the piece. It is not a test bent to accommodate a
regression: the requirement it contradicts predates the test, and the
replacement is strictly stronger, since it also proves the masked row shows no
plaintext.

**The trap in this change.** TanStack Query's `enabled: false` prevents
fetching, not reading. Once the copy path has populated
`["secret-value", bucket, keyName]`, `useSecretValue` returns that cached data
for the same row even though `revealed` is `false`. The line

```tsx
const plaintext = revealed ? value.data?.value : undefined;
```

is what keeps a copy from becoming a reveal. It must not be simplified to
`value.data?.value` on the reasoning that `enabled: false` means there is
nothing to read.

- [ ] **Step 1: Write the failing tests**

In `web/src/features/secrets/SecretRow.test.tsx`, replace the test
`offers no copy button while the value is hidden` (currently lines 112-117)
with:

```tsx
  // Replaces "offers no copy button while the value is hidden". ADR 003 line 70
  // requires copy to be available without revealing, so the old assertion
  // encoded the gap rather than the requirement. This replacement is strictly
  // stronger: it also proves the masked row shows no plaintext.
  it("offers copy while the value is still masked", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    expect(within(row).getByRole("button", { name: /copy DATABASE_URL/i })).toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
  });
```

Then append these five tests inside the same `describe`:

```tsx
  it("copies without revealing: one fetch, nothing on screen", async () => {
    const user = userEvent.setup();
    let fetches = 0;
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () => {
        fetches += 1;
        return HttpResponse.json({
          ok: true,
          data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
        });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("postgres://x"));
    expect(fetches).toBe(1);
    // Asserted against the whole document rather than the row: the value must
    // not be anywhere, including in a portal or a status line.
    expect(screen.queryByText("postgres://x")).not.toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /reveal DATABASE_URL/i })).toBeInTheDocument();
  });

  it("copies an already revealed value from the cache, with no second fetch", async () => {
    const user = userEvent.setup();
    let fetches = 0;
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () => {
        fetches += 1;
        return HttpResponse.json({
          ok: true,
          data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
        });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
    await within(row).findByText("postgres://x");
    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("postgres://x"));
    // One visit, one secret.read audit row. Copying what is already on screen
    // must not charge a second read.
    expect(fetches).toBe(1);
  });

  it("says nothing about why a copy's fetch failed, and stays masked", async () => {
    const user = userEvent.setup();
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

    await user.click(within(row).getByRole("button", { name: /copy BROKEN/i }));

    const alert = await within(row).findByRole("alert");
    expect(alert).toHaveTextContent(/could not reveal this secret/i);
    expect(alert).not.toHaveTextContent(/server detail/i);
    expect(within(row).getByText(/•/)).toBeInTheDocument();
  });

  it("reports a refused clipboard separately from a refused fetch", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });
    // The permission denial a non secure context produces, which is the real
    // way this fails in a browser. Spied after userEvent.setup(), which
    // installs the clipboard stub this replaces. `vi` is already imported in
    // this file from the auto-mask task.
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      /could not copy to the clipboard/i,
    );
  });

  it("refuses a second copy while the first is still in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetches = 0;
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, async () => {
        fetches += 1;
        await gate;
        return HttpResponse.json({
          ok: true,
          data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
        });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    // Disabled rather than merely idempotent: a double click would otherwise
    // charge two secret.read audit rows for one user action.
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: /copy DATABASE_URL/i })).toBeDisabled(),
    );

    release?.();
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("postgres://x"));
    expect(fetches).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test SecretRow`
Expected: `offers copy while the value is still masked` and the five new tests
fail, because no Copy button exists until a reveal.

- [ ] **Step 3: Add the shared query options and the imperative fetch**

In `web/src/features/secrets/useSecrets.ts`, add `useCallback` to the React
imports at the top of the file:

```tsx
import { useCallback } from "react";
```

Replace the existing `useSecretValue` function and its docblock with:

```tsx
/**
 * The single definition of a value fetch, shared by the declarative reveal path
 * and the imperative copy path.
 *
 * staleTime: Infinity lives here so both inherit it. Hiding and re-revealing
 * serves the cache, and so does copying a value that is already revealed, so
 * one visit produces one secret.read audit row however the user reaches the
 * value. Once revealed it is in the tab's memory anyway, so hiding is a visual
 * affordance rather than a security boundary, and counting clicks would make a
 * misclick indistinguishable from a genuine second look at a credential.
 *
 * gcTime is deliberately left at the five minute default: navigating away
 * unmounts the observer and the plaintext leaves memory without anyone writing
 * code to do it.
 */
export const secretValueQueryOptions = (bucket: string, keyName: string) => ({
  queryKey: secretValueQueryKey(bucket, keyName),
  queryFn: () => client.get<SecretValue>(secretPath(bucket, keyName)),
  staleTime: Infinity,
});

/**
 * One secret's plaintext, fetched only once the user asks for it.
 *
 * `enabled` is where invariant 7 lives in code: nothing about rendering the
 * list can cause a value fetch, because only a click flips this flag.
 *
 * It does not, however, stop this hook from returning a cache entry the copy
 * path put there. SecretRow's `revealed` guard is what handles that; see the
 * comment on its `plaintext`.
 */
export function useSecretValue(bucket: string, keyName: string, revealed: boolean) {
  return useQuery<SecretValue, ApiError>({
    ...secretValueQueryOptions(bucket, keyName),
    enabled: revealed,
  });
}

/**
 * Fetches one value imperatively, for the copy path.
 *
 * ADR 003 line 70 requires copy to work without revealing, which the
 * declarative hook above cannot express: its `enabled` flag is the reveal.
 * This returns the plaintext to its caller and puts it nowhere else, so the
 * caller can hand it to the clipboard without any state that would render it.
 *
 * Serves the cache when there is one, so copying an already revealed value
 * costs no second audit row.
 */
export function useFetchSecretValue(bucket: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (keyName: string) => queryClient.fetchQuery(secretValueQueryOptions(bucket, keyName)),
    [bucket, queryClient],
  );
}
```

- [ ] **Step 4: Rewire SecretRow's copy path**

In `web/src/features/secrets/SecretRow.tsx`:

Widen the import from `./useSecrets`:

```tsx
import {
  useDeleteSecret,
  useFetchSecretValue,
  useSecretValue,
  type Secret,
} from "./useSecrets";
```

Widen the copy state and add the fetcher:

```tsx
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "clipboard-failed" | "fetch-failed"
  >("idle");
```

```tsx
  const fetchValue = useFetchSecretValue(bucket);
```

Add the guard comment above the existing `plaintext` line, leaving the line
itself exactly as it is:

```tsx
  // The `revealed` guard is what keeps the copy path from becoming a reveal.
  // TanStack Query's enabled: false stops useSecretValue from fetching, not
  // from reading a cache entry the copy path populated, so dropping this guard
  // would put a value on screen that the user only asked to copy.
  const plaintext = revealed ? value.data?.value : undefined;
```

Replace the `copy` function with:

```tsx
  async function copy() {
    setCopyState("copying");
    let text: string;
    try {
      // A local, never state. On this path the plaintext reaches the clipboard
      // and nothing else: no DOM node, no toast, no error message.
      text = (await fetchValue(secret.key_name)).value;
    } catch {
      // Same fixed sentence as a failed reveal, for the same reason: SP4 made
      // decrypt failures carry no detail, so differentiating here would turn
      // the error path into a channel.
      setCopyState("fetch-failed");
      return;
    }
    try {
      // Awaited in a try/catch: writeText rejects on a denied permission or a
      // non secure context, and an unhandled rejection is an stderr line.
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("clipboard-failed");
    }
  }
```

Replace the conditional Copy button with an unconditional one:

```tsx
          <button
            type="button"
            aria-label={`Copy ${secret.key_name}`}
            onClick={() => void copy()}
            disabled={copyState === "copying"}
            className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            Copy
          </button>
```

Replace the two copy-state lines with all four states:

```tsx
      {copyState === "copying" && (
        <p role="status" className="text-sm text-text-muted">
          Copying
        </p>
      )}
      {copyState === "copied" && (
        <p role="status" className="text-sm text-text-muted">
          Copied
        </p>
      )}
      {copyState === "fetch-failed" && (
        <Alert variant="inline">Could not reveal this secret.</Alert>
      )}
      {copyState === "clipboard-failed" && (
        <Alert variant="inline">Could not copy to the clipboard.</Alert>
      )}
```

- [ ] **Step 5: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `invariants.test.tsx` must be green with no edits in this
task, including its `fetches once on reveal` count assertions.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/secrets/useSecrets.ts web/src/features/secrets/SecretRow.tsx web/src/features/secrets/SecretRow.test.tsx
git commit -m "feat(web): copy a secret to the clipboard without revealing it"
```

---

## Task 5: SecretsPage reskin, create dialog, and the pin comes off

**Files:**
- Modify: `web/src/features/secrets/SecretsPage.tsx`
- Test: `web/src/features/secrets/SecretsPage.test.tsx`
- Test: `web/src/features/secrets/invariants.test.tsx` (two form call sites only)

**Interfaces:**
- Consumes: `PutSecretForm`'s `onCreated({ keyName, replaced })` and `onCancel`
  from Task 1. `SecretRow` from Tasks 2 through 4. `Modal` and `useToast`.
- Produces: the finished page. Nothing later consumes it except the browser
  checks.

This task deletes the light-mode pin, the wrapper
`<div className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">`.
It lands in the same commit as the reskin that makes deleting it correct, so a
revert takes both.

`px-6 py-8` on the section is load-bearing. Since piece 3, `<main>` is a pure
passthrough with no padding, so a page that omits its own spacing renders flush
against the viewport edge. Piece 3's final review caught exactly that.

`KeysPage` keeps its own pin. It is not touched here.

- [ ] **Step 1: Adapt the two form call sites in invariants.test.tsx**

Both type into the form, which now lives behind the `+ Add secret` dialog. Add
the dialog-opening click and scope the typing to the dialog. Change nothing
else, and leave every comment and assertion as it is.

In the `ADR 003 A4` test (currently lines 175-177), replace:

```tsx
    await userEvent.type(screen.getByLabelText(/key name/i), "B");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
```

with:

```tsx
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
    const addDialog = await screen.findByRole("dialog", { name: /add secret/i });
    await userEvent.type(within(addDialog).getByLabelText(/key name/i), "B");
    await userEvent.type(within(addDialog).getByLabelText(/value/i), "v");
    await userEvent.click(within(addDialog).getByRole("button", { name: /add secret/i }));
```

In the byte-limit test (currently lines 242-247), replace:

```tsx
    await userEvent.type(screen.getByLabelText(/key name/i), "BIG");
    // 30,000 characters, 90,000 bytes. Typing that through userEvent is far
    // too slow, so the value is set the way a paste would set it.
    await userEvent.click(screen.getByLabelText(/value/i));
    await userEvent.paste("中".repeat(30_000));
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
```

with:

```tsx
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
    const bigDialog = await screen.findByRole("dialog", { name: /add secret/i });
    await userEvent.type(within(bigDialog).getByLabelText(/key name/i), "BIG");
    // 30,000 characters, 90,000 bytes. Typing that through userEvent is far
    // too slow, so the value is set the way a paste would set it.
    await userEvent.click(within(bigDialog).getByLabelText(/value/i));
    await userEvent.paste("中".repeat(30_000));
    await userEvent.click(within(bigDialog).getByRole("button", { name: /add secret/i }));
```

- [ ] **Step 2: Adapt and strengthen the SecretsPage form test**

Replace `hands the form the keys already in the bucket` (currently lines
101-111) with the version below. The old test opened nothing and typed nothing,
so its `Add secret` button assertion held whether or not `existingKeys` was
wired: it could not fail. Since the test has to change anyway for the dialog,
it is strengthened into one that actually exercises the prop, by typing a key
the bucket already has and checking the button switches to `Replace secret`.

```tsx
  it("hands the form the keys already in the bucket", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("DATABASE_URL")] })),
    );
    renderPage();
    await screen.findByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
    const dialog = await screen.findByRole("dialog", { name: /add secret/i });
    await userEvent.type(within(dialog).getByLabelText(/key name/i), "DATABASE_URL");

    // Proven through the behaviour the prop exists for: the button only warns
    // about a replace if the page actually handed the form the existing keys.
    expect(
      await within(dialog).findByRole("button", { name: /replace secret/i }),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 3: Write the failing dialog and toast tests**

Append to `web/src/features/secrets/SecretsPage.test.tsx`, inside the existing
`describe`:

```tsx
  it("opens the add dialog from the header", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();
    await screen.findByText(/no secrets yet/i);

    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("dialog", { name: /add secret/i })).toBeInTheDocument();
  });

  it("opens the add dialog from the empty state", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add your first secret/i }));

    expect(await screen.findByRole("dialog", { name: /add secret/i })).toBeInTheDocument();
  });

  it("closes the dialog and says so once a secret is written", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })),
      http.put(`${SECRETS}/NEW_KEY`, () =>
        HttpResponse.json({ ok: true, data: aSecret("NEW_KEY") }),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add secret/i }));
    const dialog = await screen.findByRole("dialog", { name: /add secret/i });

    await userEvent.type(within(dialog).getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.type(within(dialog).getByLabelText(/value/i), "v");
    await userEvent.click(within(dialog).getByRole("button", { name: /add secret/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/secret NEW_KEY added/i)).toBeInTheDocument();
  });

  it("keeps the dialog open when the write fails", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })),
      http.put(`${SECRETS}/NEW_KEY`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add secret/i }));
    const dialog = await screen.findByRole("dialog", { name: /add secret/i });

    await userEvent.type(within(dialog).getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.type(within(dialog).getByLabelText(/value/i), "v");
    await userEvent.click(within(dialog).getByRole("button", { name: /add secret/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/boom/i);
    expect(screen.getByRole("dialog", { name: /add secret/i })).toBeInTheDocument();
  });

  it("writes nothing when the dialog is cancelled", async () => {
    let writes = 0;
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })),
      http.put(`${SECRETS}/:key`, () => {
        writes += 1;
        return HttpResponse.json({ ok: true, data: aSecret("NEW_KEY") });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add secret/i }));
    const dialog = await screen.findByRole("dialog", { name: /add secret/i });

    await userEvent.type(within(dialog).getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toBe(0);
  });
```

Add `userEvent` and `waitFor` to the imports at the top of the file:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd web && pnpm test SecretsPage`
Expected: the five new tests and the strengthened one fail, because there is no
`+ Add secret` button and no dialog.

- [ ] **Step 5: Rewrite SecretsPage**

Replace the whole file with:

```tsx
import { useState } from "react";
import { useParams } from "react-router";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { PutSecretForm } from "./PutSecretForm";
import { SecretRow } from "./SecretRow";
import { useSecrets } from "./useSecrets";

export function SecretsPage() {
  const { name } = useParams();
  const bucket = name ?? "";
  const secrets = useSecrets(bucket);
  const notify = useToast();
  const [adding, setAdding] = useState(false);

  // The route is real and the resource is not, which is a different failure
  // from a wrong URL. Falling through to the router's NotFound would say the
  // wrong thing, and a form for writing into a bucket that does not exist is
  // worse than nothing.
  const missing = secrets.error?.code === "BUCKET_NOT_FOUND";

  function onCreated({ keyName, replaced }: { keyName: string; replaced: boolean }) {
    setAdding(false);
    notify(`Secret ${keyName} ${replaced ? "replaced" : "added"}`);
  }

  return (
    // px-6 py-8 is this page's own: since the buckets piece, <main> is a pure
    // passthrough with no padding, so a page that omits its spacing renders
    // flush against the viewport edge.
    <section className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{bucket}</h1>
        {/* No write affordance for a bucket that does not exist. */}
        {!missing && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
          >
            + Add secret
          </button>
        )}
      </div>

      {missing ? (
        <Alert>{secrets.error?.message}</Alert>
      ) : (
        <>
          {secrets.isPending && (
            <p role="status" className="text-sm text-text-muted">
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
              <div className="flex flex-col items-start gap-3">
                <p className="text-text-muted">No secrets yet.</p>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
                >
                  Add your first secret
                </button>
              </div>
            ) : (
              // role="list" explicitly: Tailwind's preflight sets
              // list-style:none, which makes some browsers drop list semantics
              // entirely.
              <ul role="list" className="flex flex-col">
                {secrets.data.map((secret) => (
                  <SecretRow key={secret.key_name} bucket={bucket} secret={secret} />
                ))}
              </ul>
            ))}
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add secret">
        <PutSecretForm
          bucket={bucket}
          existingKeys={(secrets.data ?? []).map((s) => s.key_name)}
          onCreated={onCreated}
          onCancel={() => setAdding(false)}
        />
      </Modal>
    </section>
  );
}
```

- [ ] **Step 6: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, all 33 files. In particular
`shows an unknown bucket as this page's own error, not a 404 route` must pass
untouched, which is what the `{!missing && ...}` guard on the header button
buys, and `invariants.test.tsx:103-133` must still be byte-identical.

- [ ] **Step 7: Verify the pin is really gone**

```bash
grep -rn "bg-white\|text-slate" web/src/features/secrets/
```

Expected: no matches. Any hit means part of the pin survived.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/secrets/SecretsPage.tsx web/src/features/secrets/SecretsPage.test.tsx web/src/features/secrets/invariants.test.tsx
git commit -m "feat(web): rebuild the secrets page and drop its light mode pin"
```

---

## Task 6: Browser verification

**Files:**
- Create: scratchpad scripts only. Nothing in this task is committed except
  fixes it uncovers.

**Interfaces:**
- Consumes: the finished pages from Tasks 1 through 5.
- Produces: findings. Any fix belongs in its own commit with its own message.

Every piece in this initiative has shipped at least one defect that passing
jsdom tests could not see: ToggleSwitch's knob overflowing its track, the login
grid scrambling, the Modal backdrop painting under the sticky header, and piece
3's pin relocation silently dropping padding while a toast rendered behind a
modal. `web/vite.config.ts` sets `test: { css: false }` and jsdom performs no
layout regardless, so this is structural rather than bad luck.

- [ ] **Step 1: Install Playwright to the scratchpad only**

```bash
cd "$SCRATCHPAD" && npm install playwright --no-save --silent
```

Where `$SCRATCHPAD` is this session's scratchpad directory. Never
`cd web && pnpm add playwright`.

Then confirm the repo is untouched:

```bash
cd /mnt/projects/manguito-secret-manager && git status --porcelain web/package.json web/pnpm-lock.yaml
```

Expected: empty output. Any output means Playwright leaked into the repo and
must be reverted before continuing.

- [ ] **Step 2: Start the dev server**

```bash
cd web && pnpm run dev
```

Runs on port 5173. Kill it at the end with:

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 3: Write the check script**

Use `chromium.launch({ channel: "chrome", headless: true })` so no browser
download is needed. Fake the authenticated API with `page.route()`, so no real
OAuth is involved: intercept `**/v1/auth/me` with a user, `**/v1/buckets` with
one bucket named `alpha`, `**/v1/buckets/alpha/secrets` with two secrets, and
`**/v1/buckets/alpha/secrets/*` with a value.

Give one secret a 200 character unbroken value, since check 4 depends on it:

```js
const LONG = "z".repeat(200);
```

Grant clipboard permissions on the context, or check 8 fails for an
environmental reason that looks like a product bug:

```js
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
```

For check 6, install the clock before navigating:

```js
await page.clock.install();
// ... navigate, reveal ...
await page.clock.fastForward(31_000);
```

Two known false leads, both already paid for in earlier pieces:

- Tailwind 4's `translate-x-*` utilities set the CSS `translate` property, not
  `transform`. Reading `getComputedStyle(el).transform` returns `"none"` and
  proves nothing. Read `.translate`.
- A script that re-registers a `page.route()` handler mid-run resets any
  counter closed over by the old handler. Piece 3 lost time to a request
  counter that always read 0 for this reason.

- [ ] **Step 4: Run the eight checks and screenshot each**

1. Light and dark at 1280px wide: no white box survives the pin deletion, and
   the value box's border and background are visible in both themes. Sample
   actual pixels or read the screenshots; do not infer from class names.
2. The Add secret dialog paints above the sticky header. The header is
   `sticky top-0 z-10` and `Modal`'s backdrop is `z-50` since piece 3, so this
   is a regression check rather than an expected failure.
3. The toast paints above the dialog and is readable in dark mode.
   `ToastViewport` is `z-[60]` since piece 3.
4. The 200 character unbroken value stays inside the 760px column and produces
   no horizontal page scroll. Assert
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
   and check the `<code>` element's `getBoundingClientRect().right` against the
   section's.
5. At 380px wide, the row's top line wraps without the action buttons
   overlapping the key name. Compare bounding rects rather than eyeballing.
6. Auto-mask re-masks after `page.clock.fastForward(31_000)`, and the row is
   not left misaligned across the transition.
7. The delete dialog in dark mode with an error Alert rendered: the text is
   readable against its background.
8. Copy without revealing: click Copy on a masked row, then assert
   `document.body.innerText` contains no substring of the plaintext while
   `navigator.clipboard.readText()` returns it in full.

- [ ] **Step 5: Read the screenshots**

Open each PNG and look at it. A script that says a check passed is not
evidence; the image is. Piece 3's final review found two real defects this way
after its own script reported everything green.

- [ ] **Step 6: Fix what the checks find, one commit each**

Any fix gets its own commit and its own message, so review can tell a
verification fix apart from the reskin. Re-run the affected check afterwards
and look at the new screenshot.

- [ ] **Step 7: Stop the dev server and confirm the repo is clean**

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
cd /mnt/projects/manguito-secret-manager && git status --porcelain
```

Expected: clean, or only the fix commits from Step 6 already committed. No
`web/package.json` or `web/pnpm-lock.yaml` changes, and no `web/dist`.

---

## Task 7: Record the decisions in ADR 003

**Files:**
- Modify: `docs/adr/0003-frontend-architecture.md`

**Interfaces:**
- Consumes: what Tasks 3 and 4 actually built.
- Produces: amendment A16. A15 is currently the highest.

Two requirements in the ADR's body were unbuilt and one was underspecified.
The amendment records what shipped, so the next reader is not left inferring it
from code.

- [ ] **Step 1: Append the amendment**

Add at the end of the file:

```markdown
### A16. Auto-mask and copy-without-reveal are built, and the reveal guard is load-bearing

Two of this ADR's security-relevant UI requirements went unbuilt through SP7
and stayed that way until the secrets reskin: "revealed values auto-mask after
a timeout" and "copy-to-clipboard is available without revealing". The body
also never said how long the timeout was, so the requirement was not
implementable as written.

**Amended:** both are built, on these terms.

Auto-mask is 30 seconds, timed from the plaintext reaching the screen rather
than from the reveal click, so a slow fetch does not consume the window. It is
visual only: the cached value is left in place, so a re-reveal serves the cache
and one visit still produces one `secret.read` audit row. That follows A9,
which established that hiding is an affordance rather than a boundary because
the value is in the tab's memory either way. The threat auto-mask addresses is
an unattended or overlooked screen, which re-masking covers fully. Purging the
cache instead would charge a second audit row for what the user experiences as
one visit, and A9 deliberately avoided exactly that.

Copy without revealing fetches the value imperatively through
`queryClient.fetchQuery` and the shared `secretValueQueryOptions`, rather than
through `useSecretValue`, whose `enabled` flag *is* the reveal. The plaintext
exists on that path only as a local variable handed to `writeText`. It reaches
no DOM node, no toast and no error message, which keeps it inside invariant 8
and under A10's clipboard exception. Because the shared options carry
`staleTime: Infinity`, copying an already revealed value serves the cache and
costs no second audit row.

One consequence is easy to miss and would be a security regression rather than
a cosmetic one. TanStack Query's `enabled: false` prevents fetching, not
reading: once the copy path has populated `["secret-value", bucket, keyName]`,
`useSecretValue` returns that entry for the same row even though `revealed` is
`false`. `SecretRow`'s

```ts
const plaintext = revealed ? value.data?.value : undefined;
```

is the only thing standing between a copy and an unintended reveal. It must not
be simplified to `value.data?.value` on the reasoning that a disabled query has
no data to read.

A14's toast exception is read as permitting success toasts, not mandating them
everywhere. Add, replace and delete raise one; copy keeps its adjacent inline
"Copied" line, because copy is the highest-frequency action on the page and a
toast per copy is noise.
```

- [ ] **Step 2: Check for em dashes**

```bash
grep -c "—" docs/adr/0003-frontend-architecture.md
```

Expected: `0`.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0003-frontend-architecture.md
git commit -m "docs: amend ADR 003 with auto-mask and copy-without-reveal"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: auto-mask to Task 3,
copy-without-reveal plus the `secretValueQueryOptions` extraction to Task 4,
the mask-leak rejection to Task 2 (which preserves `MASK` and its comment
unchanged) plus the Global Constraint protecting the canary test, layout to
Tasks 2 and 5, the empty state and its constrained wording to Task 5, the pin
deletion to Task 5, both dialogs to Tasks 1, 2 and 5, the toasts to Tasks 2 and
5, the error table to Tasks 2 and 4, sanctioned test changes to Tasks 2, 4 and
5, all eight browser checks to Task 6, and the amendment to Task 7. The
rejected back link and the "Add one above" copy are covered by not appearing
anywhere in the plan, and the `access.test.tsx` pre-flight result is recorded
as a Global Constraint.

**Type consistency.** `onCreated` takes
`{ keyName: string; replaced: boolean }` in Task 1's implementation, Task 1's
tests, and Task 5's `onCreated` handler and its toast test.
`useFetchSecretValue(bucket)` returns
`(keyName: string) => Promise<SecretValue>` in Task 4's `useSecrets.ts` and is
called as `(await fetchValue(secret.key_name)).value` in the same task's
`SecretRow`. `secretValueQueryOptions(bucket, keyName)` is defined once and
consumed by both `useSecretValue` and `useFetchSecretValue`. The dialog titles
`Add secret` and `Delete secret?` match the `findByRole("dialog", { name })`
regexes used to query them, `/add secret/i` and `/delete secret/i`.

**One naming collision, resolved deliberately.** The header button
`+ Add secret`, the dialog title `Add secret`, and the form's submit button
`Add secret` all match `/add secret/i`. Every test that needs the submit button
scopes to the dialog first with `within(dialog)`, and the one test asserting
absence, `SecretsPage.test.tsx:73`, wants absence of all of them and is
satisfied by the `{!missing && ...}` guard. Task 5's dialog-cancel test uses
`/^cancel$/i` rather than `/cancel/i` for the same reason, since `Cancel` would
otherwise be ambiguous against nothing today but is anchored defensively.
