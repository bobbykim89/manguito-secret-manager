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
const MESSAGES = new Map<string, string>([
  ["CONSENT_DENIED", "Sign in was cancelled. You can try again whenever you're ready."],
  ["INVALID_STATE", "That sign in attempt expired. Please start again."],
  ["EXCHANGE_FAILED", "We could not complete sign in with Google. Please try again."],
  [
    "EMAIL_NOT_VERIFIED",
    "Your Google account's email address is not verified. Verify it with Google, then try again.",
  ],
]);

export const FALLBACK_ERROR_MESSAGE = "Sign in did not complete. Please try again.";

export function messageForErrorCode(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  // A Map rather than an object literal: indexing an object falls through to
  // Object.prototype, so ?error=__proto__ returns an object that React throws
  // on, and ?error=constructor returns a function that renders as an empty
  // alert. Both are reachable from a URL an attacker controls.
  return MESSAGES.get(code) ?? FALLBACK_ERROR_MESSAGE;
}
