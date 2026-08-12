import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { KeysPage } from "./KeysPage";

const BASE = "http://localhost:8000";

function aKey(name: string) {
  return {
    id: `id-${name}`,
    lookup_id: "a3f9c2e1",
    name,
    buckets: ["prod"],
    can_write: false,
    can_reveal: false,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-11T00:00:00Z",
  };
}

function bucketsReturn(names: string[]) {
  server.use(
    http.get(`${BASE}/v1/buckets`, () =>
      HttpResponse.json({
        ok: true,
        data: names.map((name) => ({
          id: `id-${name}`,
          name,
          created_at: "2026-08-11T00:00:00Z",
          secret_count: 0,
        })),
      }),
    ),
  );
}

function renderPage() {
  const router = createMemoryRouter([{ path: "/keys", element: <KeysPage /> }], {
    initialEntries: ["/keys"],
  });
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("KeysPage", () => {
  it("lists the account's keys", async () => {
    bucketsReturn(["prod"]);
    server.use(
      http.get(`${BASE}/v1/keys`, () =>
        HttpResponse.json({ ok: true, data: [aKey("ci-deploy"), aKey("backup-job")] }),
      ),
    );
    renderPage();

    expect(await screen.findByRole("listitem", { name: "ci-deploy" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "backup-job" })).toBeInTheDocument();
  });

  it("says an account with no keys has none rather than looking like it is loading", async () => {
    bucketsReturn(["prod"]);
    server.use(http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it("does not show the no-buckets state while the bucket list is still loading", async () => {
    // useBuckets returns undefined data while pending, and passing [] then
    // would tell an account with buckets that it has none.
    let resolveBuckets: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      resolveBuckets = resolve;
    });
    server.use(
      http.get(`${BASE}/v1/buckets`, async () => {
        await held;
        return HttpResponse.json({
          ok: true,
          data: [{ id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 }],
        });
      }),
      http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })),
    );
    renderPage();

    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create a bucket/i })).not.toBeInTheDocument();

    resolveBuckets?.();

    expect(await screen.findByRole("button", { name: /create key/i })).toBeInTheDocument();
  });

  it("surfaces a bucket list fetch failure instead of showing nothing", async () => {
    server.use(
      http.get(`${BASE}/v1/buckets`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        ),
      ),
      http.get(`${BASE}/v1/keys`, () => HttpResponse.json({ ok: true, data: [] })),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh your buckets/i);
  });

  it("keeps a loaded list on screen through a failed background refetch", async () => {
    bucketsReturn(["prod"]);
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/keys`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ ok: true, data: [aKey("stable")] });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        );
      }),
    );
    const { queryClient } = renderPage();
    await screen.findByRole("listitem", { name: "stable" });

    await queryClient.refetchQueries({ queryKey: ["api-keys"] });

    expect(screen.getByRole("listitem", { name: "stable" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh/i);
  });
});
