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
});
