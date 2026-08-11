import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { CreateBucketForm } from "./CreateBucketForm";

const LIST = "http://localhost:8000/v1/buckets";

describe("CreateBucketForm", () => {
  it("rejects an invalid name without sending a request", async () => {
    // The point of validating on this side at all. If Zod were decorative,
    // this would reach the network and the server would answer 422.
    let requests = 0;
    server.use(
      http.post(LIST, () => {
        requests += 1;
        return HttpResponse.json({ ok: true, data: {} }, { status: 201 });
      }),
    );
    renderWithProviders(<CreateBucketForm />);

    await userEvent.type(screen.getByRole("textbox", { name: /bucket name/i }), "Prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/lowercase/i);
    expect(requests).toBe(0);
  });

  it("sends a valid name and clears the field", async () => {
    let posted: unknown;
    server.use(
      http.post(LIST, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { ok: true, data: { id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 } },
          { status: 201 },
        );
      }),
      http.get(LIST, () => HttpResponse.json({ ok: true, data: [] })),
    );
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });

    await userEvent.type(input, "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(posted).toEqual({ name: "prod" }));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("puts a name already taken on the field", async () => {
    // It is validation, performed by the only party that can perform it, so
    // it reads as validation rather than as a banner.
    server.use(
      http.post(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_EXISTS", message: "A bucket named 'prod' already exists." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });

    await userEvent.type(input, "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps what was typed when the server refuses", async () => {
    // Retyping a name the server just explained is pure friction.
    server.use(
      http.post(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_EXISTS", message: "Taken." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });

    await userEvent.type(input, "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await screen.findByRole("alert");
    expect(input).toHaveValue("prod");
  });

  it("shows any other failure without blaming the field", async () => {
    server.use(http.post(LIST, () => HttpResponse.error()));
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });

    await userEvent.type(input, "prod");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("disables the input and button while the mutation is pending", async () => {
    let resolvePost: (() => void) | undefined;
    server.use(
      http.post(
        LIST,
        () =>
          new Promise((resolve) => {
            resolvePost = () =>
              resolve(
                HttpResponse.json(
                  {
                    ok: true,
                    data: { id: "1", name: "prod", created_at: "2026-08-11T00:00:00Z", secret_count: 0 },
                  },
                  { status: 201 },
                ),
              );
          }),
      ),
      http.get(LIST, () => HttpResponse.json({ ok: true, data: [] })),
    );
    renderWithProviders(<CreateBucketForm />);
    const input = screen.getByRole("textbox", { name: /bucket name/i });
    const button = screen.getByRole("button", { name: /create/i });

    await userEvent.type(input, "prod");
    await userEvent.click(button);

    await waitFor(() => expect(input).toBeDisabled());
    expect(button).toBeDisabled();

    resolvePost?.();

    await waitFor(() => expect(input).not.toBeDisabled());
    expect(button).not.toBeDisabled();
  });
});
