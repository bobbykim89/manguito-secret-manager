import { Outlet } from "react-router";

import { Alert } from "../../components/Alert";

import { useSession } from "../auth/useSession";
import { useSignOut } from "../auth/useSignOut";

/**
 * The signed in shell.
 *
 * Only ever rendered inside RequireSession, so the session is authenticated in
 * practice. useSession is read again rather than threaded through an outlet
 * context because the query is already cached under the same key, so this
 * costs nothing and keeps the component independently testable. A layout
 * route whose children supply the body through Outlet.
 */
export function AppShell() {
  const session = useSession();
  const signOut = useSignOut();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold">Manguito Secret Manager</span>
        <div className="flex items-center gap-4">
          {session.status === "authenticated" && (
            <span className="text-sm text-slate-600">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="rounded border px-3 py-1 text-sm"
          >
            Sign out
          </button>
        </div>
      </header>

      {signOut.isError && (
        <div className="mx-6 mt-4">
          <Alert>Could not sign out. Please try again.</Alert>
        </div>
      )}

      <main className="mx-auto max-w-2xl p-8">
        <Outlet />
      </main>
    </div>
  );
}
