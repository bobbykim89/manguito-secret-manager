import { act } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { ToastProvider } from "./ToastProvider";
import { ToastViewport } from "./ToastViewport";
import { useToast } from "./useToast";

function Trigger({ message }: { message: string }) {
  const notify = useToast();
  return <button onClick={() => notify(message)}>Notify</button>;
}

describe("toasts", () => {
  beforeEach(() => {
    // shouldAdvanceTime lets the fake clock tick forward in small real-time
    // increments. Without it, userEvent's act()-wrapped click() deadlocks:
    // @testing-library/react globally points asyncWrapper at React's act(),
    // whose async flush loop needs its own tick to drain and never gets one
    // under a bare vi.useFakeTimers(). Explicit vi.advanceTimersByTime()
    // calls below remain exact and deterministic.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast after notify is called", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Bucket created" />
        <ToastViewport />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Notify" }));

    expect(screen.getByRole("status")).toHaveTextContent("Bucket created");
  });

  it("auto-dismisses a toast after the timeout", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Bucket created" />
        <ToastViewport />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows more than one toast at a time", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ToastProvider>
        <Trigger message="Bucket created" />
        <Trigger message="Secret added" />
        <ToastViewport />
      </ToastProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "Notify" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Notify" })[1]!);

    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("throws when useToast is called outside a ToastProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger message="x" />)).toThrow(
      "useToast must be used within a ToastProvider",
    );
    spy.mockRestore();
  });
});
