import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
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

  it("says secret management is still to come", async () => {
    signedIn();

    renderShell();

    expect(await screen.findByText(/next sub-project/i)).toBeInTheDocument();
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
