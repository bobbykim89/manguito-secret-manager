import { describe, expect, it } from "vitest";

import { bucketNameSchema } from "./bucketName";

// The same cases api/tests/test_buckets_api.py uses. If these two ever
// disagree, the server still refuses and this only guesses wrong about when.
const ACCEPTED = ["prod", "a", "blog-prod", "manguito_staging", "x".repeat(63)];
const REJECTED = ["Prod", "with space", "with/slash", "-leading", "", "x".repeat(64)];

describe("bucketNameSchema", () => {
  it.each(ACCEPTED)("accepts %j", (name) => {
    expect(bucketNameSchema.safeParse({ name }).success).toBe(true);
  });

  it.each(REJECTED)("rejects %j", (name) => {
    expect(bucketNameSchema.safeParse({ name }).success).toBe(false);
  });

  it("explains the rule rather than restating the regex", () => {
    const result = bucketNameSchema.safeParse({ name: "Prod" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toMatch(/lowercase/i);
      expect(message).not.toContain("^[a-z0-9]");
    }
  });
});
