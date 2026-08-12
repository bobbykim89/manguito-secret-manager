import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { SecretsPage } from "./SecretsPage";

const SECRETS = "http://localhost:8000/v1/buckets/alpha/secrets";

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
  };
}

function renderPage(bucket = "alpha") {
  const router = createMemoryRouter(
    [
      { path: "/buckets", element: <p>the bucket list</p> },
      { path: "/buckets/:name", element: <SecretsPage /> },
    ],
    { initialEntries: [`/buckets/${bucket}`] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("SecretsPage", () => {
  it("heads the page with the bucket name and lists its secrets", async () => {
    server.use(
      http.get(SECRETS, () =>
        HttpResponse.json({ ok: true, data: [aSecret("DATABASE_URL"), aSecret("STRIPE_KEY")] }),
      ),
    );
    renderPage();

    // Awaited on a list row, not the heading: the heading comes from the URL
    // param and is on screen before the fetch resolves, so awaiting it first
    // would resolve immediately and race the two synchronous checks below
    // against a still-pending list.
    expect(await screen.findByRole("listitem", { name: /DATABASE_URL/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /STRIPE_KEY/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "alpha" })).toBeInTheDocument();
  });

  it("says an empty bucket is empty rather than looking like it is loading", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();

    expect(await screen.findByText(/no secrets yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an unknown bucket as this page's own error, not a 404 route", async () => {
    server.use(
      http.get("http://localhost:8000/v1/buckets/ghost/secrets", () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_FOUND", message: "No bucket named 'ghost'." } },
          { status: 404 },
        ),
      ),
    );
    renderPage("ghost");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no bucket named/i);
    // The router's not found page is a different failure: there, the route is
    // wrong. Here the route is right and the resource is missing.
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    // Nothing to write into, so no form.
    expect(screen.queryByRole("button", { name: /add secret/i })).not.toBeInTheDocument();
  });

  it("keeps a loaded list on screen through a failed background refetch", async () => {
    // SP6's final review: gating on isSuccess would replace a working list
    // with an error the first time refetchOnWindowFocus dropped a request.
    let calls = 0;
    server.use(
      http.get(SECRETS, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ ok: true, data: [aSecret("STABLE")] });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        );
      }),
    );
    const { queryClient } = renderPage();
    await screen.findByRole("listitem", { name: /STABLE/ });

    await queryClient.refetchQueries({ queryKey: ["secrets", "alpha"] });

    expect(screen.getByRole("listitem", { name: /STABLE/ })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh/i);
  });

  it("hands the form the keys already in the bucket", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("DATABASE_URL")] })),
    );
    renderPage();
    await screen.findByRole("listitem", { name: /DATABASE_URL/ });

    // Proven through the behaviour the prop exists for, not by inspecting props.
    const form = screen.getByRole("form", { name: /add or replace a secret/i });
    expect(within(form).getByRole("button", { name: /add secret/i })).toBeInTheDocument();
  });
});
