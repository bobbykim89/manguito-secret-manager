import { createBrowserRouter, Navigate, type RouteObject } from "react-router";

import { KeysPage } from "../features/api-keys/KeysPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RequireSession } from "../features/auth/RequireSession";
import { BucketsPage } from "../features/buckets/BucketsPage";
import { HealthPage } from "../features/health/HealthPage";
import { SecretsPage } from "../features/secrets/SecretsPage";
import { AppShell } from "../features/shell/AppShell";
import { NotFound } from "./NotFound";

/**
 * Everything is behind RequireSession except login, health, and not found.
 *
 * The guard is a layout route rather than a check repeated per page, so later
 * sub-projects add routes as children and inherit it. Health stays public: it
 * is a development affordance, and putting a database check behind a login
 * would defeat its purpose.
 */
export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/health", element: <HealthPage /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppShell />,
        children: [
          // ADR 003 A7: the list lives at /buckets so that SP7's
          // /buckets/:name and SP8's /keys are siblings. replace, so the back
          // button does not bounce between / and /buckets.
          { index: true, element: <Navigate to="/buckets" replace /> },
          { path: "/buckets", element: <BucketsPage /> },
          // ADR 003 A7 again: a sibling of /buckets, not a child of an
          // inconsistent parent.
          { path: "/buckets/:name", element: <SecretsPage /> },
          // ADR 003 A7's third sibling, which SP6 and SP7 both named in
          // advance.
          { path: "/keys", element: <KeysPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
