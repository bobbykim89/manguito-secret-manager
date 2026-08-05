/**
 * The single place the ADR 002 response envelope is narrowed.
 *
 * Components and TanStack Query hooks deal in domain types and thrown
 * errors, never in `{ ok, data }` wrappers. Letting `ok` checks spread into
 * components is the most likely way this codebase degrades. (ADR 003 A1)
 */

import type { components } from "./generated";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type ErrEnvelope = components["schemas"]["Err"];
type Envelope<T> = { ok: true; data: T } | ErrEnvelope;

type AssertTrue<T extends true> = T;

/**
 * Fails tsc if the Python envelope's success arm stops matching the shape this
 * module narrows. The success arm has to stay generic in T, so it cannot be
 * taken from the generated types directly; without this check, renaming a
 * field in Pydantic would regenerate cleanly and leave every test passing
 * against a stale shape.
 */
export type OkArmMatchesGeneratedSchema = AssertTrue<
  components["schemas"]["Ok_HealthData_"] extends { ok: true; data: unknown }
    ? true
    : "The generated success arm no longer matches { ok: true; data: ... }"
>;

const BASE_URL: string = import.meta.env.VITE_API_URL ?? "";

function isErrorBody(value: unknown): value is ErrEnvelope["error"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

function isEnvelope<T>(body: unknown): body is Envelope<T> {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { ok?: unknown; data?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return "data" in candidate;
  }
  if (candidate.ok === false) {
    return isErrorBody(candidate.error);
  }
  return false;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the API.", 0);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("INVALID_RESPONSE", "The API returned a malformed response.", response.status);
  }

  if (!isEnvelope<T>(body)) {
    throw new ApiError("INVALID_RESPONSE", "The API returned a malformed response.", response.status);
  }

  if (!body.ok) {
    throw new ApiError(body.error.code, body.error.message, response.status);
  }

  return body.data;
}

export const client = {
  get: <T>(path: string): Promise<T> => request<T>(path),
};
