// The days a climber can't pick, as the screens read them from the jobber-free-days function: booked in
// Jobber, or a day the company is closed. Pure, so vitest can check it.

export type BlockedReason = 'busy' | 'closed';

/** YYYY-MM-DD to reason, from the function's reply. Anything unexpected gives an empty map: the server still checks each pick. */
export function blockedDaysFrom(reply: unknown): Map<string, BlockedReason> {
  const out = new Map<string, BlockedReason>();
  const blocked = (reply as { blocked?: unknown } | null)?.blocked;
  if (!Array.isArray(blocked)) return out;
  for (const entry of blocked) {
    const date = (entry as { date?: unknown })?.date;
    const status = (entry as { status?: unknown })?.status;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && (status === 'busy' || status === 'closed')) {
      out.set(date, status);
    }
  }
  return out;
}

/** The short label shown on a day the climber can't pick. */
export const blockedLabel = (reason: BlockedReason) => (reason === 'busy' ? 'Booked' : 'Closed');

/** The longer note shown next to an offered day the climber can't pick. */
export const blockedNote = (reason: BlockedReason) =>
  reason === 'busy' ? 'already booked in Jobber' : 'the company is closed';
