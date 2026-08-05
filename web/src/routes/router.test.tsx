import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";
import { server } from "../test/setup";
import { routes } from "./router";

describe("router", () => {
  it("renders the health page at the index route", async () => {
    server.use(
      http.get("http://localhost:8000/v1/health", () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: /manguito secret manager/i })).toBeInTheDocument();
  });

  it("renders a not-found message for an unknown path", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/nope"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
