# UI Modernization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared visual foundation (theme tokens, dark mode, a self-hosted font, and three new components: `ToggleSwitch`, `Modal`, and a toast system) that four later, separate pieces will each reskin one existing page onto.

**Architecture:** Everything lives under `web/src/components/` alongside `Alert.tsx` and `ConfirmPrompt.tsx`, following their existing conventions exactly (plain Tailwind, no `className` prop, a doc comment on each export explaining why it exists). Nothing here is wired into an existing page: `ThemeProvider` and the toast system mount in `main.tsx`, above the router, but no route, page, or feature component changes.

**Tech Stack:** React 19, Tailwind 4 (`@theme`, `@custom-variant`), Vitest + React Testing Library, `@testing-library/user-event`. No new npm dependency.

## Global Constraints

- Branch `feat/ui-modernization-foundation` already carries the spec commit at `docs/superpowers/specs/2026-08-12-ui-modernization-foundation-design.md`. Work happens on this branch.
- No new npm dependency. The Inter font files are fetched as static assets via `curl`, never added to `package.json`.
- Every new shared component lives in `web/src/components/`. None takes a `className` prop; `Alert.tsx`'s doc comment states why: "A component that takes arbitrary classes is the styled paragraph it was extracted from."
- Tailwind only, no CSS modules, no styled-components.
- Doc comments explain why, not what. No em dashes anywhere: code, comments, commit messages, docs.
- Tests: Vitest + React Testing Library. `describe`/`it`, `userEvent` from `@testing-library/user-event` for interactions (never raw `.click()` or `fireEvent` for user-initiated events), `vi.fn()` for callbacks, queries by role or text, never `data-testid`.
- Commit messages: conventional commits, imperative mood, scoped (`feat(web): ...`, `docs: ...`).
- No page-level or feature file is modified anywhere in this plan: not `LoginPage.tsx`, `AppShell.tsx`, `BucketsPage.tsx`, `BucketRow.tsx`, `CreateBucketForm.tsx`, `SecretsPage.tsx`, `SecretRow.tsx`, `PutSecretForm.tsx`, `KeysPage.tsx`, `KeyRow.tsx`, `CreateKeyForm.tsx`, or `NewKeyPanel.tsx`. The only files this plan touches are `web/src/index.css`, `web/public/fonts/`, `web/index.html`, `web/src/main.tsx`, new files under `web/src/components/`, `CLAUDE.md`, and `docs/adr/0003-frontend-architecture.md`.
- `web/vite.config.ts` sets `test: { css: false }`, so Vitest never processes CSS. CSS changes are verified by `pnpm run build`, not by `pnpm test`.
- Before every commit that changes `.ts`/`.tsx` code, run `cd web && pnpm run lint && pnpm run typecheck && pnpm test`. After every commit that changes `index.css` or adds a font file, also run `cd web && pnpm run build`.
- `SecretRow.tsx` is missing the auto-mask-after-timeout behavior ADR 003 describes. This is a real, separate gap, out of scope for this plan. Do not fix it here.

---

### Task 1: Theme tokens, self-hosted Inter font, and page-transition CSS

**Files:**
- Modify: `web/src/index.css`
- Create: `web/public/fonts/inter-400.woff2`, `web/public/fonts/inter-600.woff2`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-danger`, `--color-border`, and `--font-sans`, each redefined under `[data-theme="dark"]`. Tailwind's `@theme` block turns these into utilities later tasks use directly: `bg-accent`, `bg-surface`, `text-text-muted`, `border-border`, `font-sans`, and so on. A `dark:` variant selecting on `[data-theme="dark"]` on `<html>` or an ancestor. `::view-transition-old(root)` / `::view-transition-new(root)` keyframes for a later piece's `viewTransition: true` navigation calls.

There is no automated test for this task. `@theme`, `@custom-variant`, and `@font-face` are Tailwind/CSS syntax with no JS behavior to assert on, and `vite.config.ts` disables CSS processing in the test environment (`test: { css: false }`) specifically because of this. The verification is a successful production build.

- [ ] **Step 1: Fetch the self-hosted Inter font files**

Run from the repo root:

```bash
mkdir -p web/public/fonts
curl -sL -o web/public/fonts/inter-400.woff2 "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-400-normal.woff2"
curl -sL -o web/public/fonts/inter-600.woff2 "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-600-normal.woff2"
file web/public/fonts/inter-400.woff2 web/public/fonts/inter-600.woff2
```

Expected: `file` reports both as `Web Open Font Format` (version 2), and neither file is empty (`ls -la web/public/fonts/` shows a non-zero size, tens of kilobytes each). These are real weight-400 and weight-600 static Latin subsets from the Fontsource CDN mirror, fetched once as static assets, not installed as an npm package.

If the network is unreachable from this environment and the fetch fails, report BLOCKED rather than committing empty or missing font files. Do not substitute a Google Fonts `<link>` tag or any other runtime CDN reference: the spec's whole point here is no live third-party request from a page that also handles authentication.

- [ ] **Step 2: Replace `web/src/index.css`**

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

@theme {
  --color-bg: #ffffff;
  --color-surface: #f8fafc;
  --color-text: #0f172a;
  --color-text-muted: #64748b;
  --color-accent: #4f46e5;
  --color-danger: #dc2626;
  --color-border: #e2e8f0;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

/*
 * Selector-based, not Tailwind's default prefers-color-scheme media variant.
 * A manual toggle (added in the next follow-up piece) has to be able to
 * override system preference, which a media-query variant cannot do.
 */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

[data-theme="dark"] {
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-text: #f1f5f9;
  --color-text-muted: #94a3b8;
  --color-accent: #818cf8;
  --color-danger: #f87171;
  --color-border: #334155;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}

/*
 * React Router's viewTransition navigation option (wired up in the
 * login/shell follow-up piece) targets the whole document under the
 * transition name "root" by default. No extra markup is needed for that;
 * this is only the animation the browser plays during the transition.
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

- [ ] **Step 3: Verify the build succeeds**

Run: `cd web && pnpm run build`
Expected: exits 0. This is the only check that actually parses `@theme`, `@custom-variant`, and the `@font-face` blocks; a syntax error in any of them fails here.

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css web/public/fonts/
git commit -m "feat(web): add theme tokens, dark variant, and self-hosted Inter"
```

---

### Task 2: `ThemeProvider` and `useTheme`

**Files:**
- Create: `web/src/components/ThemeProvider.tsx`
- Create: `web/src/components/useTheme.ts`
- Create: `web/src/components/ThemeProvider.test.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: the `[data-theme="dark"]` selector and CSS custom properties Task 1 defined in `web/src/index.css`.
- Produces: `ThemeProvider` (default export style not used anywhere in this codebase; named export, matching `Alert`/`ConfirmPrompt`), taking `{ children: ReactNode }`. `useTheme()`, returning `{ preference: "light" | "dark" | "system", resolved: "light" | "dark", setPreference: (p: "light" | "dark" | "system") => void }`, throwing if called outside a `ThemeProvider`. Later tasks and later pieces read `resolved` to know which theme is active and call `setPreference` from a `ToggleSwitch`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ThemeProvider.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./useTheme";

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference("dark")}>dark</button>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to system preference when nothing is stored", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies a stored preference over system preference", () => {
    mockMatchMedia(true);
    window.localStorage.setItem("theme", "light");

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("persists an explicit choice and updates data-theme", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "dark" }));

    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("clears the stored preference when returning to system", async () => {
    mockMatchMedia(false);
    window.localStorage.setItem("theme", "dark");
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "system" }));

    expect(window.localStorage.getItem("theme")).toBeNull();
  });

  it("throws when useTheme is called outside a ThemeProvider", () => {
    // Swallow the expected React error log for this one assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useTheme must be used within a ThemeProvider");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- ThemeProvider`
Expected: FAIL. `./ThemeProvider` and `./useTheme` do not exist yet.

- [ ] **Step 3: Create `web/src/components/ThemeProvider.tsx`**

```tsx
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/**
 * Applies data-theme to <html> and persists the choice.
 *
 * A UI preference, not a secret value: invariant 8 restricts secret
 * values specifically, and localStorage is the ordinary place for this,
 * the same as any other app's theme toggle.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const resolved: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (next === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

- [ ] **Step 4: Create `web/src/components/useTheme.ts`**

```ts
import { useContext } from "react";

import { ThemeContext } from "./ThemeProvider";

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && pnpm test -- ThemeProvider`
Expected: PASS, all 5 cases.

- [ ] **Step 6: Wire `ThemeProvider` into `web/src/main.tsx`**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { createQueryClient } from "./api/queryClient";
import { ThemeProvider } from "./components/ThemeProvider";
import "./index.css";
import { router } from "./routes/router";

const queryClient = createQueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 7: Run the full frontend suite and lint**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass. No existing test touches `main.tsx` directly, so nothing else should change.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ThemeProvider.tsx web/src/components/useTheme.ts web/src/components/ThemeProvider.test.tsx web/src/main.tsx
git commit -m "feat(web): add ThemeProvider and useTheme"
```

---

### Task 3: `ToggleSwitch`

**Files:**
- Create: `web/src/components/ToggleSwitch.tsx`
- Create: `web/src/components/ToggleSwitch.test.tsx`

**Interfaces:**
- Consumes: the `bg-accent` / `bg-surface` Tailwind utilities Task 1's `@theme` tokens generate.
- Produces: `ToggleSwitch`, taking `{ checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }`. `role="switch"`, `aria-checked`, `aria-label={label}`. Two known future consumers: a theme toggle, and the API-keys piece's capability toggles.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ToggleSwitch.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToggleSwitch } from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("reflects the checked state via aria-checked", () => {
    render(<ToggleSwitch checked label="Dark mode" onChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("reflects the unchecked state via aria-checked", () => {
    render(<ToggleSwitch checked={false} label="Dark mode" onChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls onChange with the flipped value on click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleSwitch checked={false} label="Dark mode" onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Dark mode" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("is disabled when disabled is set and does not fire onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleSwitch checked={false} label="Dark mode" onChange={onChange} disabled />);

    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle).toBeDisabled();

    await user.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
  });
});
```

If `toHaveBeenCalledExactlyOnceWith` is not recognized by the installed `@testing-library/jest-dom`/Vitest matcher set, replace it with `expect(onChange).toHaveBeenCalledOnce(); expect(onChange).toHaveBeenCalledWith(true);` and continue; this is not a reason to stop.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- ToggleSwitch`
Expected: FAIL. `./ToggleSwitch` does not exist yet.

- [ ] **Step 3: Create `web/src/components/ToggleSwitch.tsx`**

```tsx
/**
 * A controlled on/off switch, styled as a track and thumb.
 *
 * No internal state: the caller owns checked, the same contract as a
 * native checkbox. label sets the accessible name; nothing here renders
 * visible text, so a caller that wants a visible label wraps this itself.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition-colors ${
        checked ? "bg-accent" : "bg-surface"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm test -- ToggleSwitch`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Lint and typecheck**

Run: `cd web && pnpm run lint && pnpm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ToggleSwitch.tsx web/src/components/ToggleSwitch.test.tsx
git commit -m "feat(web): add ToggleSwitch component"
```

---

### Task 4: `Modal`

**Files:**
- Create: `web/src/components/Modal.tsx`
- Create: `web/src/components/Modal.test.tsx`
- Modify: `web/index.html`

**Interfaces:**
- Consumes: a `<div id="modal-root">` present in `index.html`, and the `bg-surface` Tailwind utility from Task 1.
- Produces: `Modal`, taking `{ open: boolean; onClose: () => void; title: string; children: ReactNode }`. Renders via `createPortal` into `#modal-root`. `role="dialog"` `aria-modal="true"`. Later pieces render their own form as `children` and call `onClose` themselves on submit or cancel; `Modal` owns no form logic.

- [ ] **Step 1: Add the portal root to `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Manguito Secret Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <div id="modal-root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `web/src/components/Modal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

beforeEach(() => {
  document.body.innerHTML = "";
  const portalRoot = document.createElement("div");
  portalRoot.id = "modal-root";
  document.body.appendChild(portalRoot);
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders its content when open", () => {
    render(
      <Modal open onClose={vi.fn()} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Create bucket" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", () => {
    render(
      <Modal open onClose={vi.fn()} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on a backdrop click but not a click inside the dialog", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Create bucket">
        <button>Save</button>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole("dialog").parentElement;
    if (!backdrop) throw new Error("dialog has no parent to click as the backdrop");
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores focus to the trigger element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();

    rerender(
      <Modal open={false} onClose={onClose} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(trigger).toHaveFocus();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && pnpm test -- Modal`
Expected: FAIL. `./Modal` does not exist yet.

- [ ] **Step 4: Create `web/src/components/Modal.tsx`**

```tsx
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A controlled dialog rendered outside the app tree via a portal.
 *
 * Focus moves into the dialog on open and returns to whatever triggered it
 * on close, so a keyboard user is never dropped back at the top of the
 * document. The caller owns its own form or content entirely; this only
 * owns the dialog chrome and the three ways out: Escape, a backdrop click,
 * and whatever calls onClose directly.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement;
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const portalRoot = document.getElementById("modal-root");
  if (!portalRoot) {
    throw new Error("#modal-root was not found. Add it to index.html.");
  }

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-lg border bg-surface p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    portalRoot,
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && pnpm test -- Modal`
Expected: PASS, all 6 cases.

- [ ] **Step 6: Lint and typecheck**

Run: `cd web && pnpm run lint && pnpm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Modal.tsx web/src/components/Modal.test.tsx web/index.html
git commit -m "feat(web): add Modal component"
```

---

### Task 5: Toast notifications

**Files:**
- Create: `web/src/components/ToastProvider.tsx`
- Create: `web/src/components/useToast.ts`
- Create: `web/src/components/ToastViewport.tsx`
- Create: `web/src/components/ToastProvider.test.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: the `bg-surface` Tailwind utility from Task 1.
- Produces: `ToastProvider` (`{ children: ReactNode }`), mounted once above the router. `useToast()`, returning a `notify(message: string, tone?: "success" | "info") => void` function, throwing if called outside a `ToastProvider`. `ToastViewport`, taking no props, rendering the active toast list; mounted once, alongside `ToastProvider`, in `main.tsx`. Later pieces call `useToast()` from a mutation's `onSuccess` and never touch `ToastViewport` or `ToastProvider` directly.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ToastProvider.test.tsx`:

```tsx
import { act } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { ToastProvider } from "./ToastProvider";
import { ToastViewport } from "./ToastViewport";
import { useToast } from "./useToast";

function Trigger({ message }: { message: string }) {
  const notify = useToast();
  return <button onClick={() => notify(message)}>Notify</button>;
}

describe("toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast after notify is called", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Bucket created" />
        <ToastViewport />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Notify" }));

    expect(screen.getByRole("status")).toHaveTextContent("Bucket created");
  });

  it("auto-dismisses a toast after the timeout", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Bucket created" />
        <ToastViewport />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows more than one toast at a time", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Bucket created" />
        <Trigger message="Secret added" />
        <ToastViewport />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Notify" }));
    await user.click(screen.getAllByRole("button", { name: "Notify" })[1]);

    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("throws when useToast is called outside a ToastProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger message="x" />)).toThrow(
      "useToast must be used within a ToastProvider",
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- ToastProvider`
Expected: FAIL. `./ToastProvider`, `./useToast`, and `./ToastViewport` do not exist yet.

- [ ] **Step 3: Create `web/src/components/ToastProvider.tsx`**

```tsx
import { createContext, useCallback, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "info";

export type ToastEntry = { id: number; message: string; tone: ToastTone };

type ToastContextValue = {
  toasts: ToastEntry[];
  notify: (message: string, tone?: ToastTone) => void;
};

const DISMISS_AFTER_MS = 4000;

export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Success confirmations only. Errors keep surfacing inline via Alert, next
 * to whatever failed. ADR 003's "errors surface where the thing that
 * failed is" is unchanged; this exists for confirmations that have nowhere
 * inline to live once the modal that triggered them has already closed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      const timer = setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, notify }}>{children}</ToastContext.Provider>
  );
}
```

- [ ] **Step 4: Create `web/src/components/useToast.ts`**

```ts
import { useContext } from "react";

import { ToastContext } from "./ToastProvider";

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context.notify;
}
```

- [ ] **Step 5: Create `web/src/components/ToastViewport.tsx`**

```tsx
import { useContext } from "react";

import { ToastContext } from "./ToastProvider";

/**
 * Renders whatever ToastProvider currently holds. Mounted once, near the
 * root, so it sits above every route rather than being duplicated per
 * page.
 */
export function ToastViewport() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("ToastViewport must be used within a ToastProvider");
  }

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2">
      {context.toasts.map((toast) => (
        <div key={toast.id} role="status" className="rounded border bg-surface px-4 py-2 text-sm shadow">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd web && pnpm test -- ToastProvider`
Expected: PASS, all 4 cases.

- [ ] **Step 7: Wire `ToastProvider` and `ToastViewport` into `web/src/main.tsx`**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { createQueryClient } from "./api/queryClient";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastProvider } from "./components/ToastProvider";
import { ToastViewport } from "./components/ToastViewport";
import "./index.css";
import { router } from "./routes/router";

const queryClient = createQueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
        <ToastViewport />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Run the full frontend suite and lint**

Run: `cd web && pnpm run lint && pnpm run typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/ToastProvider.tsx web/src/components/useToast.ts web/src/components/ToastViewport.tsx web/src/components/ToastProvider.test.tsx web/src/main.tsx
git commit -m "feat(web): add toast notifications"
```

---

### Task 6: CLAUDE.md and ADR 003 amendments

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/adr/0003-frontend-architecture.md`

**Interfaces:**
- Consumes: the shipped state of Tasks 1-5 (exact file paths, exact behavior), to describe accurately rather than aspirationally.
- Produces: nothing later tasks import. This is the last task in this plan.

There is no automated test for this task; it is prose. The task reviewer checks the amendments against what Tasks 1-5 actually built, not against the spec's description of what they'd build.

- [ ] **Step 1: Edit `CLAUDE.md`**

Find this line under "Out of scope for v1":

```
Secret versioning and history, zero-knowledge buckets, command palette, dark mode.
```

Replace it with:

```
Secret versioning and history, zero-knowledge buckets, command palette.
```

- [ ] **Step 2: Add A13 to `docs/adr/0003-frontend-architecture.md`**

Find the "Open questions" section near the top of the file:

```
- Dark mode. Trivial with Tailwind, but adds test surface. Probably yes, low priority.
```

Replace it with:

```
- Dark mode. Trivial with Tailwind, but adds test surface. Probably yes, low priority. **Resolved: see A13.**
```

(This matches the line immediately below it in the same list, which already carries its own resolution note pointing at A3.)

Then, after A12 at the end of the file, add:

```markdown

### A13. Dark mode is resolved

The open question above has stood since this ADR was first written:
"Dark mode. Trivial with Tailwind, but adds test surface. Probably yes,
low priority." CLAUDE.md separately listed dark mode under "Out of scope
for v1," for a different reason: it wasn't planned work, not a rejection.
That line is removed as part of the same decision this amendment records.

**Amended:** dark mode ships. `web/src/index.css` defines a
selector-based `dark:` variant
(`@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`),
not the framework's default `prefers-color-scheme` media variant, so a
manual toggle can override system preference. `ThemeProvider`/`useTheme`
(`web/src/components/ThemeProvider.tsx`) persist the choice to
`localStorage` under a `theme` key and fall back to `prefers-color-scheme`
when unset. This is a UI preference, not a secret value, so `localStorage`
is the ordinary place for it: invariant 8 restricts secret values
specifically.

### A14. Toasts are a scoped exception to A11

A11 removed Zustand and settled on "TanStack Query owns server state and
`useState` owns the rest," reasoning that every piece of state this app
had needed turned out to be component-local. A toast queue does not fit
that shape: it is triggered from wherever a mutation succeeds and rendered
once, high in the tree, so it needs to live somewhere neither its producer
nor its single consumer owns alone.

A11's target was dependence on a state-management package, not React's
own Context, but the distinction was never stated, so this amendment
states it directly rather than leaving it implied.

**Amended:** `ToastProvider` (`web/src/components/ToastProvider.tsx`) is a
React Context wrapping a `useState` list, mounted once above the router.
`useToast()` returns a `notify(message, tone?)` function; nothing else
about A11 changes. This is scoped to toast notifications specifically and
is not a general license for more shared client state. The next piece of
state that looks like it needs to be global should still be checked for
whether it is actually component-local first, the way A9 and this ADR's
own history already show it usually is.
```

- [ ] **Step 3: Verify the changes**

Run: `grep -n "dark mode" /path/to/repo/CLAUDE.md` (adjust to the actual repo path) and confirm the "Out of scope for v1" line no longer contains it.
Run: `grep -n "A13\|A14" docs/adr/0003-frontend-architecture.md` and confirm both amendments appear, plus the "Resolved: see A13" edit to the open-questions line.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/adr/0003-frontend-architecture.md
git commit -m "docs: resolve dark mode and record the toast exception in ADR 003"
```

---

## Final verification

After Task 6, from the repo root:

```bash
cd web && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build
```

Expected: all pass, and the build succeeds with the new CSS and font files in place. `make types` is not run for this plan: no Pydantic model changed, so `web/src/api/generated.ts` has no reason to drift.
