import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { routes } from "./router";

describe("router", () => {
  it("renders the index route", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: /secretbox/i })).toBeInTheDocument();
  });

  it("renders a not-found message for an unknown path", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/nope"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
