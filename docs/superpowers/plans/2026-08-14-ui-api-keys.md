# API Keys Page UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the API keys page onto the Organic design system, give
`ToggleSwitch` its second consumer, retire the light mode pin pattern, and
delete `ConfirmPrompt` now that every confirmation is a `Modal`.

**Architecture:** Two shared component fixes land first so the rest is built on
a `Modal` that can host a tall dialog and a header that survives a narrow
viewport. Then `KeyRow` becomes a row oriented card with a tag row and a revoke
dialog, `CreateKeyForm` becomes `CreateKeyFlow` owning the mutation plus the
dialog plus the token panel, and `KeysPage` gains a three state create gate and
loses the last pin. `NewKeyPanel` is tokenized last, `ConfirmPrompt` is deleted,
and ADR 003 records the end state.

**Tech Stack:** React 19, TypeScript strict, Tailwind 4, TanStack Query 5,
React Hook Form + Zod, Vitest + React Testing Library + MSW, Playwright for
browser checks (scratchpad only, never a repo dependency).

**Spec:** `docs/superpowers/specs/2026-08-14-ui-api-keys-design.md`

## Global Constraints

- No em dashes anywhere, in code comments, commit messages, or docs.
- Tailwind only. No CSS modules, no styled-components, no new spacing scale.
- No new npm dependency. `Controller` comes from `react-hook-form`, which is
  already installed. Playwright installs to the scratchpad with `--no-save`,
  and `git status` must show zero diff on `web/package.json` and
  `web/pnpm-lock.yaml`.
- Tests mock at the fetch boundary with MSW. Test behavior, not Tailwind
  classes. The two exceptions are named explicitly in Tasks 1 and 2, and both
  follow the precedent `Alert.test.tsx` set: a CSS only fix that jsdom cannot
  observe gets one class assertion so it cannot be silently deleted later.
- `web/src/api/generated.ts` is generated. Never hand-edit it.
- Comments explain why, not what.
- **Only the 100 and 800 steps of each colour ramp have dark mode values** in
  `index.css`. Any tag or chip using another step renders a light chip on a
  dark page. `bg-accent-100`, `bg-accent-2-100`, `bg-neutral-100` and their 800
  text counterparts are the only ramp utilities this piece may use. These are
  proven: `LoginPage.tsx:32` and `:37` already ship `bg-accent-100` and
  `bg-accent-2-100` on main.
- **`web/src/features/api-keys/NewKeyPanel.test.tsx` must not be modified.** Its
  7 tests are all behavior based with zero class assertions, verified by
  reading the file. Task 6 reskins the component they cover and they must keep
  passing untouched. A diff touching that file means something went wrong.
- **`web/src/routes/access.test.tsx` is unaffected by this piece.** Its three
  keys tests assert only a heading and a pathname. This was checked before Task
  1. Do not modify it. If a task appears to require modifying it, stop and
  report rather than editing it.
- **`web/src/features/api-keys/invariants.test.tsx`'s seven assertions do not
  change.** Task 5 adds one dialog opening click to its `createAKey()` helper
  and changes exactly one regex. Everything else in that file stays as it is.
- Intermediate commits leave the app functional but visually mixed. Tasks 3, 4
  and 6 theme components while `KeysPage` still pins itself to light mode until
  Task 5. This is inherent to reskinning a page across commits and is
  acceptable as long as lint, types and tests stay green at every commit.

**Verification after every code task:**

```bash
cd web && pnpm run lint && pnpm run typecheck && pnpm test
```

Main currently has 297 tests across 33 files. Each task below states its own
expected delta.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/components/Modal.tsx` | dialog chrome; gains a height bound so a tall body stays reachable | 1 |
| `web/src/features/shell/AppShell.tsx` | app chrome; header survives a narrow viewport | 2 |
| `web/src/features/api-keys/KeyRow.tsx` | one key: identity, tags, status, revoke dialog | 3 |
| `web/src/features/api-keys/CreateKeyFlow.tsx` | the create mutation, its dialog, and the token panel's lifetime | 4, 5 |
| `web/src/features/api-keys/KeysPage.tsx` | page layout, the three state create gate, the last pin removal | 5 |
| `web/src/features/api-keys/NewKeyPanel.tsx` | shows a live credential exactly once, now on theme tokens | 6 |
| `web/src/components/ConfirmPrompt.tsx` | deleted; every confirmation is a `Modal` now | 7 |
| `docs/adr/0003-frontend-architecture.md` | amendment A17, the end state of the initiative | 9 |

---

## Task 1: Modal stops trapping a tall dialog offscreen

**Files:**
- Modify: `web/src/components/Modal.tsx`
- Test: `web/src/components/Modal.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `Modal` whose panel is height bounded and scrolls internally.
  Tasks 3, 4 and 5 all put dialogs inside it; Task 4's is the tall one.

`Modal`'s panel is currently
`w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg`, with
no maximum height, inside a backdrop that is
`fixed inset-0 z-50 flex items-center justify-center bg-black/40`. Because the
backdrop is `fixed` and does not scroll, a body taller than the viewport
overflows in both directions and the part above the top edge is unreachable:
there is no way to get to the dialog's own heading or its first fields.

Task 5's create dialog is exactly that body once an account has a handful of
buckets. Fixing it here rather than in that one caller is deliberate: the defect
is general, and every feature's dialogs benefit.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/Modal.test.tsx`, inside its existing top level
`describe`:

```tsx
  // A class assertion, which this suite otherwise avoids. jsdom performs no
  // layout, so the only thing a test here can check is that the height bound is
  // still declared. Without it a tall dialog centres in a fixed backdrop that
  // does not scroll, putting its own heading permanently out of reach, and
  // nothing else in the suite would notice its removal. Alert.test.tsx sets the
  // same precedent for the same reason.
  it("bounds its own height so a tall body stays reachable", () => {
    render(
      <Modal open onClose={() => {}} title="Tall">
        <p>body</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Tall" });
    expect(dialog.className).toMatch(/max-h-/);
    expect(dialog.className).toMatch(/overflow-y-auto/);
  });
```

This file already imports `render` and `screen` from
`@testing-library/react` and calls `render` directly in all nine of its
existing tests, so no new import is needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test Modal`
Expected: the new test fails on the first `expect`, because the panel has no
`max-h-` class.

- [ ] **Step 3: Bound the panel's height**

In `web/src/components/Modal.tsx`, change the backdrop's className from:

```tsx
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
```

to:

```tsx
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
```

and change the panel's className from:

```tsx
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg"
```

to:

```tsx
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-lg"
```

Add this comment immediately above the panel's opening `<div>`:

```tsx
      {/* Height bounded and internally scrollable. The backdrop is fixed and
          does not scroll, so an unbounded panel taller than the viewport would
          put its own heading above the top edge with no way to reach it. The
          backdrop's p-4 is the other half of the same pair: it keeps the panel
          off the viewport edges, and 2rem is exactly what max-h subtracts. */}
```

- [ ] **Step 4: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `Modal.test.tsx` goes from 9 tests to 10. Its other 9 are
behavior based and must be untouched.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Modal.tsx web/src/components/Modal.test.tsx
git commit -m "fix(web): bound Modal's height so a tall dialog stays reachable"
```

---

## Task 2: The app shell header survives a narrow viewport

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Test: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on. This is an independent fix riding
  along because this is the last UI piece.

At roughly 380px the header reports `scrollWidth` 488 against `clientWidth`
380, with `Sign out` fully clipped. Found during the secrets piece's browser
verification and traced to the header's single non wrapping flex row. It is pre
existing and was deliberately left alone then, because `AppShell` was not in
that piece's scope. There is no later piece to defer to now.

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/shell/AppShell.test.tsx`, inside its existing top
level `describe`:

```tsx
  // A class assertion, which this suite otherwise avoids, for the same reason
  // Modal's height bound has one: jsdom performs no layout, so a wrapping
  // header cannot be verified here. The real check is a browser at 380px. This
  // exists so the fix cannot be deleted silently by a later refactor.
  it("lets its header wrap rather than overflow a narrow viewport", () => {
    renderShell();

    expect(screen.getByRole("banner").className).toMatch(/flex-wrap/);
  });
```

`renderShell()` is this file's existing helper, defined at its line 26 and used
by every other test in it, so nothing new is needed.

`getByRole("banner")` reaches the `<header>` element, whose implicit role is
`banner` because it is not nested inside a `<section>` or `<article>`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test AppShell`
Expected: the new test fails, because the header className has no `flex-wrap`.

- [ ] **Step 3: Let the header wrap and the email shrink**

In `web/src/features/shell/AppShell.tsx`, change the header's className from:

```tsx
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-4">
```

to:

```tsx
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-bg px-6 py-4">
```

Change the wordmark span from:

```tsx
            <span className="font-sans font-semibold">Manguito Secret Manager</span>
```

to:

```tsx
            {/* Hidden rather than removed below sm: the logo still carries the
                brand at that width, and the wordmark is the single widest item
                in the header. It stays in the DOM, so nothing that queries for
                it breaks. */}
            <span className="hidden font-sans font-semibold sm:inline">
              Manguito Secret Manager
            </span>
```

Change the email span from:

```tsx
            <span className="text-[13px] opacity-70">{session.user.email}</span>
```

to:

```tsx
            {/* min-w-0 with truncate so a long address shrinks instead of
                shoving Sign out off the edge. Truncated rather than hidden:
                which account you are signed in as is worth knowing in a secret
                manager. */}
            <span className="min-w-0 truncate text-[13px] opacity-70">{session.user.email}</span>
```

- [ ] **Step 4: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `AppShell.test.tsx` goes from 10 tests to 11. The wordmark
stays in the DOM, so any existing test querying for it still finds it.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx
git commit -m "fix(web): let the app shell header wrap at narrow widths"
```

---

## Task 3: KeyRow becomes a card with a tag row and a revoke dialog

**Files:**
- Modify: `web/src/features/api-keys/KeyRow.tsx`
- Test: `web/src/features/api-keys/KeyRow.test.tsx`

**Interfaces:**
- Consumes: `Modal({ open, onClose, title, children })` from
  `../../components/Modal`, which portals into `#modal-root`. `useToast()` from
  `../../components/useToast`, returning `notify(message)`.
- Produces: a `KeyRow` whose revoke confirmation is a dialog titled
  `Revoke key?` with a `Revoke key` confirm button. Task 7 deletes
  `ConfirmPrompt` once this task stops importing it.

Six of this file's nine tests change, all traceable to the tag redesign or the
dialog conversion. Each is spelled out below so a reviewer can tell them from a
test bent to hide a regression.

- [ ] **Step 1: Rewrite the three tests the tag row breaks**

In `web/src/features/api-keys/KeyRow.test.tsx`, replace these three tests.
Nothing else in the file changes in this step.

Replace `shows the name, the lookup id and the scope` (currently lines 38-47).
Its `getByText(/prod, dev/)` cannot survive: buckets become one tag each, so no
single text node holds both names.

```tsx
  it("shows the name, the lookup id and each bucket in scope", () => {
    renderRow({ buckets: ["prod", "dev"] });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText("ci-deploy")).toBeInTheDocument();
    // Not secret, and exists precisely to identify a key without
    // authenticating as one.
    expect(within(row).getByText(/msm_a3f9c2e1/)).toBeInTheDocument();
    // One tag per bucket now, rather than a joined string.
    expect(within(row).getByText("prod")).toBeInTheDocument();
    expect(within(row).getByText("dev")).toBeInTheDocument();
  });
```

Replace `says read only when neither flag is set` (currently lines 49-53). The
mockup renders no tag at all when neither flag is set; this keeps an explicit
one so the grant stays legible rather than inferred from two absences.

```tsx
  it("says read only when neither flag is set", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/^read only$/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^write$/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^bulk reveal$/i)).not.toBeInTheDocument();
  });
```

Replace `names both capabilities when both are set` (currently lines 55-59).
Two separate tags now, not one joined phrase.

```tsx
  it("names both capabilities when both are set", () => {
    renderRow({ can_write: true, can_reveal: true });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/^write$/i)).toBeInTheDocument();
    expect(within(row).getByText(/^bulk reveal$/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^read only$/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Rescope the three revoke tests to the dialog**

`Modal` portals into `#modal-root`, which is outside the `<li>`, so
`within(row)` can no longer reach the confirm controls. The dialog's accessible
name comes from its title, so `/revoke this key/i` no longer matches anything:
the title is `Revoke key?`.

Replace `confirms before revoking and can be cancelled` (currently lines
85-104):

```tsx
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
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });
```

Replace `revokes when confirmed` (currently lines 106-123):

```tsx
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
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^revoke key$/i }));

    await waitFor(() => expect(revoked).toBe(ID));
  });
```

Replace `shows a failed revoke on its own row` (currently lines 125-143),
renamed because the error's location changed: it now renders inside the dialog,
which stays open on failure.

```tsx
  it("shows a failed revoke in the dialog it was confirmed from", async () => {
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
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^revoke key$/i }));

    // The dialog stays open so the message sits next to the button that failed.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/no such api key/i);
    expect(screen.getByRole("dialog", { name: /revoke key/i })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Add a test for the revoke toast**

Append inside the same `describe`:

```tsx
  it("says so once a key is revoked", async () => {
    server.use(
      http.delete(`${KEYS}/:id`, () => HttpResponse.json({ ok: true, data: { revoked: true } })),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^revoke key$/i }));

    expect(await screen.findByText(/key ci-deploy revoked/i)).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd web && pnpm test KeyRow`
Expected: the three tag tests fail on their new assertions, and the four dialog
tests fail because no element with `role="dialog"` named `/revoke key/i` exists
yet.

- [ ] **Step 5: Rewrite KeyRow**

Replace the whole file with:

```tsx
import { useState, type ReactNode } from "react";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/useToast";

import { keyStatus, useRevokeApiKey, type ApiKey } from "./useApiKeys";

const STATUS_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

/**
 * Only the 100 and 800 steps of each ramp carry dark mode values in index.css.
 * A tone using any other step would render a light chip on a dark page, which
 * is the defect that hit Alert's inline variant. These four stay inside
 * 100/800, and a fifth tone must too.
 */
const TAG_BASE =
  "inline-flex items-center text-[11px] tracking-[0.02em] px-2.5 py-[3px] rounded-[12px]";

const TAG_TONE = {
  neutral: "bg-neutral-100 text-neutral-800",
  accent: "bg-accent-100 text-accent-800",
  accent2: "bg-accent-2-100 text-accent-2-800",
  outline: "border border-accent text-accent",
} as const;

const STATUS_TONE = { active: "accent2", expired: "outline", revoked: "neutral" } as const;

function Tag({ tone, children }: { tone: keyof typeof TAG_TONE; children: ReactNode }) {
  return <span className={`${TAG_BASE} ${TAG_TONE[tone]}`}>{children}</span>;
}

export function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const [confirming, setConfirming] = useState(false);
  const revoke = useRevokeApiKey();
  const notify = useToast();
  const status = keyStatus(apiKey);
  const live = status === "active";
  const readOnly = !apiKey.can_write && !apiKey.can_reveal;

  function onConfirmed() {
    revoke.mutate(apiKey.id, {
      onSuccess: () => {
        setConfirming(false);
        notify(`Key ${apiKey.name} revoked`);
      },
    });
  }

  return (
    <li
      aria-label={apiKey.name}
      className="flex flex-row items-center justify-between gap-4 rounded-sm bg-surface p-3 shadow-sm"
    >
      {/* min-w-0 so a long name or a full row of tags shrinks rather than
          shoving the Revoke button out past the card's edge. */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[17px] leading-tight">{apiKey.name}</span>
          {/* Not secret, and exists precisely to identify a key without
              authenticating as one. */}
          <span className="text-xs text-text-muted">msm_{apiKey.lookup_id}</span>
          <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {apiKey.buckets.map((bucket) => (
            <Tag key={bucket} tone="neutral">
              {bucket}
            </Tag>
          ))}
          {apiKey.can_write && <Tag tone="accent">Write</Tag>}
          {apiKey.can_reveal && <Tag tone="accent2">Bulk reveal</Tag>}
          {/* The mockup shows nothing at all when neither flag is set. Naming
              it keeps the grant legible instead of leaving it to be inferred
              from two absent tags. */}
          {readOnly && <Tag tone="neutral">Read only</Tag>}
        </div>

        <span className="text-xs text-text-muted">
          {apiKey.last_used_at === null
            ? "Never used"
            : `Last used ${new Date(apiKey.last_used_at).toLocaleDateString()}`}
        </span>
      </div>

      {/* Revoking an already dead key changes nothing the user can see, so the
          button is not offered. The status tag carries that state instead of
          dimming the whole row, which would put 11px muted text under AA. */}
      {live && (
        <button
          type="button"
          aria-label={`Revoke ${apiKey.name}`}
          onClick={() => {
            // Cleared on open so a previous failure's message does not greet
            // the next attempt.
            revoke.reset();
            setConfirming(true);
          }}
          className="shrink-0 rounded-md border border-border px-4 py-2 font-sans text-sm"
        >
          Revoke
        </button>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Revoke key?">
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            {apiKey.name} will stop working immediately. This cannot be undone.
          </p>

          {/* The dialog stays open on failure, so the error belongs here rather
              than behind it on the card. */}
          {revoke.isError && <Alert variant="inline">{revoke.error.message}</Alert>}

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
              disabled={revoke.isPending}
              className="rounded-md bg-danger px-4 py-2 font-sans text-sm font-semibold text-bg disabled:opacity-50"
            >
              Revoke key
            </button>
          </div>
        </div>
      </Modal>
    </li>
  );
}
```

Note what this deletes: the `capabilityText()` helper (tags replace it), the
`ConfirmPrompt` import, and the `opacity-60` on non active rows.

- [ ] **Step 6: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `KeyRow.test.tsx` goes from 9 tests to 10. The three status
badge tests at the file's original lines 61-83 must pass untouched, because
`getByText(/active|revoked|expired/i)` still matches the status tag's text and
the `Revoke <name>` aria-label is preserved.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/api-keys/KeyRow.tsx web/src/features/api-keys/KeyRow.test.tsx
git commit -m "feat(web): rebuild KeyRow as a card with tags and a revoke dialog"
```

---

## Task 4: The capability flags become toggles, and the form is renamed

**Files:**
- Rename: `web/src/features/api-keys/CreateKeyForm.tsx` to `CreateKeyFlow.tsx`
- Rename: `web/src/features/api-keys/CreateKeyForm.test.tsx` to
  `CreateKeyFlow.test.tsx`
- Modify: both, after the rename
- Modify: `web/src/features/api-keys/KeysPage.tsx`, the import name only

**Interfaces:**
- Consumes: `ToggleSwitch({ checked, onChange, label, disabled? })` from
  `../../components/ToggleSwitch`, and the existing `apiKeyForm.ts` exports.
- Produces: `CreateKeyFlow({ buckets: Bucket[] })`, the same single prop the
  component has today. Task 5 adds the dialog props.

**This task deliberately does not touch the dialog.** The form keeps rendering
inline on the page exactly as it does now. Two reasons. First, the
`ToggleSwitch` and `Controller` integration is a different concern from the
dialog restructuring and deserves its own review gate. Second, and decisively:
moving the form into a dialog removes the `Create key` button from the page, and
`KeysPage.test.tsx`'s pending buckets test waits for exactly that button. Doing
both in one task would leave the suite red at this boundary. Task 5 moves the
form and updates that test in the same commit, which is where those two belong
together.

The rename lands here rather than in Task 5 so that Task 5's diff is about
behaviour rather than about a file having moved.

**Do the rename with `git mv` before editing either file's contents**, so git
records it as a rename rather than a delete plus an add:

```bash
cd /mnt/projects/manguito-secret-manager
git mv web/src/features/api-keys/CreateKeyForm.tsx web/src/features/api-keys/CreateKeyFlow.tsx
git mv web/src/features/api-keys/CreateKeyForm.test.tsx web/src/features/api-keys/CreateKeyFlow.test.tsx
```

Commit the rename and the content changes together, but say in your report
which hunks are the rename and which are real edits. A rename plus heavy edits
in one commit is hard for a reviewer to read, and naming the split for them is
cheap.

**Why the eventual name is `Flow` and not `Form`:** ADR 003 A12 says the token
exists only as the create mutation's `data`. So the component owning that
mutation has to outlive the dialog Task 5 introduces. If it unmounted when the
dialog closed, the token would go with it. That makes it one component owning the
mutation, the dialog that collects input, and the panel that displays the
result, which is a flow. The name changes here; the structure changes in Task 5.

- [ ] **Step 1: Update the import and the capability queries**

In the renamed `CreateKeyFlow.test.tsx`, change the import:

```tsx
import { CreateKeyFlow } from "./CreateKeyFlow";
```

and change the one JSX reference inside the existing `renderForm` helper from
`<CreateKeyForm buckets={buckets} />` to `<CreateKeyFlow buckets={buckets} />`.
Leave the helper's name and everything else about it alone: Task 5 is where its
props change.

Change the three capability queries, and only those three. At the original
line 57:

```tsx
    await userEvent.click(screen.getByRole("switch", { name: /write secrets/i }));
```

At the original lines 131 and 132:

```tsx
    expect(screen.getByRole("switch", { name: /bulk reveal/i })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /^reveal secrets$/i })).not.toBeInTheDocument();
```

The bucket checkbox queries at the original lines 56, 100, 162, 197 and 221 are
**untouched**: buckets stay native checkboxes.

The test `tells an account with no buckets to make one first` (originally lines
228-240) stays in this file for now. It migrates to `KeysPage.test.tsx` in Task
5, along with the branch it covers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test CreateKeyFlow`
Expected: the three `switch` queries fail, because the capability controls are
still native checkboxes.

- [ ] **Step 3: Swap the capability checkboxes for toggles**

In `web/src/features/api-keys/CreateKeyFlow.tsx`, rename the exported function
from `CreateKeyForm` to `CreateKeyFlow`, add `control` to the values pulled off
`useForm`, and change the imports at the top to add these two:

```tsx
import { Controller, useForm } from "react-hook-form";
import { ToggleSwitch } from "../../components/ToggleSwitch";
```

Then replace the two capability `<label>` blocks (currently the two
`<label className="flex items-start gap-2 text-sm">` elements holding the
`canWrite` and `canReveal` checkboxes) with these two rows. Everything else in
the file, including the inline form wrapper, the `buckets.length === 0` branch,
and the `if (create.data) return <NewKeyPanel .../>` swap, stays exactly as it
is.

```tsx
            <div className="flex items-start gap-2.5">
              {/* ToggleSwitch renders a button, not a native input, so
                  register() cannot bind it. Controller is React Hook Form's own
                  answer for a controlled component, and keeps defaultValues,
                  validation and reset() all working. */}
              <Controller
                control={control}
                name="canWrite"
                render={({ field }) => (
                  <ToggleSwitch
                    checked={field.value}
                    onChange={field.onChange}
                    label="Write secrets"
                    disabled={create.isPending}
                  />
                )}
              />
              <div>
                <div className="text-sm">Write secrets</div>
                <div className="text-xs text-text-muted">
                  Create, overwrite and delete. Deleting a secret is permanent.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Controller
                control={control}
                name="canReveal"
                render={({ field }) => (
                  <ToggleSwitch
                    checked={field.value}
                    onChange={field.onChange}
                    label="Bulk reveal"
                    disabled={create.isPending}
                  />
                )}
              />
              <div>
                <div className="text-sm">Bulk reveal</div>
                <div className="text-xs text-text-muted">
                  Fetch every secret in a bucket in one request. A browser session can never do
                  this.
                </div>
              </div>
            </div>
```

`ToggleSwitch` renders no visible text of its own by design: its `label` prop is
the accessible name, and a caller wanting visible text wraps it. The title
beside each switch is that wrapper.

Also change the capabilities `<fieldset>`'s className from
`flex flex-col gap-1` to `flex flex-col gap-3`, so the two toggle rows have room
between them.

- [ ] **Step 4: Update the import in KeysPage**

In `web/src/features/api-keys/KeysPage.tsx`, change the import and the one JSX
usage from `CreateKeyForm` to `CreateKeyFlow`. Nothing else on that page changes
in this task.

- [ ] **Step 5: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `CreateKeyFlow.test.tsx` still holds 8 tests, and
`KeysPage.test.tsx`'s pending buckets test still finds its `Create key` button,
because the form is still inline.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/api-keys/CreateKeyFlow.tsx web/src/features/api-keys/CreateKeyFlow.test.tsx web/src/features/api-keys/KeysPage.tsx
git commit -m "feat(web): make the key capability flags toggles"
```

---

## Task 5: The form moves into a dialog and KeysPage takes over

**Files:**
- Modify: `web/src/features/api-keys/CreateKeyFlow.tsx`
- Modify: `web/src/features/api-keys/KeysPage.tsx`
- Test: `web/src/features/api-keys/CreateKeyFlow.test.tsx`
- Test: `web/src/features/api-keys/KeysPage.test.tsx`
- Test: `web/src/features/api-keys/invariants.test.tsx` (two changes only)

**Interfaces:**
- Consumes: `Modal({ open, onClose, title, children })`, height bounded by Task
  1. `KeyRow` from Task 3. `CreateKeyFlow` as Task 4 left it.
- Produces:

```tsx
CreateKeyFlow({
  buckets: Bucket[],
  open: boolean,
  onClose: () => void,
  onCreated: () => void,
  onAcknowledged: () => void,
})
```

`onCreated` and `onAcknowledged` take no arguments on purpose: only the fact
that a token exists crosses this boundary, never the token.

This task deletes the last light mode pin, the wrapper
`<div className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">`.
It lands in the same commit as the reskin that makes deleting it correct.

`px-6 py-8` on the section is load bearing. Since the buckets piece, `<main>` is
a pure passthrough with no padding, so a page omitting its own spacing renders
flush against the viewport edge.

**The three state gate.** `useBuckets` returns `undefined` while pending. There
are three states, not two, and collapsing them is the trap:

| `buckets` state | guidance | create affordance |
|---|---|---|
| pending (`data === undefined`) | hidden | hidden |
| loaded and empty | shown | hidden |
| loaded and non empty | hidden | shown |

Gating the guidance on the negation of "can create" would tell an account with
plenty of buckets that it has none for as long as the request is in flight.
`KeysPage.test.tsx`'s pending buckets test is what enforces this.

- [ ] **Step 1: Move the form into the dialog**

Replace the whole of `web/src/features/api-keys/CreateKeyFlow.tsx` with:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Alert } from "../../components/Alert";
import { Modal } from "../../components/Modal";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import type { Bucket } from "../buckets/useBuckets";

import {
  apiKeyFormSchema,
  EXPIRY_PRESETS,
  expiresAtFromPreset,
  type ApiKeyFormValues,
} from "./apiKeyForm";
import { NewKeyPanel } from "./NewKeyPanel";
import { useCreateApiKey } from "./useApiKeys";

/**
 * The whole create a key flow: the mutation, the dialog that collects input,
 * and the panel that shows the resulting token exactly once.
 *
 * These three live together because of where the token lives. ADR 003 A12 says
 * it exists only as this mutation's `data`, so the component owning the
 * mutation has to outlive the dialog: if it unmounted when the dialog closed,
 * the token would go with it. That is why this is a flow rather than a form,
 * and why `onCreated` carries no payload. Only the fact that a token exists
 * crosses this boundary, never the token.
 */
export function CreateKeyFlow({
  buckets,
  open,
  onClose,
  onCreated,
  onAcknowledged,
}: {
  buckets: Bucket[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onAcknowledged: () => void;
}) {
  const create = useCreateApiKey();
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: { name: "", buckets: [], canWrite: false, canReveal: false, expiry: "90d" },
  });

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
        // Reset only on acknowledgement, not here. A failed submit keeps what
        // was typed, and a successful one has a token to hand over first.
        onSuccess: () => onCreated(),
        onError: (error) => setError("root", { message: error.message }),
      },
    );
  });

  return (
    <>
      {/* `!create.data` is belt and braces on top of the page clearing `open`.
          It keeps "no dialog over an unacknowledged token" true inside the
          component that owns the token, rather than depending on the page
          maintaining its mirror flag correctly. */}
      <Modal open={open && !create.data} onClose={onClose} title="New API key">
        <form
          onSubmit={onSubmit}
          // Named, so a test can scope to it and a screen reader announces what
          // it is.
          aria-label="Create an API key"
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="key-name" className="text-xs">
              Name
            </label>
            <input
              id="key-name"
              {...register("name")}
              placeholder="ci-deploy"
              disabled={create.isPending}
              aria-invalid={errors.name ? true : undefined}
              className="rounded-sm border border-border bg-bg px-3 py-2"
            />
          </div>
          {errors.name && <Alert variant="inline">{errors.name.message}</Alert>}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs">Buckets this key can reach</legend>
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

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs">Capabilities</legend>
            {/* may_reveal gates only the bulk path in list_endpoint. The single
                key endpoint has no such check, so a key with neither flag can
                still read values one at a time. Saying so is the difference
                between this form describing the grant and lying about it. */}
            <p className="text-xs text-text-muted">
              Any key can read secrets in these buckets one at a time. The options below grant more
              than that.
            </p>

            <div className="flex items-start gap-2.5">
              {/* ToggleSwitch renders a button, not a native input, so
                  register() cannot bind it. Controller is React Hook Form's own
                  answer for a controlled component, and keeps defaultValues,
                  validation and reset() all working. */}
              <Controller
                control={control}
                name="canWrite"
                render={({ field }) => (
                  <ToggleSwitch
                    checked={field.value}
                    onChange={field.onChange}
                    label="Write secrets"
                    disabled={create.isPending}
                  />
                )}
              />
              <div>
                <div className="text-sm">Write secrets</div>
                <div className="text-xs text-text-muted">
                  Create, overwrite and delete. Deleting a secret is permanent.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Controller
                control={control}
                name="canReveal"
                render={({ field }) => (
                  <ToggleSwitch
                    checked={field.value}
                    onChange={field.onChange}
                    label="Bulk reveal"
                    disabled={create.isPending}
                  />
                )}
              />
              <div>
                <div className="text-sm">Bulk reveal</div>
                <div className="text-xs text-text-muted">
                  Fetch every secret in a bucket in one request. A browser session can never do
                  this.
                </div>
              </div>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor="key-expiry" className="text-xs">
              Expires
            </label>
            <select
              id="key-expiry"
              {...register("expiry")}
              disabled={create.isPending}
              className="rounded-sm border border-border bg-bg px-3 py-2"
            >
              {EXPIRY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {errors.root && <Alert variant="inline">{errors.root.message}</Alert>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
            >
              Create key
            </button>
          </div>
        </form>
      </Modal>

      {create.data && (
        <NewKeyPanel
          apiKey={create.data}
          onAcknowledge={() => {
            create.reset();
            reset();
            onAcknowledged();
          }}
        />
      )}
    </>
  );
}
```

Note what this deletes from the version Task 4 left: the inline form wrapper, the
`buckets.length === 0` branch and its `Link` import (the guidance moves to the
page in Step 4, and `canCreate` makes that state unreachable), and the
`if (create.data) return <NewKeyPanel .../>` early return, which becomes a
sibling of the Modal rather than a replacement for the form.

- [ ] **Step 2: Point the flow's own tests at the dialog**

In `web/src/features/api-keys/CreateKeyFlow.test.tsx`, replace the `renderForm`
helper with:

```tsx
/**
 * A data router, because a successful create renders NewKeyPanel's blocker.
 *
 * `open` is a fixed true rather than page state: this suite exercises the flow
 * with its dialog open, and the page level wiring (the dialog closing, the
 * trigger hiding) is KeysPage's to test. The dialog still closes on success on
 * its own, because CreateKeyFlow gates the Modal on `!create.data` too, which is
 * what the "replaces itself with the token panel" test below proves.
 */
function renderFlow(buckets = [aBucket("prod"), aBucket("dev")]) {
  const router = createMemoryRouter(
    [
      {
        path: "/keys",
        element: (
          <CreateKeyFlow
            buckets={buckets}
            open
            onClose={() => {}}
            onCreated={() => {}}
            onAcknowledged={() => {}}
          />
        ),
      },
    ],
    { initialEntries: ["/keys"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}
```

Replace every `renderForm(` call with `renderFlow(`.

Then delete the test `tells an account with no buckets to make one first`
(originally lines 228-240). It moves to `KeysPage.test.tsx` in Step 4, because
the guidance it covers moves to the page. Delete the now unused `MemoryRouter`
import if nothing else in the file uses it.

The test `replaces itself with the token panel on success` keeps its assertion
that `queryByRole("button", { name: /create key/i })` is absent afterwards. That
still holds, now via the `!create.data` guard rather than an early return, and it
is the unit level proof that a second submit is impossible while a token is
unsaved.

- [ ] **Step 3: Adapt the two lines in invariants.test.tsx**

The form now lives behind a dialog. Add the opening click to the `createAKey()`
helper (originally lines 65-70):

```tsx
async function createAKey() {
  await userEvent.click(await screen.findByRole("button", { name: /new key/i }));
  await userEvent.type(await screen.findByLabelText(/name/i), "ci-deploy");
  await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
  await userEvent.click(screen.getByRole("button", { name: /create key/i }));
  await screen.findByText(TOKEN);
}
```

Then, in `removes the token from the page for good once acknowledged`, change
only its final assertion (originally line 174). The `create key` submit button
no longer exists on the page, because it is inside the dialog. The affordance
that returns is `+ New key`.

```tsx
    // Nothing can bring it back: the create affordance is what returns, not
    // the panel.
    expect(await screen.findByRole("button", { name: /new key/i })).toBeInTheDocument();
```

Every other line in this file, including all seven security assertions, stays
exactly as it is.

- [ ] **Step 4: Migrate the no-buckets test and adapt the pending one**

In `web/src/features/api-keys/KeysPage.test.tsx`, change the pending buckets
test's final assertion (originally line 96) from `/create key/i` to
`/new key/i`. Its two assertions at the original lines 91 and 92 are untouched:
they are the gate's guard.

```tsx
    expect(await screen.findByRole("button", { name: /new key/i })).toBeInTheDocument();
```

Then append the migrated test plus the page level tests inside the same
`describe`:

```tsx
  // Migrated from CreateKeyForm.test.tsx: the guidance moved from the form to
  // the page, so nobody opens a dialog to be told no.
  it("tells an account with no buckets to make one first", async () => {
    bucketsReturn([]);
    server.use(http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    expect(await screen.findByRole("link", { name: /create a bucket/i })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(screen.queryByRole("button", { name: /new key/i })).not.toBeInTheDocument();
  });

  it("opens the create dialog from the header", async () => {
    bucketsReturn(["prod"]);
    server.use(
      http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [aKey("ci-deploy")] })),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new key/i }));

    expect(await screen.findByRole("dialog", { name: /new api key/i })).toBeInTheDocument();
  });

  it("opens the create dialog from the empty state", async () => {
    bucketsReturn(["prod"]);
    server.use(http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /create your first key/i }));

    expect(await screen.findByRole("dialog", { name: /new api key/i })).toBeInTheDocument();
  });

  it("offers no second create while a token is still unacknowledged", async () => {
    bucketsReturn(["prod"]);
    server.use(
      http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })),
      http.post(`${BASE}/v1/keys`, () =>
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
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new key/i }));
    const dialog = await screen.findByRole("dialog", { name: /new api key/i });
    await userEvent.type(within(dialog).getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "prod" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /create key/i }));
    await screen.findByText("msm_a3f9c2e1_secret");

    // Creating a second key here would lose the first token permanently.
    expect(screen.queryByRole("button", { name: /new key/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(await screen.findByRole("button", { name: /new key/i })).toBeInTheDocument();
  });
```

Update the imports at the top of the file to add what these need:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

This test file needs a data router, because a successful create renders
`NewKeyPanel`'s blocker. Its existing `renderPage` already uses
`createMemoryRouter`, so no change is needed there.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd web && pnpm test KeysPage`
Expected: the four new tests and the adapted pending buckets test fail, because
there is no `+ New key` button and no dialog.

- [ ] **Step 6: Rewrite KeysPage**

Replace the whole file with:

```tsx
import { useState } from "react";
import { Link } from "react-router";

import { Alert } from "../../components/Alert";
import { useBuckets } from "../buckets/useBuckets";

import { CreateKeyFlow } from "./CreateKeyFlow";
import { KeyRow } from "./KeyRow";
import { useApiKeys } from "./useApiKeys";

export function KeysPage() {
  const buckets = useBuckets();
  const keys = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [tokenPending, setTokenPending] = useState(false);

  // Three states, not two. useBuckets returns undefined while pending, and
  // treating that as "no buckets" would tell an account with plenty that it has
  // none for as long as the request is in flight.
  const noBuckets = buckets.data !== undefined && buckets.data.length === 0;

  // One condition for both triggers. Gating only the header would leave the
  // empty state's button able to open a dialog in exactly the situation the
  // header button was hidden to prevent.
  const canCreate = buckets.data !== undefined && buckets.data.length > 0 && !tokenPending;

  return (
    // px-6 py-8 is this page's own: <main> is a pure passthrough with no
    // padding, so a page that omits its spacing renders flush against the
    // viewport edge.
    <section className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">API keys</h1>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
          >
            + New key
          </button>
        )}
      </div>

      {buckets.isError && <Alert>Could not refresh your buckets. {buckets.error.message}</Alert>}

      {noBuckets && (
        <p className="rounded-md border border-border p-4 text-text-muted">
          A key has to be scoped to at least one bucket.{" "}
          <Link to="/buckets" className="text-accent underline">
            Create a bucket
          </Link>{" "}
          first.
        </p>
      )}

      {/* Above the list, where the form used to be, so an unacknowledged token
          is the first thing on the page rather than the last. */}
      <CreateKeyFlow
        buckets={buckets.data ?? []}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setTokenPending(true);
        }}
        onAcknowledged={() => setTokenPending(false)}
      />

      {keys.isPending && (
        <p role="status" className="text-sm text-text-muted">
          Loading keys
        </p>
      )}

      {keys.isError && <Alert>Could not refresh your API keys. {keys.error.message}</Alert>}

      {/* Rendered on data existing, not on isSuccess: TanStack reports a failed
          refetch as an error while still holding the previous data, so gating on
          isSuccess would erase a working list. */}
      {keys.data &&
        (keys.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-text-muted">No API keys yet.</p>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
              >
                Create your first key
              </button>
            )}
          </div>
        ) : (
          // role="list" explicitly: Tailwind's preflight sets list-style:none,
          // which makes some browsers drop list semantics entirely.
          <ul role="list" className="flex flex-col gap-3">
            {keys.data.map((apiKey) => (
              <KeyRow key={apiKey.id} apiKey={apiKey} />
            ))}
          </ul>
        ))}
    </section>
  );
}
```

- [ ] **Step 7: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. `KeysPage.test.tsx` goes from 5 tests to 9,
`CreateKeyFlow.test.tsx` from 8 to 7 (the migrated one left), and
`invariants.test.tsx` stays at 7 with all seven assertions unchanged.

- [ ] **Step 8: Verify the pin is really gone from this feature**

```bash
grep -rn "bg-white\|bg-slate\|text-slate" web/src/features/api-keys/
```

Expected: matches remain only in `NewKeyPanel.tsx`, which Task 6 handles. If
anything else matches, part of the pin survived.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/api-keys/CreateKeyFlow.tsx web/src/features/api-keys/CreateKeyFlow.test.tsx web/src/features/api-keys/KeysPage.tsx web/src/features/api-keys/KeysPage.test.tsx web/src/features/api-keys/invariants.test.tsx
git commit -m "feat(web): move key creation into a dialog and drop the last light mode pin"
```

---

## Task 6: NewKeyPanel moves onto the theme tokens

**Files:**
- Modify: `web/src/features/api-keys/NewKeyPanel.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. This is the last visual change in the piece.

**Do not modify `NewKeyPanel.test.tsx`.** Its 7 tests are behavior based with
zero class assertions, verified by reading the file. They must keep passing
untouched, which is the check that this reskin changed only appearance.

This component has no mockup to follow: the mockup never displays a token
anywhere. It gets the vocabulary the other four pieces established.

Four hardcoded light mode only colour pairs live here, invisible until Task 5
removed the pin above them.

- [ ] **Step 1: Tokenize the panel**

In `web/src/features/api-keys/NewKeyPanel.tsx`, change the section's className
from:

```tsx
      className="flex flex-col gap-3 rounded border p-4"
```

to:

```tsx
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
```

Change the token box from:

```tsx
      <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-sm">
```

to:

```tsx
      {/* bg-bg inside a bg-surface panel, so the token reads as a nested field
          rather than blending into the card. */}
      <code className="break-all rounded-sm border border-border bg-bg px-3 py-2 font-mono text-sm">
```

Change the Copy button's className from:

```tsx
          className="rounded border px-3 py-1 text-sm"
```

to:

```tsx
          className="rounded-md border border-border px-4 py-2 font-sans text-sm"
```

Change the acknowledge button's className from:

```tsx
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
```

to:

```tsx
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-semibold text-bg"
```

Change the copy notice's className from:

```tsx
        <p role="status" className="text-sm text-slate-600">
```

to:

```tsx
        <p role="status" className="text-sm text-text-muted">
```

- [ ] **Step 2: Tokenize the blocker callout**

Change the blocker wrapper's className from:

```tsx
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
```

to this, comment included. Note it is a JSX comment: a `//` line placed among
JSX children would render as literal text.

```tsx
        {/* There is no amber token in this theme. accent-100 with an accent
            border reads as a warm warning in both themes and stays inside the
            100/800 rule, the only ramp pair with dark mode values. */}
        <div className="flex flex-col gap-2 rounded-md border border-accent bg-accent-100 p-3">
```

The existing comment above this block, explaining that it is a div wrapping an
Alert rather than an Alert containing buttons because Alert renders a `<p>` and
a button inside a `<p>` is invalid HTML, stays where it is.

Change the two blocker buttons' classNames from:

```tsx
              className="rounded border px-2 py-1"
```

to, for both `Stay` and `Leave`:

```tsx
              className="rounded-md border border-border px-4 py-2 font-sans text-sm"
```

- [ ] **Step 3: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass with no test file changes at all. `NewKeyPanel.test.tsx`
stays at 7 tests and stays byte identical.

- [ ] **Step 4: Verify the whole features tree is clean**

```bash
grep -rn "bg-white\|bg-slate\|text-slate\|amber-50\|amber-300" web/src/features/
```

Expected: no matches anywhere. This is the check that the pin pattern is
retired across all five pages.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/api-keys/NewKeyPanel.tsx
git commit -m "feat(web): put the new key panel on the theme tokens"
```

---

## Task 7: Delete ConfirmPrompt

**Files:**
- Delete: `web/src/components/ConfirmPrompt.tsx`
- Delete: `web/src/components/ConfirmPrompt.test.tsx`

**Interfaces:**
- Consumes: Task 3 having removed the last import of it.
- Produces: nothing.

Buckets moved to a `Modal` in piece 3, secrets in piece 4, and `KeyRow` in Task
3 of this piece. Nothing imports it now.

- [ ] **Step 1: Confirm there are no consumers**

```bash
grep -rn "ConfirmPrompt" web/src/
```

Expected: matches only in the two files being deleted. If any other file
appears, stop and report rather than deleting.

- [ ] **Step 2: Delete both files**

```bash
git rm web/src/components/ConfirmPrompt.tsx web/src/components/ConfirmPrompt.test.tsx
```

- [ ] **Step 3: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, with 5 fewer tests and one fewer test file (32 files).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(web): delete ConfirmPrompt now every confirmation is a dialog"
```

---

## Task 8: Browser verification

**Files:**
- Create: scratchpad scripts only. Nothing here is committed except fixes it
  uncovers.

**Interfaces:**
- Consumes: the finished pages from Tasks 1 through 7.
- Produces: findings. Any fix belongs in its own commit with its own message.

Every piece in this initiative has shipped at least one defect that passing
jsdom tests could not see: `ToggleSwitch`'s knob overflowing its track, the
login grid scrambling, the `Modal` backdrop painting under the sticky header,
the buckets pin relocation silently dropping padding, a toast rendering behind a
modal, and `Alert` failing WCAG AA in dark mode. `web/vite.config.ts` sets
`test: { css: false }` and jsdom performs no layout regardless.

- [ ] **Step 1: Install Playwright to the scratchpad only**

```bash
cd "$SCRATCHPAD" && npm install playwright --no-save --silent
```

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

Port 5173. Kill it at the end with:

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 3: Write the check script**

Use `chromium.launch({ channel: "chrome", headless: true })` so no browser
download is needed. Fake the authenticated API with `page.route()`: intercept
`**/v1/auth/me` with a user, `**/v1/buckets` with six buckets (check 6 needs
them), `**/v1/keys` with several keys covering all three statuses and all
capability combinations, and `**/v1/keys` POST with a created key carrying a
long token.

Grant clipboard permissions on the context before navigating, or check 2's copy
path fails for an environmental reason that looks like a product bug:

```js
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
```

Force the theme with `page.addInitScript` setting `localStorage.theme` before
navigation, matching the inline script in `index.html` that reads it on first
paint.

Three known false leads, all already paid for in earlier pieces:

- Tailwind 4's `translate-x-*` utilities set the CSS `translate` property, not
  `transform`. Reading `getComputedStyle(el).transform` returns `"none"` and
  proves nothing. Read `.translate`. This matters for check 3.
- Re-registering a `page.route()` handler mid-run resets any counter closed over
  by the old handler. Register counters once, outside handlers you might
  re-register.
- The real success flow closes its own dialog in the same render that fires a
  toast, so the two do not naturally coexist. If a check needs both on screen,
  the honest route is a delete in one row followed by opening another dialog
  inside the toast's four second window, not a synthetic DOM click that bypasses
  the backdrop.

- [ ] **Step 4: Run the eight checks and screenshot each**

1. All four tag variants readable in light and dark at 1280px: neutral, accent,
   accent-2 and outline. Sample actual pixels or read the screenshots. This is
   the direct test of the constraint that only the 100 and 800 ramp steps have
   dark values.
2. `NewKeyPanel` in dark mode: panel surface, token box, the warning Alert and
   the blocker's Stay/Leave callout all readable. Four hardcoded colour pairs
   were replaced here, on the one screen that shows a live credential. Trigger
   the blocker by clicking a nav link while a token is unacknowledged.
3. The create dialog at 1280px with six buckets: both `ToggleSwitch`es render
   with the knob inside the track (read `.translate`, not `.transform`), and the
   dialog stays inside the viewport with its heading and first field reachable.
   Assert the panel's `scrollHeight` against its `clientHeight` to confirm it
   scrolls internally rather than overflowing, and that its
   `getBoundingClientRect().top` is at or below 0. Then open the buckets and
   secrets dialogs, which are short, and confirm they did not gain a scrollbar
   or lose their centring.
4. `AppShell` at 380px: assert
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
   and that `Sign out`'s bounding rect sits inside the viewport. Then a 1280px
   regression pass on buckets, secrets and keys, confirming the header still
   reads as one row with the wordmark visible.
5. A key card at 380px: the tag row wraps and Revoke stays inside the card.
   Compare bounding rects rather than eyeballing.
6. A key with six buckets and both capabilities at 1280px: tags wrap inside the
   card and Revoke's rect stays inside the card's rect. This is `min-w-0` doing
   its job.
7. The revoke dialog in dark mode with an error Alert rendered: the text is
   readable against its background.
8. A long token in the panel: `break-all` keeps it inside its box and produces
   no horizontal page scroll.

- [ ] **Step 5: Read the screenshots**

Open each PNG and look at it. A script that says a check passed is not
evidence; the image is. The secrets piece's final review found two real defects
this way after its own script reported everything green.

- [ ] **Step 6: Fix what the checks find, one commit each**

Any fix gets its own commit and its own message, so review can tell a
verification fix from the reskin. Re-run the affected check afterwards and look
at the new screenshot.

- [ ] **Step 7: Stop the dev server and confirm the repo is clean**

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
cd /mnt/projects/manguito-secret-manager && git status --porcelain
```

Expected: clean, apart from any fix commits from Step 6 already committed. No
`web/package.json`, `web/pnpm-lock.yaml`, or `web/dist` changes.

---

## Task 9: Record the end state in ADR 003

**Files:**
- Modify: `docs/adr/0003-frontend-architecture.md`

**Interfaces:**
- Consumes: what Tasks 1 through 8 actually built.
- Produces: amendment A17. A16 is currently the highest.

- [ ] **Step 1: Append the amendment**

Add at the end of the file:

```markdown
### A17. The UI modernization is complete, and what it settled

Five sub-projects reskinned this frontend onto the Organic design system:
foundation, login and shell, buckets, secrets, API keys. This records the end
state, so the next reader does not have to infer it from five specs.

**Amended:** the following are now true of the whole frontend.

The light mode pin is gone. While the reskin was in flight, each unconverted
page wrapped itself in `bg-white text-slate-900` so dark mode could ship before
every page was ready. Each piece deleted its own pin as it converted its page,
and the API keys piece deleted the last one.
`grep -rn "bg-white\|bg-slate\|text-slate" web/src/features/` returns nothing.

Every confirmation is a `Modal`. `ConfirmPrompt`, the inline confirm this
frontend started with, is deleted. Its last consumer was `KeyRow`.

`Modal` bounds its own height and scrolls internally. Its backdrop is `fixed`
and does not scroll, so an unbounded panel taller than the viewport put its own
heading above the top edge with no way to reach it. The API keys create dialog
is the body that exposed this.

Only the **100 and 800** steps of each colour ramp have dark mode values. Steps
200 through 700 and 900 are light mode only. A chip or tag using another step
renders a light element on a dark page, which is the defect that hit `Alert`'s
inline variant in the secrets piece. `KeyRow`'s tag tones stay inside 100/800
and say so in a comment.

`ToggleSwitch` has a second consumer. A5 planned a client state library around
reveal toggles, A9 corrected that, and A11 removed the library when no consumer
appeared. The switch component itself did arrive, and the API keys capability
flags are its second real use after the theme toggle. Because it renders a
`<button role="switch">` rather than a native input, React Hook Form binds it
with `Controller` rather than `register()`.

Key creation fires no toast. Every other state changing success in the app does
(A14), but the token panel is already an unmissable confirmation whose actual
message is "save this now or lose it", and a toast would compete with it. A14 is
read as permitting success toasts rather than mandating them, the same reading
the secrets piece applied when it kept copy feedback inline.

A12 still holds literally, and one structural decision is what keeps it holding.
Moving the create form into a dialog meant the component owning the create
mutation had to outlive that dialog, or the token would have died with it. So
`CreateKeyFlow` owns the mutation, the dialog and the panel together, and only a
boolean (`tokenPending`, "is there an unacknowledged token") crosses the
boundary up to `KeysPage`, never the token. The rejected alternative was lifting
the created key into page state, which would have traded a defined, audited
lifecycle (`gcTime: 0` plus `reset()` on acknowledgement) for whatever lifecycle
a page component happens to have.
```

- [ ] **Step 2: Check that no new em dashes were added**

```bash
grep -c "—" docs/adr/0003-frontend-architecture.md
```

Expected: `6`. The file already contained 6 em dashes in sections predating this
work, so the count must not rise. If it reads 7 or more, the amendment
introduced one.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0003-frontend-architecture.md
git commit -m "docs: amend ADR 003 with the end state of the UI modernization"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the `Modal` overflow fix
to Task 1, the `AppShell` fix to Task 2, the cards and tags and the dropped row
dimming to Task 3, the rename and the capability toggles to Task 4, the dialog
move plus the three state gate plus the empty states plus the pin removal plus
`tokenPending` to Task 5, `NewKeyPanel`'s four colour pairs to Task 6,
`ConfirmPrompt`'s deletion to Task 7, all eight browser checks to Task 8, and
A17 to Task 9. The revoke dialog and its toast are in Task 3. The sanctioned
test changes are distributed across the tasks that cause them, each with its
reason stated inline. The pre-flight result for `access.test.tsx` and the
prohibition on touching `NewKeyPanel.test.tsx` are Global Constraints.

**Why Tasks 4 and 5 split where they do.** The first draft of this plan put the
rename, the toggles, and the dialog move all in Task 4, with the page rewrite in
Task 5. That draft was wrong, and the reason is worth recording so nobody
"simplifies" it back. Moving the form into a dialog removes the `Create key`
button from the page, and `KeysPage.test.tsx`'s pending buckets test waits for
exactly that button. Task 4 would therefore have ended with a red suite, which
no task may do. The dialog move and the page rewrite have to land together, so
they are both Task 5, and Task 4 is the part that is genuinely independent: the
rename and the `ToggleSwitch` integration, which leave the form inline and the
suite green.

**Type consistency.** `CreateKeyFlow`'s five props are declared identically in
Task 5's implementation, Task 5's test helper, and Task 5's call site in
`KeysPage`, and `onCreated`/`onAcknowledged` take no arguments in all three. In
Task 4 the component still takes only `buckets`, matching its unchanged test
helper. `Tag`'s `tone` prop accepts `keyof typeof TAG_TONE`, and `STATUS_TONE`'s
values (`accent2`, `outline`, `neutral`) are all keys of `TAG_TONE`. The dialog
titles `New API key` and `Revoke key?` match the
`findByRole("dialog", { name })` regexes used to query them, `/new api key/i`
and `/revoke key/i`.

**Two naming collisions, both resolved deliberately.** First, `+ New key`
(header trigger), `New API key` (dialog title) and `Create key` (form submit)
are three different strings on purpose: `/new key/i` reaches the trigger,
`/create key/i` reaches the submit, and they never match each other. The
migrated no-buckets test asserts `/new key/i` is absent rather than
`/create key/i`, because the submit button lives in a dialog that is closed
either way and so its absence would prove nothing. Second, `Create your first
key` deliberately does not contain the substring "create key", so the empty
state CTA never collides with a `/create key/i` query.

**One place where a test's failure mode is not what it looks like.** In Task 3,
the three status badge tests keep passing without edits, which might read as
those tests being insensitive to the rewrite. They are not: they assert on the
status text and the `Revoke <name>` aria-label, both of which the rewrite
preserves on purpose. If the rewrite dropped the status tag, they would fail.
