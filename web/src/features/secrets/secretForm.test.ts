import { describe, expect, it } from "vitest";

import { MAX_VALUE_BYTES, secretFormSchema } from "./secretForm";

function keyNameAccepted(keyName: string): boolean {
  return secretFormSchema.safeParse({ keyName, value: "v" }).success;
}

function valueAccepted(value: string): boolean {
  return secretFormSchema.safeParse({ keyName: "KEY", value }).success;
}

describe("the secret key name rule", () => {
  // The backend's VALID_CASES, verbatim from api/tests/test_secret_key_names.py.
  it.each([
    ["upper with underscore", "DATABASE_URL"],
    ["dotted", "stripe.webhook"],
    ["hyphenated", "next-auth"],
    ["single char", "A"],
    ["at the 128 limit", "x".repeat(128)],
  ])("accepts %s", (_label, keyName) => {
    expect(keyNameAccepted(keyName)).toBe(true);
  });

  // The backend's INVALID_CASES, verbatim.
  it.each([
    ["one over the limit", "x".repeat(129)],
    ["leading hyphen", "-leading"],
    ["leading dot", ".leading"],
    ["leading underscore", "_leading"],
    ["empty", ""],
    ["slash", "with/slash"],
    ["space", "with space"],
    ["comma", "with,comma"],
    ["trailing newline", "KEY\n"],
  ])("rejects %s", (_label, keyName) => {
    expect(keyNameAccepted(keyName)).toBe(false);
  });

  it("is not the bucket rule: uppercase and dots are the whole point", () => {
    // ADR 002 A22. If someone ever "unifies" this with bucketName.ts, this is
    // the test that stops it.
    expect(keyNameAccepted("DATABASE_URL")).toBe(true);
    expect(keyNameAccepted("stripe.webhook")).toBe(true);
  });
});

describe("the value size rule", () => {
  it("accepts a value exactly at the limit", () => {
    expect(valueAccepted("a".repeat(MAX_VALUE_BYTES))).toBe(true);
  });

  it("rejects one ASCII byte over the limit", () => {
    expect(valueAccepted("a".repeat(MAX_VALUE_BYTES + 1))).toBe(false);
  });

  it("rejects a multi byte value that is under the limit in characters", () => {
    // The trap. 30,000 characters is well under 65,536, and 90,000 bytes is
    // well over. A .max() on the string would accept this and the server
    // would reject it.
    const value = "中".repeat(30_000);

    expect(value.length).toBeLessThan(MAX_VALUE_BYTES);
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(MAX_VALUE_BYTES);
    expect(valueAccepted(value)).toBe(false);
  });

  it("accepts an empty value, because the backend does", () => {
    expect(valueAccepted("")).toBe(true);
  });
});
