import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./useTheme";

function mockMatchMedia(initialMatches: boolean) {
  let changeListener: ((event: MediaQueryListEvent) => void) | null = null;
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      changeListener = listener;
    },
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockImplementation(() => mql) as unknown as typeof window.matchMedia;
  return {
    fireChange(matches: boolean) {
      mql.matches = matches;
      changeListener?.({ matches } as MediaQueryListEvent);
    },
  };
}

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <p role="status">
        preference: {preference}, resolved: {resolved}
      </p>
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

    expect(screen.getByRole("status")).toHaveTextContent("resolved: dark");
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

    expect(screen.getByRole("status")).toHaveTextContent("resolved: light");
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

  it("responds to a live system preference change when preference is system", () => {
    const media = mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("resolved: light");

    act(() => {
      media.fireChange(true);
    });

    expect(screen.getByRole("status")).toHaveTextContent("resolved: dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("throws when useTheme is called outside a ThemeProvider", () => {
    // Swallow the expected React error log for this one assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useTheme must be used within a ThemeProvider");
    spy.mockRestore();
  });
});
