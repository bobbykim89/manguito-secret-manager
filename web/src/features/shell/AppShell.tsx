import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";

import { Alert } from "../../components/Alert";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { useTheme } from "../../components/useTheme";

import { useSession } from "../auth/useSession";
import { useSignOut } from "../auth/useSignOut";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-semibold underline" : "opacity-60";

/*
 * Drawn here rather than inlined from Font Awesome like the About page's
 * social icons. Those are brand glyphs where the official shape is the point
 * and the licence requires attribution. A sun and a moon are generic forms,
 * so matching this design's stroke weight is worth more than matching
 * someone else's, and no attribution obligation arises either way. Neither
 * approach adds a dependency.
 *
 * Both are aria-hidden. The switch beside them already carries role="switch",
 * aria-checked and aria-label="Dark mode", so a screen reader has the whole
 * story and these would only repeat it. They exist for sighted users, who
 * had position alone to go on before.
 */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /*
   * A disclosure, not a dialog, so no focus trap. Trapping focus in a
   * disclosure is a common enough mistake to be worth naming: Modal already
   * implements trapping, Escape and focus restoration, and reusing it here
   * would be the wrong prior art. Only two of those three belong.
   *
   * Escape hands focus back to the button, because the user's focus was
   * inside the panel that just vanished. An outside click deliberately does
   * not, because focus is already going wherever they clicked.
   */
  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    function handlePointerDown(event: MouseEvent) {
      if (headerRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        flex-wrap is the mechanism the mobile menu is built on, not a leftover.
        w-full sets a flex item's basis, it does not start a new row, so
        without wrapping the four groups below would squeeze onto one line
        instead of stacking. Nothing in jsdom can observe that, which is why
        the class carries a test.

        justify-between is deliberately absent: it distributed two children
        here once, and there are four now. ml-auto on the button and
        md:ml-auto on the account group reproduce it at each width instead.
      */}
      <header
        ref={headerRef}
        className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-bg px-6 py-4"
      >
        <Link to="/buckets" viewTransition className="flex items-center gap-2.5">
          <img src="/logo.webp" alt="" className="h-7 w-7 rounded-lg" />
          {/* Hidden rather than removed below sm: the logo still carries the
              brand at that width, and the wordmark is the single widest item
              in the header. It stays in the DOM, so nothing that queries for
              it breaks. */}
          <span className="hidden font-sans font-semibold sm:inline">
            Manguito Secret Manager
          </span>
        </Link>

        {/* Two groups collapse together, so aria-controls names both. A
            space separated id list is valid ARIA, and it beats wrapping them
            in one element, which would drag the nav to the right on desktop. */}
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((was) => !was)}
          aria-expanded={menuOpen}
          aria-controls="shell-nav shell-account"
          aria-label="Menu"
          className="ml-auto rounded-sm border border-border p-1.5 md:hidden"
        >
          {menuOpen ? <CloseIcon /> : <HamburgerIcon />}
        </button>

        {/* NavLink rather than Link: it supplies isActive and sets
            aria-current, so the current destination needs no state and no
            route matching here. `end` is deliberately unset, so
            /buckets/:name keeps Buckets marked. */}
        <nav
          id="shell-nav"
          aria-label="Main"
          className={`${menuOpen ? "flex" : "hidden"} w-full items-center gap-4 text-sm md:flex md:w-auto`}
        >
          <NavLink
            to="/buckets"
            viewTransition
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Buckets
          </NavLink>
          <NavLink
            to="/keys"
            viewTransition
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Keys
          </NavLink>
        </nav>

        {/* flex-1 with min-w-0 rather than ml-auto with w-auto, so this group
            takes the leftover space and can also give it back. Sized to its
            content it could not shrink, and the header wrapped to two rows at
            768px instead of the email truncating, which is the one job the
            email's own min-w-0 and truncate exist to do. justify-end keeps it
            hard right, exactly where ml-auto had it. */}
        <div
          id="shell-account"
          className={`${menuOpen ? "flex" : "hidden"} w-full items-center gap-4 md:flex md:min-w-0 md:flex-1 md:justify-end`}
        >
          {/* The icons flank the switch rather than living inside it:
              ToggleSwitch also renders the API key capability flags, so theme
              semantics have no business in it. Its own docstring settles this,
              a caller wanting visible labelling wraps it.

              Whichever side is active takes the accent, so the control says
              its state twice: knob position and colour. */}
          <div className="flex items-center gap-2">
            <SunIcon
              className={`h-4 w-4 shrink-0 ${resolved === "dark" ? "text-text-muted" : "text-accent"}`}
            />
            {/* Named for the thing being switched, not for the act of
                switching: role="switch" already conveys that it toggles, so
                "Dark mode, switch, on" reads correctly. */}
            <ToggleSwitch
              checked={resolved === "dark"}
              onChange={(checked) => setPreference(checked ? "dark" : "light")}
              label="Dark mode"
            />
            <MoonIcon
              className={`h-4 w-4 shrink-0 ${resolved === "dark" ? "text-accent" : "text-text-muted"}`}
            />
          </div>
          {session.status === "authenticated" && (
            /* min-w-0 with truncate so a long address shrinks instead of
                shoving Sign out off the edge. Truncated rather than hidden:
                which account you are signed in as is worth knowing in a secret
                manager. */
            <span className="min-w-0 truncate text-[13px] opacity-70">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            // shrink-0 with nowrap: it is the last item in a row that holds a
            // truncating email, and without these it was the thing that gave,
            // breaking across two lines as "Sign / out". The email is what
            // should shrink here.
            className="shrink-0 rounded-sm border border-border px-3 py-1 font-sans text-sm whitespace-nowrap"
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
        A pure layout passthrough: no width, no color, no padding of its own.
        Every page now supplies its own width, padding and colour; the light
        mode pin that used to sit here while pages waited for their reskin is
        gone (ADR 003 A17).
      */}
      <main className="flex w-full flex-1 flex-col">
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
          <NavLink to="/buckets" viewTransition className="text-accent">
            Buckets
          </NavLink>
          <NavLink to="/keys" viewTransition className="text-accent">
            Keys
          </NavLink>
          <NavLink to="/about" viewTransition className="text-accent">
            About
          </NavLink>
        </nav>
      </footer>
    </div>
  );
}
