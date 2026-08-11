import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { BucketsPage } from "./BucketsPage";
import { BUCKETS_QUERY_KEY } from "./useBuckets";

const LIST = "http://localhost:8000/v1/buckets";

function aBucket(name: string, secretCount = 0) {
  return {
    id: `id-${name}`,
    name,
    created_at: "2026-08-11T00:00:00Z",
    secret_count: secretCount,
  };
}

function listReturns(...buckets: ReturnType<typeof aBucket>[]) {
  server.use(http.get(LIST, () => HttpResponse.json({ ok: true, data: buckets })));
}

describe("BucketsPage", () => {
  it("shows a row per bucket with its secret count", async () => {
    listReturns(aBucket("alpha", 3), aBucket("beta", 0));
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );

    const alpha = await screen.findByRole("listitem", { name: /alpha/i });

    expect(within(alpha).getByText(/3 secrets/i)).toBeInTheDocument();
    expect(within(alpha).getByRole("time")).toHaveAttribute("datetime", "2026-08-11T00:00:00Z");
    expect(screen.getByRole("listitem", { name: /beta/i })).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: /beta/i })).getByText(/0 secrets/i))
      .toBeInTheDocument();
  });

  it("says there are no buckets rather than looking like it is still loading", async () => {
    listReturns();
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/no buckets yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a failure to load", async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh/i);
  });

  it("keeps showing a cached list through a failed background refetch", async () => {
    // refetchOnWindowFocus is on, so a stale, momentarily-failing list is
    // routine, not exceptional, exactly like useSession's equivalent test.
    // The first response is the initial mount; the second is the refetch
    // triggered explicitly below.
    let requestCount = 0;
    server.use(
      http.get(LIST, () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json({ ok: true, data: [aBucket("stable")] });
        }
        return HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "Boom." } },
          { status: 500 },
        );
      }),
    );
    const { queryClient } = renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("listitem", { name: /stable/i });

    await queryClient.refetchQueries({ queryKey: BUCKETS_QUERY_KEY });

    await waitFor(() => expect(requestCount).toBe(2));
    expect(screen.getByRole("listitem", { name: /stable/i })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not refresh/i);
  });

  it("refuses to delete a bucket that still holds secrets, and says why", async () => {
    // The 409 is explained before it can happen rather than discovered
    // through an error.
    listReturns(aBucket("occupied", 2));
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /occupied/i });

    expect(within(row).getByRole("button", { name: /delete/i })).toBeDisabled();
    expect(within(row).getByText(/still holds/i)).toBeInTheDocument();
  });

  it("confirms before deleting and can be cancelled", async () => {
    let deletes = 0;
    listReturns(aBucket("spare"));
    server.use(
      http.delete(`${LIST}/:name`, () => {
        deletes += 1;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /spare/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    expect(within(row).getByText(/delete this bucket/i)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: /cancel/i }));

    expect(within(row).queryByText(/delete this bucket/i)).not.toBeInTheDocument();
    expect(deletes).toBe(0);
  });

  it("deletes when confirmed", async () => {
    let deleted: string | undefined;
    let listCalls = 0;
    server.use(
      http.get(LIST, () => {
        listCalls += 1;
        return HttpResponse.json({ ok: true, data: listCalls > 1 ? [] : [aBucket("spare")] });
      }),
      http.delete(`${LIST}/:name`, ({ params }) => {
        deleted = String(params.name);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /spare/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(row).getByRole("button", { name: /yes/i }));

    await waitFor(() => expect(deleted).toBe("spare"));
    expect(await screen.findByText(/no buckets yet/i)).toBeInTheDocument();
  });

  it("shows a stale count's rejection on the row it belongs to", async () => {
    // secret_count came from the last fetch, so something could have written
    // through the API since.
    listReturns(aBucket("racy", 0));
    server.use(
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /racy/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(row).getByRole("button", { name: /yes/i }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(/still holds secrets/i);
  });

  it("disables a confirmed delete once the corrected count shows it is not empty", async () => {
    let calls = 0;
    server.use(
      http.get(LIST, () => {
        calls += 1;
        return HttpResponse.json({
          ok: true,
          data: [aBucket("racy2", calls === 1 ? 0 : 3)],
        });
      }),
      http.delete(`${LIST}/:name`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: /racy2/i });

    await userEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(row).getByRole("button", { name: /yes/i }));

    await waitFor(() =>
      expect(within(row).getByRole("button", { name: /yes/i })).toBeDisabled(),
    );
  });
});
