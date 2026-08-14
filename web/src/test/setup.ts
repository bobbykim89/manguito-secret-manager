import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/**
 * jsdom does not implement matchMedia. ThemeProvider (now mounted by every
 * test via renderWithProviders) calls it unconditionally on first render, so
 * every test needs a stub, not just the ones about theme.
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

/**
 * jsdom has no document.startViewTransition. AppShell's links set
 * viewTransition, so any test that navigates would otherwise print a
 * console warning. Guarded so a real implementation is never overwritten.
 */
if (!("startViewTransition" in document)) {
  Object.defineProperty(document, "startViewTransition", {
    writable: true,
    value: (callback: () => void) => {
      callback();
      return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    },
  });
}

/** Shared MSW server. ADR 003 requires mocking at the fetch layer, not hooks. */
export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterAll(() => {
  server.close();
});
