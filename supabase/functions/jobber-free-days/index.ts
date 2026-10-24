// The days a job's climber should see as unavailable: booked in Jobber, or a day the company is closed.
// The bid form's day pickers and the confirm-days screen grey these out before the climber taps them.
// Only dates and "busy" or "closed" leave this function, never visit details. The Jobber job made from
// this job's own quote doesn't count, so its visit never blocks its own day.
// Behind the company's free_days switch (company_jobber_settings): off, it returns { source: "off" } and
// the screens behave as before. Callers: the company's office, a crew member the job was sent to, or the
// awarded climber. Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { jobberSwitches } from "../_shared/jobberSwitches.ts";
import { calendarDays } from "../_shared/jobberCalendar.ts";
import { closedWeekdays } from "../_shared/jobActivity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

interface JobRow {
  id: string;
  owner_contractor_id: string;
  awarded_bid_id: string | null;
  jobber_quote_id: string | null;
}

/** The office, a crew member the job was sent to, or the awarded climber (the same people bid-submit allows). */
async function canSee(admin: Admin, userId: string, job: JobRow): Promise<boolean> {
  const { data: me } = await admin.from("profiles").select("parent_contractor_id").eq("id", userId).maybeSingle();
  if ((me?.parent_contractor_id ?? userId) === job.owner_contractor_id) return true;

  const { data: mine } = await admin.from("crew_members").select("id").eq("user_id", userId);
  const myIds = (mine ?? []).map((m: { id: string }) => m.id);
  if (!myIds.length) return false;

  const { data: recipients } = await admin
    .from("bid_request_recipients").select("crew_member_id").eq("bid_request_id", job.id);
  const invited = (recipients ?? []).map((r: { crew_member_id: string }) => r.crew_member_id);
  // As in bid-submit: a job with no recipients recorded is open to any crew member.
  if (invited.length === 0 || invited.some((id: string) => myIds.includes(id))) return true;

  if (job.awarded_bid_id) {
    const { data: bid } = await admin.from("bids").select("crew_member_id").eq("id", job.awarded_bid_id).maybeSingle();
    if (bid?.crew_member_id && myIds.includes(bid.crew_member_id)) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.bid_request_id === "string" ? body.bid_request_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "bid_request_id required" }, 400);

    const { data: job } = await admin
      .from("bid_requests").select("id, owner_contractor_id, awarded_bid_id, jobber_quote_id").eq("id", requestId).maybeSingle();
    if (!job || !(await canSee(admin, u.user.id, job))) return json({ error: "Not found" }, 404);

    const switches = await jobberSwitches(admin, job.owner_contractor_id);
    if (!switches.freeDays) return json({ source: "off", blocked: [] });

    const closed = await closedWeekdays(admin, job.owner_contractor_id);
    const cal = await calendarDays(admin, job.owner_contractor_id, {
      tz: switches.timezone,
      closedWeekdays: closed,
      busyThreshold: switches.busyVisitsPerDay,
      days: 62,
      budgetMs: 6000,
      excludeQuoteId: job.jobber_quote_id ?? null,
    });
    return json({
      source: cal.source,
      today: cal.today,
      blocked: cal.statuses.filter((s) => s.status === "busy" || s.status === "closed"),
    });
  } catch (e) {
    console.error("jobber-free-days error", e instanceof Error ? e.message : e);
    return json({ error: "Couldn't read the calendar" }, 500);
  }
});
