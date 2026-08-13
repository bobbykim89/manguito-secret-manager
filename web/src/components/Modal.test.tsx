import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

beforeEach(() => {
  document.body.innerHTML = "";
  const portalRoot = document.createElement("div");
  portalRoot.id = "modal-root";
  document.body.appendChild(portalRoot);
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders its content when open", () => {
    render(
      <Modal open onClose={vi.fn()} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Create bucket" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", () => {
    render(
      <Modal open onClose={vi.fn()} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on a backdrop click but not a click inside the dialog", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Create bucket">
        <button>Save</button>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole("dialog").parentElement;
    if (!backdrop) throw new Error("dialog has no parent to click as the backdrop");
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores focus to the trigger element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();

    rerender(
      <Modal open={false} onClose={onClose} title="Create bucket">
        <p>Body</p>
      </Modal>,
    );

    expect(trigger).toHaveFocus();
  });

  it("does not steal focus when onClose's identity changes while open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Create bucket">
        <input aria-label="Name" />
      </Modal>,
    );

    await user.click(screen.getByRole("textbox", { name: "Name" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();

    rerender(
      <Modal open onClose={() => {}} title="Create bucket">
        <input aria-label="Name" />
      </Modal>,
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });
});
