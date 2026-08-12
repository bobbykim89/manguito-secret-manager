import { describe, expect, it } from "vitest";

import {
  apiKeyFormSchema,
  expiresAtFromPreset,
  EXPIRY_PRESETS,
  KEY_NAME_MAX_LENGTH,
} from "./apiKeyForm";

function parse(overrides: Record<string, unknown> = {}) {
  return apiKeyFormSchema.safeParse({
    name: "ci-deploy",
    buckets: ["prod"],
    canWrite: false,
    canReveal: false,
    expiry: "90d",
    ...overrides,
  });
}

describe("the key form schema", () => {
  it("accepts a minimal valid key", () => {
    expect(parse().success).toBe(true);
  });

  it("requires a name", () => {
    expect(parse({ name: "" }).success).toBe(false);
  });

  it("accepts a name at the 64 character limit and rejects one over", () => {
    expect(parse({ name: "x".repeat(KEY_NAME_MAX_LENGTH) }).success).toBe(true);
    expect(parse({ name: "x".repeat(KEY_NAME_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it("requires at least one bucket, because the API does", () => {
    expect(parse({ buckets: [] }).success).toBe(false);
    expect(parse({ buckets: ["prod", "dev"] }).success).toBe(true);
  });

  it("allows all four combinations of the two capability flags", () => {
    // Write without bulk reveal is precisely a deploy pipeline's scope, so
    // collapsing these into preset roles would remove a real one.
    for (const canWrite of [true, false]) {
      for (const canReveal of [true, false]) {
        expect(parse({ canWrite, canReveal }).success).toBe(true);
      }
    }
  });

  it("rejects an expiry that is not one of the presets", () => {
    expect(parse({ expiry: "tuesday" }).success).toBe(false);
  });
});

describe("expiresAtFromPreset", () => {
  const NOW = Date.parse("2026-08-11T00:00:00.000Z");

  it("returns null for never, so no expires_at is sent at all", () => {
    expect(expiresAtFromPreset("never", NOW)).toBeNull();
  });

  it("returns an exact instant for each dated preset", () => {
    expect(expiresAtFromPreset("30d", NOW)).toBe("2026-09-10T00:00:00.000Z");
    expect(expiresAtFromPreset("90d", NOW)).toBe("2026-11-09T00:00:00.000Z");
    expect(expiresAtFromPreset("1y", NOW)).toBe("2027-08-11T00:00:00.000Z");
  });

  it("always carries an offset, which is the bug this shape removes", () => {
    // A datetime-local input yields "2026-11-09T14:30" with no offset, which
    // SP5's final review caught as a 500 before it merged.
    for (const preset of EXPIRY_PRESETS) {
      const value = expiresAtFromPreset(preset.value, NOW);
      if (value === null) {
        continue;
      }
      expect(value).toMatch(/Z$/);
      expect(Date.parse(value)).toBeGreaterThan(NOW);
    }
  });
});
