import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { KeyRow } from "./KeyRow";

const KEYS = "http://localhost:8000/v1/keys";
const ID = "11111111-1111-1111-1111-111111111111";

function aKey(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    lookup_id: "a3f9c2e1",
    name: "ci-deploy",
    buckets: ["prod"],
    can_write: false,
    can_reveal: false,
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

function renderRow(overrides: Record<string, unknown> = {}) {
  return renderWithProviders(
    <ul>
      <KeyRow apiKey={aKey(overrides)} />
    </ul>,
  );
}

describe("KeyRow", () => {
  it("shows the name, the lookup id and each bucket in scope", () => {
    renderRow({ buckets: ["prod", "dev"] });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText("ci-deploy")).toBeInTheDocument();
    // Not secret, and exists precisely to identify a key without
    // authenticating as one.
    expect(within(row).getByText(/msm_a3f9c2e1/)).toBeInTheDocument();
    // One tag per bucket now, rather than a joined string.
    expect(within(row).getByText("prod")).toBeInTheDocument();
    expect(within(row).getByText("dev")).toBeInTheDocument();
  });

  it("says read only when neither flag is set", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/^read only$/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^write$/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^bulk reveal$/i)).not.toBeInTheDocument();
  });

  it("names both capabilities when both are set", () => {
    renderRow({ can_write: true, can_reveal: true });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/^write$/i)).toBeInTheDocument();
    expect(within(row).getByText(/^bulk reveal$/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^read only$/i)).not.toBeInTheDocument();
  });

  it("badges an active key and offers revoke", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/active/i)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /revoke ci-deploy/i })).toBeInTheDocument();
  });

  it("badges a revoked key and offers nothing", () => {
    renderRow({ revoked_at: "2026-08-01T00:00:00Z" });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/revoked/i)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });

  it("badges an expired key and offers nothing", () => {
    renderRow({ expires_at: "2020-01-01T00:00:00Z" });
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    expect(within(row).getByText(/expired/i)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });

  it("confirms before revoking and can be cancelled", async () => {
    let calls = 0;
    server.use(
      http.delete(`${KEYS}/:id`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("revokes when confirmed", async () => {
    let revoked: string | undefined;
    server.use(
      http.delete(`${KEYS}/:id`, ({ params }) => {
        revoked = String(params.id);
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^revoke key$/i }));

    await waitFor(() => expect(revoked).toBe(ID));
  });

  it("shows a failed revoke in the dialog it was confirmed from", async () => {
    server.use(
      http.delete(`${KEYS}/:id`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "API_KEY_NOT_FOUND", message: "No such API key." } },
          { status: 404 },
        ),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^revoke key$/i }));

    // The dialog stays open so the message sits next to the button that failed.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/no such api key/i);
    expect(screen.getByRole("dialog", { name: /revoke key/i })).toBeInTheDocument();
  });

  it("says so once a key is revoked", async () => {
    server.use(
      http.delete(`${KEYS}/:id`, () => HttpResponse.json({ ok: true, data: { revoked: true } })),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /ci-deploy/ });

    await userEvent.click(within(row).getByRole("button", { name: /revoke ci-deploy/i }));
    const dialog = await screen.findByRole("dialog", { name: /revoke key/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^revoke key$/i }));

    expect(await screen.findByText(/key ci-deploy revoked/i)).toBeInTheDocument();
  });
});
