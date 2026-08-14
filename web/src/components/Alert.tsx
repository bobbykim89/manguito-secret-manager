import type { ReactNode } from "react";

/**
 * The one place role="alert" is spelled in this app.
 *
 * Both axes come from code this replaces rather than from anticipation:
 * banner and inline both existed, as did the amber sign in notice. There is
 * deliberately no className prop. A component that takes arbitrary classes is
 * the styled paragraph it was extracted from.
 */
export function Alert({
  variant = "banner",
  tone = "error",
  children,
}: {
  variant?: "banner" | "inline";
  tone?: "error" | "warning";
  children: ReactNode;
}) {
  // The banner variant is a self-contained light card (dark text on a light
  // fill), so its contrast holds regardless of the surrounding theme. The
  // inline variant has no fill of its own: it sits directly on whatever
  // dialog or page background is behind it, which in dark mode is the near
  // black --color-surface. The light shades below read at roughly 2.4:1
  // there, well under WCAG AA's 4.5:1, so inline needs its own dark: color.
  const palette =
    tone === "warning"
      ? { banner: "border-amber-300 bg-amber-50 text-amber-900", inline: "text-amber-700 dark:text-amber-400" }
      : { banner: "border-red-300 bg-red-50 text-red-900", inline: "text-red-700 dark:text-red-400" };

  const className =
    variant === "banner"
      ? `rounded border p-3 text-sm ${palette.banner}`
      : `text-sm ${palette.inline}`;

  return (
    <p role="alert" className={className}>
      {children}
    </p>
  );
}
