/**
 * The single place the ADR 002 response envelope is narrowed.
 *
 * Components and TanStack Query hooks deal in domain types and thrown
 * errors, never in `{ ok, data }` wrappers. Letting `ok` checks spread into
 * components is the most likely way this codebase degrades. (ADR 003 A1)
 */

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

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

const BASE_URL: string = import.meta.env.VITE_API_URL ?? "";

function isErrorBody(value: unknown): value is { code: string; message: string } {
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
