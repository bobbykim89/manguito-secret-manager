import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/setup";
import { apiUrl, ApiError, client } from "./client";

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

describe("client.post", () => {
  it("sends a POST and returns the data arm", async () => {
    let method: string | undefined;
    server.use(
      http.post(`${BASE}/v1/auth/logout`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true, data: { signed_out: true } });
      }),
    );

    await expect(client.post<{ signed_out: boolean }>("/v1/auth/logout")).resolves.toEqual({
      signed_out: true,
    });
    expect(method).toBe("POST");
  });

  it("sends no body and no content type when none is given", async () => {
    let contentType: string | null = null;
    let raw = "";
    server.use(
      http.post(`${BASE}/v1/auth/logout`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        raw = await request.text();
        return HttpResponse.json({ ok: true, data: { signed_out: true } });
      }),
    );

    await client.post("/v1/auth/logout");

    expect(contentType).toBeNull();
    expect(raw).toBe("");
  });

  it("serialises a body as JSON when one is given", async () => {
    let received: unknown;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v1/thing`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        received = await request.json();
        return HttpResponse.json({ ok: true, data: { ok: 1 } });
      }),
    );

    await client.post("/v1/thing", { name: "x" });

    expect(received).toEqual({ name: "x" });
    expect(contentType).toContain("application/json");
  });

  it("throws ApiError on the failure arm, like get", async () => {
    server.use(
      http.post(`${BASE}/v1/auth/logout`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
          { status: 401 },
        ),
      ),
    );

    await expect(client.post("/v1/auth/logout")).rejects.toMatchObject({
      name: "ApiError",
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });
});

describe("client.del", () => {
  it("sends DELETE and returns the narrowed data", async () => {
    let method: string | undefined;
    server.use(
      http.delete("http://localhost:8000/v1/buckets/gone", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );

    const data = await client.del<{ deleted: boolean }>("/v1/buckets/gone");

    expect(method).toBe("DELETE");
    expect(data).toEqual({ deleted: true });
  });

  it("throws ApiError on the envelope's failure arm", async () => {
    server.use(
      http.delete("http://localhost:8000/v1/buckets/full", () =>
        HttpResponse.json(
          { ok: false, error: { code: "BUCKET_NOT_EMPTY", message: "Still holds secrets." } },
          { status: 409 },
        ),
      ),
    );

    await expect(client.del("/v1/buckets/full")).rejects.toMatchObject({
      code: "BUCKET_NOT_EMPTY",
      status: 409,
    });
  });

  it("sends credentials, like every other method", async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.delete("http://localhost:8000/v1/buckets/creds", ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );

    await client.del("/v1/buckets/creds");

    expect(credentials).toBe("include");
  });
});

describe("apiUrl", () => {
  it("composes a path onto the configured API base", () => {
    expect(apiUrl("/v1/auth/google/start")).toBe(`${BASE}/v1/auth/google/start`);
  });
});
