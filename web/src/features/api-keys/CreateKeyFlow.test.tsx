import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { CreateKeyFlow } from "./CreateKeyFlow";

const KEYS = "http://localhost:8000/v1/keys";

function aBucket(name: string) {
  return { id: `id-${name}`, name, created_at: "2026-08-11T00:00:00Z", secret_count: 0 };
}

/** A data router, because a successful create renders NewKeyPanel's blocker. */
function renderForm(buckets = [aBucket("prod"), aBucket("dev")]) {
  const router = createMemoryRouter(
    [{ path: "/keys", element: <CreateKeyFlow buckets={buckets} /> }],
    { initialEntries: ["/keys"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe("CreateKeyFlow", () => {
  it("sends the chosen name, buckets, flags and an expiry instant", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(KEYS, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "ci-deploy",
              buckets: ["prod"],
              can_write: true,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        );
      }),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("switch", { name: /write secrets/i }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.name).toBe("ci-deploy");
    expect(body?.buckets).toEqual(["prod"]);
    expect(body?.can_write).toBe(true);
    expect(body?.can_reveal).toBe(false);
    // 90 days is the default preset, so this is an instant, not a duration.
    expect(typeof body?.expires_at).toBe("string");
    expect(String(body?.expires_at)).toMatch(/Z$/);
    expect(Date.parse(String(body?.expires_at))).toBeGreaterThan(Date.now());
  });

  it("sends no expires_at when the key never expires", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(KEYS, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "forever",
              buckets: ["prod"],
              can_write: false,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        );
      }),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "forever");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.selectOptions(screen.getByLabelText(/expires/i), "never");
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.expires_at).toBeNull();
  });

  it("refuses to submit with no bucket chosen, without reaching the network", async () => {
    let calls = 0;
    server.use(
      http.post(KEYS, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: {} }, { status: 201 });
      }),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "no-buckets");
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByText(/at least one bucket/i)).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("states that any key can already read secrets, so the reveal box is not misread", () => {
    renderForm();

    // may_reveal gates only the bulk path. A key without it still reads
    // secrets one at a time, and the form must not imply otherwise.
    expect(screen.getByText(/read secrets in these buckets one at a time/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /bulk reveal/i })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /^reveal secrets$/i })).not.toBeInTheDocument();
  });

  it("replaces itself with the token panel on success", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "ci-deploy",
              buckets: ["prod"],
              can_write: false,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByText("msm_a3f9c2e1_secret")).toBeInTheDocument();
    // A second submit is impossible while a token is unsaved.
    expect(screen.queryByRole("button", { name: /create key/i })).not.toBeInTheDocument();
  });

  it("shows the form again once the token is acknowledged", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          {
            ok: true,
            data: {
              id: "1",
              lookup_id: "a3f9c2e1",
              name: "ci-deploy",
              buckets: ["prod"],
              can_write: false,
              can_reveal: false,
              expires_at: null,
              revoked_at: null,
              last_used_at: null,
              created_at: "2026-08-11T00:00:00Z",
              token: "msm_a3f9c2e1_secret",
            },
          },
          { status: 201 },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "ci-deploy");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));
    await screen.findByText("msm_a3f9c2e1_secret");

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(await screen.findByRole("button", { name: /create key/i })).toBeInTheDocument();
    expect(screen.queryByText("msm_a3f9c2e1_secret")).not.toBeInTheDocument();
    // Reset, not merely hidden: the name field is empty again.
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
  });

  it("puts a server refusal on the form and keeps what was typed", async () => {
    server.use(
      http.post(KEYS, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_FOUND", message: "No bucket named 'prod'." } },
          { status: 404 },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/name/i), "keep-me");
    await userEvent.click(screen.getByRole("checkbox", { name: "prod" }));
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no bucket named/i);
    expect(screen.getByLabelText(/name/i)).toHaveValue("keep-me");
  });

  it("tells an account with no buckets to make one first", () => {
    renderWithProviders(
      <MemoryRouter>
        <CreateKeyFlow buckets={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /create a bucket/i })).toHaveAttribute(
      "href",
      "/buckets",
    );
    expect(screen.queryByRole("button", { name: /create key/i })).not.toBeInTheDocument();
  });
});
