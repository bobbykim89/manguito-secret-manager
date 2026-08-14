# API keys page: UI modernization, piece 5 of 5

**Status:** approved
**Date:** 2026-08-14
**Scope:** `web/src/features/api-keys/`, plus `web/src/features/shell/AppShell.tsx`
and the deletion of `web/src/components/ConfirmPrompt.tsx`

Pieces 1 (foundation), 2 (login and shell), 3 (buckets) and 4 (secrets) are
merged as PRs #15, #16, #17 and #18. This is the last piece. When it lands, the
light mode pin pattern is gone and every page in the application is on the
theme tokens.

## What this piece owns

- `web/src/features/api-keys/KeysPage.tsx`
- `web/src/features/api-keys/KeyRow.tsx`
- `web/src/features/api-keys/CreateKeyForm.tsx`, renamed to `CreateKeyFlow.tsx`
- `web/src/features/api-keys/NewKeyPanel.tsx`
- `web/src/features/shell/AppShell.tsx`, one narrow viewport fix, its own commit
- `web/src/components/ConfirmPrompt.tsx` and its test, both deleted

`useApiKeys.ts` and `apiKeyForm.ts` need no changes. The data layer,
`keyStatus`, the `gcTime: 0` on the create mutation, and the Zod schema are all
correct as they stand.

## The mockup does not cover the important screen

The mockup is the source for the list, the cards and the create dialog. It has
no show once token flow at all: it never displays a token anywhere, and its
"Key created" toast is the whole success feedback because there is nothing else
to show.

So `NewKeyPanel`, the one screen in this application that displays a live
credential on purpose, has no mockup reference. It gets reskinned by extending
the vocabulary the other four pieces established, not by copying anything.

This also means the mockup's "Key created" toast is not evidence about whether
this application should toast on create. See "Toasts".

## Renaming CreateKeyForm to CreateKeyFlow

The token lives in the create mutation's `data` and nowhere else, which ADR 003
A12 states explicitly. So the component that owns that mutation has to outlive
the dialog: if it unmounted when the dialog closed, the token would die with
it.

`CreateKeyFlow` therefore renders a `Modal` containing the form **and**,
separately, `NewKeyPanel` once a token exists. That is a flow rather than a
form. The current name was already slightly inaccurate, since the component
already owns the mutation and already swaps itself out for the panel; putting
the form inside a dialog makes the mismatch worse. The rename costs a file
rename, a test file rename, and one import in `KeysPage`.

**Rejected:** lifting the created key into a `useState` on `KeysPage`. That
would make A12's wording false, and it would trade a defined, audited lifecycle
(`gcTime: 0` plus `reset()` on acknowledgement) for whatever lifecycle a page
component happens to have. Structural convenience is not worth weakening a
statement about the only live credential this UI displays.

## Layout

Values from the mockup, expressed with tokens already in `index.css`.

The page section is
`mx-auto flex w-full max-w-[820px] flex-col gap-6 px-6 py-8`. The 820px is the
mockup's own width for this page, between buckets at 960px and secrets at
760px.

`px-6 py-8` is load-bearing for the third time. Since piece 3, `<main>` is a
pure passthrough with no padding of its own, so a page omitting its own spacing
renders flush against the viewport edge. Piece 3's final review caught exactly
that.

The header row is `flex flex-wrap items-center justify-between gap-4`: the
heading, then a `+ New key` primary button. The `h1` and primary button class
lists are copied verbatim from `BucketsPage` rather than approximated.

### The cards

A third distinct treatment, and that is the mockup's intent rather than drift.
Buckets are a grid of column oriented cards. Secrets are a divider list. Keys
are a vertical stack (`flex flex-col gap-3`) of row oriented cards.

Each card is
`flex flex-row items-center justify-between gap-4 rounded-sm bg-surface p-3 shadow-sm`
and keeps its `aria-label={apiKey.name}`, which existing
`getByRole("listitem", { name })` queries depend on. No hover shadow and no
stretched link: unlike a bucket card there is nothing to navigate to.

The left column is `flex min-w-0 flex-col gap-1.5`.

**`min-w-0` is load-bearing.** Without it a long key name or a row of bucket
tags cannot shrink, and it shoves the Revoke button out past the card's edge.
This is flexbox behaviour jsdom cannot observe at all. Checks 5 and 6 under
"Verification" cover it.

Inside the left column, three lines:

1. `flex flex-wrap items-center gap-2`: the name at
   `font-sans text-[17px] leading-tight`, then `msm_<lookup_id>` at
   `text-xs text-text-muted`, then the status tag.
2. `flex flex-wrap gap-1.5`: one neutral tag per bucket, then the capability
   tags.
3. `text-xs text-text-muted`: the last used line.

The Revoke button is `shrink-0` and renders only when the status is active.
Revoking an already dead key changes nothing the user can see, which is why the
current code does not offer it either. It takes the bordered secondary
treatment the mockup specifies, not a danger treatment: it only opens a
confirmation.

### Tags

Base:
`inline-flex items-center text-[11px] tracking-[0.02em] px-2.5 py-[3px] rounded-[12px]`.
That radius is `--radius-md * 0.75`, which is what the design system's CSS
computes.

| Variant | Classes | Used for |
|---|---|---|
| neutral | `bg-neutral-100 text-neutral-800` | each bucket, and Revoked |
| accent | `bg-accent-100 text-accent-800` | Write |
| accent-2 | `bg-accent-2-100 text-accent-2-800` | Bulk reveal, and Active |
| outline | `border border-accent text-accent` | Expired |

Status mapping, from the mockup: active takes accent-2, expired takes outline,
revoked takes neutral.

**A constraint that must be recorded where the tags are defined.** The
`[data-theme="dark"]` block in `index.css` redefines only the **100 and 800**
steps of each ramp. Steps 200 through 700 and 900 have light mode values only.
A tag palette using any other step would render a light chip on a dark page,
which is the same defect that bit `Alert` in piece 4. The four variants above
stay inside 100/800 deliberately, and that reason belongs in a comment rather
than in tribal knowledge.

These utilities are already proven: `LoginPage.tsx` ships `bg-accent-100` and
`bg-accent-2-100` on main today, so the Tailwind naming resolves and no
arbitrary value fallback is needed.

### Dropping the row dimming

`KeyRow` currently applies `opacity-60` to any non active row. With a real
status tag carrying that meaning, dimming 11px and 12px muted text to 60% is a
contrast risk for no communicative gain, and the mockup does not do it. The
status tag does the work instead.

### Empty states, and a three state gate

The keys empty state keeps the text **"No API keys yet."** verbatim.
`KeysPage.test.tsx` matches `/no api keys yet/i` in two places, and rewording
would break them for no reason. It gains a `Create your first key` CTA button,
matching buckets and secrets.

The "a key has to be scoped to at least one bucket, create a bucket first"
guidance moves out of the form and onto the page, and the create affordance is
not offered when there are no buckets. Nobody should open a dialog to be told
no.

**Moving that guidance means inheriting a distinction the current code makes
deliberately, and it is easy to get wrong.** `useBuckets` returns `undefined`
while pending, so there are three states, not two:

| `buckets` state | guidance | create affordance |
|---|---|---|
| pending (`data === undefined`) | hidden | hidden |
| loaded and empty | shown | hidden |
| loaded and non empty | hidden | shown |

The trap is gating the guidance on the negation of "can create", which is also
true while pending. That would tell an account with plenty of buckets that it
has none, for as long as the request is in flight. `KeysPage.tsx` currently
avoids this by gating on `buckets.data &&` with a comment saying exactly why,
and `KeysPage.test.tsx:74-95` is the test that enforces it: it holds the
buckets request on an unresolved promise and asserts the "create a bucket" link
is absent in that window. That test stays untouched and keeps guarding the
behaviour after the guidance moves.

So the page computes one condition and both triggers use it:

```tsx
const canCreate =
  buckets.data !== undefined && buckets.data.length > 0 && !tokenPending;
```

and the guidance renders on `buckets.data !== undefined && buckets.data.length === 0`.

Both the header `+ New key` and the empty state's `Create your first key` are
gated on `canCreate`. Gating only the header would leave the empty state's CTA
able to open a dialog in exactly the situation the header button was hidden to
prevent.

## The create flow

`KeysPage` holds two booleans and nothing else about creation:

```tsx
<CreateKeyFlow
  buckets={buckets.data}
  open={creating}
  onClose={() => setCreating(false)}
  onCreated={() => { setCreating(false); setTokenPending(true); }}
  onAcknowledged={() => setTokenPending(false)}
/>
```

Inside, `Modal open={open && !create.data}` wraps the form, and the panel
renders separately once `create.data` exists.

### Why a boolean crosses the boundary

Today `CreateKeyForm` replaces itself with the panel, and its comment states
the reason: "a second submit is impossible while a token is still unsaved."
That guarantee matters, because creating a second key while the first token is
unacknowledged loses a credential permanently.

Once the trigger button lives in the page header and the panel lives below it,
nothing prevents that unless the page knows a token is pending. So
`tokenPending` crosses the boundary and `+ New key` is hidden while a token is
unacknowledged. The token itself never crosses, so A12 stays exactly true.

The `!create.data` in the Modal's own `open` condition is deliberate belt and
braces on top of that. It keeps "no dialog over an unacknowledged token"
enforced inside the component that owns the token, rather than depending on the
page maintaining its mirror boolean correctly.

### Form body

Field order and copy follow the mockup: Name, `Buckets this key can reach`,
`Capabilities`, `Expires`, then Cancel and `Create key`.

The form keeps its `aria-label="Create an API key"`.

Buckets stay **native checkboxes**, which is what the mockup does and is right.
The accessible name comes from the label text, so
`getByRole("checkbox", { name: "prod" })` keeps working unchanged.

The Capabilities block keeps its helper sentence verbatim: "Any key can read
secrets in these buckets one at a time. The options below grant more than
that." It is load bearing, and the code comment explaining why stays with it:
`may_reveal` gates only the bulk path, so a key with neither flag can still
read values one at a time, and saying so is the difference between the form
describing the grant and lying about it.

### The capability toggles

The two capability flags become `ToggleSwitch`, its second real consumer after
the theme toggle. Each row is `flex items-start gap-2.5`: the switch, then a
title at `text-sm` and a description at `text-xs text-text-muted`.

`ToggleSwitch` renders a `<button role="switch">` rather than a native input,
so `register()` cannot bind it. `canWrite` and `canReveal` get React Hook
Form's `Controller`, which is the documented way to wrap a controlled component
and keeps `defaultValues`, validation and `reset()` working. `react-hook-form`
is already a dependency, so no new package.

`ToggleSwitch` renders no visible text of its own by design; its `label` prop
supplies the accessible name, and a caller wanting visible text wraps it. The
visible title beside each switch is that wrapper.

## Revoke

Moves into a `Modal`, mirroring buckets and secrets: titled `Revoke key?`, body
naming the key, Cancel plus a danger styled `Revoke key`. It stays open with an
inline Alert on failure, and calls `revoke.reset()` when opening so a previous
failure's message does not greet the next attempt. That last point was a Minor
finding in piece 3's final review; there is no reason to ship it a third time.

The body says the key will stop working immediately rather than that it will be
deleted, because the row stays and is marked Revoked.

This leaves `ConfirmPrompt` with no consumers. It and its test are deleted.

## Toasts

Revoke fires `Key <name> revoked`, matching the delete precedent from buckets
and secrets.

**Create fires no toast.** The token panel is already an unmissable success
confirmation, and its actual message is "save this now or lose it". A toast
saying "Key created" competes with that for attention while adding nothing.

The mockup does toast on create, but the mockup has no token panel at all, so
it is not evidence either way. A14 is read as permitting success toasts rather
than mandating them everywhere, the same reading piece 4 applied when it kept
copy feedback inline.

## NewKeyPanel

Four hardcoded light mode only colour pairs live here today, invisible because
the pin has been hiding them:

- `bg-slate-100` on the token box
- `bg-slate-900 text-white` on the acknowledge button
- `text-slate-600` on the copy notice
- `border-amber-300 bg-amber-50` on the navigation blocker callout

All four are tokenized. The panel becomes
`rounded-md border border-border bg-surface p-4`. The token box takes `bg-bg`
with a border so it reads as a nested field inside the panel. The buttons take
the same secondary and primary treatments the dialogs use.

The blocker callout has no amber token available, so it becomes
`border-accent bg-accent-100`, which reads as a warm warning in both themes and
stays inside the 100/800 rule. The `Alert tone="warning"` nested inside it
inherits piece 4's dark mode contrast fix for free.

Everything else about this component is unchanged and deliberately so. The
token is shown in full, which is the opposite of `SecretRow` and correct: a
secret can be revealed again tomorrow, this cannot. `useBlocker(true)` and the
`beforeunload` listener stay armed by the component's own existence rather than
by a flag, so they cannot drift out of step with what is on screen. The
`aria-label={`Token for ${name}`}` stays.

## The AppShell narrow viewport fix

The header overflows horizontally at roughly 380px: `scrollWidth` 488 against
`clientWidth` 380, with `Sign out` fully clipped. Found during piece 4's
browser verification and traced to the header nav row. It is pre-existing from
piece 2 and was deliberately left alone in piece 4, since `AppShell` was not in
that piece's scope.

It is fixed here, in its own commit, for one reason: this is the last UI piece,
so "a later piece will get it" is no longer available. Ending a five piece
modernization with a known broken viewport is worse than a slightly wider diff.

The fix adds `flex-wrap` and a row gap to the header, and `min-w-0 truncate` to
the email so it shrinks rather than shoving. Truncating beats hiding: which
account you are signed in as is useful information in a secret manager. The
exact shape is confirmed in the browser at 380px, which is what check 4 is for.

Because this is a shared component on every page, check 4 includes a 1280px
regression pass over all three list pages, not merely proof that 380px
improved.

## Tests

### Sanctioned changes to existing tests

Enumerated so a reviewer can distinguish them from a test bent to hide a
regression.

- `CreateKeyForm.test.tsx` renames to `CreateKeyFlow.test.tsx`. Tests that
  drive the form open the dialog first. Three capability queries change role
  from `checkbox` to `switch`, at lines 57, 131 and 132 of the current file.
  The bucket checkbox queries at lines 56, 100, 162, 197 and 221 are untouched,
  because buckets stay native checkboxes. The empty buckets test migrates to
  `KeysPage.test.tsx`. The copy precision test asserting the label reads "Bulk
  reveal" and specifically not "Reveal secrets" keeps its intent and only
  changes role.
- `KeyRow.test.tsx`: the revoke confirm tests rescope to `within(dialog)`, the
  same way pieces 3 and 4 rescoped theirs. The test named for a row located
  error gets renamed, since the error now lives in the dialog.
- `KeysPage.test.tsx`: gains the migrated empty buckets test and tests for
  opening the dialog from the header and from the empty state. The two
  `/no api keys yet/i` assertions are untouched, which is why the wording is
  fixed. The pending buckets test at lines 74-95 is untouched and is the guard
  on the three state gate described under "Empty states".
- `ConfirmPrompt.test.tsx` is deleted with its component.
- `NewKeyPanel.test.tsx` is expected to be unaffected: it renders the panel
  directly and asserts behaviour, not classes. The plan verifies this rather
  than assuming it.
- `routes/access.test.tsx` is unaffected. Its three keys tests assert only a
  heading and a pathname. Checked before task one, the same pre-flight piece 4
  ran after piece 3 was surprised by this file.

### The security assertions do not change

`api-keys/invariants.test.tsx` holds seven tests. Its `createAKey()` helper
gains a dialog opening click, because the form now lives behind one. **All
seven assertions stay identical:** `localStorage` and `sessionStorage` empty
after a create, the token absent from the URL, no request URL containing
`msm_`, the blocker blocking a navigation, the blocker releasing after
acknowledgement, `beforeunload` arming and disarming with the panel, and the
token gone from the page once acknowledged.

Exactly one assertion changes semantically. The last line of "removes the token
from the page for good" currently asserts the `create key` submit button
returns, which no longer exists on the page once the form is in a dialog. It
becomes an assertion that the `+ New key` affordance returns. The intent is
preserved exactly: what comes back is the create affordance, not the panel.

### New tests

- Opening the create dialog from the header and from the empty state.
- The dialog closing on success and the panel appearing.
- The dialog staying open on a failed create, with the error inline.
- `+ New key` hidden while a token is unacknowledged, and back after it.
- Cancel writing nothing.
- The revoke dialog: cancel writes nothing, confirm revokes, a failure keeps
  the dialog open with the message, and success fires the toast.
- Each capability toggle reaching the request as `can_write` / `can_reveal`,
  driven through `role="switch"`.

## Verification

Every piece in this initiative has shipped at least one defect that passing
jsdom tests could not see: `ToggleSwitch`'s knob overflowing its track, the
login grid scrambling, the `Modal` backdrop painting under the sticky header,
piece 3's pin relocation silently dropping padding, a toast rendering behind a
modal, and piece 4's `Alert` failing WCAG AA in dark mode. `web/vite.config.ts`
sets `test: { css: false }` and jsdom performs no layout regardless, so this is
structural rather than bad luck.

Playwright installs to the scratchpad with `--no-save`, never into `web/`.
`git status` must show zero diff on `web/package.json` and
`web/pnpm-lock.yaml` afterwards. Screenshots are read directly, not summarized
by the script that took them.

Eight checks:

1. All four tag variants readable in light and dark at 1280px. The direct test
   of the 100/800 only constraint.
2. `NewKeyPanel` in dark mode: panel, token box, warning Alert and blocker
   callout all readable. Four hardcoded colour pairs are being replaced here,
   on the credential screen.
3. The create dialog at 1280px: both `ToggleSwitch`es render with the knob
   inside the track, and a dialog carrying several buckets plus capabilities
   plus expiry does not overflow the viewport. `Modal` centres its content, so
   a tall body is a real risk, and this is `ToggleSwitch`'s first use outside
   the header.
4. `AppShell` at 380px: no horizontal page scroll and `Sign out` reachable,
   plus a 1280px regression pass across buckets, secrets and keys.
5. A key card at 380px: tags wrap and Revoke stays inside the card.
6. A key with six buckets and both capabilities at 1280px: tags wrap inside the
   card without pushing Revoke out.
7. The revoke dialog in dark mode with an error Alert rendered.
8. A long token in the panel: `break-all` keeps it inside its box with no
   horizontal scroll.

Check 3 is where a surprise is most likely.

## ADR 003 amendment A17

A16 is currently the highest. A17 records the end state of this initiative:

- The light mode pin pattern is retired. All five pages are on theme tokens,
  and `grep -rn "bg-white\|bg-slate\|text-slate" web/src/features/` returns
  nothing.
- `ConfirmPrompt` is gone. Every confirmation in the application is a `Modal`.
- Only the 100 and 800 steps of each colour ramp have dark mode values. Using
  any other step is a dark mode bug.
- `ToggleSwitch` has a second consumer, which is what A5 and A9's long argument
  about a first consumer was ultimately about.
- Why `tokenPending` crosses the `CreateKeyFlow` boundary while the token does
  not, so A12's claim stays literally true.
- Key creation deliberately fires no toast.

## Out of scope

- Secret versioning and history, zero knowledge buckets, the command palette.
  Out for v1 per CLAUDE.md.
- Per key rate limiting. Separate hardening work with its own unresolved design
  question about shared state under `min_machines_running = 0`.
- Extracting a shared `Button` component. Buttons are inline Tailwind repeated
  across four pages now. It was deferred in piece 4 on the grounds that piece 5
  would have full information, and it does: the repetition is real but the
  class lists are short, the variants are stable at three, and pulling them
  into a component now would touch every page in the last piece of the
  initiative for no behavioural gain. Better as its own bounded change with its
  own review.

## Risks

- **The pin deletion is the irreversible feeling step**, and this time it is the
  last one, on the page holding the credential screen. Checks 1 and 2 exist for
  this. The pin deletion belongs in the same commit as the reskin so a revert
  takes both.
- **`AppShell` is shared.** Its fix is the only change in this piece that can
  break a page this piece does not own. Hence its own commit and the 1280px
  regression pass.
- **`ToggleSwitch`'s second consumer is its first outside the header.** The knob
  overflow bug piece 1 shipped was invisible to 265 passing tests and was found
  by a human using the application. Check 3 is the countermeasure.
- **The rename touches a test file name.** A rename plus content edits in one
  commit can obscure what actually changed. The plan keeps the rename and the
  content changes legible, and the reviewer is pointed at that specifically.
