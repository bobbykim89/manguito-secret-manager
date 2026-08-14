# The buckets pages, design

Date: 2026-08-14
Status: Approved, ready for planning
Depends on: the UI modernization foundation (merged, PR #15), the login
page and app shell (merged, PR #16)

## Purpose

The third of five UI modernization pieces. The foundation shipped theme
tokens, `Modal`, and a toast system; the login and shell piece made the
theme visible and wired the first toggle. This piece reskins the buckets
list onto a card grid, and is the first place `Modal` and the toast system
get real consumers.

It also relocates the light mode pin that has been protecting the
unreskinned pages, and it is the first piece to treat real browser
verification as a deliverable rather than a closing formality. Both are
explained below.

## Why browser verification is scoped work here

The day the login and shell piece merged, the theme toggle was found to be
visually broken in the running app: `ToggleSwitch`'s knob had a `top`
anchor but no `left` anchor, so its pre-translate position resolved near
the track's right edge, and the checked state's translate pushed it 18px
past the track entirely, colliding with the adjacent email text.

That component shipped in the foundation piece. It passed its task review,
the whole branch review, and every one of the 265 tests, and stayed broken
through two merged pull requests. Nothing in the process could have caught
it: `web/vite.config.ts` sets `test: { css: false }`, and jsdom performs no
layout regardless, so a Tailwind class list is only ever a string in the
test environment. It took a person opening the app.

`Modal` and the toast system are in exactly that state right now. Both were
built in the foundation piece, reviewed, tested, and never rendered in a
browser. This piece gives both their first real consumer, so the browser
pass is scoped work with named checks, listed under Verification below.

## Scope

### In scope

- Rebuild `BucketsPage`, `BucketRow`, and `CreateBucketForm`.
- Move bucket creation into `Modal`; move delete confirmation into `Modal`.
- First real `useToast()` call sites.
- Relocate the light mode pin out of `AppShell`'s `<main>` and into the
  three pages that still need it.
- A named browser verification pass, with screenshots in the pull request.

### Explicitly out of scope

- **Reskinning secrets or API keys.** Those are the two remaining pieces.
  They keep rendering as they do today, on their own light pins.
- **A shared `ConfirmDialog` component.** The delete confirmation is
  composed from `Modal` directly in `BucketRow`. Secrets and API keys will
  likely want the same shape, and extracting against two real consumers
  beats designing an interface against one. `ConfirmPrompt` stays untouched
  and still serves `SecretRow` and `KeyRow`.
- **Switching disabled controls to `aria-disabled`.** See The cards below.
- **Any change to `useBuckets.ts`.** The data layer already returns exactly
  what the cards render.

## Shell changes

`AppShell`'s `<main>` currently carries `mx-auto max-w-2xl bg-white p-8
text-slate-900`: a width constraint and the light mode pin. It keeps
`flex-1` and vertical padding only.

**Width moves to the pages.** The mockup's buckets section is 960px, and
`max-w-2xl` is 672px, which fits two grid columns instead of three. Each
page now sets its own maximum width, so the buckets grid can be wide
without widening pages nobody has reskinned yet.

**The pin moves to the two pages that need it.** `SecretsPage` and
`KeysPage` each wrap their content in a `bg-white text-slate-900` container
and delete it when their own piece reskins them.

This is bookkeeping made honest. One file currently protects pages it does
not own, which is easy to forget; afterwards each unreskinned page visibly
carries its own pin, and removing it becomes a concrete line item in that
page's piece.

Accepted cost: three files outside `features/buckets/` change, each by one
wrapper element. The alternative is an override inside `<main>` that the
buckets page then overrides again, and the pin has to move eventually
regardless.

### A pre-existing dark mode bug outside the shell

Writing this spec surfaced something the pin never covered. `/health` and
`*` are top level routes, siblings of `AppShell` rather than children, so
they render directly on the themed `body` and were never behind the pin at
all. `RequireSession`'s pending and error states render outside it too.

One of them is already broken, and has been since the login and shell piece
restored the `body` rule. `HealthPage`'s error box is `bg-red-50` with no
text colour, so its contents inherit `--color-text`, which is `#f1eee6` in
dark mode: near white text on a light red panel. That is the same defect
class as the invisible API key token the pin exists to prevent, in a place
the pin could never have reached.

`NotFound` is fine, being plain text on a themed background.
`RequireSession`'s two states use `text-slate-500` and `text-slate-600`,
which are legible in dark mode but poorly contrasted.

**In scope for this piece**, because it is four one line changes in the
same defect family this piece is already reasoning about, and the browser
pass covers these screens anyway:

- `HealthPage`'s error box gets an explicit text colour, exactly as
  `Alert`'s banners did in the previous piece.
- The hardcoded `text-slate-500` and `text-slate-600` in `HealthPage` and
  `RequireSession` become the theme's own `text-text-muted`.

These files get no other treatment. They are not being reskinned; they are
being made readable in a theme that already shipped.

## The list

A `max-w-[960px]` column holding a header row and a grid.

The header row is the `h1` and a primary "+ New bucket" button, spaced
apart. The grid is `repeat(auto-fill, minmax(230px, 1fr))`.

**The empty state gets its own call to action**, not the current "No
buckets yet. Create one above." line, which is doubly wrong now: nothing
sits above the list, and a first run user would have to find the header
button. SP6 originally chose an always visible form for exactly this
reason. A short line plus its own prominent "Create your first bucket"
button, opening the same dialog, answers that concern without returning to
an always visible form.

Loading and error states keep their current behavior, including showing a
cached list alongside a refresh failure rather than replacing it.

## The cards

Each bucket is a card: `bg-surface`, `rounded-sm`, `shadow-sm`, and
`hover:shadow-md`. It holds four things, matching the mockup:

| Element | Content | Styling |
|---|---|---|
| Kicker | "Bucket" | 10px, uppercase, `tracking-[0.1em]`, accent |
| Title | `bucket.name` | `h3`, 17px, tight leading, Inter |
| Meta | `2 secrets · Aug 11, 2026` | 13px, 80% opacity, date in `<time>` |
| Footer | "View →" and Delete | 11px, spaced apart |

The API returns `secret_count` and `created_at`, so the meta line is built
from those. There is no `updated_at` on a bucket.

### The card is clickable without nested interactive elements

The mockup makes the whole card a `div` with an `onClick` and nests the
Delete button inside it. Copied literally that ships a primary navigation
control that is not keyboard reachable and is announced as nothing, plus
ambiguous click targets where a button sits inside a clickable region.

Instead: the card is `relative`, the name is a real `<Link>` whose `::after`
is `absolute inset-0` and covers the card, and the Delete button is
`relative` so it paints above that overlay and stays independently
clickable. The whole card is clickable, exactly one link is in the
accessibility tree, and keyboard navigation works.

"View →" is `aria-hidden`. It is a visual affordance, and the link already
announces its destination, so exposing it would make a screen reader read
the destination twice.

### Two deliberate departures on the disabled Delete button

A bucket holding secrets cannot be deleted.

**The mockup explains this with a `title` tooltip on the disabled button.
This spec does not.** Disabled elements do not reliably fire the hover
events tooltips depend on, and `title` is invisible to keyboard and touch
users regardless. The current visible "Still holds secrets" note stays,
restyled for the card. The meta line directly above it already reads
"2 secrets", so the reason is legible with no hover at all.

**The button keeps the `disabled` attribute rather than moving to
`aria-disabled`.** Keeping it focusable and announcing the reason is the
more thorough answer, but it changes real behavior and the existing tests
assert `toBeDisabled()`. That belongs in its own deliberate change, not
smuggled into a reskin.

## The dialogs

Three pieces of local `useState`: `BucketsPage` owns whether the create
dialog is open, and each `BucketRow` owns whether its own delete dialog is,
the same way it owns its confirm flag today.

**Create.** `CreateBucketForm` stays a component and keeps React Hook Form,
the Zod `bucketNameSchema`, and the `BUCKET_EXISTS` handling that puts the
server's answer on the field rather than in a banner. It gains `onCreated`
and `onCancel` props, so the form owns submission and the page owns the
dialog. Rendered inside `<Modal title="New bucket">` with Cancel and
"Create bucket".

**Delete.** `BucketRow` opens `<Modal title="Delete bucket?">` naming the
bucket, with Cancel and a danger styled "Delete bucket".

**Toasts** fire on success only: "Bucket *name* created" and
"Bucket *name* deleted".

### Both dialogs close only on success

A failed create shows its error on the field inside the still open dialog.
A failed delete shows its error inside the still open dialog, rather than
in the card's current inline `Alert`.

Closing a dialog and surfacing the failure behind it would be the worst of
both patterns, and ADR 003's rule that errors surface where the thing that
failed is points the same way. Toasts remain success only; nothing here
moves an error onto one.

### A known rough edge, deliberately not pre-solved

On a successful delete the dialog closes and the card unmounts, so
`Modal`'s focus restore targets a detached node and focus falls to
`<body>`. The standard fix is giving the page heading `tabIndex={-1}` and
focusing it.

This spec does not build that yet. The behavior is on the verification list
below; confirming what actually happens in a browser is cheap, and building
machinery for an unconfirmed problem is how the invented palette got
shipped two pieces ago.

## Verification

### Automated

Vitest, React Testing Library, MSW at the fetch boundary, behavior not
classes.

**The existing buckets suites will legitimately need changes**, unlike the
last two pieces where a test break signalled a defect. Moving creation into
a dialog means a test that renders `BucketsPage` and types into a name
field must now open the dialog first. That is a real behavior change the
tests correctly encoded, so updating them is correct. The implementation
plan must name exactly which changes are sanctioned, so a reviewer can tell
them apart from a test bent to hide a regression.

New coverage:

- Opening and cancelling the create dialog.
- A successful create closes the dialog and fires a toast.
- A failed create keeps the dialog open with the error on the field.
- The delete dialog confirms and cancels.
- The empty state's button opens the same dialog as the header's.

### In a browser

Playwright installed into the scratchpad rather than the repository, so no
dependency is added. `page.route()` fakes the authenticated API responses;
`getComputedStyle` and bounding boxes answer anything geometric. Each check
below is here because jsdom provably cannot answer it.

1. **`Modal` over the sticky header.** The header is `z-10` in a root that
   establishes no stacking context, and the modal backdrop is `fixed` with
   no `z-index`. The login and shell piece's final review flagged this as a
   latent conflict that would surface at `Modal`'s first real consumer,
   which is this piece. The expectation is that the header paints over the
   backdrop; if so, a `z-index` on the backdrop is in scope here.
2. **The toast viewport against an open dialog.** Does a toast render above
   or behind it, and does a toast fired as a dialog closes appear at all?
3. **The stretched link overlay.** Does the `::after` cover the card, and
   does the Delete button stay clickable through it?
4. **The grid.** Three columns at 960px, and a sane collapse at narrow
   widths.
5. **Focus after a successful delete**, per the rough edge above.
6. **Every screen in both themes**: buckets, secrets, API keys, health, and
   not found. This confirms the relocated pins keep secrets and API keys
   rendering correctly, and that the outside the shell fix actually makes
   `/health`'s error box readable.

Screenshots go in the pull request.

## Acceptance criteria

1. `AppShell`'s `<main>` no longer sets a maximum width or the light pin.
2. `SecretsPage` and `KeysPage` each carry their own light pin.
2b. `HealthPage`'s error box carries an explicit text colour, and the
   hardcoded slate text in `HealthPage` and `RequireSession` uses
   `text-text-muted`.
3. `BucketsPage` is a 960px column with a header row and an
   `auto-fill, minmax(230px, 1fr)` grid.
4. The empty state has its own button opening the create dialog.
5. Each card renders the kicker, name, meta line with a `<time>`, "View →",
   and Delete.
6. The card is fully clickable through a stretched `::after` on the name's
   `<Link>`, with exactly one link in the accessibility tree and the Delete
   button independently clickable.
7. "View →" is `aria-hidden`. No `title` tooltip carries load bearing
   information.
8. Creation happens in `<Modal title="New bucket">`; `BUCKET_EXISTS` still
   lands on the field.
9. Deletion happens in `<Modal title="Delete bucket?">`; `ConfirmPrompt` is
   unchanged and still used by `SecretRow` and `KeyRow`.
10. Both dialogs close on success only, and show failures inside
    themselves.
11. Success toasts fire for create and delete. No error is routed to a
    toast.
12. Every browser check above is performed and reported, with screenshots
    in the pull request.
13. No new npm dependency. No backend change. `make types` produces no
    diff.
14. `make lint` and `make test` pass.

## Risks

**The pin relocation touches files this piece does not otherwise own.**
Each change is one wrapper element, but a mistake in either of them makes
an unreskinned page unreadable in dark mode, and both display secret
material. The browser pass over every screen in both themes is the check
that closes this.

**The outside the shell fix is a second, independent thing shipping in the
same piece.** It is small and clearly correct, but it is scope this piece
took on after finding the bug rather than scope it was given. Keeping it
separate in review, as its own commit, is what stops it from being read as
part of the buckets reskin.

**`Modal`'s first real use may surface more than the known z-index
issue.** It has a focus trap, a portal, an Escape handler, and a backdrop
click handler, none of which has ever run in a browser. The z-index
conflict is the one already predicted; there may be others, and finding
them is part of this piece's job rather than a surprise.

**The card grid at narrow widths is untested design.** The mockup is
desktop only. `auto-fill` degrades sensibly in principle, but the
narrow-width result is this spec's invention, as the login split's mobile
behavior was.

## Deferred

To the secrets piece: reskinning `SecretsPage`, `SecretRow`, and
`PutSecretForm`, deleting that page's pin, and the auto mask after timeout
gap that ADR 003 requires but `SecretRow` never implemented.

To the API keys piece: reskinning `KeysPage`, `KeyRow`, `CreateKeyForm`,
and `NewKeyPanel`, deleting that page's pin, and replacing the capability
checkboxes with `ToggleSwitch`.

A shared `ConfirmDialog`, once two real consumers exist to design it
against.

Per key rate limiting, the last post v1 hardening piece, remains unstarted.
