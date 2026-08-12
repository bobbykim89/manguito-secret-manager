import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { KeysPage } from "./KeysPage";

const BASE = "http://localhost:8000";
const TOKEN = "msm_a3f9c2e1_averylongsecretsegmenthere";

function created(name = "ci-deploy") {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    lookup_id: "a3f9c2e1",
    name,
    buckets: ["prod"],
    can_write: false,
    can_reveal: false,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-11T00:00:00Z",
    token: TOKEN,
  };
}

function handlers() {
  server.use(
    http.get(`${BASE}/v1/buckets`, () =>
      HttpResponse.json({
        ok: true,
        data: [{ id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 }],
      }),
    ),
    http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })),
    http.post(`${BASE}/v1/keys`, () =>
      HttpResponse.json({ ok: true, data: created() }, { status: 201 }),
    ),
  );
}

/** A data router with somewhere else to go, so the blocker has work to do. */
function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/keys",
        element: (
          <>
            <Link to="/buckets">Buckets</Link>
            <KeysPage />
          </>
        ),
      },
      { path: "/buckets", element: <p>the bucket list</p> },
    ],
    { initialEntries: ["/keys"] },
  );
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
}

async function createAKey() {
  await userEvent.type(await screen.findByLabelText(/name/i), "ci-deploy");
  await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
  await userEvent.click(screen.getByRole("button", { name: /create key/i }));
  await screen.findByText(TOKEN);
}

/** Every URL the app asked for during a test, in order. */
let requested: string[] = [];

beforeEach(() => {
  requested = [];
  server.events.on("request:start", ({ request }) => {
    requested.push(request.url);
  });
});

afterEach(() => {
  server.events.removeAllListeners("request:start");
});

describe("invariant 8: the token reaches no persistent store", () => {
  it("leaves localStorage and sessionStorage empty after a create", async () => {
    handlers();
    renderPage();

    await createAKey();

    // The invariant asserted literally rather than by reading the source.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps the token out of the URL", async () => {
    handlers();
    const { router } = renderPage();

    await createAKey();

    const { hash, pathname, search } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe("/keys");
  });
});

describe("invariant 2: credentials never travel in a request", () => {
  it("makes no request whose URL contains a token, in any interaction", async () => {
    handlers();
    renderPage();

    await createAKey();
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    await waitFor(() => expect(requested.length).toBeGreaterThan(2));
    // Asserted across every request rather than one URL, so the guarantee
    // covers code nobody has written yet.
    expect(requested.filter((url) => url.includes("msm_"))).toEqual([]);
  });
});

describe("the show once guarantee", () => {
  it("blocks a navigation away while the token is unacknowledged", async () => {
    handlers();
    const { router } = renderPage();
    await createAKey();

    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));

    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/keys");
  });

  it("stops blocking once the token is acknowledged", async () => {
    handlers();
    const { router } = renderPage();
    await createAKey();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));
    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/buckets"));
    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument();
  });

  it("arms and disarms the reload warning with the panel", async () => {
    handlers();
    renderPage();
    await createAKey();

    const armed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(armed);
    expect(armed.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    const disarmed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(disarmed);
    expect(disarmed.defaultPrevented).toBe(false);
  });

  it("removes the token from the page for good once acknowledged", async () => {
    handlers();
    renderPage();
    await createAKey();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    // Nothing can bring it back: the form is what returns, not the panel.
    expect(await screen.findByRole("button", { name: /create key/i })).toBeInTheDocument();
  });
});
