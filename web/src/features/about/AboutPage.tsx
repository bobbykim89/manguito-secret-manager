import { Link } from "react-router";

/**
 * The application's second public page, beside the login screen.
 *
 * Standalone rather than a child of AppShell: it has to render for a signed
 * out visitor, which is the whole reason it is worth indexing, and AppShell's
 * header offers a Sign out button and links to pages such a visitor cannot
 * open.
 */

/**
 * Icons are Font Awesome Free 6.x, which is CC BY 4.0 and requires the
 * attribution rendered beside each path below. Inlined rather than pulled
 * from a package: three glyphs do not justify a dependency.
 */
const SOCIAL_LINKS = [
  {
    label: "GitHub",
    href: "https://github.com/bobbykim89",
    viewBox: "0 0 448 512",
    path: "M448 96c0-35.3-28.7-64-64-64H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V96zM265.8 407.7c0-1.8 0-6 .1-11.6c.1-11.4 .1-28.8 .1-43.7c0-15.6-5.2-25.5-11.3-30.7c37-4.1 76-9.2 76-73.1c0-18.2-6.5-27.3-17.1-39c1.7-4.3 7.4-22-1.7-45c-13.9-4.3-45.7 17.9-45.7 17.9c-13.2-3.7-27.5-5.6-41.6-5.6s-28.4 1.9-41.6 5.6c0 0-31.8-22.2-45.7-17.9c-9.1 22.9-3.5 40.6-1.7 45c-10.6 11.7-15.6 20.8-15.6 39c0 63.6 37.3 69 74.3 73.1c-4.8 4.3-9.1 11.7-10.6 22.3c-9.5 4.3-33.8 11.7-48.3-13.9c-9.1-15.8-25.5-17.1-25.5-17.1c-16.2-.2-1.1 10.2-1.1 10.2c10.8 5 18.4 24.2 18.4 24.2c9.7 29.7 56.1 19.7 56.1 19.7c0 9 .1 21.7 .1 30.6c0 4.8 .1 8.6 .1 10c0 4.3-3 9.5-11.5 8C106 393.6 59.8 330.8 59.8 257.4c0-91.8 70.2-161.5 162-161.5s166.2 69.7 166.2 161.5c.1 73.4-44.7 136.3-110.7 158.3c-8.4 1.5-11.5-3.7-11.5-8z",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/sihun-kim-9baa17165/",
    viewBox: "0 0 448 512",
    path: "M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z",
  },
  {
    label: "Email",
    href: "mailto:bobby.sihun.kim@gmail.com",
    viewBox: "0 0 512 512",
    path: "M64 112c-8.8 0-16 7.2-16 16l0 22.1L220.5 291.7c20.7 17 50.4 17 71.1 0L464 150.1l0-22.1c0-8.8-7.2-16-16-16L64 112zM48 212.2L48 384c0 8.8 7.2 16 16 16l384 0c8.8 0 16-7.2 16-16l0-171.8L322 328.8c-38.4 31.5-93.7 31.5-132 0L48 212.2zM0 128C0 92.7 28.7 64 64 64l384 0c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64L64 448c-35.3 0-64-28.7-64-64L0 128z",
  },
] as const;

export function AboutPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-[900px] rounded-lg border border-border bg-surface p-8 shadow-lg">
        <div className="flex flex-col items-center gap-8 md:flex-row md:gap-10">
          {/* The circle carries the brand colour and the logo sits inside it
              at 112px. logo.webp is 192px square, so filling a 240px circle
              would upscale it and soften visibly on a high density display. */}
          <Link
            to="/"
            aria-label="Manguito Secret Manager home"
            className="flex aspect-square w-full max-w-[240px] shrink-0 items-center justify-center rounded-full border-4 border-border bg-accent-100 transition-opacity hover:opacity-75"
          >
            <img src="/logo.webp" alt="" className="h-28 w-28 rounded-[24px]" />
          </Link>

          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">About Manguito Secret Manager</h1>

            <p>
              A self hosted secret manager. Secrets live in buckets, encrypted at rest with
              envelope encryption, and are reachable through this web interface or programmatically
              with a scoped API key.
            </p>

            <p className="text-text-muted">Maintained by Bobby Kim</p>

            <div className="flex items-center gap-4">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  // noreferrer, not just noopener: it covers the Referer
                  // header as well as window.opener.
                  rel="noreferrer"
                  aria-label={link.label}
                  className="text-text-muted transition-colors hover:text-accent"
                >
                  {/* !Font Awesome Free 6.6.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2024 Fonticons, Inc. */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox={link.viewBox}
                    fill="currentColor"
                    aria-hidden="true"
                    className="h-7 w-7"
                  >
                    <path d={link.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
