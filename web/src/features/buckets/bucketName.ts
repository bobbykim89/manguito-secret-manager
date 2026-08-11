import { z } from "zod";

/**
 * Duplicated from the backend's NAME_PATTERN, deliberately and visibly.
 *
 * FastAPI emits the pattern into the OpenAPI schema, but openapi-typescript
 * produces types and a regex is a runtime value, so nothing carries it across
 * the generated boundary. This is the only copy on this side, and its test
 * uses the same cases the backend's does. If the two drift, the server still
 * refuses and this merely guesses wrong about when, which is the failure mode
 * worth having rather than its reverse. See ADR 002 A16.
 */
export const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

// Teaches the rule rather than restating the regex, because lowercase only is
// the part people get wrong.
export const BUCKET_NAME_MESSAGE =
  "Use lowercase letters, numbers, hyphens and underscores, starting with a letter or number.";

export const bucketNameSchema = z.object({
  name: z.string().regex(BUCKET_NAME_PATTERN, BUCKET_NAME_MESSAGE),
});

export type BucketNameValues = z.infer<typeof bucketNameSchema>;
