import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { routes } from "../../routes/router";
import { BUCKETS_QUERY_KEY } from "../buckets/useBuckets";
import { SecretsPage } from "./SecretsPage";

const API = "http://localhost:8000";
const SECRETS = `${API}/v1/buckets/alpha/secrets`;

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
  };
}

/**
 * The stub bucket list is a link back, so a test can leave the page and
 * return through clicks alone. Driving router.navigate directly would need
 * act() wrapping and would prove less.
 */
function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/buckets", element: <Link to="/buckets/alpha">back to alpha</Link> },
      {
        path: "/buckets/:name",
        element: (
          <>
            {/* Stands in for AppShell's nav bar, which this stub router does
                not mount. SP8 removed SecretsPage's own back link. */}
            <Link to="/buckets">Buckets</Link>
            <SecretsPage />
          </>
        ),
      },
    ],
    { initialEntries: ["/buckets/alpha"] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
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

describe("invariant 7: the list never fetches a value", () => {
  it("sends zero single key requests while rendering three secrets", async () => {
    server.use(
      http.get(SECRETS, () =>
        HttpResponse.json({
          ok: true,
          data: [aSecret("A"), aSecret("B"), aSecret("C")],
        }),
      ),
    );
    renderPage();
    await screen.findByRole("listitem", { name: /^A$/ });

    // A request count, not the absence of a rendered value. A value can be
    // absent for the wrong reason; a request that was never sent cannot.
    const singleKeyCalls = requested.filter((url) => /\/secrets\/[^/]+$/.test(url));
    expect(singleKeyCalls).toEqual([]);
  });

  it("fetches once on reveal and serves the cache on a re-reveal", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");
    await userEvent.click(within(row).getByRole("button", { name: /hide A/i }));
    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    // One visit, one secret.read audit row, however many times it is toggled.
    expect(requested.filter((url) => url.endsWith("/secrets/A"))).toHaveLength(1);
  });

  it("shows the same mask for a short value and a long one", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("SHORT"), aSecret("LONG")] })),
      http.get(`${SECRETS}/SHORT`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("SHORT"), value: "ab" } }),
      ),
      http.get(`${SECRETS}/LONG`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("LONG"), value: "z".repeat(200) } }),
      ),
    );
    renderPage();
    const short = await screen.findByRole("listitem", { name: /^SHORT$/ });
    const long = screen.getByRole("listitem", { name: /^LONG$/ });

    // Reveal both, then hide both, so the values are in the cache and a
    // length derived mask would be possible.
    await userEvent.click(within(short).getByRole("button", { name: /reveal SHORT/i }));
    await within(short).findByText("ab");
    await userEvent.click(within(long).getByRole("button", { name: /reveal LONG/i }));
    await within(long).findByText("z".repeat(200));
    await userEvent.click(within(short).getByRole("button", { name: /hide SHORT/i }));
    await userEvent.click(within(long).getByRole("button", { name: /hide LONG/i }));

    // Two masks from two genuinely different lengths, compared against each
    // other. Comparing either against the constant would still pass if the
    // constant became a repeat.
    const shortMask = within(short).getByText(/•/).textContent;
    const longMask = within(long).getByText(/•/).textContent;
    expect(shortMask).toBe(longMask);
    expect(shortMask).not.toContain("z");
  });

  it("hides everything again after leaving the bucket and coming back", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });
    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    await userEvent.click(screen.getByRole("link", { name: /^buckets$/i }));
    await userEvent.click(await screen.findByRole("link", { name: /back to alpha/i }));

    const returned = await screen.findByRole("listitem", { name: /^A$/ });
    expect(within(returned).queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(within(returned).getByText(/•/)).toBeInTheDocument();
    // Still one fetch: the value is inside gcTime and therefore still cached,
    // so this proves the reveal flag reset rather than the cache emptying.
    // Walking away and coming back must not leave plaintext on screen.
    expect(requested.filter((url) => url.endsWith("/secrets/A"))).toHaveLength(1);
  });
});

describe("ADR 003 A4: the web session never asks for bulk reveal", () => {
  it("makes no request whose URL mentions reveal, in any interaction", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
      http.put(`${SECRETS}/B`, () => HttpResponse.json({ ok: true, data: aSecret("B") })),
      http.delete(`${SECRETS}/A`, () => HttpResponse.json({ ok: true, data: aSecret("A") })),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");
    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
    const addDialog = await screen.findByRole("dialog", { name: /add secret/i });
    await userEvent.type(within(addDialog).getByLabelText(/key name/i), "B");
    await userEvent.type(within(addDialog).getByLabelText(/value/i), "v");
    await userEvent.click(within(addDialog).getByRole("button", { name: /add secret/i }));
    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    const deleteDialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: /delete secret/i }));

    await waitFor(() => expect(requested.length).toBeGreaterThan(3));
    // Asserted across every request rather than one URL, so the guarantee
    // covers code nobody has written yet.
    expect(requested.filter((url) => url.includes("reveal"))).toEqual([]);
  });
});

describe("invariant 8: a plaintext reaches no persistent store", () => {
  it("leaves localStorage and sessionStorage empty after a reveal", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    renderPage();
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    // The invariant asserted literally rather than by reading the source.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps the revealed value out of the URL", async () => {
    server.use(
      http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [aSecret("A")] })),
      http.get(`${SECRETS}/A`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("A"), value: "s3cr3t" } }),
      ),
    );
    const router = createMemoryRouter(
      [
        { path: "/buckets", element: <p>the bucket list</p> },
        { path: "/buckets/:name", element: <SecretsPage /> },
      ],
      { initialEntries: ["/buckets/alpha"] },
    );
    renderWithProviders(<RouterProvider router={router} />);
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal A/i }));
    await within(row).findByText("s3cr3t");

    const { hash, pathname, search } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe("/buckets/alpha");
  });
});

describe("the byte limit stops before the network", () => {
  it("rejects a multi byte value under 65,536 characters with zero requests", async () => {
    server.use(http.get(SECRETS, () => HttpResponse.json({ ok: true, data: [] })));
    renderPage();
    await screen.findByText(/no secrets yet/i);
    // Counted over single key URLs rather than every request, so an unrelated
    // background refetch of the list cannot make this pass or fail by accident.
    const singleKey = () => requested.filter((url) => /\/secrets\/[^/]+$/.test(url));
    const before = singleKey().length;

    await userEvent.click(screen.getByRole("button", { name: /add secret/i }));
    const bigDialog = await screen.findByRole("dialog", { name: /add secret/i });
    await userEvent.type(within(bigDialog).getByLabelText(/key name/i), "BIG");
    // 30,000 characters, 90,000 bytes. Typing that through userEvent is far
    // too slow, so the value is set the way a paste would set it.
    await userEvent.click(within(bigDialog).getByLabelText(/value/i));
    await userEvent.paste("中".repeat(30_000));
    await userEvent.click(within(bigDialog).getByRole("button", { name: /add secret/i }));

    expect(await screen.findByText(/at most 64 KiB/i)).toBeInTheDocument();
    expect(singleKey()).toHaveLength(before);
  });
});

describe("the bucket list learns about a deleted secret", () => {
  it("re-enables Delete on a bucket whose last secret was removed", async () => {
    // The cross feature invalidation: secret_count is cached on the bucket
    // list, and deleting a secret must mark that cache stale. The direct
    // isInvalidated check below is what proves the invalidateQueries call
    // fires; see its comment, and the one on the UI walk-through further
    // down, for why a click-driven assertion alone could not prove it here.
    let secretsLeft = 1;
    server.use(
      http.get(`${API}/v1/auth/me`, () =>
        HttpResponse.json({
          ok: true,
          data: { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com", name: "A" },
        }),
      ),
      http.get(`${API}/v1/buckets`, () =>
        HttpResponse.json({
          ok: true,
          data: [
            {
              id: "1",
              name: "alpha",
              created_at: "2026-08-11T00:00:00Z",
              secret_count: secretsLeft,
            },
          ],
        }),
      ),
      http.get(SECRETS, () =>
        HttpResponse.json({ ok: true, data: secretsLeft > 0 ? [aSecret("A")] : [] }),
      ),
      http.delete(`${SECRETS}/A`, () => {
        secretsLeft = 0;
        return HttpResponse.json({ ok: true, data: aSecret("A") });
      }),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/buckets/alpha"] });
    const { queryClient } = renderWithProviders(<RouterProvider router={router} />);
    const row = await screen.findByRole("listitem", { name: /^A$/ });

    // Seeded directly, mirroring useSecrets.test.tsx: BucketsPage is never
    // mounted before the delete in this walk-through, so without an existing
    // cache entry invalidateQueries has nothing to mark and isInvalidated
    // would read undefined regardless of whether the call is present.
    queryClient.setQueryData(BUCKETS_QUERY_KEY, [
      { id: "1", name: "alpha", created_at: "2026-08-11T00:00:00Z", secret_count: 1 },
    ]);

    await userEvent.click(within(row).getByRole("button", { name: /delete A/i }));
    const secretDialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(secretDialog).getByRole("button", { name: /delete secret/i }));

    // The direct falsification: BucketsPage is not mounted at this point, so a
    // UI walk-through alone cannot tell "invalidated" apart from "always
    // refetches anyway" once the route remounts it. This is what actually
    // fails if the invalidateQueries call in useDeleteSecret is removed.
    await waitFor(() =>
      expect(queryClient.getQueryState(BUCKETS_QUERY_KEY)?.isInvalidated).toBe(true),
    );

    await screen.findByText(/no secrets yet/i);
    await userEvent.click(within(screen.getByRole("banner")).getByRole("link", { name: /^buckets$/i }));

    // The direct isInvalidated check above is what actually falsifies removing
    // the invalidation call. This UI walk-through additionally confirms the
    // user-visible outcome, though under this app's staleTime: 0 default the
    // remount would refetch fresh data even without invalidateQueries, since
    // /buckets and /buckets/:name are mutually exclusive routes and
    // BucketsPage never stays mounted across the mutation.
    const bucketRow = await screen.findByRole("listitem", { name: /alpha/i });
    await waitFor(() =>
      expect(within(bucketRow).getByRole("button", { name: /^delete$/i })).toBeEnabled(),
    );
  });
});
