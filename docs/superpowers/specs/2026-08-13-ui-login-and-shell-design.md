# The login page and app shell, design

Date: 2026-08-13
Status: Approved, ready for planning
Depends on: the UI modernization foundation (merged, PR #15)

## Purpose

The foundation piece shipped theme tokens, dark mode, `ToggleSwitch`,
`Modal`, a toast system, and page-transition keyframes. All of it is
inert: nothing consumes any of it and no page renders differently. This
piece is the one that makes it visible, reskinning the login page and the
app shell and wiring up the theme toggle and view transitions.

It also corrects a real error in the foundation. See below.

## The foundation shipped an invented palette

When the foundation's plan was written, the mockup's design-system files
(`styles.css`, `_ds_bundle.js`) had been identified but never read. The
plan filled the gap with plausible indigo and slate values rather than the
real ones, and nothing downstream caught it, because invented tokens are
indistinguishable from correct tokens once they compile.

The mockup is built on a design system named Organic, whose palette is
warm terracotta and olive, keyed to the Manguito lovebird logo:

| Token | Foundation shipped | Organic actually uses |
|---|---|---|
| `--color-bg` | `#ffffff` | `#f5ead8` |
| `--color-surface` | `#f8fafc` | `#ebddc5` |
| `--color-text` | `#0f172a` | `#201e1d` |
| `--color-accent` | `#4f46e5` | `#c67139` |
| `--color-accent-2` | absent | `#7a8a5e` |
| `--color-danger` | `#dc2626` | `#b5432c` |
| dark `--color-bg` | `#0f172a` | `#1a1b1f` |
| dark `--color-surface` | `#1e293b` | `#24252b` |
| dark `--color-text` | `#f1f5f9` | `#f1eee6` |
| dark `--color-accent` | `#818cf8` | `#ff8a54` |
| dark `--color-danger` | `#f87171` | `#ff6b52` |

Correcting this belongs here rather than in its own piece: it is the same
file this piece already rewrites, and building two screens against a
knowingly wrong palette would mean rebuilding them.

## Scope

### In scope

- Correct every token value in `web/src/index.css` to Organic's, add
  `--color-accent-2`, both tonal ramps, a neutral ramp, and radius tokens.
- Add the two missing assets: the Figtree font and the logo.
- Rebuild `LoginPage.tsx` as the two-column split the mockup specifies.
- Rebuild `AppShell.tsx`: reskinned header, a footer that does not exist
  today, and the theme toggle.
- Turn on React Router's `viewTransition` for user-initiated navigation.
- Restore the `body` background and color rule, with `<main>` pinned light
  so unreskinned pages are unaffected.
- Give `Alert`'s banner variants an explicit text color.
- ADR 003 amendment A15.

### Explicitly out of scope

- **Reskinning buckets, secrets, or API keys.** Those are the three
  remaining pieces. They render inside a light-pinned `<main>` and look
  exactly as they do today.
- **Animating redirects.** `viewTransition` goes on links the user clicks,
  not on `<Navigate>` firing from the session guard or after login.
- **Bucket detail navigation.** Those links live in `BucketRow`, which
  this piece does not touch, so they animate when the buckets piece lands.
- **A three-state theme control.** The toggle is binary. See below.
- **Reproducing Organic's spacing scale.** Organic uses a 1.1-ratio scale
  (4.4px, 8.8px, 13.2px...). Tailwind's default scale is close enough that
  porting a second one buys nothing.

## Tokens

`@theme` carries the full light palette: the four base colors, `accent-2`,
`danger`, both accent ramps at 100 through 900, a neutral ramp, and
`--radius-sm` / `md` / `lg` at 8px, 16px, and 28px. Organic is
noticeably rounder than what the foundation shipped.

Both ramps are ported whole rather than only the four steps this piece
uses. The foundation's final review established that Tailwind 4 tree-shakes
unused `@theme` variables out of the built CSS, so unused steps cost
nothing, and a partial port is what invites a later piece to invent a
missing step the same way this spec is correcting.

The hand-written `[data-theme="dark"]` block is not tree-shaken, so it
mirrors the mockup exactly and overrides only what the mockup overrides:
the four base colors, `accent-2`, `danger`, the divider, and four ramp
endpoints (`accent-100`, `accent-800`, `accent-2-100`, `accent-2-800`,
`neutral-100`, `neutral-800`).

`--color-border` becomes Organic's divider,
`color-mix(in srgb, #201e1d 16%, transparent)`, and its dark counterpart
`color-mix(in srgb, #f1eee6 16%, transparent)`.

`--font-sans` splits in two. Inter stays for headings, buttons, and the
brand wordmark; `--font-body` is Figtree for body text. This follows the
mockup, which explicitly overrides Organic's own heading font to force
Inter in exactly those places.

`Modal`, `ToastViewport`, and `ToggleSwitch` need no edits. They already
use `bg-surface` and `border-border`, so they take the corrected values
automatically. That is the tokens working as designed.

## Assets

**Figtree**, self-hosted under `web/public/fonts/` beside Inter, weights
400 and 600, with `@font-face` declarations in `index.css`. Not from
Google's CDN: the foundation established that a page handling Google
sign-in should not also make a live third-party font request, and that
reasoning is unchanged.

**The logo**, `web/public/logo.webp`, at 64px on the login panel, 28px in
the header, and 20px in the footer. It is also wired into `index.html` as
the favicon, which the app currently lacks entirely.

## The login page

A two-column grid, `minmax(300px,38%) 1fr`, filling the viewport height.

The left panel is tinted `--color-accent-100`, clips its overflow, and
holds the logo at 64px with an 18px radius, an `h1` at 36px, and the
tagline "Secrets, scoped to buckets and short-lived API keys." capped at
320px and rendered at 75% opacity.

Behind that content sit three decorative circles, absolutely positioned,
`aria-hidden`, and clipped by the panel:

| Size | Position | Fill | Opacity |
|---|---|---|---|
| 220px | top -60px, left -60px | `--color-accent-2-100` | .6 |
| 140px | bottom 30px, left 140px | `--color-accent-200` | .5 |
| 90px | bottom -30px, right 50px | `--color-accent-2-200` | .5 |

They are not blurred. The mockup uses solid tinted circles at partial
opacity with no `filter`, which is both what it specifies and cheaper than
a blur.

The right column centers a card of `min(380px, 100%)` holding an `h2`
reading "Sign in", the muted line "Sign in to manage your secrets.", and a
full-width "Continue with Google".

**Below the `md` breakpoint the decorative panel is hidden** and only the
card renders, centered. The mockup is desktop-only and specifies no mobile
behavior, so this is a decision this spec is making rather than carrying
over.

Behavior is unchanged in every respect. The `useSession()` redirect to `/`
when already authenticated, `messageForErrorCode()` driving a
`tone="warning"` `Alert` (now inside the card, above the button), and the
OAuth start rendered as an **anchor rather than a button**, with its
existing comment intact. That last one is load-bearing: the flow is a top
level browser navigation, and a `fetch` would receive an opaque redirect
and silently do nothing.

### A known risk

The mockup's dark block overrides `--color-accent-100` to `#3a2a1c` but
does not override `--color-accent-200`, which the 140px circle uses. In
dark mode that circle therefore stays `#ffe1d0`, a bright peach, against a
dark brown panel.

This spec reproduces that exactly rather than silently correcting it,
because it may be deliberate warmth. If it reads as wrong once running,
overriding `--color-accent-200` in the dark block is a one-line change.

## The app shell

**Header.** Sticky to the top, `--color-bg` behind it, divider beneath.

Left: the logo at 28px and the "Manguito Secret Manager" wordmark, wrapped
in a `Link` to `/buckets`. The mockup makes the brand clickable through an
`onClick` handler on a div; a `Link` is used instead so it is keyboard
reachable and middle-clickable. Then the Buckets and Keys `NavLink`s,
keeping their existing contract exactly: active is 600 weight and
underlined, inactive is the same color at 60% opacity, and `end` stays
unset so `/buckets/:name` keeps Buckets marked.

Right, in order: the theme toggle, the signed-in email at 13px and 70%
opacity, and "Sign out".

**The theme toggle** is the existing `ToggleSwitch`, `checked` when the
resolved theme is dark, calling `setPreference("dark")` or
`setPreference("light")`.

It is binary, which means the first click moves the user from `system` to
an explicit preference permanently. `system` remains the default for
anyone who never touches it, and there is no in-app path back to it. A
three-state control would need a component that does not exist and would
leave `ToggleSwitch` unused until the API keys piece. This is the common
shape and it uses what is already built.

Its accessible name is "Dark mode", not the mockup's "Toggle theme".
`role="switch"` already conveys that the control toggles, so naming it for
the thing being switched reads correctly in a screen reader: "Dark mode,
switch, on".

**Footer**, which does not exist today. Divider above, `margin-top: auto`
so it sits at the bottom of short pages, the logo at 20px and
"© 2026 Manguito Secret Manager" on the left, Buckets and Keys links on
the right, wrapping on narrow screens.

It duplicates the header navigation. That is mild redundancy, and it is
what the design specifies; footer navigation is a normal convention rather
than a mistake to correct.

**The duplication forces a test change**, which the testing section below
covers: three existing `AppShell` tests query links by accessible name
globally, and a second link named "Buckets" makes those queries ambiguous
by construction rather than by any behavior change.

The root becomes a `min-h-screen` flex column so the footer's
`margin-top: auto` has something to push against. The sign-out error
`Alert` keeps its current position and behavior.

## Theming boundary

`body` regains `background-color: var(--color-bg)` and
`color: var(--color-text)`, and `<main>` inside `AppShell` is pinned to an
explicit light background and text.

The foundation's final review stripped the `body` rule because dark mode
follows OS preference with no toggle, and unreskinned pages use hardcoded
light-mode classes. Two of those are security relevant: the one-time API
key token (`NewKeyPanel.tsx`) and a revealed secret value
(`SecretRow.tsx`) are both `bg-slate-100` with no text color, so on a dark
body they would inherit `--color-text` and render as invisible text.

The pin is what makes restoring the rule safe. Everything inside `<main>`
renders exactly as it does today, and each later piece deletes its own pin
as it reskins.

Leaving `body` unstyled and theming the shell's root div instead was
considered and rejected. Three things render outside that div:
`RequireSession`'s bare loading and error states, the browser's overscroll
area, and the paint before React mounts. All three would stay white in
dark mode, reintroducing the flash-of-light-theme problem that the
foundation added an inline script to `index.html` specifically to prevent.

**One component sits in themed space and needs a fix.** The sign-out error
`Alert` renders between the header and `<main>`. Its banner variants are
`bg-red-50` and `bg-amber-50` with no text color, so in dark mode it would
inherit `--color-text` and go invisible, the same defect class as the API
token. Its variants get explicit `text-red-900` and `text-amber-900`,
making it readable against its own tinted background regardless of the
surrounding theme, in pinned and themed space alike.

## View transitions

`viewTransition` goes on the header `NavLink`s, the footer links, and the
brand `Link`. The keyframes already shipped with the foundation and target
the document under the transition name `root`, so no markup is needed
beyond the prop.

Redirects are excluded deliberately. A `<Navigate>` firing from the
session guard or after login is not a user gesture, and animating it would
make an involuntary redirect feel like a chosen navigation.

## Testing

Vitest, React Testing Library, MSW at the fetch boundary.

The existing suites are the safety net: 9 `LoginPage` tests and 7
`AppShell` tests, none of which assert on classes. **A break in any of
them is a signal that behavior changed, and should be treated as a finding
rather than an occasion to update the test**, with exactly one
pre-identified exception, below.

### The one sanctioned test change

Three `AppShell` tests query links by accessible name against the whole
document:

```tsx
expect(await screen.findByRole("link", { name: "Buckets" })).toHaveAttribute(
  "href", "/buckets",
);
```

The footer introduces a second link named "Buckets" and a second named
"Keys", so those queries match two elements and throw. This is ambiguity
created by construction, not a behavior change: both links are correct,
and the test simply never had to say which one it meant.

Those three tests (`offers both destinations`, `marks the current
destination`, and `keeps Buckets current inside a bucket`) are rescoped to
the header with `within(screen.getByRole("banner"))`. The assertions
themselves do not change. Any *other* failure in these suites is a real
finding.

This also means the header must be a `<header>` element and the footer a
`<footer>` element, so `banner` and `contentinfo` landmarks exist to scope
by. The current shell already uses `<header>`.

New coverage:

- The theme toggle renders with the accessible name "Dark mode".
- Clicking it sets `data-theme` on the document element and persists the
  preference.
- The footer renders its copyright line and both links.
- `Alert`'s banner variants carry a text color, so the sign-out error is
  readable in dark mode.

`ThemeProvider` is wrapped locally in `AppShell.test.tsx` rather than
added to the shared `renderWithProviders` helper. The helper is used by
roughly twenty files, and `api-keys/invariants.test.tsx` asserts
`localStorage.length === 0` as its proof that the API token never
persists. `ThemeProvider` writes only on `setPreference` and not on mount,
so adding it globally would not break that today, but it would place a
localStorage writer inside a helper that a security invariant depends on
staying silent.

Nothing tests viewport-dependent layout; jsdom performs no real layout.

## ADR amendments this spec requires

**A15. The theme toggle ships, and the palette is Organic's.**

Supersedes A13's statement that no `setPreference` caller exists. A13
named the login and shell piece as where the toggle would arrive; this is
that piece. Records that the toggle is binary, that `system` stays the
default until first interaction, and that there is no in-app path back to
it.

Records the palette correction and its cause: the foundation's token
values were invented rather than read from the design system, and are now
Organic's real values. A13 should not be read as evidence that the
original values were ever chosen deliberately.

## Acceptance criteria

1. Every token in `index.css` matches Organic's values, and both accent
   ramps are present at 100 through 900.
2. The dark block overrides exactly what the mockup overrides, no more.
3. Figtree is self-hosted beside Inter; no runtime request to a font CDN.
4. The logo renders at 64px, 28px, and 20px, and is the favicon.
5. The login page is a two-column grid collapsing to the card alone below
   `md`, with three `aria-hidden` decorative circles.
6. The OAuth start remains an anchor, and its explanatory comment
   survives.
7. The header carries the brand `Link`, both `NavLink`s with their
   existing active contract, the theme toggle, the email, and sign out.
8. The theme toggle is a `ToggleSwitch` named "Dark mode" that calls
   `setPreference` and moves the user off `system` on first click.
9. The footer renders the copyright and both links and sits at the bottom
   of short pages.
10. `body` sets background and color from tokens; `AppShell`'s `<main>` is
    pinned to explicit light values.
11. `Alert`'s banner variants carry an explicit text color.
12. `viewTransition` is set on user-initiated links and on no redirect.
13. All 9 existing `LoginPage` tests pass unmodified. All 7 existing
    `AppShell` tests pass, with only the three link queries named above
    rescoped to the `banner` landmark and their assertions untouched.
14. ADR 003 carries A15.
15. No new npm dependency. No backend change. `make types` produces no
    diff.
16. `make lint` and `make test` pass.

## Risks

**The palette correction changes every themed surface at once.** `Modal`,
`ToastViewport`, and `ToggleSwitch` all shift appearance without being
edited. That is intended, and none has a visible consumer yet, so the
blast radius is limited to components only tests currently see.

**The light pin has to be removed three more times.** Each remaining piece
must delete its own pin as it reskins, and a piece that forgets will
render a reskinned page against a hardcoded light background. The pin is a
single class list in one file, and the reskin will look obviously wrong if
it is missed, so this is a visible failure rather than a silent one.

**The mockup is desktop-only.** Mobile behavior for the login split is
this spec's invention, and the shell's header at narrow widths is
untested against any design. Both are judgment calls that may need
revisiting once seen on a real device.

**Dark mode has never been seen running.** It has existed since the
foundation merged but nothing consumed it. This piece is the first time
anyone will look at it, and the peach-circle case above is one known
oddity already; there may be others that only appear on screen.

## Deferred

To the three remaining pieces: buckets, secrets, and API keys. Each
reskins one area, deletes its light pin, and wires its toast calls.

The `SecretRow.tsx` auto-mask gap that the foundation spec recorded still
stands: ADR 003 lists auto-masking after a timeout as a security-relevant
requirement, and it was never built. It belongs to the secrets piece.

Per-key rate limiting, the last post-v1 hardening piece, remains unstarted.
