import { createBrowserRouter, type RouteObject } from "react-router";

import { HealthPage } from "../features/health/HealthPage";
import { NotFound } from "./NotFound";

/** Exported separately so tests can build a memory router over them. */
export const routes: RouteObject[] = [
  { path: "/", element: <HealthPage /> },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
