/**
 * A controlled on/off switch, styled as a track and thumb.
 *
 * No internal state: the caller owns checked, the same contract as a
 * native checkbox. label sets the accessible name; nothing here renders
 * visible text, so a caller that wants a visible label wraps this itself.
 *
 * shrink-0 is load-bearing: without it, placing this next to a wrapping text
 * sibling in a width-constrained flex row (the API keys capability rows,
 * inside Modal's fixed-width dialog) lets the browser's flex-shrink algorithm
 * squeeze the track below its fixed w-11 once the text sibling hits its own
 * min-content floor and the shrink deficit lands entirely on this element.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors ${
        checked ? "bg-accent" : "bg-surface"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
