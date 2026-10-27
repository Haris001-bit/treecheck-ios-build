// The RipSaw RS2511 giveaway. Mirrors supabase/functions/_shared/giveaway.ts (the server checks the dates), so change
// both together. Starting the 14-day trial is the entry; there is no separate checkbox.
export const GIVEAWAY_ID = 'ripsaw-rs2511-2026';
export const GIVEAWAY_STARTS_AT = '2026-10-26T05:00:00.000Z';
export const GIVEAWAY_ENDS_AT = '2026-12-01T05:59:59.999Z';

export const GIVEAWAY_HEADLINE = 'Win a Ported RipSaw RS2511';
export const GIVEAWAY_COPY = "Start your free 14-day TreeCheck trial and you're automatically entered to win.";
export const GIVEAWAY_DISCLOSURE = 'No charge during the 14-day trial. Subscription begins after the trial unless canceled.';
export const GIVEAWAY_END_LABEL = 'November 30, 2026 at 11:59 PM Central Time';

export function giveawayOpen(now: Date = new Date()): boolean {
  const t = now.getTime();
  return t >= Date.parse(GIVEAWAY_STARTS_AT) && t <= Date.parse(GIVEAWAY_ENDS_AT);
}
