import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A config assertion, which this suite otherwise avoids, for the same reason
 * Modal's height bound and AppShell's flex-wrap have one: nothing reachable
 * from a test can observe it, and losing it fails silently in production.
 *
 * Every route except / is created by React Router in the browser, so there is
 * no file at dist/login for a static host to serve. Without this rewrite
 * Vercel answers any direct navigation with its own 404: a refresh, a
 * bookmark, an OAuth callback landing anywhere but /, or a crawler fetching
 * /about. The application never loads, so its own NotFound never renders
 * either, which is what makes the failure so confusing to read.
 */
// Resolved from the Vitest root, which is web/, rather than from
// import.meta.url: under the jsdom environment that is an http URL, not a
// file one, so fileURLToPath rejects it.
const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  rewrites?: { source: string; destination: string }[];
};

describe("the deployed SPA fallback", () => {
  it("sends unmatched paths to index.html, so a deep link survives a refresh", () => {
    expect(config.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });
});
