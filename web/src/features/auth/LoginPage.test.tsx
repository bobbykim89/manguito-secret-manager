import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { LoginPage } from "./LoginPage";

const ME = "http://localhost:8000/v1/auth/me";

function unauthenticated() {
  server.use(
    http.get(ME, () =>
      HttpResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
        { status: 401 },
      ),
    ),
  );
}

function renderLogin(search = "") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>signed in area</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("offers a sign in link pointing at the API start endpoint", async () => {
    unauthenticated();

    renderLogin();

    const link = await screen.findByRole("link", { name: /continue with google/i });
    expect(link).toHaveAttribute("href", "http://localhost:8000/v1/auth/google/start");
  });

  it("shows no error when there is no error parameter", async () => {
    unauthenticated();

    renderLogin();

    await screen.findByRole("link", { name: /continue with google/i });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["CONSENT_DENIED", /cancelled/i],
    ["INVALID_STATE", /expired/i],
    ["EXCHANGE_FAILED", /could not complete/i],
    ["EMAIL_NOT_VERIFIED", /not verified/i],
  ])("renders the message for %s", async (code, pattern) => {
    unauthenticated();

    renderLogin(`?error=${code}`);

    expect(await screen.findByRole("alert")).toHaveTextContent(pattern);
  });

  it("renders the fallback and not the raw parameter for an unknown code", async () => {
    unauthenticated();

    renderLogin("?error=Your%20account%20is%20locked.%20Call%20555-0100.");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not complete/i);
    expect(alert).not.toHaveTextContent(/555/);
  });

  it("redirects an already authenticated visitor away from the login screen", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
    );

    renderLogin();

    expect(await screen.findByText("signed in area")).toBeInTheDocument();
  });
});
