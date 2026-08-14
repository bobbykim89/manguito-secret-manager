import { Navigate, useSearchParams } from "react-router";

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
      <h1 className="sr-only md:not-sr-only md:relative md:z-10 md:m-0 md:text-4xl md:font-semibold">
        Manguito Secret Manager
      </h1>

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
        <p className="relative z-10 max-w-[320px] opacity-75">
          Secrets, scoped to buckets and short-lived API keys.
        </p>
      </div>

      <main className="flex items-center justify-center p-8">
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
            className="rounded-sm bg-accent px-4 py-2 text-center font-sans font-semibold text-bg"
          >
            Continue with Google
          </a>
        </div>
      </main>
    </div>
  );
}
