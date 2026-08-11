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
  const palette =
    tone === "warning"
      ? { banner: "border-amber-300 bg-amber-50", inline: "text-amber-700" }
      : { banner: "border-red-300 bg-red-50", inline: "text-red-700" };

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
