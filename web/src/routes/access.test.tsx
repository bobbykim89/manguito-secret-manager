import { useQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import { client } from "../api/client";
import { RequireSession } from "../features/auth/RequireSession";
import { LoginPage } from "../features/auth/LoginPage";
import { renderWithProviders } from "../test/render";
import { server } from "../test/setup";
import { routes } from "./router";

const ME = "http://localhost:8000/v1/auth/me";

function signedOut() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
        { status: 401 },
      ),
    ),
  );
}

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

describe("route access", () => {
  it("sends a signed out visitor from / to the login screen", async () => {
    signedOut();
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("returns the user to the login screen after signing out", async () => {
    signedIn();
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    renderWithProviders(<RouterProvider router={router} />);
    await screen.findByText("a@example.com");

    // The cookie is gone once logout succeeds, so /me must start refusing.
    // Without this the login page mounts a fresh observer, refetches at the
    // default staleTime of 0, gets a signed in user back, and bounces
    // straight to "/" again. The test would fail for a reason the
    // application does not actually have.
    server.use(
      http.post("http://localhost:8000/v1/auth/logout", () => {
        signedOut();
        return HttpResponse.json({ ok: true, data: { signed_out: true } });
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("keeps /health reachable while signed out", async () => {
    signedOut();
    server.use(
      http.get("http://localhost:8000/v1/health", () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/health"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });
});

/**
 * A protected page whose own request is rejected, so this exercises the global
 * handler through a query that is not the session check. Written against a
 * throwaway route because SP2b has no other authenticated call yet, and a test
 * using /me alone would pass even if the handler only ever worked for /me.
 */
function Probe() {
  useQuery({ queryKey: ["probe"], queryFn: () => client.get("/v1/probe") });
  return <p>probe rendered</p>;
}

describe("global 401 handling", () => {
  it("sends the user to login when a non-session query is unauthorised", async () => {
    signedIn();
    server.use(
      http.get("http://localhost:8000/v1/probe", () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );
    const probeRoutes: RouteObject[] = [
      { path: "/login", element: <LoginPage /> },
      { element: <RequireSession />, children: [{ path: "/", element: <Probe /> }] },
    ];
    const router = createMemoryRouter(probeRoutes, { initialEntries: ["/"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("link", { name: /continue with google/i })).toBeInTheDocument();
  });
});
