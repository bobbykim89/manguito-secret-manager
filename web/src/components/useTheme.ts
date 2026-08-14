import { useContext } from "react";

import { ThemeContext } from "./ThemeProvider";

/**
 * Reads the current theme preference and resolved value, and lets callers
 * change it. Split from ThemeProvider so components don't need to import
 * the provider (and its context object) just to consume the theme.
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
