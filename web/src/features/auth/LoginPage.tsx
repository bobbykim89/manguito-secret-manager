import { Link, Navigate, useSearchParams } from "react-router";

import { apiUrl } from "../../api/client";
import { Alert } from "../../components/Alert";
import { messageForErrorCode } from "./errorMessages";
import { useSession } from "./useSession";

/**
 * A two column split: a tinted brand panel and a sign in card.
 *
 * The panel is hidden below md. The mockup this follows is desktop only and
 * specifies no mobile behaviour, so dropping the decoration rather than
 * stacking it is a decision made here, not one carried over.
 *
 * There are two <h1> elements in the markup, never both exposed at once: the
 * one inside the panel is removed from the accessibility tree below md
 * (the panel is display:none there), and the one inside <main> is removed at
 * md and up (md:hidden). A screen reader user and a sighted user each ever
 * reach exactly one page heading, whichever width they're at.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const message = messageForErrorCode(searchParams.get("error"));

  if (session.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[minmax(300px,38%)_1fr]">
      <div className="relative hidden flex-col justify-center gap-4 overflow-hidden bg-accent-100 p-8 md:flex">
        {/* Ornament only, so it is hidden from assistive technology. The
            circles are solid fills at partial opacity, not blurs. */}
        <div
          aria-hidden="true"
          className="absolute -top-[60px] -left-[60px] h-[220px] w-[220px] rounded-full bg-accent-2-100 opacity-60"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-[30px] left-[140px] h-[140px] w-[140px] rounded-full bg-accent-200 opacity-50"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-[30px] right-[50px] h-[90px] w-[90px] rounded-full bg-accent-2-200 opacity-50"
        />
        <img
          src="/logo.webp"
          alt=""
          className="relative z-10 h-16 w-16 rounded-[18px]"
        />
        <h1 className="relative z-10 m-0 text-4xl font-semibold">Manguito Secret Manager</h1>
        <p className="relative z-10 max-w-[320px] opacity-75">
          Secrets, scoped to buckets and short-lived API keys.
        </p>
      </div>

      <main className="flex flex-col items-center justify-center p-8">
        <h1 className="sr-only md:hidden">Manguito Secret Manager</h1>
        <div className="flex w-[min(380px,100%)] flex-col gap-4 rounded-sm border border-border bg-surface p-6">
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="text-text-muted">Sign in to manage your secrets.</p>

          {message !== null && <Alert tone="warning">{message}</Alert>}

          {/*
            An anchor, not a button with an onClick. The flow is a top level
            browser navigation to Google and back through the API's callback. A
            fetch would receive an opaque redirect and silently do nothing.
          */}
          <a
            href={apiUrl("/v1/auth/google/start")}
            className="rounded-md bg-accent px-4 py-2 text-center font-sans font-semibold text-bg"
          >
            Continue with Google
          </a>
        </div>

        <p className="mt-4 text-center text-sm text-text-muted">
          <Link to="/about" className="hover:text-accent">
            About this project
          </Link>
        </p>
      </main>
    </div>
  );
}
