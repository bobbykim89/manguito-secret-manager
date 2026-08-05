import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { HealthPage } from "./HealthPage";

const HEALTH = "http://localhost:8000/v1/health";

describe("HealthPage", () => {
  it("renders the loading state first", async () => {
    server.use(
      http.get(HEALTH, async () => {
        await delay(50);
        return HttpResponse.json({ ok: true, data: { db: "ok" } });
      }),
    );

    renderWithProviders(<HealthPage />);

    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });

  it("renders the database status on success", async () => {
    server.use(http.get(HEALTH, () => HttpResponse.json({ ok: true, data: { db: "ok" } })));

    renderWithProviders(<HealthPage />);

    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });

  it("renders the error code and message on 503", async () => {
    server.use(
      http.get(HEALTH, () =>
        HttpResponse.json(
          { ok: false, error: { code: "DB_UNAVAILABLE", message: "Database is not reachable." } },
          { status: 503 },
        ),
      ),
    );

    renderWithProviders(<HealthPage />);

    expect(await screen.findByText(/DB_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText(/database is not reachable/i)).toBeInTheDocument();
  });

  it("renders a network failure without crashing", async () => {
    server.use(http.get(HEALTH, () => HttpResponse.error()));

    renderWithProviders(<HealthPage />);

    expect(await screen.findByText(/NETWORK_ERROR/)).toBeInTheDocument();
  });
});
