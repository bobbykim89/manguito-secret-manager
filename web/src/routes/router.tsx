import { createBrowserRouter, type RouteObject } from "react-router";

function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">secretbox</h1>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p>Page not found.</p>
    </main>
  );
}

/** Exported separately so tests can build a memory router over them. */
export const routes: RouteObject[] = [
  { path: "/", element: <Home /> },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
