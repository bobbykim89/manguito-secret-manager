import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmPrompt } from "./ConfirmPrompt";

describe("ConfirmPrompt", () => {
  it("asks the question and calls back on confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmPrompt prompt="Delete this bucket?" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );

    expect(screen.getByText("Delete this bucket?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^yes$/i }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls back on cancel without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmPrompt prompt="Delete?" onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("leaves the buttons named by their text when no labels are given", () => {
    // BucketRow relies on this: its tests query /yes/i, and an aria-label of
    // undefined must render no attribute rather than an empty one.
    render(<ConfirmPrompt prompt="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^yes$/i })).not.toHaveAttribute("aria-label");
  });

  it("names the buttons when labels are given, so many rows stay distinguishable", () => {
    render(
      <ConfirmPrompt
        prompt="Delete this secret?"
        confirmLabel="Confirm deleting DATABASE_URL"
        cancelLabel="Cancel deleting DATABASE_URL"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Confirm deleting DATABASE_URL" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel deleting DATABASE_URL" }),
    ).toBeInTheDocument();
  });

  it("can disable confirm while leaving cancel reachable", () => {
    render(
      <ConfirmPrompt prompt="Delete?" onConfirm={vi.fn()} onCancel={vi.fn()} confirmDisabled />,
    );

    expect(screen.getByRole("button", { name: /^yes$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
  });
});
