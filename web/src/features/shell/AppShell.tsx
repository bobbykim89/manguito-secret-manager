import { Link, NavLink, Outlet } from "react-router";

import { Alert } from "../../components/Alert";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { useTheme } from "../../components/useTheme";

import { useSession } from "../auth/useSession";
import { useSignOut } from "../auth/useSignOut";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-semibold underline" : "opacity-60";

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
  const { resolved, setPreference } = useTheme();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-6 py-4">
        <div className="flex items-center gap-6">
          <Link to="/buckets" viewTransition className="flex items-center gap-2.5">
            <img src="/logo.webp" alt="" className="h-7 w-7 rounded-lg" />
            <span className="font-sans font-semibold">Manguito Secret Manager</span>
          </Link>
          {/* NavLink rather than Link: it supplies isActive and sets
              aria-current, so the current destination needs no state and no
              route matching here. `end` is deliberately unset, so
              /buckets/:name keeps Buckets marked. */}
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <NavLink to="/buckets" viewTransition className={navLinkClass}>
              Buckets
            </NavLink>
            <NavLink to="/keys" viewTransition className={navLinkClass}>
              Keys
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {/* Named for the thing being switched, not for the act of
              switching: role="switch" already conveys that it toggles, so
              "Dark mode, switch, on" reads correctly. */}
          <ToggleSwitch
            checked={resolved === "dark"}
            onChange={(checked) => setPreference(checked ? "dark" : "light")}
            label="Dark mode"
          />
          {session.status === "authenticated" && (
            <span className="text-[13px] opacity-70">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="rounded-sm border border-border px-3 py-1 font-sans text-sm"
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

      {/*
        Pinned to explicit light values. Buckets, secrets and API keys still
        use hardcoded light mode classes, and two of them render a secret on
        a bg-slate-100 block with no text colour, which would be invisible
        against a dark inherited colour. Each of those pieces deletes this
        pin as it is reskinned.
      */}
      <main className="mx-auto w-full max-w-2xl flex-1 bg-white p-8 text-slate-900">
        <Outlet />
      </main>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border p-6">
        <div className="flex items-center gap-2">
          <img src="/logo.webp" alt="" className="h-5 w-5 rounded-md" />
          <span className="text-[13px] text-text-muted">
            © 2026 Manguito Secret Manager
          </span>
        </div>
        <nav aria-label="Footer" className="flex gap-4 text-[13px]">
          <NavLink to="/buckets" viewTransition>
            Buckets
          </NavLink>
          <NavLink to="/keys" viewTransition>
            Keys
          </NavLink>
        </nav>
      </footer>
    </div>
  );
}
