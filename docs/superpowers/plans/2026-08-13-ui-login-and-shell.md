# Login Page and App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the theme tokens to the real Organic palette, add the missing font and logo assets, and rebuild the login page and app shell so the foundation's dark mode, toggle, and page transitions become visible.

**Architecture:** Five sequential tasks. Tokens and assets land first because every later task consumes them. Then the login page, then the shell, then the `Alert` fix and the theming boundary that depends on both, then the ADR amendment describing what actually shipped.

**Tech Stack:** React 19, React Router 7, Tailwind 4 (`@theme`, `@custom-variant`), Vitest + React Testing Library, `@testing-library/user-event`. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-08-13-ui-login-and-shell-design.md`

## Global Constraints

- Branch `feat/ui-login-and-shell` already carries the spec commit. Work happens on this branch.
- No new npm dependency. Figtree is fetched as a static asset with `curl`, never added to `package.json`.
- Tailwind only, no CSS modules, no styled-components. No component takes a `className` prop.
- Doc comments explain why, not what. No em dashes anywhere: code, comments, commit messages, docs.
- Tests: Vitest + React Testing Library. `describe`/`it`, `userEvent` for interactions (never raw `.click()` or `fireEvent`), `vi.fn()` for callbacks, queries by role or text, never `data-testid`.
- Commit messages: conventional commits, imperative mood, scoped (`feat(web): ...`, `docs: ...`).
- **The mockup source is read-only design input** at `/tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/mockup/`. Read from it freely. Never commit any of it into the repo except the single logo asset named in Task 1.
- **Existing tests are the safety net.** All 9 `LoginPage` tests must pass unmodified. All 7 `AppShell` tests must pass, with exactly three link queries rescoped as Task 3 specifies and their assertions untouched. Any other failure in either suite is a real finding: report it, do not edit the test to make it pass.
- `ThemeProvider` is wrapped locally in `AppShell.test.tsx`. Do NOT add it to `web/src/test/render.tsx`: that helper is used by roughly twenty files, and `web/src/features/api-keys/invariants.test.tsx` asserts `localStorage.length === 0` as a security invariant.
- Before every commit that changes `.ts`/`.tsx`: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`. After any commit that changes `index.css`, `index.html`, or adds an asset, also run `cd web && pnpm run build` and then `rm -rf web/dist` so the tree stays clean.
- Buckets, secrets, and API keys pages are NOT reskinned by this plan. They must render exactly as they do today.

---

### Task 1: Correct the tokens, add Figtree and the logo

**Files:**
- Modify: `web/src/index.css`
- Modify: `web/index.html`
- Create: `web/public/fonts/figtree-400.woff2`, `web/public/fonts/figtree-600.woff2`
- Create: `web/public/logo.webp`

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind utilities later tasks use by name: `bg-bg`, `bg-surface`, `text-text`, `text-text-muted`, `bg-accent`, `text-accent`, `bg-accent-100`, `bg-accent-200`, `bg-accent-2-100`, `bg-accent-2-200`, `border-border`, `text-danger`, `font-sans` (Inter), `font-body` (Figtree), `rounded-sm`/`md`/`lg` at 8/16/28px. A `dark:` variant driven by `[data-theme="dark"]`. `/logo.webp` as a served static asset.

There is no automated test for this task. `@theme` and `@font-face` are CSS with no JS behavior to assert on, and `vite.config.ts` sets `test: { css: false }`. Verification is a successful production build.

- [ ] **Step 1: Fetch the Figtree font files**

Run from the repo root:

```bash
curl -sL -o web/public/fonts/figtree-400.woff2 "https://cdn.jsdelivr.net/npm/@fontsource/figtree@5/files/figtree-latin-400-normal.woff2"
curl -sL -o web/public/fonts/figtree-600.woff2 "https://cdn.jsdelivr.net/npm/@fontsource/figtree@5/files/figtree-latin-600-normal.woff2"
file web/public/fonts/figtree-400.woff2 web/public/fonts/figtree-600.woff2
ls -la web/public/fonts/
```

Expected: `file` reports both as `Web Open Font Format (Version 2)`, and both are tens of kilobytes, not zero.

If the network is unreachable and the fetch fails, report BLOCKED. Do not substitute a Google Fonts `<link>` tag or any other runtime CDN reference: the whole point is no live third-party request from a page that also handles Google sign-in.

- [ ] **Step 2: Copy the logo asset**

```bash
cp "/tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/mockup/uploads/logo192.webp" web/public/logo.webp
file web/public/logo.webp
```

Expected: `file` reports a Web/P image. This is the only file from the mockup directory that enters the repo.

- [ ] **Step 3: Replace `web/src/index.css`**

Replace the whole file with this. The values come from the Organic design system's `styles.css` and the mockup's own dark-mode overrides; do not adjust them.

```css
@import "tailwindcss";

@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/inter-400.woff2") format("woff2");
}

@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("/fonts/inter-600.woff2") format("woff2");
}

@font-face {
  font-family: "Figtree";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/figtree-400.woff2") format("woff2");
}

@font-face {
  font-family: "Figtree";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("/fonts/figtree-600.woff2") format("woff2");
}

/*
 * The Organic design system's palette, warm terracotta and olive, keyed to
 * the Manguito lovebird logo. These are the design system's real values.
 * The indigo and slate this replaced were invented when the foundation was
 * planned, before its source was read. See ADR 003 A15.
 */
@theme {
  --color-bg: #f5ead8;
  --color-surface: #ebddc5;
  --color-text: #201e1d;
  --color-text-muted: color-mix(in srgb, #201e1d 55%, transparent);
  --color-accent: #c67139;
  --color-accent-2: #7a8a5e;
  --color-danger: #b5432c;
  --color-border: color-mix(in srgb, #201e1d 16%, transparent);

  --color-neutral-100: #f9f4ed;
  --color-neutral-200: #eee7db;
  --color-neutral-300: #dcd3c4;
  --color-neutral-400: #c0b6a5;
  --color-neutral-500: #a19786;
  --color-neutral-600: #82796a;
  --color-neutral-700: #645c50;
  --color-neutral-800: #474238;
  --color-neutral-900: #2e2b25;

  --color-accent-100: #fff2eb;
  --color-accent-200: #ffe1d0;
  --color-accent-300: #ffc6a5;
  --color-accent-400: #f6a06b;
  --color-accent-500: #d67f48;
  --color-accent-600: #b2622d;
  --color-accent-700: #8c491a;
  --color-accent-800: #643312;
  --color-accent-900: #402310;

  --color-accent-2-100: #f0fae1;
  --color-accent-2-200: #e1eecc;
  --color-accent-2-300: #ccdbb2;
  --color-accent-2-400: #aebf92;
  --color-accent-2-500: #8fa073;
  --color-accent-2-600: #728157;
  --color-accent-2-700: #56633f;
  --color-accent-2-800: #3d472b;
  --color-accent-2-900: #272e1b;

  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Figtree", ui-sans-serif, system-ui, sans-serif;

  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 28px;
}

/*
 * Selector-based, not Tailwind's default prefers-color-scheme media variant.
 * The manual toggle in AppShell has to be able to override system
 * preference, which a media-query variant cannot do.
 */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/*
 * Overrides exactly what the mockup overrides and no more. Unlike the
 * @theme block above, this is plain CSS and is not tree-shaken, so every
 * line here ships.
 */
[data-theme="dark"] {
  --color-bg: #1a1b1f;
  --color-surface: #24252b;
  --color-text: #f1eee6;
  --color-text-muted: color-mix(in srgb, #f1eee6 55%, transparent);
  --color-accent: #ff8a54;
  --color-accent-2: #a7cd7a;
  --color-danger: #ff6b52;
  --color-border: color-mix(in srgb, #f1eee6 16%, transparent);
  --color-accent-100: #3a2a1c;
  --color-accent-800: #ffd4ab;
  --color-accent-2-100: #28331f;
  --color-accent-2-800: #d5e8b5;
  --color-neutral-100: #2c2d33;
  --color-neutral-800: #dcd8ce;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
}

/*
 * Inter for headings, buttons and the brand wordmark; Figtree for body
 * text. This follows the mockup, which overrides the Organic system's own
 * heading font to force Inter in exactly these places.
 */
h1,
h2,
h3,
h4 {
  font-family: var(--font-sans);
}

/*
 * React Router's viewTransition navigation option targets the whole
 * document under the transition name "root" by default. No extra markup is
 * needed for that; this is only the animation the browser plays.
 */
::view-transition-old(root) {
  animation: 150ms ease-out both page-fade-out;
}

::view-transition-new(root) {
  animation: 150ms ease-in both page-fade-in;
}

@keyframes page-fade-out {
  to {
    opacity: 0;
    transform: translateY(-8px);
  }
}

@keyframes page-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

- [ ] **Step 4: Add the favicon link to `web/index.html`**

Add one line inside `<head>`, immediately after the `<title>` line and before the existing `<script>` block. Change nothing else in this file.

```html
    <link rel="icon" type="image/webp" href="/logo.webp" />
```

- [ ] **Step 5: Verify the build succeeds**

Run: `cd web && pnpm run build`
Expected: exits 0. This is the only check that parses `@theme`, `@custom-variant`, and the `@font-face` blocks.

Then confirm the corrected accent actually reached the output, rather than trusting the build's exit code:

```bash
grep -c "c67139" web/dist/assets/*.css
```

Expected: at least 1. If it is 0, the token did not compile in and something is wrong. Report it rather than proceeding.

Then clean up: `rm -rf web/dist`

- [ ] **Step 6: Run the existing suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 265 tests. No test reads CSS, so nothing should change here. A failure means something other than styling moved.

- [ ] **Step 7: Commit**

```bash
git add web/src/index.css web/index.html web/public/fonts/ web/public/logo.webp
git commit -m "feat(web): correct theme tokens to the Organic palette"
```

---

### Task 2: Rebuild the login page

**Files:**
- Modify: `web/src/features/auth/LoginPage.tsx`
- Test: `web/src/features/auth/LoginPage.test.tsx` (must pass unmodified)

**Interfaces:**
- Consumes: Task 1's `bg-accent-100`, `bg-accent-200`, `bg-accent-2-100`, `bg-accent-2-200`, `bg-bg`, `bg-surface`, `text-text-muted`, `border-border`, `rounded-sm`, `font-sans`, and `/logo.webp`.
- Produces: nothing later tasks import.

- [ ] **Step 1: Read the existing tests first**

Run: `cd web && pnpm test -- LoginPage`
Expected: 9 passing.

Then read `web/src/features/auth/LoginPage.test.tsx` in full before writing any code. These 9 tests define the behavior contract this rebuild must preserve. They must still pass with zero edits.

- [ ] **Step 2: Replace `web/src/features/auth/LoginPage.tsx`**

```tsx
import { Navigate, useSearchParams } from "react-router";

import { apiUrl } from "../../api/client";
import { Alert } from "../../components/Alert";
import { messageForErrorCode } from "./errorMessages";
import { useSession } from "./useSession";

/**
 * A two column split: a tinted brand panel and a sign in card.
 *
 * The panel is hidden below md. The mockup this follows is desktop only and
 * specifies no mobile behaviour, so dropping the decoration rather than
 * stacking it is a decision made here, not one carried over.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const message = messageForErrorCode(searchParams.get("error"));

  if (session.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[minmax(300px,38%)_1fr]">
      <div className="relative hidden flex-col justify-center gap-4 overflow-hidden bg-accent-100 p-8 md:flex">
        {/* Ornament only, so it is hidden from assistive technology. The
            circles are solid fills at partial opacity, not blurs. */}
        <div
          aria-hidden="true"
          className="absolute -top-[60px] -left-[60px] h-[220px] w-[220px] rounded-full bg-accent-2-100 opacity-60"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-[30px] left-[140px] h-[140px] w-[140px] rounded-full bg-accent-200 opacity-50"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-[30px] right-[50px] h-[90px] w-[90px] rounded-full bg-accent-2-200 opacity-50"
        />
        <img
          src="/logo.webp"
          alt=""
          className="relative z-10 h-16 w-16 rounded-[18px]"
        />
        <h1 className="relative z-10 text-4xl font-semibold">Manguito Secret Manager</h1>
        <p className="relative z-10 max-w-[320px] opacity-75">
          Secrets, scoped to buckets and short-lived API keys.
        </p>
      </div>

      <main className="flex items-center justify-center p-8">
        <div className="flex w-[min(380px,100%)] flex-col gap-4 rounded-sm border border-border bg-surface p-6">
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="text-text-muted">Sign in to manage your secrets.</p>

          {message !== null && <Alert tone="warning">{message}</Alert>}

          {/*
            An anchor, not a button with an onClick. The flow is a top level
            browser navigation to Google and back through the API's callback. A
            fetch would receive an opaque redirect and silently do nothing.
          */}
          <a
            href={apiUrl("/v1/auth/google/start")}
            className="rounded-sm bg-accent px-4 py-2 text-center font-sans font-semibold text-bg"
          >
            Continue with Google
          </a>
        </div>
      </main>
    </div>
  );
}
```

The logo's `alt` is deliberately empty: the `h1` beside it already says "Manguito Secret Manager", so alt text would make a screen reader announce the name twice.

- [ ] **Step 3: Run the login tests**

Run: `cd web && pnpm test -- LoginPage`
Expected: 9 passing, unmodified.

If any fail, do not edit the test. Read the failure: it means behaviour changed. The likely causes are the `Alert` moving inside the card (it should still be found by `getByRole("alert")`) or the anchor's accessible name changing (it must remain "Continue with Google"). Fix the component, not the test. If you conclude the test itself is wrong, stop and report it as a finding.

- [ ] **Step 4: Run the full suite and build**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build`
Expected: all pass, 265 tests.

Then: `rm -rf web/dist`

- [ ] **Step 5: Commit**

```bash
git add web/src/features/auth/LoginPage.tsx
git commit -m "feat(web): rebuild the login page as a two column split"
```

---

### Task 3: Rebuild the app shell

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/shell/AppShell.test.tsx` (three link queries rescoped, assertions untouched)

**Interfaces:**
- Consumes: Task 1's tokens and `/logo.webp`. The existing `ToggleSwitch` from `web/src/components/ToggleSwitch.tsx`, whose props are `{ checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }`. The existing `useTheme` from `web/src/components/useTheme.ts`, which returns `{ preference, resolved, setPreference }` where `resolved` is `"light" | "dark"`.
- Produces: a `<header>` (`banner` landmark) and a `<footer>` (`contentinfo` landmark), which later pieces can scope test queries by.

- [ ] **Step 1: Replace `web/src/features/shell/AppShell.tsx`**

```tsx
import { Link, NavLink, Outlet } from "react-router";

import { Alert } from "../../components/Alert";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { useTheme } from "../../components/useTheme";

import { useSession } from "../auth/useSession";
import { useSignOut } from "../auth/useSignOut";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-semibold underline" : "opacity-60";

/**
 * The signed in shell.
 *
 * Only ever rendered inside RequireSession, so the session is authenticated in
 * practice. useSession is read again rather than threaded through an outlet
 * context because the query is already cached under the same key, so this
 * costs nothing and keeps the component independently testable. A layout
 * route whose children supply the body through Outlet.
 */
export function AppShell() {
  const session = useSession();
  const signOut = useSignOut();
  const { resolved, setPreference } = useTheme();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-4">
        <div className="flex items-center gap-6">
          <Link to="/buckets" viewTransition className="flex items-center gap-2.5">
            <img src="/logo.webp" alt="" className="h-7 w-7 rounded-lg" />
            <span className="font-sans font-semibold">Manguito Secret Manager</span>
          </Link>
          {/* NavLink rather than Link: it supplies isActive and sets
              aria-current, so the current destination needs no state and no
              route matching here. `end` is deliberately unset, so
              /buckets/:name keeps Buckets marked. */}
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <NavLink to="/buckets" viewTransition className={navLinkClass}>
              Buckets
            </NavLink>
            <NavLink to="/keys" viewTransition className={navLinkClass}>
              Keys
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {/* Named for the thing being switched, not for the act of
              switching: role="switch" already conveys that it toggles, so
              "Dark mode, switch, on" reads correctly. */}
          <ToggleSwitch
            checked={resolved === "dark"}
            onChange={(checked) => setPreference(checked ? "dark" : "light")}
            label="Dark mode"
          />
          {session.status === "authenticated" && (
            <span className="text-[13px] opacity-70">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="rounded-sm border border-border px-3 py-1 font-sans text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      {signOut.isError && (
        <div className="mx-6 mt-4">
          <Alert>Could not sign out. Please try again.</Alert>
        </div>
      )}

      {/*
        Pinned to explicit light values. Buckets, secrets and API keys still
        use hardcoded light mode classes, and two of them render a secret on
        a bg-slate-100 block with no text colour, which would be invisible
        against a dark inherited colour. Each of those pieces deletes this
        pin as it is reskinned.
      */}
      <main className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">
        <Outlet />
      </main>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border p-6">
        <div className="flex items-center gap-2">
          <img src="/logo.webp" alt="" className="h-5 w-5 rounded-md" />
          <span className="text-[13px] text-text-muted">
            © 2026 Manguito Secret Manager
          </span>
        </div>
        <nav aria-label="Footer" className="flex gap-4 text-[13px]">
          <NavLink to="/buckets" viewTransition>
            Buckets
          </NavLink>
          <NavLink to="/keys" viewTransition>
            Keys
          </NavLink>
        </nav>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Run the shell tests and watch three fail**

Run: `cd web && pnpm test -- AppShell`
Expected: 4 passing, 3 failing. The three failures are `offers both destinations`, `marks the current destination`, and `keeps Buckets current inside a bucket`, each with a "Found multiple elements" error naming the Buckets or Keys link.

This failure is expected and is the reason for Step 3. It is ambiguity created by adding a second correct link, not a behaviour change. If you see a *different* set of failures, stop and report it.

- [ ] **Step 3: Rescope those three queries to the header**

In `web/src/features/shell/AppShell.test.tsx`, add `within` to the existing import from `@testing-library/react`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
```

Then change only the link lookups in the three named tests, leaving every assertion as it is.

In `offers both destinations`:

```tsx
    renderShell();

    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(within(header).getByRole("link", { name: "Keys" })).toHaveAttribute("href", "/keys");
```

In `marks the current destination`:

```tsx
    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(header).getByRole("link", { name: "Buckets" })).not.toHaveAttribute(
      "aria-current",
    );
```

In `keeps Buckets current inside a bucket, since a secret list is still buckets`:

```tsx
    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
```

- [ ] **Step 4: Run the shell tests again**

Run: `cd web && pnpm test -- AppShell`
Expected: 7 passing.

Note the theme toggle is not yet exercised. It needs `ThemeProvider` in the tree, which Step 5 adds.

- [ ] **Step 5: Add the new tests**

Append to `web/src/features/shell/AppShell.test.tsx`. Add `ThemeProvider` to the imports:

```tsx
import { ThemeProvider } from "../../components/ThemeProvider";
```

Then add this block at the end of the file:

```tsx
describe("AppShell chrome", () => {
  it("renders the footer with its copyright", async () => {
    signedIn();

    renderShell();

    const footer = await screen.findByRole("contentinfo");
    expect(within(footer).getByText(/© 2026 Manguito Secret Manager/)).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(within(footer).getByRole("link", { name: "Keys" })).toHaveAttribute("href", "/keys");
  });

  it("offers a dark mode switch that reflects the resolved theme", async () => {
    signedIn();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");

    renderWithProviders(
      <ThemeProvider>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const toggle = await screen.findByRole("switch", { name: "Dark mode" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("switches the document to dark and persists the choice", async () => {
    signedIn();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    const user = userEvent.setup();

    renderWithProviders(
      <ThemeProvider>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </ThemeProvider>,
    );

    await user.click(await screen.findByRole("switch", { name: "Dark mode" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
```

The two theme tests clear `localStorage` and the `data-theme` attribute first because both are global state that another test in the same file could have left behind. `ThemeProvider` reads `prefers-color-scheme` when nothing is stored, and jsdom reports no match for that query, so the resolved theme starts as light.

- [ ] **Step 6: Run the shell tests**

Run: `cd web && pnpm test -- AppShell`
Expected: 10 passing (7 existing, 3 new).

- [ ] **Step 7: Run the full suite and build**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build`
Expected: all pass, 268 tests.

Then: `rm -rf web/dist`

- [ ] **Step 8: Commit**

```bash
git add web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx
git commit -m "feat(web): rebuild the app shell with a footer and theme toggle"
```

---

### Task 4: Make Alert readable in themed space

**Files:**
- Modify: `web/src/components/Alert.tsx`
- Modify: `web/src/components/Alert.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks import.

The sign-out error `Alert` renders between the header and `<main>`, which is themed space. Its banner variants set a light tinted background and no text colour, so in dark mode the text would inherit `--color-text` and render nearly invisibly on its own background. This is the same defect class as an invisible API key token.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/Alert.test.tsx`:

```tsx
  it("sets its own text colour, so a banner stays readable on a dark surface", () => {
    // The sign out error renders outside the light pinned main, so it cannot
    // rely on inheriting a dark text colour from an ancestor.
    const { rerender } = render(<Alert>Something failed.</Alert>);
    expect(screen.getByRole("alert").className).toMatch(/text-red-900/);

    rerender(<Alert tone="warning">Careful.</Alert>);
    expect(screen.getByRole("alert").className).toMatch(/text-amber-900/);
  });
```

This asserts on class names, which the project's conventions normally forbid. It is justified here and only here: the defect being prevented *is* a missing colour class, and there is no behavioural surface to assert against instead. jsdom computes no styles, so a computed-colour assertion would pass against any input.

Add `rerender` support by confirming the file already imports `render` and `screen` from `@testing-library/react`. It does.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- Alert`
Expected: FAIL. The banner class list has no `text-red-900`.

- [ ] **Step 3: Add the text colours**

In `web/src/components/Alert.tsx`, change the palette object so each banner carries its own text colour:

```tsx
  const palette =
    tone === "warning"
      ? { banner: "border-amber-300 bg-amber-50 text-amber-900", inline: "text-amber-700" }
      : { banner: "border-red-300 bg-red-50 text-red-900", inline: "text-red-700" };
```

Leave the `inline` variants alone: they set a colour already and render inside pinned light space.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm test -- Alert`
Expected: 4 passing.

- [ ] **Step 5: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 269 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Alert.tsx web/src/components/Alert.test.tsx
git commit -m "fix(web): give Alert banners their own text colour"
```

---

### Task 5: ADR 003 amendment A15

**Files:**
- Modify: `docs/adr/0003-frontend-architecture.md`

**Interfaces:**
- Consumes: the shipped state of Tasks 1 through 4, which it must describe accurately rather than aspirationally.
- Produces: nothing. This is the last task.

There is no automated test for this task. The reviewer checks the prose against what Tasks 1 through 4 actually built.

- [ ] **Step 1: Append A15 to `docs/adr/0003-frontend-architecture.md`**

Add at the end of the file, after A14:

```markdown

### A15. The theme toggle ships, and the palette is the design system's

A13 recorded that no page or component called `setPreference`, and named
the login and shell piece as where a toggle would arrive. This is that
piece, so that sentence no longer holds.

**Amended:** `AppShell` renders a `ToggleSwitch` labelled "Dark mode" that
calls `setPreference`. It is binary, so the first click moves a user from
`system` to an explicit preference and there is no in-app path back.
`system` remains the default for anyone who never touches it. A three
state control would need a component that does not exist and would leave
`ToggleSwitch` without a consumer until the API keys piece.

**Also amended, and more consequential:** the token values A13 described
were invented. The foundation's plan was written before the mockup's
design system source had been read, and filled the gap with plausible
indigo and slate rather than real values. They compiled cleanly, so
nothing downstream caught it.

The palette is now the Organic design system's own: warm terracotta
(`#c67139`) and olive (`#7a8a5e`) on a cream ground (`#f5ead8`), keyed to
the Manguito lovebird logo, with both accent ramps at 100 through 900 and
Organic's own dark overrides. Inter is kept for headings, buttons and the
brand wordmark, matching the mockup's explicit override of Organic's
heading font, and Figtree is self hosted for body text on the same terms
Inter already was: no runtime request to a font CDN from a page that also
handles Google sign in.

A13 should not be read as evidence that the original values were ever
chosen deliberately. Nothing else in A13 changes.
```

- [ ] **Step 2: Verify the edit**

```bash
cd /mnt/projects/manguito-secret-manager
grep -n "A15" docs/adr/0003-frontend-architecture.md
grep -c "—" docs/adr/0003-frontend-architecture.md
```

Expected: A15's heading appears. The em dash count is 6, unchanged from before this task: those six predate this branch and are out of scope. If the count is higher, your new text introduced one, and CLAUDE.md forbids them.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0003-frontend-architecture.md
git commit -m "docs: record the theme toggle and the palette correction in ADR 003"
```

---

## Final verification

From the repo root:

```bash
cd web && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build && rm -rf dist
```

Expected: all pass, 269 tests, build exits 0.

`make types` is not run: no Pydantic model changed, so `web/src/api/generated.ts` cannot have drifted.

**Manual check, which no test covers.** Run `make dev`, open the app, and confirm four things a jsdom test cannot see: the login split renders with its three circles and collapses to the card alone at a narrow width; the header toggle actually switches the whole page between light and dark; buckets, secrets, and API keys still render on white with dark, readable text in both theme states; and the one-time API key panel and a revealed secret value are both legible with dark mode on. That last one is the specific regression the light pin exists to prevent.
