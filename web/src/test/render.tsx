import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { createQueryClient } from "../api/queryClient";
import { ThemeProvider } from "../components/ThemeProvider";

/**
 * A fresh client per test, built by the same factory the application uses, so
 * tests exercise the real global 401 handler rather than a stand-in.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { queryClient?: QueryClient } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createQueryClient();

  return {
    ...render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </ThemeProvider>,
    ),
    queryClient,
  };
}
