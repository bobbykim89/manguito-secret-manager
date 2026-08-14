import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert } from "./Alert";

describe("Alert", () => {
  it("announces its content to assistive technology", () => {
    render(<Alert>Something failed.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Something failed.");
  });

  it("announces an inline alert too, so a field error is not silently downgraded", () => {
    render(<Alert variant="inline">Name is taken.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Name is taken.");
  });

  it("announces a warning as an alert as well", () => {
    render(<Alert tone="warning">Sign in did not complete.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Sign in did not complete.");
  });

  it("sets its own text colour, so a banner stays readable on a dark surface", () => {
    // The sign out error renders outside the light pinned main, so it cannot
    // rely on inheriting a dark text colour from an ancestor.
    const { rerender } = render(<Alert>Something failed.</Alert>);
    expect(screen.getByRole("alert").className).toMatch(/text-red-900/);

    rerender(<Alert tone="warning">Careful.</Alert>);
    expect(screen.getByRole("alert").className).toMatch(/text-amber-900/);
  });
});
