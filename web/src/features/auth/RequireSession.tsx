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
    // min-h-dvh, because the guard renders outside AppShell and so owns the
    // whole viewport. Nothing else is competing for the height, which is what
    // makes centring here a two-class job rather than a layout problem.
    return (
      <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <p className="text-sm text-text-muted">Loading...</p>
        <div
          aria-hidden
          className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-accent motion-reduce:animate-none"
        />
      </div>
    );
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
