import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { SecretRow } from "./SecretRow";

const SECRETS = "http://localhost:8000/v1/buckets/alpha/secrets";

function aSecret(keyName: string) {
  return {
    key_name: keyName,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
  };
}

function renderRow(keyName = "DATABASE_URL") {
  return renderWithProviders(
    <ul>
      <SecretRow bucket="alpha" secret={aSecret(keyName)} />
    </ul>,
  );
}

describe("SecretRow", () => {
  it("shows the key name and stays masked until asked", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    expect(within(row).getByText("DATABASE_URL")).toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /reveal DATABASE_URL/i })).toBeInTheDocument();
  });

  it("reveals the value on click", async () => {
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));

    expect(await within(row).findByText("postgres://x")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /hide DATABASE_URL/i })).toBeInTheDocument();
  });

  it("hides it again, and the mask comes back", async () => {
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
    await within(row).findByText("postgres://x");
    await userEvent.click(within(row).getByRole("button", { name: /hide DATABASE_URL/i }));

    expect(within(row).queryByText("postgres://x")).not.toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
  });

  it("says nothing about why a reveal failed", async () => {
    server.use(
      http.get(`${SECRETS}/BROKEN`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "server detail" } },
          { status: 500 },
        ),
      ),
    );
    renderRow("BROKEN");
    const row = screen.getByRole("listitem", { name: /BROKEN/ });

    await userEvent.click(within(row).getByRole("button", { name: /reveal BROKEN/i }));

    const alert = await within(row).findByRole("alert");
    expect(alert).toHaveTextContent(/could not reveal this secret/i);
    // SP4 made decrypt failures carry no detail. Routing the server's string
    // into the UI here is how a value eventually gets routed into it.
    expect(alert).not.toHaveTextContent(/server detail/i);
  });

  it("copies the revealed value to the clipboard", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
    await within(row).findByText("postgres://x");
    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    // The stub userEvent.setup() installs, not a hand mocked global.
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("postgres://x"),
    );
    expect(within(row).getByRole("status")).toHaveTextContent(/copied/i);
  });

  // Replaces "offers no copy button while the value is hidden". ADR 003 line 70
  // requires copy to be available without revealing, so the old assertion
  // encoded the gap rather than the requirement. This replacement is strictly
  // stronger: it also proves the masked row shows no plaintext.
  it("offers copy while the value is still masked", () => {
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    expect(within(row).getByRole("button", { name: /copy DATABASE_URL/i })).toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
  });

  it("copies without revealing: one fetch, nothing on screen", async () => {
    const user = userEvent.setup();
    let fetches = 0;
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () => {
        fetches += 1;
        return HttpResponse.json({
          ok: true,
          data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
        });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("postgres://x"));
    expect(fetches).toBe(1);
    // Asserted against the whole document rather than the row: the value must
    // not be anywhere, including in a portal or a status line.
    expect(screen.queryByText("postgres://x")).not.toBeInTheDocument();
    expect(within(row).getByText(/•/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /reveal DATABASE_URL/i })).toBeInTheDocument();
  });

  it("copies an already revealed value from the cache, with no second fetch", async () => {
    const user = userEvent.setup();
    let fetches = 0;
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () => {
        fetches += 1;
        return HttpResponse.json({
          ok: true,
          data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
        });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
    await within(row).findByText("postgres://x");
    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("postgres://x"));
    // One visit, one secret.read audit row. Copying what is already on screen
    // must not charge a second read.
    expect(fetches).toBe(1);
  });

  it("says nothing about why a copy's fetch failed, and stays masked", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SECRETS}/BROKEN`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message: "server detail" } },
          { status: 500 },
        ),
      ),
    );
    renderRow("BROKEN");
    const row = screen.getByRole("listitem", { name: /BROKEN/ });

    await user.click(within(row).getByRole("button", { name: /copy BROKEN/i }));

    const alert = await within(row).findByRole("alert");
    expect(alert).toHaveTextContent(/could not reveal this secret/i);
    expect(alert).not.toHaveTextContent(/server detail/i);
    expect(within(row).getByText(/•/)).toBeInTheDocument();
  });

  it("reports a refused clipboard separately from a refused fetch", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });
    // The permission denial a non secure context produces, which is the real
    // way this fails in a browser. Spied after userEvent.setup(), which
    // installs the clipboard stub this replaces. `vi` is already imported in
    // this file from the auto-mask task.
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      /could not copy to the clipboard/i,
    );
  });

  it("refuses a second copy while the first is still in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetches = 0;
    server.use(
      http.get(`${SECRETS}/DATABASE_URL`, async () => {
        fetches += 1;
        await gate;
        return HttpResponse.json({
          ok: true,
          data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
        });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await user.click(within(row).getByRole("button", { name: /copy DATABASE_URL/i }));

    // Disabled rather than merely idempotent: a double click would otherwise
    // charge two secret.read audit rows for one user action.
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: /copy DATABASE_URL/i })).toBeDisabled(),
    );

    release?.();
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("postgres://x"));
    expect(fetches).toBe(1);
  });

  it("confirms before deleting and can be cancelled", async () => {
    let deletes = 0;
    server.use(
      http.delete(`${SECRETS}/DATABASE_URL`, () => {
        deletes += 1;
        return HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete DATABASE_URL/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deletes).toBe(0);
  });

  it("deletes when confirmed", async () => {
    let deleted = false;
    server.use(
      http.delete(`${SECRETS}/DATABASE_URL`, () => {
        deleted = true;
        return HttpResponse.json({ ok: true, data: aSecret("DATABASE_URL") });
      }),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete DATABASE_URL/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete secret/i }));

    await waitFor(() => expect(deleted).toBe(true));
  });

  it("shows a failed delete in the dialog it was confirmed from", async () => {
    server.use(
      http.delete(`${SECRETS}/DATABASE_URL`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "SECRET_NOT_FOUND", message: "Already gone." } },
          { status: 404 },
        ),
      ),
    );
    renderRow();
    const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

    await userEvent.click(within(row).getByRole("button", { name: /delete DATABASE_URL/i }));
    const dialog = await screen.findByRole("dialog", { name: /delete secret/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /delete secret/i }));

    // The dialog stays open so the message is next to the button that failed.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/already gone/i);
    expect(screen.getByRole("dialog", { name: /delete secret/i })).toBeInTheDocument();
  });

  it("re-masks a revealed value once the window is up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      server.use(
        http.get(`${SECRETS}/DATABASE_URL`, () =>
          HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
        ),
      );
      renderRow();
      const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      expect(within(row).queryByText("postgres://x")).not.toBeInTheDocument();
      expect(within(row).getByText(/•/)).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /reveal DATABASE_URL/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the value cached across an auto-mask, so a re-reveal costs no request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      let fetches = 0;
      server.use(
        http.get(`${SECRETS}/DATABASE_URL`, () => {
          fetches += 1;
          return HttpResponse.json({
            ok: true,
            data: { ...aSecret("DATABASE_URL"), value: "postgres://x" },
          });
        }),
      );
      renderRow();
      const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");

      // Auto-mask is a visual affordance, not a cache purge. One visit, one
      // secret.read audit row, however many times the window lapses.
      expect(fetches).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a re-revealed value a full fresh window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      server.use(
        http.get(`${SECRETS}/DATABASE_URL`, () =>
          HttpResponse.json({ ok: true, data: { ...aSecret("DATABASE_URL"), value: "postgres://x" } }),
        ),
      );
      renderRow();
      const row = screen.getByRole("listitem", { name: /DATABASE_URL/ });

      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      await user.click(within(row).getByRole("button", { name: /hide DATABASE_URL/i }));
      await user.click(within(row).getByRole("button", { name: /reveal DATABASE_URL/i }));
      await within(row).findByText("postgres://x");

      // 26 seconds past the first reveal's 30 second deadline. A stale timer
      // from that first reveal would have fired by now; the restarted one has
      // not.
      await act(async () => {
        vi.advanceTimersByTime(26_000);
      });
      expect(within(row).getByText("postgres://x")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      expect(within(row).queryByText("postgres://x")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
