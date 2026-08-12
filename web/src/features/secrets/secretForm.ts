import { z } from "zod";

/**
 * Duplicated from the backend's KEY_NAME_PATTERN, deliberately and visibly,
 * for the reason bucketName.ts records: a regex is a runtime value and
 * openapi-typescript produces types, so nothing carries it across the
 * generated boundary.
 *
 * This is NOT the bucket rule. Uppercase and dots are allowed, because these
 * are environment variable names. ADR 002 A22 records why the asymmetry
 * exists, so do not unify the two.
 *
 * JavaScript's `$` without the m flag matches the true end of the string, so
 * "KEY\n" is rejected here as it is by Pydantic's Rust engine. Python's own
 * re.match would have accepted it, which is why the backend's test says so.
 */
export const SECRET_KEY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const SECRET_KEY_NAME_MESSAGE =
  "Use letters, numbers, dots, hyphens and underscores, starting with a letter or number, up to 128 characters.";

export const MAX_VALUE_BYTES = 64 * 1024;

export const VALUE_TOO_LARGE_MESSAGE = "A secret can be at most 64 KiB.";

export const secretFormSchema = z.object({
  keyName: z.string().regex(SECRET_KEY_NAME_PATTERN, SECRET_KEY_NAME_MESSAGE),
  // Bytes, not characters. z.string().max(65536) counts UTF-16 code units, so
  // 30,000 characters of a three byte character would pass here at 30,000 and
  // fail at the server at 90,000.
  value: z
    .string()
    .refine((v) => new TextEncoder().encode(v).length <= MAX_VALUE_BYTES, VALUE_TOO_LARGE_MESSAGE),
});

export type SecretFormValues = z.infer<typeof secretFormSchema>;
