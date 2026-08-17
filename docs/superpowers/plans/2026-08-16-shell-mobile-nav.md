# Shell Mobile Nav and Toggle Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the header's dark mode switch a sun and moon indicator, and
collapse the nav links and account controls behind a hamburger below the `md`
breakpoint, without changing the desktop layout.

**Architecture:** Both changes live entirely at the `AppShell` call site. The
icons are inline SVG siblings of the existing `ToggleSwitch`, which is not
modified. The menu keeps one single set of controls and changes only their
layout: the header's existing `flex-wrap` plus `w-full md:w-auto` on the two
collapsing groups puts each on its own row below `md` and inline above it, so
nothing is duplicated in the DOM or the accessibility tree.

**Tech Stack:** React 19, React Router 7, Tailwind 4, Vitest with jsdom,
Testing Library, MSW. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-shell-mobile-nav-design.md`

## Global Constraints

- **`web/src/components/ToggleSwitch.tsx` is not modified.** It is shared with
  `CreateKeyFlow`'s capability flags, so theme semantics must not leak into it.
- **No new npm dependency.** Icons are inlined SVG.
- **Tailwind only.** No CSS modules, no styled-components, no inline `style`.
- **Dark mode tokens:** only the 100 and 800 steps of each colour ramp carry
  dark values, plus `accent-600/700` and `danger-600`. This work uses only
  `text-accent`, `text-text-muted` and `border-border`, all of which are safe.
- **Tests assert behaviour, not classes.** The single exception is the existing
  `flex-wrap` assertion, which stays for the reason given in the spec.
- **No em dashes** in code comments, commit messages or docs.
- **Conventional commits**, imperative mood, scoped: `feat(web): ...`,
  `fix(web): ...`, `test(web): ...`.
- **Commands:** `cd web && pnpm run lint && pnpm run typecheck && pnpm test`.
  Run all three before any commit.
- The suite is currently 12 tests in `AppShell.test.tsx`. Eleven must remain
  untouched; the twelfth is rewritten, not deleted.

---

## File Structure

Only two files change.

| File | Responsibility after this work |
|---|---|
| `web/src/features/shell/AppShell.tsx` | The signed in shell. Gains four small module-level icon components, one piece of disclosure state, and the reordered header. |
| `web/src/features/shell/AppShell.test.tsx` | Gains six disclosure tests. One existing test is renamed and recommented. |

**Why the icons live in `AppShell.tsx` rather than a new `components/icons.tsx`:**
all four are used by this file and nothing else. A shared icon module with a
single consumer is a boundary invented ahead of a second caller. If a second
caller ever appears, extracting them is a rename and a move. The file goes from
118 lines to roughly 230, which is still one component with one job.

---

### Task 1: The sun and moon indicator

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `useTheme()` from `../../components/useTheme`, already imported,
  returning `{ resolved, setPreference }` where `resolved` is `"light" | "dark"`.
- Produces: `SunIcon` and `MoonIcon`, module-level components in
  `AppShell.tsx` taking `{ className }: { className?: string }`. Task 2 adds
  two more icon components alongside them and does not touch these.

**On testing:** this task adds no unit test, deliberately. The icons are
`aria-hidden` decoration with no behaviour, no state and no accessible name.
A test asserting `container.querySelectorAll("svg").length === 2` would assert
nothing a regression could fail meaningfully, and this project has a recorded
history of assertions that looked like proof and were not. The real check is
Task 3's browser pass. The 12 existing tests must stay green, which is what
proves this task broke nothing: in particular the two switch tests, which would
fail if the icons were accidentally nested inside the button and changed its
accessible name.

- [ ] **Step 1: Add the two icon components**

Insert immediately after the `navLinkClass` definition near the top of
`web/src/features/shell/AppShell.tsx`, before the `AppShell` docstring.

```tsx
/*
 * Drawn here rather than inlined from Font Awesome like the About page's
 * social icons. Those are brand glyphs where the official shape is the point
 * and the licence requires attribution. A sun and a moon are generic forms,
 * so matching this design's stroke weight is worth more than matching
 * someone else's, and no attribution obligation arises either way. Neither
 * approach adds a dependency.
 *
 * Both are aria-hidden. The switch beside them already carries role="switch",
 * aria-checked and aria-label="Dark mode", so a screen reader has the whole
 * story and these would only repeat it. They exist for sighted users, who
 * had position alone to go on before.
 */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
```

- [ ] **Step 2: Wrap the switch with the icons**

In `AppShell`, replace the `ToggleSwitch` element and the comment directly
above it. The current code is:

```tsx
          {/* Named for the thing being switched, not for the act of
              switching: role="switch" already conveys that it toggles, so
              "Dark mode, switch, on" reads correctly. */}
          <ToggleSwitch
            checked={resolved === "dark"}
            onChange={(checked) => setPreference(checked ? "dark" : "light")}
            label="Dark mode"
          />
```

Replace it with:

```tsx
          {/* The icons flank the switch rather than living inside it:
              ToggleSwitch also renders the API key capability flags, so theme
              semantics have no business in it. Its own docstring settles this,
              a caller wanting visible labelling wraps it.

              Whichever side is active takes the accent, so the control says
              its state twice: knob position and colour. */}
          <div className="flex items-center gap-2">
            <SunIcon
              className={`h-4 w-4 shrink-0 ${resolved === "dark" ? "text-text-muted" : "text-accent"}`}
            />
            {/* Named for the thing being switched, not for the act of
                switching: role="switch" already conveys that it toggles, so
                "Dark mode, switch, on" reads correctly. */}
            <ToggleSwitch
              checked={resolved === "dark"}
              onChange={(checked) => setPreference(checked ? "dark" : "light")}
              label="Dark mode"
            />
            <MoonIcon
              className={`h-4 w-4 shrink-0 ${resolved === "dark" ? "text-accent" : "text-text-muted"}`}
            />
          </div>
```

`shrink-0` on both, for the same reason `ToggleSwitch` itself carries it: this
sits in a flex row alongside a truncating email, and the browser will happily
squash an SVG that does not forbid it.

- [ ] **Step 3: Verify nothing regressed**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`

Expected: PASS. `AppShell.test.tsx` reports 12 passing, unchanged. If either
switch test fails on the accessible name, the icons ended up inside the button
rather than beside it, which is the one mistake this step can make.

- [ ] **Step 4: Commit**

```bash
cd /mnt/projects/manguito-secret-manager
git add web/src/features/shell/AppShell.tsx
git commit -m "feat(web): show sun and moon beside the dark mode switch

The switch had no indicator, so what it controlled was a guess until you
flipped it. The icons sit beside it rather than inside it because ToggleSwitch
also renders the API key capability flags, where a moon would be nonsense.

Whichever side is active takes the accent colour, so the control now carries
its state in colour as well as knob position."
```

---

### Task 2: The hamburger disclosure

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx`
- Modify: `web/src/features/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `SunIcon` and `MoonIcon` from Task 1, both already in this file.
  Do not move or re-declare them.
- Produces: two more module-level components in `AppShell.tsx`,
  `HamburgerIcon` and `CloseIcon`, each taking no props. Two DOM ids,
  `shell-nav` and `shell-account`, referenced together by the button's
  `aria-controls`.

**Read this before starting.** The header already has `flex-wrap`. It is
required, not incidental: `w-full` on a flex item sets its basis, it does not
start a new row, so without wrapping the whole line squeezes instead of
stacking. Do not remove it. The test that asserts it stays, with a new name.

- [ ] **Step 1: Write the failing tests**

Append this block to `web/src/features/shell/AppShell.test.tsx`. It uses the
existing `signedIn()` and `renderShell()` helpers already defined at the top of
that file, so add no new helpers.

```tsx
describe("AppShell mobile menu", () => {
  it("starts closed", async () => {
    signedIn();

    renderShell();

    expect(await screen.findByRole("button", { name: "Menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens when the button is pressed", async () => {
    signedIn();
    const user = userEvent.setup();

    renderShell();

    const button = await screen.findByRole("button", { name: "Menu" });
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("names both groups it controls, since two collapse together", async () => {
    signedIn();

    renderShell();

    const button = await screen.findByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-controls", "shell-nav shell-account");
    expect(document.getElementById("shell-nav")).not.toBeNull();
    expect(document.getElementById("shell-account")).not.toBeNull();
  });

  it("closes on Escape and hands focus back to the button", async () => {
    signedIn();
    const user = userEvent.setup();

    renderShell();

    const button = await screen.findByRole("button", { name: "Menu" });
    await user.click(button);
    await user.keyboard("{Escape}");

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("closes when something outside the header is clicked", async () => {
    signedIn();
    const user = userEvent.setup();

    renderShell();

    const button = await screen.findByRole("button", { name: "Menu" });
    await user.click(button);
    await user.click(document.body);

    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when a destination is chosen, so it does not hang open after navigating", async () => {
    signedIn();
    const user = userEvent.setup();

    renderShell();

    const button = await screen.findByRole("button", { name: "Menu" });
    await user.click(button);
    const header = screen.getByRole("banner");
    await user.click(within(header).getByRole("link", { name: "Keys" }));

    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- AppShell`

Expected: 6 FAIL, 12 PASS. Every new failure reads
`Unable to find an accessible element with the role "button" and name "Menu"`,
because the button does not exist yet.

- [ ] **Step 3: Add the hamburger and close icons**

Insert in `web/src/features/shell/AppShell.tsx` directly after `MoonIcon`.

```tsx
function HamburgerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
```

- [ ] **Step 4: Add the state and the dismissal effect**

Add `useEffect`, `useRef` and `useState` to the React import at the top of the
file. The file currently imports nothing from `react`, so add a new line above
the `react-router` import:

```tsx
import { useEffect, useRef, useState } from "react";
```

Then inside `AppShell`, directly after the existing `useTheme` line:

```tsx
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /*
   * A disclosure, not a dialog, so no focus trap. Trapping focus in a
   * disclosure is a common enough mistake to be worth naming: Modal already
   * implements trapping, Escape and focus restoration, and reusing it here
   * would be the wrong prior art. Only two of those three belong.
   *
   * Escape hands focus back to the button, because the user's focus was
   * inside the panel that just vanished. An outside click deliberately does
   * not, because focus is already going wherever they clicked.
   */
  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    function handlePointerDown(event: MouseEvent) {
      if (headerRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);
```

- [ ] **Step 5: Restructure the header**

Replace the whole `<header>` element, from its opening tag through its closing
`</header>`, with the block below. The brand `Link`, the two `NavLink`s, the
theme group from Task 1, the email span and the Sign out button all keep their
existing content and comments; what changes is the nesting and the classes.

```tsx
      {/*
        flex-wrap is the mechanism the mobile menu is built on, not a leftover.
        w-full sets a flex item's basis, it does not start a new row, so
        without wrapping the four groups below would squeeze onto one line
        instead of stacking. Nothing in jsdom can observe that, which is why
        the class carries a test.

        justify-between is deliberately absent: it distributed two children
        here once, and there are four now. ml-auto on the button and
        md:ml-auto on the account group reproduce it at each width instead.
      */}
      <header
        ref={headerRef}
        className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-bg px-6 py-4"
      >
        <Link to="/buckets" viewTransition className="flex items-center gap-2.5">
          <img src="/logo.webp" alt="" className="h-7 w-7 rounded-lg" />
          {/* Hidden rather than removed below sm: the logo still carries the
              brand at that width, and the wordmark is the single widest item
              in the header. It stays in the DOM, so nothing that queries for
              it breaks. */}
          <span className="hidden font-sans font-semibold sm:inline">
            Manguito Secret Manager
          </span>
        </Link>

        {/* Two groups collapse together, so aria-controls names both. A
            space separated id list is valid ARIA, and it beats wrapping them
            in one element, which would drag the nav to the right on desktop. */}
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((was) => !was)}
          aria-expanded={menuOpen}
          aria-controls="shell-nav shell-account"
          aria-label="Menu"
          className="ml-auto rounded-sm border border-border p-1.5 md:hidden"
        >
          {menuOpen ? <CloseIcon /> : <HamburgerIcon />}
        </button>

        {/* NavLink rather than Link: it supplies isActive and sets
            aria-current, so the current destination needs no state and no
            route matching here. `end` is deliberately unset, so
            /buckets/:name keeps Buckets marked. */}
        <nav
          id="shell-nav"
          aria-label="Main"
          className={`${menuOpen ? "flex" : "hidden"} w-full items-center gap-4 text-sm md:flex md:w-auto`}
        >
          <NavLink
            to="/buckets"
            viewTransition
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Buckets
          </NavLink>
          <NavLink
            to="/keys"
            viewTransition
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Keys
          </NavLink>
        </nav>

        <div
          id="shell-account"
          className={`${menuOpen ? "flex" : "hidden"} w-full items-center gap-4 md:ml-auto md:flex md:w-auto`}
        >
          {/* The icons flank the switch rather than living inside it:
              ToggleSwitch also renders the API key capability flags, so theme
              semantics have no business in it. Its own docstring settles this,
              a caller wanting visible labelling wraps it.

              Whichever side is active takes the accent, so the control says
              its state twice: knob position and colour. */}
          <div className="flex items-center gap-2">
            <SunIcon
              className={`h-4 w-4 shrink-0 ${resolved === "dark" ? "text-text-muted" : "text-accent"}`}
            />
            {/* Named for the thing being switched, not for the act of
                switching: role="switch" already conveys that it toggles, so
                "Dark mode, switch, on" reads correctly. */}
            <ToggleSwitch
              checked={resolved === "dark"}
              onChange={(checked) => setPreference(checked ? "dark" : "light")}
              label="Dark mode"
            />
            <MoonIcon
              className={`h-4 w-4 shrink-0 ${resolved === "dark" ? "text-accent" : "text-text-muted"}`}
            />
          </div>
          {session.status === "authenticated" && (
            /* min-w-0 with truncate so a long address shrinks instead of
                shoving Sign out off the edge. Truncated rather than hidden:
                which account you are signed in as is worth knowing in a secret
                manager. */
            <span className="min-w-0 truncate text-[13px] opacity-70">{session.user.email}</span>
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
```

Note what left: the `<div className="flex items-center gap-6">` that used to
hold the brand and nav together, and the `<div className="flex items-center gap-4">`
that held the account controls. The first is gone entirely, its 24px gap now
supplied by the header's own `gap-x-6`. The second survives as `#shell-account`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && pnpm test -- AppShell`

Expected: 18 PASS. All 6 new tests pass and all 12 existing tests still pass.

If "offers both destinations" or "marks the current destination" fails, the
nav ended up outside `<header>`. If the `flex-wrap` test fails, the class was
dropped from the header, which would silently break the entire mobile stack.

- [ ] **Step 7: Rename the flex-wrap test to describe what it now guards**

In `web/src/features/shell/AppShell.test.tsx`, replace this test and the
comment above it:

```tsx
  // A class assertion, which this suite otherwise avoids, for the same reason
  // Modal's height bound has one: jsdom performs no layout, so a wrapping
  // header cannot be verified here. The real check is a browser at 380px. This
  // exists so the fix cannot be deleted silently by a later refactor.
  it("lets its header wrap rather than overflow a narrow viewport", () => {
    signedIn();

    renderShell();

    expect(screen.getByRole("banner").className).toMatch(/flex-wrap/);
  });
```

with:

```tsx
  // A class assertion, which this suite otherwise avoids, for the same reason
  // Modal's height bound and the vercel.json rewrite have one: nothing
  // reachable from a test can observe it, and losing it fails silently.
  //
  // The header wraps so that w-full puts the nav and the account controls each
  // on their own row when the mobile menu opens. w-full alone would not do it:
  // it sets a flex item's basis, and in a non-wrapping container the line
  // squeezes rather than stacks. jsdom performs no layout, so every test here
  // would still pass with the menu collapsed onto one crushed row.
  it("keeps the wrap its mobile menu stacks on", () => {
    signedIn();

    renderShell();

    expect(screen.getByRole("banner").className).toMatch(/flex-wrap/);
  });
```

- [ ] **Step 8: Run the full suite and the linters**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`

Expected: all PASS. `AppShell.test.tsx` reports 18.

- [ ] **Step 9: Commit**

```bash
cd /mnt/projects/manguito-secret-manager
git add web/src/features/shell/AppShell.tsx web/src/features/shell/AppShell.test.tsx
git commit -m "feat(web): collapse the header behind a hamburger on mobile

The nav links, the signed in address, the theme switch and Sign out all
competed for one row on a phone. They now sit behind a disclosure below md.

One set of controls, not two. A hidden mobile copy alongside a desktop one
would put two Sign out buttons and two Buckets links in the accessibility
tree, and would break every scoped query in the suite. So only the layout
changes: flex-wrap plus w-full md:w-auto gives each group its own row on
mobile and leaves the desktop row exactly as it was.

No focus trap. This is a disclosure and not a dialog, so Escape and focus
restoration apply and trapping does not, which is why it does not reuse Modal."
```

---

### Task 3: Browser verification

**Files:**
- Modify: `web/src/features/shell/AppShell.tsx` only if a check fails.

**Interfaces:**
- Consumes: the finished header from Task 2.
- Produces: nothing the code depends on. Its output is either a clean report
  or a fix commit.

**Why this is a task and not a footnote:** `web/vite.config.ts` sets
`test: { css: false }`, so jsdom applies no styles and performs no layout.
Every green test in Task 2 would stay green with the header visually broken.
`ToggleSwitch` in particular shipped once with a knob overflowing its track by
18px while 265 tests passed, and later needed `shrink-0` when first placed in a
flex row. Screenshots must be opened and looked at. A script that exits 0 has
proved only that it ran.

- [ ] **Step 1: Install Playwright into the scratchpad**

Never into `web/`. This adds no dependency to the project.

```bash
cd /tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad
npm install playwright --no-save --silent
```

- [ ] **Step 2: Start the dev server**

```bash
cd /mnt/projects/manguito-secret-manager/web && pnpm run dev
```

Run it in the background. It serves on port 5173.

- [ ] **Step 3: Write the capture script**

Save as `shell-check.mjs` in the scratchpad. `page.route` fakes the
authenticated session, so no OAuth round trip is needed.

```js
import { chromium } from "playwright";

const SESSION = {
  ok: true,
  data: { id: "11111111-1111-1111-1111-111111111111", email: "bobby.kim.long.address@example.com", name: "Bobby" },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function shot(name, width, { dark, open }) {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  await page.route("**/v1/auth/me", (r) => r.fulfill({ json: SESSION }));
  await page.route("**/v1/buckets*", (r) => r.fulfill({ json: { ok: true, data: [] } }));
  await page.addInitScript((d) => window.localStorage.setItem("theme", d ? "dark" : "light"), dark);

  await page.goto("http://localhost:5173/buckets");
  await page.waitForSelector("header");
  if (open) await page.getByRole("button", { name: "Menu" }).click();

  const header = page.locator("header");
  const box = await header.boundingBox();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(name, "headerWidth", box.width, "viewport", width, "pageOverflows", overflow);

  await page.screenshot({ path: `${name}.png`, clip: { x: 0, y: 0, width, height: Math.ceil(box.height) + 20 } });
  await page.close();
}

await shot("380-closed-light", 380, { dark: false, open: false });
await shot("380-open-light", 380, { dark: false, open: true });
await shot("380-open-dark", 380, { dark: true, open: true });
await shot("768-light", 768, { dark: false, open: false });
await shot("1280-light", 1280, { dark: false, open: false });
await shot("1280-dark", 1280, { dark: true, open: false });

await browser.close();
```

- [ ] **Step 4: Run it and open every screenshot**

```bash
cd /tmp/claude-1000/-mnt-projects-manguito-secret-manager/dcf81b36-f615-42f2-aece-99cb0d92b35b/scratchpad
node shell-check.mjs
```

`pageOverflows` must be `false` for all six. Then read each PNG with the Read
tool and check it against the list below. Do not skip this; the numbers cannot
see a wrong colour or a clipped glyph.

| Screenshot | What must be true |
|---|---|
| `380-closed-light` | One row: logo left, hamburger right. No nav, no email, no switch, no Sign out. |
| `380-open-light` | Three rows: logo and X, then Buckets and Keys, then sun, switch, moon, email, Sign out. Everything inside 380px. |
| `380-open-dark` | Same layout. Moon accented, sun muted. Both icons visible against the dark background. |
| `768-light` | Full desktop row, no hamburger, nothing clipped or overlapping. This is the tightest the full row ever gets. |
| `1280-light` | Brand, then Buckets and Keys at 24px from the wordmark, then the account group hard right. Sun accented, moon muted. Compare against the current deployed header: it must be indistinguishable. |
| `1280-dark` | Same, with the moon accented and the sun muted. |

- [ ] **Step 5: Check the switch itself up close**

Add to the script and rerun, or run as a separate snippet against the 1280
dark page:

```js
const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
await page.route("**/v1/auth/me", (r) => r.fulfill({ json: SESSION }));
await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
await page.goto("http://localhost:5173/buckets");
await page.waitForSelector("header");
const group = page.locator('header [role="switch"]').locator("xpath=..");
await group.screenshot({ path: "switch-closeup.png" });
const track = await page.locator('header [role="switch"]').boundingBox();
const knob = await page.locator('header [role="switch"] span').boundingBox();
console.log("track", track, "knob", knob);
console.log("knob inside track:", knob.x >= track.x && knob.x + knob.width <= track.x + track.width);
```

`knob inside track` must print `true`. Open `switch-closeup.png` and confirm
the sun, track, knob and moon read as one control rather than three loose
objects.

- [ ] **Step 6: Stop the dev server**

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 7: Confirm the repo took no dependency**

```bash
cd /mnt/projects/manguito-secret-manager
git status --porcelain web/package.json web/pnpm-lock.yaml
```

Expected: empty output. Anything else means Playwright was installed into the
project and must be reverted.

- [ ] **Step 8: Fix anything the checks found, then commit**

If every check passed, there is nothing to commit and this task ends here; say
so plainly rather than manufacturing a commit. If a check failed, fix it in
`AppShell.tsx`, rerun `cd web && pnpm run lint && pnpm run typecheck && pnpm test`,
rerun the affected screenshot, and commit with a message naming the width the
defect appeared at and what was wrong.

```bash
git add web/src/features/shell/AppShell.tsx
git commit -m "fix(web): <what was wrong> at <width>"
```

---

## Self-Review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| ToggleSwitch not modified | Global Constraints; Task 1 Step 2 puts icons outside it |
| Sun before, moon after, `flex items-center gap-2` | Task 1 Step 2 |
| Both `aria-hidden` | Task 1 Step 1 |
| Active side `text-accent`, inactive `text-text-muted` | Task 1 Step 2 |
| `h-4 w-4` | Task 1 Step 2 |
| Drawn geometry, not Font Awesome, reason recorded | Task 1 Step 1 comment |
| Existing "Dark mode" label comment kept | Task 1 Step 2 |
| One set of controls, not two | Task 2 Step 5; commit message |
| Flex wrap ordering table | Task 2 Step 5 |
| `justify-between` removed, `gap-x-6` | Task 2 Step 5 and its comment |
| `aria-controls="shell-nav shell-account"` | Task 2 Steps 1, 5 |
| `aria-expanded`, `aria-label="Menu"`, icon swap | Task 2 Steps 3, 5 |
| Escape closes and restores focus | Task 2 Step 4 |
| Click outside closes | Task 2 Step 4 |
| Nav link click closes | Task 2 Step 5 |
| No focus trap | Task 2 Step 4 comment; commit message |
| `flex-wrap` guard kept, renamed | Task 2 Step 7 |
| Six new behavioural tests | Task 2 Step 1 |
| Browser checks at 380, 768, 1280, plus the switch | Task 3 |

No gaps.

**Placeholder scan.** No TBD, TODO, "handle edge cases", or "similar to Task N".
Every code step carries the code. Task 3 Step 8 is conditional by nature, and
says what to do in each branch rather than deferring.

**Type consistency.** `SunIcon` and `MoonIcon` take `{ className?: string }`
and are called with `className` in both Task 1 and Task 2. `HamburgerIcon` and
`CloseIcon` take no props and are called with none. `menuOpen`, `setMenuOpen`,
`headerRef` and `menuButtonRef` are declared in Task 2 Step 4 and used in Step
5 with matching names. `resolved` and `setPreference` come from the existing
`useTheme` destructure, unchanged. The ids `shell-nav` and `shell-account`
appear identically in the test, the `aria-controls` value and the two elements.

**One thing worth flagging to a reviewer.** Task 2 Step 5 replaces the header
wholesale rather than editing it in place. That makes the diff look larger than
the change is: the brand link, both nav links, the theme group, the email span
and the Sign out button are all carried over verbatim, comments included. The
real changes are the two wrapper divs collapsing into the header itself, the
new button, the two ids, the class strings on nav and account, and
`justify-between` becoming `ml-auto` pairs.
