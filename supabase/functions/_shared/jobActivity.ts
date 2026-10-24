// Shared helpers: per-job activity flags for the office, and company closed weekdays.
// deno-lint-ignore-file no-explicit-any

/** Record something that happened on a job so the office sees a flag on its card. Never throws. */
export async function logJobActivity(admin: any, bidRequestId: string, kind: string, summary: string, actorUserId?: string | null) {
  try {
    await admin.from("job_activity").insert({ bid_request_id: bidRequestId, kind, summary: summary.slice(0, 200), actor_user_id: actorUserId ?? null });
  } catch (e) { console.error("logJobActivity failed", e); }
}

/** Weekdays (0=Sun..6=Sat) the company is closed. */
export async function closedWeekdays(admin: any, ownerId: string): Promise<number[]> {
  const { data } = await admin.from("company_settings").select("closed_weekdays").eq("contractor_id", ownerId).maybeSingle();
  return Array.isArray(data?.closed_weekdays) ? data.closed_weekdays.map(Number) : [];
}

/** Weekday of a YYYY-MM-DD date (timezone-independent). */
export const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export const isClosedDay = (d: string, closed: number[]) => closed.includes(weekdayOf(d));
