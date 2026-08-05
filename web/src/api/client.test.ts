import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/setup";
import { ApiError, client } from "./client";

const BASE = "http://localhost:8000";

describe("client", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("returns data from the success arm of the envelope", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );

    await expect(client.get<{ db: string }>("/v1/health")).resolves.toEqual({ db: "ok" });
  });

  it("throws ApiError carrying the code and message from the failure arm", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "DB_UNAVAILABLE", message: "Database is not reachable." } },
          { status: 503 },
        ),
      ),
    );

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      name: "ApiError",
      code: "DB_UNAVAILABLE",
      message: "Database is not reachable.",
      status: 503,
    });
  });

  it("throws ApiError with NETWORK_ERROR when the request cannot be made", async () => {
    server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.error()));

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });

  it("throws ApiError with INVALID_RESPONSE when the body is not an envelope", async () => {
    server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.json({ nope: true })));

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("throws ApiError (not a raw TypeError) when the failure arm has no error key", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () => HttpResponse.json({ ok: false }, { status: 500 })),
    );

    const rejection = expect(client.get("/v1/health")).rejects;
    await rejection.toBeInstanceOf(ApiError);
    await rejection.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("throws ApiError with INVALID_RESPONSE when the failure arm's error is not an object", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json({ ok: false, error: "boom" }, { status: 500 }),
      ),
    );

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("throws ApiError with INVALID_RESPONSE rather than resolving to undefined when the success arm has no data", async () => {
    server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.json({ ok: true })));

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("sends credentials so the session cookie is attached", async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.get(`${BASE}/v1/health`, ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ ok: true, data: { db: "ok" } });
      }),
    );

    await client.get("/v1/health");

    expect(credentials).toBe("include");
  });

  it("is an instance of ApiError, so callers can narrow on it", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json({ ok: false, error: { code: "X", message: "y" } }, { status: 400 }),
      ),
    );

    await expect(client.get("/v1/health")).rejects.toBeInstanceOf(ApiError);
  });
});
