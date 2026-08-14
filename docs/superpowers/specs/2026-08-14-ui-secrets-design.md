# Secrets pages: UI modernization, piece 4 of 5

**Status:** approved
**Date:** 2026-08-14
**Scope:** `web/src/features/secrets/` plus one addition to `useSecrets.ts`

Pieces 1 (foundation), 2 (login and shell) and 3 (buckets) are merged as PRs
#15, #16 and #17. This piece reskins the secrets pages onto the Organic
design system, closes two requirements ADR 003 states but nobody built, and
deletes this page's light mode pin.

Piece 5 (API keys) is the only one left after this.

## What this piece owns

- `web/src/features/secrets/SecretsPage.tsx`
- `web/src/features/secrets/SecretRow.tsx`
- `web/src/features/secrets/PutSecretForm.tsx`
- `web/src/features/secrets/useSecrets.ts`, one addition described under
  "Copy without revealing"

## Two requirements ADR 003 states and the app does not meet

### Auto-mask after a timeout

ADR 003 line 69 requires it and line 91 lists it as a priority test case.
Neither says how long, or what exactly re-masks. Both are decided here.

A revealed row returns to masked 30 seconds after the plaintext reaches the
screen. The timer starts on the value arriving, not on the reveal click, so a
slow fetch does not consume the reading window.

Re-masking is visual only. The cached plaintext is left in place, so
re-revealing serves the cache and one visit still produces one `secret.read`
audit row. This matches what `useSecrets.ts` already documents about
`staleTime: Infinity` and what ADR 003 A9 says about hiding being an
affordance rather than a boundary. The threat auto-mask addresses is an
unattended or overlooked screen, and a visual re-mask addresses it fully.
Purging the cache instead would make re-reveal cost a second audit row for
what the user experiences as one visit, which A9 deliberately avoided.

Implementation shape: a `useEffect` keyed on the plaintext being present,
arming a `setTimeout` whose cleanup clears it. Manual Hide flips `revealed`,
which runs that cleanup, so no stale timer can fire afterwards. Unmount does
the same. The duration is a named constant carrying a comment that records
both the value and the visual-only decision.

### Copy without revealing

ADR 003 line 70: "Copy-to-clipboard is available without revealing, since
users usually want the value in the clipboard rather than on screen." The
current `SecretRow` renders Copy only after a reveal, so the requirement is
unmet.

Copy becomes unconditional. On click it serves the cached value if one is
present and otherwise fetches it, writes it to the clipboard, and never sets
`revealed`.

`useSecrets.ts` grows one export so the request is not defined twice:

```ts
export const secretValueQueryOptions = (bucket: string, keyName: string) => ({
  queryKey: secretValueQueryKey(bucket, keyName),
  queryFn: () => client.get<SecretValue>(secretPath(bucket, keyName)),
  staleTime: Infinity,
});
```

`useSecretValue` consumes it plus `enabled: revealed`. The copy path consumes
it through `queryClient.fetchQuery`. Because `staleTime` is `Infinity`, an
already-revealed row copies with zero extra requests and zero extra audit
rows.

On a copy-without-reveal the plaintext exists only as a local variable handed
to `writeText`. It reaches no DOM node, no toast, and no error message. This
is a requirement of the path, not an incidental property of one
implementation, and check 8 under "Verification" tests it in a real browser.

Copy is disabled while a copy is in flight. A double click would otherwise
fire two fetches and write two `secret.read` audit rows for one user action.

`queryClient.fetchQuery` rejects on failure, so the copy handler needs to tell
a fetch rejection apart from a `writeText` rejection and set the matching
error state. They are two different failures with two different messages, per
"Error placement".

### The trap in this change

TanStack Query's `enabled: false` prevents fetching. It does not prevent
reading. Once the copy path has populated
`["secret-value", bucket, keyName]`, `useSecretValue` returns that cached data
for the same row even though `revealed` is `false`.

The current source already handles this correctly:

```ts
const plaintext = revealed ? value.data?.value : undefined;
```

That `revealed` guard is what keeps a copy-without-reveal from putting the
plaintext on screen. It must not be simplified to `value.data?.value` on the
reasoning that `enabled: false` means there is no data to read. Doing so turns
Copy into an unintended reveal, which is a security regression rather than a
cosmetic one.

The same reasoning applies to the auto-mask effect: it keys on `plaintext`,
the guarded value, not on `value.data`. Keying it on `value.data` would arm a
timer for a row that was never revealed.

## Where the mockup is wrong

The mockup is the source for layout and spacing. It is not the source for how
a masked value is rendered.

Mockup line 487 renders the mask as
`'•'.repeat(Math.max(8, Math.min(24, value.length)))`. That is derived from
the value's length, and for any secret between 8 and 24 characters, which
covers most tokens and passwords, the mask width is exactly the value's
length.

`SecretRow.tsx` already refuses this, with a comment stating why, and
`invariants.test.tsx:103-133` falsifies it by comparing a 2 character
secret's mask against a 200 character one. The constant mask stays. The only
thing taken from the mockup's mask rendering is the cosmetic
`letter-spacing: 3px`.

Two smaller rejections, recorded so a later reader does not mistake them for
oversights:

- The mockup's `← Buckets` back link is not added. SP8 removed this page's
  own back link deliberately, because AppShell's nav carries a Buckets link
  that stays active on `/buckets/:name`.
- The mockup's "No secrets yet. Add one above." is stale once the form lives
  in a dialog. See "Empty state" for the replacement and why its wording is
  constrained.

## Layout

Values from the mockup, expressed with tokens already in `index.css`.

The page section mirrors `BucketsPage`'s shape at the mockup's narrower
width: `mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-8`.

That `px-6 py-8` is load-bearing. Since piece 3, `<main>` is a pure
passthrough with no padding of its own, so a page omitting its own spacing
renders flush against the viewport edge. Piece 3's final review caught
exactly this after the pin relocation dropped it.

The header row is `flex flex-wrap items-center justify-between gap-4`: the
bucket name, then a `+ Add secret` primary button. The `h1` and primary
button class lists are copied verbatim from `BucketsPage` rather than
approximated.

### Rows

A divider list, not a card grid. This is the mockup's treatment and the main
visual difference from buckets.

Each `<li>` is `flex flex-col gap-2 border-b border-border py-3` and keeps
its `aria-label={key_name}`, which existing
`getByRole("listitem", { name })` queries depend on.

The top line is `flex flex-wrap items-center justify-between gap-3`. On the
left, `flex items-baseline gap-3` holds the key name at `font-semibold` and
`updated_at` in a `<time>` at `text-xs text-text-muted`. On the right,
`flex gap-2` holds Reveal/Hide, Copy and Delete. Reveal and Copy take the
bordered secondary treatment; Delete takes the accent-text ghost treatment
already used by `BucketRow`.

The existing `Reveal <key>` / `Hide <key>`, `Copy <key>` and `Delete <key>`
aria-labels are preserved. Tests depend on them.

### The value box

Styled as an input, following the mockup:
`rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] break-all`,
with `tracking-[3px]` applied only when masked.

Row height changes between masked and revealed, since eight mask characters
occupy one short line while a 200 character token wraps to several. That is
inherent and acceptable. It does make `break-all` load-bearing: a long
unbroken value is the most likely way this row escapes the 760px column, and
jsdom cannot see it. Check 4 under "Verification" covers it.

### Empty state

Gets its own CTA, matching what buckets does: an `Add your first secret`
button opening the same dialog.

The text stays exactly **"No secrets yet."** This wording is constrained, not
chosen. `invariants.test.tsx` asserts `findByText(/no secrets yet/i)` in two
places, one of them the byte-limit test. The more natural "No secrets in this
bucket yet" would not match that regex and would pull two security-adjacent
tests into this piece's diff for no reason.

### Unchanged behavior moved onto tokens

The `role="status"` "Loading secrets" line, the page-level refresh Alert, and
the `BUCKET_NOT_FOUND` branch that renders an Alert and no form. That last
one is deliberate and commented in the current source. Its logic is not
touched.

### The light mode pin

`SecretsPage`'s wrapper,
`<div className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">`,
is deleted. This is only correct because the page is fully on theme tokens by
the end of this piece, which check 1 under "Verification" confirms in both
themes.

`KeysPage` keeps its own pin until piece 5.

## Dialogs

### PutSecretForm as a dialog body

Mirrors `CreateBucketForm`, which is the reference implementation from piece
3. It gains:

- `onCancel?: () => void`, with Cancel rendering only when provided
- `onCreated?: (result: { keyName: string; replaced: boolean }) => void`

On success it resets, then calls `onCreated`. The dialog closes on success
only; a failure leaves it open with the inline root Alert.

The form keeps its `replacing` detection and its dynamic
`Add secret` / `Replace secret` button text. The endpoint is an upsert, so
there is no "already exists" error to catch and this button text is the only
silent-clobber guard the flow has.

The dialog title is the static "Add secret" from the mockup. A dynamic title
would require lifting the typed key name out of the form and into the page.
The button is the point of commitment, so the warning earns its place there
instead.

The `replaced` flag exists so the success toast can be accurate about whether
a value was overwritten.

### Delete as a dialog

Mirrors `BucketRow`: titled "Delete secret?", naming the key, with Cancel and
a danger-styled `Delete secret`. It stays open with an inline Alert on
failure.

It calls `remove.reset()` when opening. That was a Minor finding in piece 3's
final review and there is no reason to ship it twice.

This leaves `ConfirmPrompt` used only by `KeyRow`. Piece 5 is the natural
point to convert that and delete the component with its test.

## Toasts

Three, on the state-changing successes: "Secret added", "Secret replaced",
"Secret deleted".

**Tradeoff, not covered by an ADR.** Copy success stays as the existing
adjacent inline "Copied" line rather than becoming a toast. Copy is the
highest-frequency action on this page and its feedback belongs beside the
button that caused it. A14 is read here as permitting toasts for success
confirmations rather than mandating them for every success. Flagged for
review because it is a judgment call.

## Error placement

| Failure | Where | Message |
|---|---|---|
| Reveal fetch | inline in row | "Could not reveal this secret." |
| Copy fetch | inline in row | "Could not reveal this secret." |
| Clipboard denied | inline in row | "Could not copy to the clipboard." |
| Delete | inside the dialog, stays open | server message |
| Form submit | inside the dialog, stays open | server message |

The two fetch paths share one fixed sentence deliberately. SP4 made decrypt
failures a 500 carrying no detail, so a differentiated message here would
turn the error path into a channel it currently is not.

Copy state is therefore five-valued:
`idle | copying | copied | clipboard-failed | fetch-failed`. `idle` renders
nothing; the other four each map to exactly one line of feedback.

## Tests

### Sanctioned changes to existing tests

Enumerated so a reviewer can distinguish them from a test bent to hide a
regression. Every one is caused by the form or delete moving into a dialog.
None weakens an assertion.

- `invariants.test.tsx`, four call sites. Lines 175-177 and 242-247 type into
  the form and must open the dialog first. Lines 178-179 and 302-303 click
  `confirm deleting A` and become dialog-scoped, the way piece 3 rescoped its
  equivalents.
- `SecretRow.test.tsx` and `SecretsPage.test.tsx`: the delete-confirm and
  form-typing tests, for the same two reasons. The plan enumerates each after
  reading both files.
- `access.test.tsx` renders secrets pages at lines 193 and 225. The plan
  checks whether either interacts with the form or delete before any task
  starts. This is the file that surprised piece 3 by breaking from a change to
  a component it does not own.

### One test must not change

`invariants.test.tsx:103-133`, comparing a 2 character secret's mask against
a 200 character one, stays byte-identical. It is the canary for the mockup's
length-leaking mask. A diff touching it is a signal that something went
wrong.

### New tests

Auto-mask:

- re-masks 30 seconds after the value appears
- the cache survives it, proven by a re-reveal firing zero new requests
- a manual hide followed by a re-reveal gets a full fresh window, which
  proves the timer restarts rather than a stale one firing early

Copy without revealing:

- one single-key request on a never-revealed row, row still masked afterwards
- the plaintext absent from the whole container's text on that path, not
  merely from the row
- zero additional requests when the row was already revealed
- the fixed sentence on a fetch failure, row still masked
- Copy disabled while in flight

Plus the three toasts, and that each dialog closes on success only.

### A testing note the plan must carry

Auto-mask tests need `vi.useFakeTimers()` and
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. Without the
second half, `userEvent` waits on timers a fake clock never advances and the
test hangs rather than failing.

## Verification

Every piece in this initiative has shipped at least one defect that passing
jsdom tests could not see: ToggleSwitch's knob overflow, the login grid
scramble, the Modal versus sticky-header z-index conflict, and piece 3's pin
relocation silently dropping padding alongside a toast rendering behind a
modal backdrop. `web/vite.config.ts` sets `test: { css: false }` and jsdom
performs no layout regardless, so this is structural rather than bad luck.
Browser verification is scoped work here, not a footnote.

Playwright installs to the scratchpad with `--no-save`, never into `web/`.
`git status` must show zero diff on `web/package.json` and
`web/pnpm-lock.yaml` afterwards.

Eight checks:

1. Light and dark at 1280px: no white box survives the pin deletion, and the
   value box's border and background are visible in both themes.
2. The Add secret dialog paints above the sticky header, re-verifying piece
   3's `z-50` fix on this page's flow.
3. The toast paints above the dialog and is readable in dark, same for
   `z-[60]`.
4. A 200 character unbroken value stays inside the 760px column and causes no
   horizontal page scroll.
5. At roughly 380px wide, the top line wraps without the action buttons
   overlapping the key name.
6. Auto-mask visibly re-masks and the row is not left misaligned across the
   transition. Driven with Playwright's `page.clock.fastForward` rather than a
   real 30 second wait. `page.clock.install()` must run before the navigation
   it applies to.
7. The delete dialog in dark mode with an error Alert rendered: contrast is
   readable.
8. Copy without revealing, as a security property: click Copy on a masked
   row, then assert `document.body.innerText` contains no substring of the
   plaintext while `navigator.clipboard.readText()` returns it in full. This
   needs `context.grantPermissions(["clipboard-read", "clipboard-write"])`,
   otherwise the read fails for an environmental reason that looks like a
   product bug.

Check 4 is the one most likely to find something. Check 8 is the one that
only a real browser makes convincing.

## Out of scope

- Secret versioning and history. Out for v1 per CLAUDE.md.
- Extracting a shared `Button` component. Buttons are inline Tailwind
  repeated across three pages now. Piece 5 is the point to do that once with
  full information, rather than refactoring adjacent code opportunistically
  here.
- Converting `KeyRow`'s `ConfirmPrompt` and deleting that component. Piece 5.

## Risks

- **Deleting the pin is the irreversible-feeling step.** If the page turns
  out not to be fully tokenized, dark mode breaks visibly. Check 1 exists for
  this, and the pin deletion belongs in the same commit as the reskin so a
  revert takes both.
- **The copy-without-reveal path is new surface handling plaintext.** It is
  the first code in this app that fetches a secret value without displaying
  it. Check 8 and the DOM-absence unit test both guard it, deliberately from
  two different angles.
- **`access.test.tsx` broke unexpectedly in piece 3.** Checked before task
  one this time rather than discovered during it.
