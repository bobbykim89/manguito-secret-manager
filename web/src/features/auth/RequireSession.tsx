import { Navigate, Outlet } from "react-router";

import { useSession } from "./useSession";

/**
 * Layout route guarding everything that needs a session.
 *
 * A guard rather than a check per page, so later sub-projects add routes as
 * children and inherit it. The loading state is unavoidable: ADR 003 forbids
 * caching an auth hint in JS accessible storage, so the first paint genuinely
 * cannot know who you are.
 */
export function RequireSession() {
  const session = useSession();

  if (session.status === "pending") {
    return <p className="p-8 text-text-muted">Loading</p>;
  }

  if (session.status === "error") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Cannot reach the server</h1>
        <p className="mt-2 text-text-muted">{session.message}</p>
      </main>
    );
  }

  if (session.status === "unauthenticated") {
    // replace, so the back button does not bounce between here and login.
    return <Navigate to="/login" replace />;
  }

  if (session.status === "authenticated") {
    return <Outlet />;
  }

  // A fifth Session arm must fail tsc here rather than falling through to
  // Outlet. Defaulting an unrecognised state to "let them in" is the wrong
  // direction for a component whose job is deciding who gets in, and the
  // change that added the arm would live in another file entirely.
  const unhandled: never = session;
  throw new Error(`Unhandled session status: ${JSON.stringify(unhandled)}`);
}
