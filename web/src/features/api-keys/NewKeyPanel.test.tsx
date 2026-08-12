import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../../test/render";
import { NewKeyPanel } from "./NewKeyPanel";

const CREATED = {
  id: "11111111-1111-1111-1111-111111111111",
  lookup_id: "a3f9c2e1",
  name: "ci-deploy",
  buckets: ["prod"],
  can_write: true,
  can_reveal: false,
  expires_at: null,
  revoked_at: null,
  last_used_at: null,
  created_at: "2026-08-11T00:00:00Z",
  token: "msm_a3f9c2e1_averylongsecretsegmenthere",
};

/** useBlocker needs a data router, so a plain MemoryRouter will not do. */
function renderPanel(onAcknowledge = vi.fn()) {
  const router = createMemoryRouter(
    [
      {
        path: "/keys",
        element: (
          <>
            <Link to="/buckets">Buckets</Link>
            <NewKeyPanel apiKey={CREATED} onAcknowledge={onAcknowledge} />
          </>
        ),
      },
      { path: "/buckets", element: <p>the bucket list</p> },
    ],
    { initialEntries: ["/keys"] },
  );
  return { onAcknowledge, router, ...renderWithProviders(<RouterProvider router={router} />) };
}

describe("NewKeyPanel", () => {
  it("shows the token in full, because it will never be shown again", () => {
    renderPanel();

    expect(screen.getByText(CREATED.token)).toBeInTheDocument();
  });

  it("says plainly that it cannot be recovered", () => {
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be recovered/i);
  });

  it("copies the token to the clipboard", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(CREATED.token));
    expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
  });

  it("hands acknowledgement back to the owner of the mutation", async () => {
    const { onAcknowledge } = renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));

    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it("blocks a navigation away and can be told to stay", async () => {
    const { router } = renderPanel();

    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));

    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/keys");

    await userEvent.click(screen.getByRole("button", { name: /^stay$/i }));

    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/keys");
  });

  it("lets the navigation through when the user insists", async () => {
    const { router } = renderPanel();

    await userEvent.click(screen.getByRole("link", { name: "Buckets" }));
    await userEvent.click(await screen.findByRole("button", { name: /^leave$/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/buckets"));
  });

  it("asks the browser to confirm a reload while it is on screen", () => {
    const { unmount } = renderPanel();

    const armed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(armed);
    expect(armed.defaultPrevented).toBe(true);

    // Unmounting is what acknowledgement does, so the guard must disarm with
    // the panel rather than outlive it.
    unmount();

    const disarmed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(disarmed);
    expect(disarmed.defaultPrevented).toBe(false);
  });
});
