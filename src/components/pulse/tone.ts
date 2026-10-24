// Financial Pulse: status colours and the choice-tile look, from TreeCheck's dark "holographic glass" theme of
// 2026-10-01 (it is the default :root, so Tailwind `dark:` classes never apply). Theme tokens only, never fixed
// palette colours (src/lib/pulse/themeColors.test.ts).

/**
 * Words in a status colour. Green and amber are the theme's own tokens. Plain --destructive is under 4.5:1 for
 * small text on the card's light end and on tints, so red words are mixed a quarter toward the text colour
 * (4.55:1 or more on every Pulse surface). Large figures, icons and bar fills keep plain destructive.
 * Browsers without color-mix() (Safari before 16.2, Chrome before 111) keep plain destructive: without the
 * @supports guard they would drop the colour and show the words in the text colour.
 */
export const GOOD_TEXT = "text-success";
export const WARN_TEXT = "text-warning";
export const BAD_TEXT = "text-destructive supports-[color:color-mix(in_srgb,currentcolor,currentcolor)]:text-[color:color-mix(in_srgb,hsl(var(--destructive))_75%,hsl(var(--foreground)))]";

/** Absolute outcome: profit/money in is good above zero; costs are good below zero (refunds). */
export function amountTone(amount: number, cost = false): string {
  if (amount === 0) return "text-muted-foreground";
  return (cost ? amount < 0 : amount > 0) ? GOOD_TEXT : BAD_TEXT;
}

export const CASHFLOW_IN_STROKE = "hsl(var(--success))";
export const CASHFLOW_OUT_STROKE = "hsl(var(--destructive))";
export const CHART_MUTED = "hsl(var(--muted-foreground))";
export const CHART_BORDER = "hsl(var(--border))";

/** Icons in a status colour. */
export const GOOD_ICON = "text-success";
export const WARN_ICON = "text-warning";

/** A panel tinted with a status colour, and its border (about 3:1 against the card). */
export const GOOD_PANEL = "bg-success/10";
export const WARN_PANEL = "bg-warning/10";
export const BAD_PANEL = "bg-destructive/10";
export const GOOD_BORDER = "border-success/60";
export const WARN_BORDER = "border-warning/60";
export const BAD_BORDER = "border-destructive/85";

/** A status chip, for an outline Badge (the solid default and destructive Badges fail contrast on this theme). */
export const GOOD_CHIP = "border-success/50 bg-success/10 text-success";
export const BAD_CHIP = `border-destructive/60 bg-destructive/15 ${BAD_TEXT}`;

/** A choice tile (a Label around a radio or checkbox): the whole tile shows the choice, like TreeCheck's own choice tiles. */
export const CHOICE_TILE = "flex items-center gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer font-normal leading-snug transition-colors";
export const CHOICE_ON = "border-primary bg-primary/10 ring-1 ring-primary";
export const CHOICE_OFF = "border-border hover:border-primary/50";
