import { z } from "zod";

/** Duplicated from api/app/models/api_key.py:18. A number, not a pattern. */
export const KEY_NAME_MAX_LENGTH = 64;

export type ExpiryPreset = "30d" | "90d" | "1y" | "never";

/**
 * Presets rather than a datetime input, so two failures have no input that
 * could cause them.
 *
 * A datetime-local input yields "2026-11-09T14:30" with no offset, and SP5's
 * final review caught a 500 from exactly that before it merged. And the API
 * refuses an expires_at already in the past, which adding to now cannot
 * produce.
 */
export const EXPIRY_PRESETS: { value: ExpiryPreset; label: string; days: number | null }[] = [
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "1y", label: "1 year", days: 365 },
  { value: "never", label: "Never", days: null },
];

export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .min(1, "Give the key a name so you can tell it apart later.")
    .max(KEY_NAME_MAX_LENGTH, `Use at most ${KEY_NAME_MAX_LENGTH} characters.`),
  // The API requires at least one, and a key scoped to nothing could reach
  // nothing anyway.
  buckets: z.array(z.string()).min(1, "Choose at least one bucket."),
  canWrite: z.boolean(),
  canReveal: z.boolean(),
  expiry: z.enum(["30d", "90d", "1y", "never"]),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * An aware UTC instant in the future, or null for never.
 *
 * `now` is a parameter so the test can pin an exact instant rather than
 * assert a range.
 */
export function expiresAtFromPreset(preset: ExpiryPreset, now: number = Date.now()): string | null {
  const found = EXPIRY_PRESETS.find((candidate) => candidate.value === preset);
  if (found === undefined || found.days === null) {
    return null;
  }
  return new Date(now + found.days * MILLISECONDS_PER_DAY).toISOString();
}
