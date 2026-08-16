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
