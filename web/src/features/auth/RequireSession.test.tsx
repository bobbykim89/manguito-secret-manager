import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { RequireSession } from "./RequireSession";

const ME = "http://localhost:8000/v1/auth/me";

function renderGuard() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<RequireSession />}>
          <Route path="/" element={<p>protected content</p>} />
        </Route>
        <Route path="/login" element={<p>login screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireSession", () => {
  it("renders a loading state while the session is unknown", () => {
    server.use(http.get(ME, async () => new Promise(() => {})));

    renderGuard();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the children when authenticated", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
    );

    renderGuard();

    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("redirects to the login screen on a 401", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );

    renderGuard();

    expect(await screen.findByText("login screen")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("shows an error and does NOT redirect when the server is unreachable", async () => {
    server.use(http.get(ME, () => HttpResponse.error()));

    renderGuard();

    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText("login screen")).not.toBeInTheDocument();
  });
});
