# About Page and Search Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public About page and give the application share and search
metadata that actually reaches crawlers.

**Architecture:** The metadata is static in `web/index.html`, because a Vite
SPA serves that one file for every route and crawlers do not run JavaScript.
Absolute URLs come from `%VITE_SITE_URL%`, which Vite substitutes at build
time, so the repository stays domain agnostic. The About page is a standalone
public route beside `/login`, outside `RequireSession` and outside `AppShell`.

**Tech Stack:** React 19, TypeScript strict, Tailwind 4, React Router 7,
Vitest + React Testing Library, Playwright for the image and browser checks
(scratchpad only, never a repository dependency).

**Spec:** `docs/superpowers/specs/2026-08-15-about-page-and-seo-design.md`

## Global Constraints

- No em dashes anywhere, in code comments, commit messages, or docs.
- Tailwind only. No CSS modules, no styled-components.
- **No new npm dependency.** Playwright stays in the scratchpad; `git status`
  must show zero diff on `web/package.json` and `web/pnpm-lock.yaml`.
- Comments explain why, not what.
- **Only the 100 and 800 steps of each colour ramp carry dark mode values**
  in `index.css`, plus `accent-600/700` and `danger-600` for hover states.
  `bg-accent-100` is safe. Any other numbered step renders its light colour
  unchanged in dark mode.
- Tests verify behaviour, not Tailwind classes. `AboutPage` fetches nothing,
  so it needs a router wrapper and no MSW handlers.
- The Font Awesome attribution comment must be preserved verbatim wherever
  those icon paths are used. The icons are Font Awesome Free 6.x, which is
  CC BY 4.0 and requires attribution.

**Verification after every code task:**

```bash
cd web && pnpm run lint && pnpm run typecheck && pnpm test
```

Baseline is 302 frontend tests across 32 files.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/features/about/AboutPage.tsx` | the page itself, static | 2 |
| `web/src/features/about/AboutPage.test.tsx` | its behaviour | 2 |
| `web/src/routes/router.tsx` | registers `/about` as public | 2 |
| `web/src/features/shell/AppShell.tsx` | footer link, signed in | 2 |
| `web/src/features/auth/LoginPage.tsx` | link, signed out | 2 |
| `web/src/routes/access.test.tsx` | proves `/about` is public | 2 |
| `web/index.html` | every meta tag a crawler will ever see | 3 |
| `web/public/robots.txt` | keeps authenticated routes out of indexes | 3 |
| `web/.env.example`, `docs/deployment.md` | document `VITE_SITE_URL` | 3 |
| `web/public/og.png` | the 1200x630 share card | 4 |

---

## Task 1: Verify the Vite substitution gate

**Files:** none changed. This task produces a decision, not a diff.

**Interfaces:**
- Consumes: nothing.
- Produces: a confirmed answer to whether `%VITE_SITE_URL%` resolves at build
  time, which Task 3 depends on entirely.

Task 3 puts `%VITE_SITE_URL%` into `index.html` for every absolute URL. Vite
documents this substitution, but it has never run in this repository, and it
fails **invisibly**: an unresolved token ships as a literal
`%VITE_SITE_URL%/og.png`, which looks fine in the diff, passes every test, and
only surfaces when somebody shares a link and gets a broken card. Verify it
before building on it.

- [ ] **Step 1: Add a throwaway probe to index.html**

Temporarily add one line inside `<head>` in `web/index.html`:

```html
<meta name="probe" content="%VITE_SITE_URL%" />
```

- [ ] **Step 2: Build with the variable set and inspect the output**

```bash
cd web
VITE_SITE_URL=https://example.test pnpm build
grep -o 'name="probe"[^>]*' dist/index.html
```

Expected if the feature works: `name="probe" content="https://example.test"`.

Expected if it does not: `name="probe" content="%VITE_SITE_URL%"`.

- [ ] **Step 3: Record the result and clean up**

```bash
cd web && rm -rf dist
git checkout -- index.html
```

**If the substitution worked**, proceed to Task 2 as written.

**If it did not**, stop and report it rather than working around it silently.
The fallback is to hardcode the production origin in `index.html` and drop
`VITE_SITE_URL` from Task 3, which is a real change to the approved design and
belongs in front of a human, not buried in an implementation.

No commit. Nothing changed.

---

## Task 2: The About page

**Files:**
- Create: `web/src/features/about/AboutPage.tsx`
- Create: `web/src/features/about/AboutPage.test.tsx`
- Modify: `web/src/routes/router.tsx`
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/auth/LoginPage.tsx`
- Modify: `web/src/routes/access.test.tsx`

**Interfaces:**
- Consumes: `Link` and `NavLink` from `react-router`, `renderWithProviders`
  from `web/src/test/render.tsx`, and `access.test.tsx`'s existing
  `signedIn()` and `signedOut()` helpers.
- Produces: `AboutPage`, exported from
  `web/src/features/about/AboutPage.tsx`, taking no props. Route `/about`.

**One deviation from the spec, made deliberately.** The spec says the page's
heading links to `/`. Implemented literally, a visitor who clicks a heading
reading "About Manguito Secret Manager" gets bounced to a login screen, which
is a hostile thing for a public page to do. The logo carries the link instead,
which is the conventional affordance for "go to the app", and the heading
stays plain text. Same navigation, less surprise.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/about/AboutPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { AboutPage } from "./AboutPage";

/** A router, because the page links home. It fetches nothing, so no MSW. */
function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/about", element: <AboutPage /> },
      { path: "/", element: <p>the app</p> },
    ],
    { initialEntries: ["/about"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("AboutPage", () => {
  it("heads the page with its own h1", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: /about manguito secret manager/i }),
    ).toBeInTheDocument();
  });

  it("offers a way back into the application", () => {
    renderPage();

    expect(screen.getByRole("link", { name: /manguito secret manager home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("links out to the maintainer, each opening safely in a new tab", () => {
    renderPage();

    const expected = [
      [/github/i, "https://github.com/bobbykim89"],
      [/linkedin/i, "https://www.linkedin.com/in/sihun-kim-9baa17165/"],
      [/email/i, "mailto:bobby.sihun.kim@gmail.com"],
    ] as const;

    for (const [name, href] of expected) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      // Without noreferrer the opened tab can reach back through
      // window.opener, and these are links off our own origin.
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm test AboutPage`
Expected: fails to resolve `./AboutPage`, because the module does not exist.

- [ ] **Step 3: Write the page**

Create `web/src/features/about/AboutPage.tsx`:

```tsx
import { Link } from "react-router";

/**
 * The application's second public page, beside the login screen.
 *
 * Standalone rather than a child of AppShell: it has to render for a signed
 * out visitor, which is the whole reason it is worth indexing, and AppShell's
 * header offers a Sign out button and links to pages such a visitor cannot
 * open.
 */

/**
 * Icons are Font Awesome Free 6.x, which is CC BY 4.0 and requires the
 * attribution rendered beside each path below. Inlined rather than pulled
 * from a package: three glyphs do not justify a dependency.
 */
const SOCIAL_LINKS = [
  {
    label: "GitHub",
    href: "https://github.com/bobbykim89",
    viewBox: "0 0 448 512",
    path: "M448 96c0-35.3-28.7-64-64-64H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V96zM265.8 407.7c0-1.8 0-6 .1-11.6c.1-11.4 .1-28.8 .1-43.7c0-15.6-5.2-25.5-11.3-30.7c37-4.1 76-9.2 76-73.1c0-18.2-6.5-27.3-17.1-39c1.7-4.3 7.4-22-1.7-45c-13.9-4.3-45.7 17.9-45.7 17.9c-13.2-3.7-27.5-5.6-41.6-5.6s-28.4 1.9-41.6 5.6c0 0-31.8-22.2-45.7-17.9c-9.1 22.9-3.5 40.6-1.7 45c-10.6 11.7-15.6 20.8-15.6 39c0 63.6 37.3 69 74.3 73.1c-4.8 4.3-9.1 11.7-10.6 22.3c-9.5 4.3-33.8 11.7-48.3-13.9c-9.1-15.8-25.5-17.1-25.5-17.1c-16.2-.2-1.1 10.2-1.1 10.2c10.8 5 18.4 24.2 18.4 24.2c9.7 29.7 56.1 19.7 56.1 19.7c0 9 .1 21.7 .1 30.6c0 4.8 .1 8.6 .1 10c0 4.3-3 9.5-11.5 8C106 393.6 59.8 330.8 59.8 257.4c0-91.8 70.2-161.5 162-161.5s166.2 69.7 166.2 161.5c.1 73.4-44.7 136.3-110.7 158.3c-8.4 1.5-11.5-3.7-11.5-8z",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/sihun-kim-9baa17165/",
    viewBox: "0 0 448 512",
    path: "M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z",
  },
  {
    label: "Email",
    href: "mailto:bobby.sihun.kim@gmail.com",
    viewBox: "0 0 512 512",
    path: "M64 112c-8.8 0-16 7.2-16 16l0 22.1L220.5 291.7c20.7 17 50.4 17 71.1 0L464 150.1l0-22.1c0-8.8-7.2-16-16-16L64 112zM48 212.2L48 384c0 8.8 7.2 16 16 16l384 0c8.8 0 16-7.2 16-16l0-171.8L322 328.8c-38.4 31.5-93.7 31.5-132 0L48 212.2zM0 128C0 92.7 28.7 64 64 64l384 0c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64L64 448c-35.3 0-64-28.7-64-64L0 128z",
  },
] as const;

export function AboutPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-[900px] rounded-lg border border-border bg-surface p-8 shadow-lg">
        <div className="flex flex-col items-center gap-8 md:flex-row md:gap-10">
          {/* The circle carries the brand colour and the logo sits inside it
              at 112px. logo.webp is 192px square, so filling a 240px circle
              would upscale it and soften visibly on a high density display. */}
          <Link
            to="/"
            aria-label="Manguito Secret Manager home"
            className="flex aspect-square w-full max-w-[240px] shrink-0 items-center justify-center rounded-full border-4 border-border bg-accent-100 transition-opacity hover:opacity-75"
          >
            <img src="/logo.webp" alt="" className="h-28 w-28 rounded-[24px]" />
          </Link>

          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">About Manguito Secret Manager</h1>

            <p>
              A self hosted secret manager. Secrets live in buckets, encrypted at rest with
              envelope encryption, and are reachable through this web interface or
              programmatically with a scoped API key.
            </p>

            <p className="text-text-muted">Maintained by Bobby Kim</p>

            <div className="flex items-center gap-4">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  // noreferrer, not just noopener: it covers the Referer
                  // header as well as window.opener.
                  rel="noreferrer"
                  aria-label={link.label}
                  className="text-text-muted transition-colors hover:text-accent"
                >
                  {/* !Font Awesome Free 6.6.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2024 Fonticons, Inc. */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox={link.viewBox}
                    fill="currentColor"
                    aria-hidden="true"
                    className="h-7 w-7"
                  >
                    <path d={link.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run the page's own tests**

Run: `cd web && pnpm test AboutPage`
Expected: 3 passing.

- [ ] **Step 5: Register the route**

In `web/src/routes/router.tsx`, add the import:

```tsx
import { AboutPage } from "../features/about/AboutPage";
```

and add the route beside the other public ones, directly after `/health`:

```tsx
  // Public like login and health: a page nobody can reach signed out is a
  // page no crawler can reach either, and this one exists to be found.
  { path: "/about", element: <AboutPage /> },
```

- [ ] **Step 6: Prove the route is public**

Append to the `describe("route access", ...)` block in
`web/src/routes/access.test.tsx`:

```tsx
  it("shows about to a signed out visitor rather than sending them to login", async () => {
    signedOut();
    const router = createMemoryRouter(routes, { initialEntries: ["/about"] });

    renderWithProviders(<RouterProvider router={router} />);

    // The whole public half of this page rests on this staying true. Moving
    // /about under RequireSession would still look correct to a signed in
    // developer and would silently make it invisible to crawlers.
    expect(
      await screen.findByRole("heading", { level: 1, name: /about manguito secret manager/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/about");
  });
```

- [ ] **Step 7: Link it from the shell's footer**

In `web/src/features/shell/AppShell.tsx`, add a third `NavLink` inside the
existing `<nav aria-label="Footer">`, after the Keys link, matching its
siblings exactly:

```tsx
          <NavLink to="/about" viewTransition className="text-accent">
            About
          </NavLink>
```

- [ ] **Step 8: Link it from the login page**

In `web/src/features/auth/LoginPage.tsx`, add a link below the sign in card,
inside `<main>` and immediately after the card's closing `</div>`:

```tsx
        <p className="mt-4 text-center text-sm text-text-muted">
          <Link to="/about" className="hover:text-accent">
            About this project
          </Link>
        </p>
```

The card is currently `<main>`'s only child, so wrap the card and this line
in a fragment or a flex column. Use a column so the spacing stays predictable:
change `<main className="flex items-center justify-center p-8">` to
`<main className="flex flex-col items-center justify-center p-8">`, which
leaves the card centred and puts the link beneath it.

Add `Link` to the existing `react-router` import at the top of the file:

```tsx
import { Link, Navigate, useSearchParams } from "react-router";
```

- [ ] **Step 9: Cover both links**

Append to `web/src/features/shell/AppShell.test.tsx`, inside its top level
`describe`:

```tsx
  it("links to the about page from the footer", () => {
    renderShell();

    const footer = screen.getByRole("navigation", { name: /footer/i });
    expect(within(footer).getByRole("link", { name: /about/i })).toHaveAttribute(
      "href",
      "/about",
    );
  });
```

Append to `web/src/features/auth/LoginPage.test.tsx`, inside its top level
`describe`:

```tsx
  it("offers the about page to a visitor who has not signed in", async () => {
    renderLogin();

    expect(await screen.findByRole("link", { name: /about this project/i })).toHaveAttribute(
      "href",
      "/about",
    );
  });
```

Both helpers already exist and are used by every other test in their file:
`renderShell()` at `AppShell.test.tsx:26` and `renderLogin(search = "")` at
`LoginPage.test.tsx:23`. `AppShell.test.tsx` already imports `within`;
`LoginPage.test.tsx` does not need it.

- [ ] **Step 10: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, 302 tests becoming 308 across 33 files.

- [ ] **Step 11: Commit**

```bash
git add web/src/features/about web/src/routes/router.tsx web/src/routes/access.test.tsx web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx web/src/features/auth/LoginPage.tsx web/src/features/auth/LoginPage.test.tsx
git commit -m "feat(web): add a public About page"
```

---

## Task 3: The metadata

**Files:**
- Modify: `web/index.html`
- Create: `web/public/robots.txt`
- Modify: `web/.env.example`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: Task 1's confirmed answer about `%VITE_SITE_URL%`. Do not start
  this task until that gate has passed.
- Produces: `og:image` pointing at `/og.png`, which Task 4 creates. The tag
  lands before the file, which is fine: nothing reads it until deployment.

- [ ] **Step 1: Add the tags**

In `web/index.html`, replace the single `<title>` line with the block below,
keeping everything else in `<head>` exactly as it is, including the inline
theme script:

```html
    <title>Manguito Secret Manager</title>
    <meta
      name="description"
      content="A self hosted secret manager. Secrets live in buckets, encrypted at rest, and reachable through the web interface or a scoped API key."
    />
    <link rel="canonical" href="%VITE_SITE_URL%/" />

    <!--
      Static, and necessarily so. This is a single page application: every
      route serves this same file, and crawlers do not run JavaScript, so
      these are the only tags any crawler will ever see. Per route cards
      would need prerendering, which two public pages do not justify.

      The absolute URLs come from VITE_SITE_URL, substituted by Vite at build
      time, so the repository carries no hardcoded domain.
    -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Manguito Secret Manager" />
    <meta property="og:title" content="Manguito Secret Manager" />
    <meta
      property="og:description"
      content="A self hosted secret manager. Secrets live in buckets, encrypted at rest, and reachable through the web interface or a scoped API key."
    />
    <meta property="og:url" content="%VITE_SITE_URL%/" />
    <meta property="og:image" content="%VITE_SITE_URL%/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Manguito Secret Manager" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Manguito Secret Manager" />
    <meta
      name="twitter:description"
      content="A self hosted secret manager. Secrets live in buckets, encrypted at rest, and reachable through the web interface or a scoped API key."
    />
    <meta name="twitter:image" content="%VITE_SITE_URL%/og.png" />
```

- [ ] **Step 2: Add robots.txt**

Create `web/public/robots.txt`:

```
# Crawlers asking for /buckets get this application's index.html with a 200,
# because the router runs in the browser. Without these rules a secret
# manager's internal route names end up in search indexes, describing pages
# that render nothing without a session.
#
# No Sitemap line: files in public/ are copied verbatim with no environment
# substitution, so it could not stay domain agnostic, and two public pages do
# not need one.
User-agent: *
Disallow: /buckets
Disallow: /keys
Disallow: /health
```

The spec sketched explicit `Allow:` lines alongside these. They are dropped
here: anything not disallowed is already allowed, and `Allow: /$` relies on a
non standard wildcard extension. Fewer directives, same behaviour.

- [ ] **Step 3: Document the variable**

Append to `web/.env.example`:

```
# Absolute origin, used by index.html's canonical and Open Graph tags. Vite
# substitutes %VITE_SITE_URL% at build time. Locally this only has to be
# well formed; in production it must be the real origin or shared links will
# point at the wrong host.
VITE_SITE_URL=http://localhost:5173
```

In `docs/deployment.md`, in the Vercel environment variable step, add
`VITE_SITE_URL` beside `VITE_API_URL`:

```
   VITE_API_URL  = https://api.example.com
   VITE_SITE_URL = https://app.example.com
```

and a sentence after that block:

> `VITE_SITE_URL` is the frontend's own origin, not the API's. It is baked
> into the canonical and Open Graph tags at build time, so getting it wrong
> means every shared link previews against the wrong host.

- [ ] **Step 4: Confirm the build resolves every token**

```bash
cd web
VITE_SITE_URL=https://example.test pnpm build
grep -c "%VITE_SITE_URL%" dist/index.html
```

Expected: `0`. Any other number means a token survived the build and would
ship literally.

Then confirm the tags actually carry the origin:

```bash
grep -o 'property="og:image" content="[^"]*"' dist/index.html
rm -rf dist
```

Expected: `content="https://example.test/og.png"`.

- [ ] **Step 5: Run the full suite**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass, unchanged from Task 2. No test asserts on `index.html`.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/public/robots.txt web/.env.example docs/deployment.md
git commit -m "feat(web): add Open Graph and search metadata"
```

---

## Task 4: The share image, and browser verification

**Files:**
- Create: `web/public/og.png`
- Scratchpad only, never committed: the generator and any screenshots.

**Interfaces:**
- Consumes: `og:image` from Task 3, which already points at `/og.png`.
- Produces: the file that tag refers to.

Playwright is already installed in the scratchpad. Confirm before assuming:

```bash
ls /tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad/node_modules/.bin/playwright
```

If it is missing, install it there with `npm install playwright --no-save`,
never into `web/`. Either way, verify afterwards that
`git status --porcelain web/package.json web/pnpm-lock.yaml` is empty.

- [ ] **Step 1: Build the card**

Write `og.html` in the scratchpad, sized exactly 1200 by 630, using the
application's real tokens and fonts. The fonts load from the repository over
`file://`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Inter";
        src: url("file:///mnt/projects/manguito-secret-manager/web/public/fonts/inter-600.woff2")
          format("woff2");
        font-weight: 600;
      }
      @font-face {
        font-family: "Figtree";
        src: url("file:///mnt/projects/manguito-secret-manager/web/public/fonts/figtree-400.woff2")
          format("woff2");
        font-weight: 400;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px;
        height: 630px;
        background: #f5ead8;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 0 90px;
      }
      .orn { position: absolute; border-radius: 50%; }
      .o1 { width: 420px; height: 420px; background: #f0fae1; opacity: .6; top: -120px; left: -110px; }
      .o2 { width: 260px; height: 260px; background: #ffe1d0; opacity: .5; bottom: 40px; left: 250px; }
      .o3 { width: 180px; height: 180px; background: #e1eecc; opacity: .5; bottom: -50px; right: 90px; }
      .row { position: relative; z-index: 1; display: flex; align-items: center; gap: 28px; margin-bottom: 26px; }
      img { width: 96px; height: 96px; border-radius: 24px; }
      h1 { font-family: Inter, sans-serif; font-weight: 600; font-size: 64px; color: #201e1d; }
      p { position: relative; z-index: 1; font-family: Figtree, sans-serif; font-size: 30px; color: #201e1d; opacity: .75; max-width: 760px; }
    </style>
  </head>
  <body>
    <div class="orn o1"></div>
    <div class="orn o2"></div>
    <div class="orn o3"></div>
    <div class="row">
      <img src="file:///mnt/projects/manguito-secret-manager/web/public/logo.webp" />
      <h1>Manguito Secret Manager</h1>
    </div>
    <p>Secrets, scoped to buckets and short-lived API keys.</p>
  </body>
</html>
```

Those hex values are the light mode tokens from `web/src/index.css`:
`--color-bg`, `--color-accent-2-100`, `--color-accent-200`,
`--color-accent-2-200`, `--color-text`.

- [ ] **Step 2: Render it**

```js
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto("file:///.../og.html");
await p.waitForTimeout(400); // let the woff2 faces settle before capture
await p.screenshot({ path: "/mnt/projects/manguito-secret-manager/web/public/og.png" });
await b.close();
```

- [ ] **Step 3: Look at it**

Open `web/public/og.png` with the Read tool and actually look at it. A script
that exits zero has proved the file exists, not that it is legible or that
the fonts loaded rather than silently falling back. Check the wordmark is
Inter rather than a default sans, nothing is clipped, and the logo is crisp.

Confirm the dimensions and that it is a reasonable size for a social scraper:

```bash
cd /mnt/projects/manguito-secret-manager/web/public
python3 -c "
d=open('og.png','rb').read()
print('bytes:', len(d))
print('dims:', int.from_bytes(d[16:20],'big'), 'x', int.from_bytes(d[20:24],'big'))
"
```

Expected: 1200 x 630, comfortably under 1 MB.

- [ ] **Step 4: Check the page in a browser**

Start the dev server, then check the About page at two widths in both themes:

```bash
cd web && pnpm run dev
```

Force the theme by setting `localStorage.theme` in an init script before
navigating, matching the inline script in `index.html`. Check, and look at
each screenshot rather than trusting assertions:

1. `/about` at 1280px in light and in dark: the card, the circle and all
   three icons legible, every token resolving in both themes.
2. `/about` at 380px: the `md:flex-row` collapses to a column, and the card
   does not overflow. Assert
   `document.documentElement.scrollWidth <= clientWidth`.
3. `/robots.txt` returns the file rather than the application's HTML.

Then stop the server:

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 5: Confirm the repository is clean**

```bash
cd /mnt/projects/manguito-secret-manager
git status --porcelain web/package.json web/pnpm-lock.yaml
git status --porcelain
```

The first must be empty. The second must show only `web/public/og.png`, plus
any fix a browser check turned up.

- [ ] **Step 6: Commit**

```bash
git add web/public/og.png
git commit -m "feat(web): add the Open Graph share image"
```

Record the provenance in the commit body: 1200x630, rendered from the
application's own light mode tokens and self hosted fonts with headless
Chrome, generator kept in the scratchpad rather than committed because it
needs a dependency this repository deliberately does not carry.

Any fix a browser check turns up gets its own separate commit, so review can
tell a verification fix from the feature.

---

## Self-Review

**Spec coverage.** The substitution gate is Task 1. The metadata block,
`robots.txt` with no sitemap, `VITE_SITE_URL` in `.env.example` and the
runbook are Task 3. The About page, its layout, its content, its three
documented departures from the reference, and both navigation links are Task
2. The share image and all three browser checks are Task 4. The spec's "out of
scope" items appear in no task, which is the intent.

**Type consistency.** `AboutPage` takes no props and is imported the same way
in its own test, in `router.tsx`, and implicitly through `routes` in
`access.test.tsx`. `SOCIAL_LINKS` is a single `as const` array whose `label`
supplies both the `aria-label` and the accessible name the tests query by, so
the two cannot drift apart.

**One deviation from the spec, already flagged in Task 2.** The spec put the
link home on the heading; the plan puts it on the logo. Same destination, and
it avoids a public page whose title bounces visitors to a login screen.

**One ordering note.** Task 3 writes an `og:image` tag pointing at a file
Task 4 creates. That is deliberate rather than an oversight: nothing reads
the tag until the site is deployed, and splitting the metadata from the binary
asset keeps the diffs reviewable.
