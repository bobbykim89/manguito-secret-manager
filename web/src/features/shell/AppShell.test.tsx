import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SESSION_QUERY_KEY } from "../../api/queryClient";
import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { AppShell } from "./AppShell";

const ME = "http://localhost:8000/v1/auth/me";
const LOGOUT = "http://localhost:8000/v1/auth/logout";

function signedIn() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json({
        ok: true,
        data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
      }),
    ),
  );
}

function renderShell() {
  return renderWithProviders(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("shows the signed in email", async () => {
    signedIn();

    renderShell();

    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
  });

  it("renders whatever the router puts inside it", async () => {
    signedIn();
    const router = createMemoryRouter(
      [{ element: <AppShell />, children: [{ path: "/", element: <p>child content</p> }] }],
      { initialEntries: ["/"] },
    );

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText("child content")).toBeInTheDocument();
  });

  it("clears the session when sign out succeeds", async () => {
    signedIn();
    server.use(http.post(LOGOUT, () => HttpResponse.json({ ok: true, data: { signed_out: true } })));
    const { queryClient } = renderShell();
    await screen.findByText("a@example.com");

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull());
  });

  it("keeps the session and explains when sign out fails", async () => {
    signedIn();
    server.use(http.post(LOGOUT, () => HttpResponse.error()));
    const { queryClient } = renderShell();
    await screen.findByText("a@example.com");

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not sign out/i);
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).not.toBeNull();
  });
});

describe("AppShell navigation", () => {
  it("offers both destinations", async () => {
    signedIn();

    renderShell();

    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(within(header).getByRole("link", { name: "Keys" })).toHaveAttribute("href", "/keys");
  });

  it("marks the current destination", async () => {
    signedIn();
    renderWithProviders(
      <MemoryRouter initialEntries={["/keys"]}>
        <AppShell />
      </MemoryRouter>,
    );

    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(header).getByRole("link", { name: "Buckets" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps Buckets current inside a bucket, since a secret list is still buckets", async () => {
    // NavLink matches descendants unless `end` is set, and not setting it is
    // deliberate here.
    signedIn();
    renderWithProviders(
      <MemoryRouter initialEntries={["/buckets/alpha"]}>
        <AppShell />
      </MemoryRouter>,
    );

    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("AppShell chrome", () => {
  it("renders the footer with its copyright", async () => {
    signedIn();

    renderShell();

    const footer = await screen.findByRole("contentinfo");
    expect(within(footer).getByText(/© 2026 Manguito Secret Manager/)).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(within(footer).getByRole("link", { name: "Keys" })).toHaveAttribute("href", "/keys");
  });

  it("offers a dark mode switch that reflects the resolved theme", async () => {
    signedIn();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");

    renderShell();

    const toggle = await screen.findByRole("switch", { name: "Dark mode" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("switches the document to dark and persists the choice", async () => {
    signedIn();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    const user = userEvent.setup();

    renderShell();

    await user.click(await screen.findByRole("switch", { name: "Dark mode" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

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

  it("links to the about page from the footer", async () => {
    signedIn();

    renderShell();

    const footer = await screen.findByRole("navigation", { name: /footer/i });
    expect(within(footer).getByRole("link", { name: /about/i })).toHaveAttribute("href", "/about");
  });
});

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
