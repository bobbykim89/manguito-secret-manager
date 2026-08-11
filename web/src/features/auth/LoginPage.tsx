import { Navigate, useSearchParams } from "react-router";

import { apiUrl } from "../../api/client";
import { Alert } from "../../components/Alert";
import { messageForErrorCode } from "./errorMessages";
import { useSession } from "./useSession";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const session = useSession();
  const message = messageForErrorCode(searchParams.get("error"));

  if (session.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Manguito Secret Manager</h1>
      <p className="mt-2 text-slate-600">Sign in to manage your secrets.</p>

      {message !== null && (
        <div className="mt-4">
          <Alert tone="warning">{message}</Alert>
        </div>
      )}

      {/*
        An anchor, not a button with an onClick. The flow is a top level
        browser navigation to Google and back through the API's callback. A
        fetch would receive an opaque redirect and silently do nothing.
      */}
      <a
        href={apiUrl("/v1/auth/google/start")}
        className="mt-6 inline-block rounded bg-slate-900 px-4 py-2 text-white"
      >
        Continue with Google
      </a>
    </main>
  );
}
