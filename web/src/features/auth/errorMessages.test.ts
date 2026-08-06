import { describe, expect, it } from "vitest";

import { FALLBACK_ERROR_MESSAGE, messageForErrorCode } from "./errorMessages";

describe("messageForErrorCode", () => {
  it("returns nothing when there is no code", () => {
    expect(messageForErrorCode(null)).toBeNull();
  });

  it.each([
    ["CONSENT_DENIED", /cancelled/i],
    ["INVALID_STATE", /expired/i],
    ["EXCHANGE_FAILED", /could not complete/i],
    ["EMAIL_NOT_VERIFIED", /not verified/i],
  ])("maps %s to its own message", (code, pattern) => {
    expect(messageForErrorCode(code)).toMatch(pattern);
  });

  it("falls back for an unrecognised code", () => {
    expect(messageForErrorCode("SOMETHING_ELSE")).toBe(FALLBACK_ERROR_MESSAGE);
  });

  it("never returns attacker supplied text", () => {
    const injected = "Your account is locked. Call 555-0100.";

    expect(messageForErrorCode(injected)).toBe(FALLBACK_ERROR_MESSAGE);
    expect(messageForErrorCode(injected)).not.toContain("555");
  });
});
