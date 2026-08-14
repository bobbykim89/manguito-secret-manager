import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { PutSecretForm } from "./PutSecretForm";

const SECRETS = "http://localhost:8000/v1/buckets/alpha/secrets";

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-11T00:00:00Z",
  };
}

describe("PutSecretForm", () => {
  it("writes the typed key and value", async () => {
    let path: string | undefined;
    let body: unknown;
    server.use(
      http.put(`${SECRETS}/:key`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") });
      }),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "DATABASE_URL");
    await userEvent.type(screen.getByLabelText(/value/i), "postgres://x");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    await waitFor(() => expect(path).toBe("/v1/buckets/alpha/secrets/DATABASE_URL"));
    expect(body).toEqual({ value: "postgres://x" });
  });

  it("says Replace once the typed key already exists", async () => {
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={["DATABASE_URL"]} />);

    expect(screen.getByRole("button", { name: /add secret/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/key name/i), "DATABASE_URL");

    expect(await screen.findByRole("button", { name: /replace secret/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add secret/i })).not.toBeInTheDocument();
  });

  it("keeps saying Add for a key that only differs in case", async () => {
    // The backend's key names are case sensitive, so database_url and
    // DATABASE_URL are two different secrets and this is not a replace.
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={["DATABASE_URL"]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "database_url");

    expect(await screen.findByRole("button", { name: /add secret/i })).toBeInTheDocument();
  });

  it("rejects an invalid key name without reaching the network", async () => {
    let calls = 0;
    server.use(
      http.put(`${SECRETS}/:key`, () => {
        calls += 1;
        return HttpResponse.json({ ok: true, data: aSecret("x") });
      }),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "has space");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/letters, numbers/i);
    expect(calls).toBe(0);
    expect(screen.getByLabelText(/key name/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps what was typed when the server refuses", async () => {
    server.use(
      http.put(`${SECRETS}/:key`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "WRITE_NOT_PERMITTED", message: "Not allowed." } },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "KEEP_ME");
    await userEvent.type(screen.getByLabelText(/value/i), "typed");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed/i);
    // Retyping a value the server just explained is pure friction.
    expect(screen.getByLabelText(/key name/i)).toHaveValue("KEEP_ME");
    expect(screen.getByLabelText(/value/i)).toHaveValue("typed");
  });

  it("clears both fields on success", async () => {
    server.use(
      http.put(`${SECRETS}/:key`, () => HttpResponse.json({ ok: true, data: aSecret("GONE") })),
    );
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    await userEvent.type(screen.getByLabelText(/key name/i), "GONE");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    await waitFor(() => expect(screen.getByLabelText(/key name/i)).toHaveValue(""));
    expect(screen.getByLabelText(/value/i)).toHaveValue("");
  });

  it("reports a new key as added", async () => {
    const onCreated = vi.fn();
    server.use(
      http.put(`${SECRETS}/NEW_KEY`, () =>
        HttpResponse.json({ ok: true, data: aSecret("NEW_KEY") }),
      ),
    );
    renderWithProviders(
      <PutSecretForm bucket="alpha" existingKeys={["OTHER"]} onCreated={onCreated} />,
    );

    await userEvent.type(screen.getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ keyName: "NEW_KEY", replaced: false }),
    );
  });

  it("reports an overwritten key as replaced", async () => {
    const onCreated = vi.fn();
    server.use(
      http.put(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") }),
      ),
    );
    renderWithProviders(
      <PutSecretForm
        bucket="alpha"
        existingKeys={["DATABASE_URL"]}
        onCreated={onCreated}
      />,
    );

    await userEvent.type(screen.getByLabelText(/key name/i), "DATABASE_URL");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /replace secret/i }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ keyName: "DATABASE_URL", replaced: true }),
    );
  });

  it("stays put and reports nothing when the write fails", async () => {
    const onCreated = vi.fn();
    server.use(
      http.put(`${SECRETS}/NEW_KEY`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(
      <PutSecretForm bucket="alpha" existingKeys={[]} onCreated={onCreated} />,
    );

    await userEvent.type(screen.getByLabelText(/key name/i), "NEW_KEY");
    await userEvent.type(screen.getByLabelText(/value/i), "v");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/i);
    expect(onCreated).not.toHaveBeenCalled();
    // What was typed survives a failure. Retyping a value the server just
    // rejected is pure friction.
    expect(screen.getByLabelText(/key name/i)).toHaveValue("NEW_KEY");
  });

  it("draws no cancel button when there is nothing to cancel back to", () => {
    renderWithProviders(<PutSecretForm bucket="alpha" existingKeys={[]} />);

    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("cancels through the callback when one is given", async () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <PutSecretForm bucket="alpha" existingKeys={[]} onCancel={onCancel} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
