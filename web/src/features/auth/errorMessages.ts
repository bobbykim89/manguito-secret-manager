/**
 * Callback failure codes mapped to text.
 *
 * The raw `?error=` value is never rendered. It is attacker controllable, so
 * echoing it would let anyone put arbitrary text on the login screen, for
 * example a fake support phone number. React escapes markup, so this is not
 * XSS; it is a content injection and a phishing surface.
 *
 * These are exactly the four codes api/app/routers/auth.py can emit.
 */
const MESSAGES: Record<string, string> = {
  CONSENT_DENIED: "Sign in was cancelled. You can try again whenever you're ready.",
  INVALID_STATE: "That sign in attempt expired. Please start again.",
  EXCHANGE_FAILED: "We could not complete sign in with Google. Please try again.",
  EMAIL_NOT_VERIFIED:
    "Your Google account's email address is not verified. Verify it with Google, then try again.",
};

export const FALLBACK_ERROR_MESSAGE = "Sign in did not complete. Please try again.";

export function messageForErrorCode(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return MESSAGES[code] ?? FALLBACK_ERROR_MESSAGE;
}
