# The UI modernization foundation, design

Date: 2026-08-12
Status: Approved, ready for planning
Depends on: nothing shipped depends on this; it is new frontend surface

## Purpose

A visual redesign was prototyped in a Claude Design mockup (`Manguito Secret
Manager.dc.html`, project "Secret Manager UI Modernization"), covering
every screen: login, buckets, bucket detail/secrets, API keys, and the
shell nav/footer. The mockup is design input, not code to import verbatim
— it is a static `.dc.html` prototype using its own templating DSL and mock
data, not React or Tailwind, and its own accompanying notes describe it as
"a design prototype for review before implementation," with an explicit
screen-to-file mapping onto this app's real components.

The mockup also does three things this project's existing decisions
explicitly ruled out or never built: a full light/dark theme system
(CLAUDE.md lists dark mode as out of scope for v1), modal dialogs for every
create action (SP6 deliberately chose an always-visible inline form
instead), and toast notifications for success confirmations (ADR 003 A11
rejected toasts and global client state). Each of these was raised with the
user directly and resolved before this spec was written: dark mode ships,
create actions move to modals, and toasts ship for success confirmations
only, additive to the existing inline error pattern. One thing in the
mockup is not a design choice at all: its secret-masking function derives
the mask from the plaintext's length, which is exactly the pattern SP7's
test suite exists to prevent. It is not carried over under any
circumstance; the existing fixed-width mask stays.

The mockup's scope is too large for one plan. This spec covers the first
of five pieces: the shared foundation everything else builds on. Nothing
in this piece is visibly wired into a page yet.

## Where this sits

| Piece | Touches | Status |
|---|---|---|
| **The foundation** | tokens, fonts, `ToggleSwitch`, `Modal`, toasts, page transitions | this spec |
| Login + shell | `LoginPage.tsx`, `AppShell.tsx` | not started |
| Buckets | `BucketsPage.tsx`, `BucketRow.tsx`, `CreateBucketForm.tsx` | not started |
| Secrets | `SecretsPage.tsx`, `SecretRow.tsx`, `PutSecretForm.tsx` | not started |
| API keys | `KeysPage.tsx`, `KeyRow.tsx`, `CreateKeyForm.tsx`, `NewKeyPanel.tsx` | not started |

Each row is its own spec, plan, and PR, following the same sequencing this
project has used for every prior sub-project and the four post-v1
hardening pieces.

## Scope

### In scope

- Theme tokens (light + dark) via Tailwind 4's `@theme`, a selector-based
  dark variant, `localStorage` persistence with system-preference
  fallback, and a self-hosted Inter font.
- Three new shared components: `ToggleSwitch`, `Modal`, and a toast system
  (`ToastProvider` + `useToast()`).
- CSS keyframes for the page-transition effect, consumed by React
  Router v7's built-in `viewTransition` navigation option (no custom hook).
- A CLAUDE.md edit dropping "dark mode" from Out of scope for v1.
- Two ADR 003 amendments: resolving its own long-standing open question on
  dark mode, and recording the toast system as a scoped exception to A11.

### Explicitly out of scope

- **Reskinning any existing page.** That is the four follow-up pieces.
  This piece ships components with no consumer yet, verified by
  component-level tests, not a demo page.
- **The mockup's length-derived secret mask.** Not a design choice;
  excluded outright. The existing fixed-width mask is unchanged by this or
  any later piece.
- **Moving existing inline errors onto toasts.** Toasts are additive, for
  success confirmations only. ADR 003's "errors surface where the thing
  that failed is" stands.
- **A component library or design-tokens package.** Everything here is
  plain Tailwind utilities and hand-written components under
  `web/src/components/`, matching how `Alert` and `ConfirmPrompt` already
  work. No new dependency.

## Theming

**Tokens.** `web/src/index.css` gains a Tailwind 4 `@theme` block defining
the palette as CSS custom properties (`--color-bg`, `--color-surface`,
`--color-text`, `--color-accent`, `--color-danger`, `--color-border`, and
similar) for light mode, plus:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

A parallel block under `[data-theme="dark"]` redefines the same tokens.
Components use `dark:` utilities throughout; no component hand-rolls a
second, dark-specific class list.

A selector-based variant, not Tailwind's default `prefers-color-scheme`
media variant, because a manual toggle has to be able to override system
preference. This is the same reasoning already implicit in ADR 003's
unresolved open question ("dark mode... probably yes"), made concrete now.

**Persistence.** `ThemeProvider` (`web/src/components/ThemeProvider.tsx`)
and a `useTheme()` hook: reads a `theme` key from `localStorage`
(`"light" | "dark" | "system"`), falls back to `prefers-color-scheme` when
unset or `"system"`, and sets `data-theme` on `<html>`. This is a UI
preference, not a secret value — invariant 8 restricts secret values
specifically, and a theme choice is not one.

**Font.** Inter, self-hosted: `.woff2` files committed under
`web/public/fonts/`, `@font-face` declarations in `index.css`,
`font-family` set on `body`. Not pulled from Google's CDN at runtime — a
one-time static-asset fetch during implementation, not a live third-party
request on a page that also asks users to sign in with Google, and not a
new npm dependency.

## New shared components

**`ToggleSwitch`** (`web/src/components/ToggleSwitch.tsx`). Controlled:
`checked`, `onChange`, `label` for accessible naming. Tailwind only,
track-and-thumb styling. Two known consumers: the theme toggle here, and
the API-keys piece later, which replaces its capability checkboxes (Write,
Bulk reveal) with this component instead of building a second one-off
toggle.

**`Modal`** (`web/src/components/Modal.tsx`). Controlled: `open`,
`onClose`, `title`, `children`. Rendered through `createPortal`
(`react-dom`, no new dependency) into a portal root added to `index.html`.
Closes on Escape and backdrop click, traps focus while open, restores
focus to the triggering element on close. `role="dialog"`
`aria-modal="true"`, `aria-labelledby` pointing at the title. No built-in
form handling — callers own their form and call `onClose` themselves,
matching how `ConfirmPrompt` stays presentational today.

**Toasts.** `ToastProvider` (`web/src/components/ToastProvider.tsx`, a
React Context wrapping a `useState` list of `{id, message, tone}`) mounted
once in `main.tsx`, above the router, so it covers the login page as well
as the authenticated shell. `useToast()` returns `notify(message, tone?)`.
A `ToastViewport` renders the active list in a fixed-position stack and
auto-dismisses each entry after a timeout via `setTimeout`, cleared on
unmount. There is no existing timeout convention elsewhere in this
codebase to follow — ADR 003 states that revealed secrets auto-mask after
a timeout, but `SecretRow.tsx` was never actually built that way; it only
hides on manual click. That gap is unrelated to this piece and is called
out separately under Deferred, not fixed here. Success-only: nothing in
this piece or its follow-ups moves an existing `Alert` error onto a
toast.

## Page transitions

`main.tsx`/`routes/router.tsx` already use React Router v7's data router
(`createBrowserRouter`, `RouterProvider`), which ships first-class View
Transitions support: `navigate(to, { viewTransition: true })` and
`<NavLink viewTransition>` already wrap `document.startViewTransition`
internally, with their own feature-detection fallback for browsers that
don't implement it. A hand-rolled hook would reinvent that, with a weaker
fallback than the one already built into the router.

This piece adds only the CSS side. React Router's default view transition
targets the whole document under the transition name `root`, with no extra
markup required, so `index.css` gets:

```css
::view-transition-old(root) {
  animation: 150ms ease-out both page-fade-out;
}
::view-transition-new(root) {
  animation: 150ms ease-in both page-fade-in;
}
@keyframes page-fade-out {
  to { opacity: 0; transform: translateY(-8px); }
}
@keyframes page-fade-in {
  from { opacity: 0; transform: translateY(8px); }
}
```

No hook, no new file. Passing `viewTransition: true` on an actual
`navigate()` call or `<NavLink>` is page-level wiring, deferred to the
login/shell piece — the same boundary as every other primitive in this
spec.

## Files

**New:**
- `web/src/index.css` — theme tokens, dark variant, `@font-face`
- `web/public/fonts/inter-*.woff2`
- `web/src/components/ThemeProvider.tsx`, `web/src/components/useTheme.ts`
- `web/src/components/ToggleSwitch.tsx`
- `web/src/components/Modal.tsx`
- `web/src/components/ToastProvider.tsx`, `web/src/components/ToastViewport.tsx`
- A test file per component/hook above, following existing naming
  (`ComponentName.test.tsx`)

**Modified:**
- `web/src/main.tsx` — mounts `ThemeProvider` and `ToastProvider` above the router
- `index.html` — adds the `Modal` portal root
- `CLAUDE.md` — drops "dark mode" from Out of scope for v1
- `docs/adr/0003-frontend-architecture.md` — A13 and A14 (below)

## ADR amendments this spec requires

**A13. Dark mode is resolved.** ADR 003's own open-questions list has said
since it was written: "Dark mode. Trivial with Tailwind, but adds test
surface. Probably yes, low priority." This amendment closes it: dark mode
ships, using a selector-based `dark:` variant (`[data-theme="dark"]`, not
`prefers-color-scheme` alone, so a manual toggle can override system
preference), persisted to `localStorage` under a `theme` key, defaulting to
system preference when unset.

**A14. Toasts are a scoped exception to A11.** A11 removed Zustand and
said "TanStack Query owns server state and `useState` owns the rest,"
reasoning that every piece of state this app had needed turned out to be
component-local. A toast queue is the first state that does not fit that
shape: it is triggered from wherever a mutation succeeds and rendered once,
high in the tree. A11's target was dependence on a state-management
package, not React's own Context — this amendment records that
distinction explicitly rather than leaving it implied. Scoped narrowly to
toast notifications; it is not a general license for more shared client
state.

## Testing

Vitest + React Testing Library, this project's existing frontend
convention: test behavior, not internals.

- `ThemeProvider` / `useTheme`: applies `data-theme` from a stored
  preference; falls back to system preference when unset; toggling updates
  both the attribute and `localStorage`.
- `ToggleSwitch`: reflects `checked`, fires `onChange`, has an accessible
  name.
- `Modal`: renders when `open`, not when closed; Escape and backdrop click
  call `onClose`; focus moves into the dialog on open and returns to the
  trigger on close.
- Toasts: `notify()` renders a toast; it auto-dismisses after the timeout,
  using fake timers.

Page transitions have no behavior of their own to test in this piece —
they're CSS consumed by a browser feature React Router already tests. No
test is added for a CSS keyframe.

## Acceptance criteria

1. `web/src/index.css` defines light and dark tokens via `@theme` and a
   selector-based `dark:` variant driven by `data-theme` on `<html>`.
2. Inter is self-hosted under `web/public/fonts/`; no runtime request to a
   font CDN.
3. `ThemeProvider`/`useTheme` persists the choice to `localStorage`,
   defaults to system preference when unset, and never stores a secret
   value.
4. `ToggleSwitch`, `Modal`, and the toast system (`ToastProvider`,
   `useToast`, `ToastViewport`) exist under `web/src/components/`, each
   with its own test file.
5. `Modal` traps focus, closes on Escape and backdrop click, and restores
   focus to the trigger on close.
6. Toasts auto-dismiss after a timeout and are never used for error
   states.
7. `index.css` defines `::view-transition-old(root)` /
   `::view-transition-new(root)` keyframes for a fade + translateY
   transition. No custom hook is added; triggering a transition
   (`viewTransition: true` on `navigate()`/`NavLink`) is deferred to the
   login/shell piece.
8. No existing page (`LoginPage`, `AppShell`, `BucketsPage`,
   `SecretsPage`, `KeysPage`, or their sub-components) is modified by this
   piece.
9. CLAUDE.md no longer lists dark mode under Out of scope for v1.
10. ADR 003 carries A13 and A14.
11. No new npm dependency. No backend change. `make types` produces no
    diff.
12. `make lint` and `make test` pass.

## Risks

**Nothing consumes these components until the next four pieces land.**
Component-level tests can verify each one in isolation, but real
integration issues (a `Modal` interacting with a form's own focus
management, a toast firing during a route transition) can't surface until
a page actually uses them. Accepted: each follow-up piece's own review is
where that surfaces, and building the primitives first, thoroughly tested
in isolation, is what keeps each of those four pieces small.

**`document.startViewTransition` has partial browser support.** React
Router's own `viewTransition` option already falls back to a plain
navigation when the browser doesn't implement it, so this never breaks
navigation, only degrades the animation — a cosmetic risk, not a
functional one, and not this piece's code to maintain.

**Self-hosted font files add a small amount of repo weight** (a handful of
`.woff2` files) in exchange for not depending on Google Fonts' CDN being
reachable and not sending visitor IPs to a third party from a page that
also handles authentication.

## Deferred

To the four follow-up pieces: login + shell, buckets, secrets, API keys.
Each reskins one area onto this foundation and is where the mockup's modal
pattern actually replaces SP6's inline forms, and where the toast calls
actually get wired to real mutations.

Per-key rate limiting, the last of the original four post-v1 hardening
pieces, remains separate and unstarted, with its own open design question
(ADR 002 A7 rules out an in-process counter; no shared store chosen yet).

**A real gap, found incidentally while writing this spec, not caused by
it:** ADR 003 lists "Revealed values auto-mask after a timeout" as a
non-negotiable security-relevant UI requirement, but `SecretRow.tsx` was
never built that way — reveal only toggles off on manual click or on
unmount. This piece does not touch `SecretRow.tsx` and does not fix it.
Flagged here so it isn't lost; worth its own small spec, most likely
folded into the secrets follow-up piece rather than done standalone.
