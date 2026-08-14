import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToggleSwitch } from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("reflects the checked state via aria-checked", () => {
    render(<ToggleSwitch checked label="Dark mode" onChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("reflects the unchecked state via aria-checked", () => {
    render(<ToggleSwitch checked={false} label="Dark mode" onChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls onChange with the flipped value on click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleSwitch checked={false} label="Dark mode" onChange={onChange} />);

    await user.click(screen.getByRole("switch", { name: "Dark mode" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("is disabled when disabled is set and does not fire onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleSwitch checked={false} label="Dark mode" onChange={onChange} disabled />);

    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle).toBeDisabled();

    await user.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
  });
});
