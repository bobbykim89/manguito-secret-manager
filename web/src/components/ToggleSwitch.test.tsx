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

  it("anchors the knob to the track's left edge", () => {
    // jsdom performs no layout, so this can't verify the knob actually stays
    // inside the track in a real browser (a real-browser check caught the
    // regression this guards: with no left anchor, the knob's static
    // position fell back to the track's right side, and translate-x-5 then
    // pushed it 18px past the track's own right edge). This only guards
    // against the anchor class being removed again.
    const { container } = render(<ToggleSwitch checked={false} label="Dark mode" onChange={vi.fn()} />);

    const knob = container.querySelector('[aria-hidden="true"]');
    expect(knob?.className).toMatch(/\bleft-0\.5\b/);
  });
});
