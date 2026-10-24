// Financial Pulse: how a failing Jobber import is recorded in jobber_sync_state.last_error (A8).
// Server-side only. No imports, so it can be unit-tested without Deno.
//
// last_error = "[reconnect: ]#<n> <message>":
// * "reconnect:" when Jobber refused the stored sign-in (the owner must reconnect Jobber);
// * n = how many tries in a row have failed (any page of progress or a new connection clears it).
// The Pulse screen shows a Jobber problem after FAILING_AFTER failed tries in a row, instead of waiting.

/** last_error starts with this when Jobber refused the stored sign-in: the owner must reconnect Jobber. */
export const RECONNECT_ERROR = "reconnect:";

/**
 * Failed tries in a row before the import counts as failing. pulse-get's background refreshes are at
 * least 3 minutes apart, and the setup page adds at most one (it doesn't retry a failure the server
 * answered), so this is several minutes of failing, not a short blip.
 */
export const FAILING_AFTER = 3;

/** Jobber refused the stored sign-in on the last try. */
export function needsReconnect(state: { last_error?: unknown } | null | undefined): boolean {
  return typeof state?.last_error === "string" && state.last_error.startsWith(RECONNECT_ERROR);
}

/** How many tries in a row have failed (0 when the last try worked or nothing was recorded). */
export function failureCount(state: { last_error?: unknown } | null | undefined): number {
  const e = state?.last_error;
  if (typeof e !== "string" || e === "") return 0;
  const m = /^(?:reconnect:\s*)?#(\d+)\s/.exec(e);
  // An error recorded before counting existed counts as one.
  return m ? Number(m[1]) : 1;
}

/** The last_error to save after a failed try, counting on from the previous one. */
export function failureText(previous: { last_error?: unknown } | null | undefined, reconnect: boolean, message: string): string {
  const n = failureCount(previous) + 1;
  return `${reconnect ? `${RECONNECT_ERROR} ` : ""}#${n} ${message}`.slice(0, 500);
}

/** The import is failing: Jobber refused the sign-in, or several tries in a row failed. */
export function importFailing(state: { last_error?: unknown } | null | undefined): boolean {
  return needsReconnect(state) || failureCount(state) >= FAILING_AFTER;
}
