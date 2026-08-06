import { createBrowserRouter, type RouteObject } from "react-router";

import { LoginPage } from "../features/auth/LoginPage";
import { RequireSession } from "../features/auth/RequireSession";
import { HealthPage } from "../features/health/HealthPage";
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
    children: [{ path: "/", element: <AppShell /> }],
  },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
