// The awarded climber (or the office for them) confirms fresh work days.
// Only today-or-later dates are kept; then the ground crew call-out opens.
// Internal calls with { action: "remind" } send one 24h reminder per request.
import { createClient } from "npm:@supabase/supabase-js@2";
import { officePhones, sendPush, sendSms } from "../_shared/crewRecipients.ts";
import { closedWeekdays, isClosedDay, logJobActivity } from "../_shared/jobActivity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const APP = "https://app.treecheck.ai/dashboard/crew-bids";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);
    const isInternal = token === SERVICE;
    const body = await req.json().catch(() => ({}));

    // ---- Reminder sweep ----
    if (body.action === "remind") {
      if (!isInternal) return json({ error: "Forbidden" }, 403);
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: rows } = await admin.from("bid_requests")
        .select("id, title, city, owner_contractor_id, awarded_bid_id")
        .eq("climber_dates_status", "requested").is("climber_dates_reminded_at", null)
        .lt("climber_dates_requested_at", cutoff).limit(50);
      for (const r of rows ?? []) {
        await admin.from("bid_requests").update({ climber_dates_reminded_at: new Date().toISOString() }).eq("id", r.id);
        const { data: bid } = await admin.from("bids").select("crew_member_id").eq("id", r.awarded_bid_id).maybeSingle();
        const { data: c } = bid
          ? await admin.from("crew_members").select("full_name, phone, user_id").eq("id", bid.crew_member_id).maybeSingle()
          : { data: null };
        const job = `${r.title}${r.city ? ` (${r.city})` : ""}`;
        if (c?.phone) await sendSms(String(c.phone), `Reminder: please confirm the days you can do ${job}. ${APP}?job=${r.id}`);
        if (c?.user_id) await sendPush([c.user_id], "Confirm your days", job, { route: `/dashboard/crew-bids?job=${r.id}` });
        for (const p of await officePhones(admin, r.owner_contractor_id)) {
          await sendSms(p, `Heads-up: ${c?.full_name ?? "The climber"} hasn't confirmed days for ${job} yet. You can confirm for them on the job.`);
        }
      }
      return json({ success: true, reminded: (rows ?? []).length });
    }

    if (isInternal) return json({ error: "Not supported" }, 400);
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const requestId = typeof body.bid_request_id === "string" ? body.bid_request_id : null;
    if (!requestId) return json({ error: "bid_request_id required" }, 400);
    const { data: request } = await admin.from("bid_requests")
      .select("id, title, city, owner_contractor_id, awarded_bid_id, climber_dates_status").eq("id", requestId).maybeSingle();
    if (!request?.awarded_bid_id) return json({ error: "No climber has been awarded on this job yet." }, 409);
    const { data: bid } = await admin.from("bids").select("crew_member_id").eq("id", request.awarded_bid_id).maybeSingle();
    const { data: climber } = await admin.from("crew_members")
      .select("id, full_name, user_id").eq("id", bid?.crew_member_id ?? "").maybeSingle();

    const { data: me } = await admin.from("profiles").select("parent_contractor_id, full_name").eq("id", u.user.id).maybeSingle();
    const isOffice = (me?.parent_contractor_id ?? u.user.id) === request.owner_contractor_id;
    const isClimber = !!climber && climber.user_id === u.user.id;
    if (!isOffice && !isClimber) return json({ error: "This job isn't yours to schedule." }, 403);

    // ---- Office asks the climber to pick a whole new set of dates ----
    if (body.action === "rerequest") {
      if (!isOffice) return json({ error: "Only the office can ask for new dates." }, 403);
      const job = `${request.title}${request.city ? ` (${request.city})` : ""}`;
      const { data: disp } = await admin.from("job_dispatches").select("id, hired_crew_member_ids")
        .eq("bid_request_id", requestId).eq("role", "ground").maybeSingle();
      let told = 0;
      if (disp) {
        const { data: resp } = await admin.from("job_dispatch_responses").select("crew_member_id").eq("dispatch_id", disp.id);
        const ids = [...new Set([...(disp.hired_crew_member_ids ?? []), ...(resp ?? []).map((r: { crew_member_id: string }) => r.crew_member_id)])];
        const { data: crew } = ids.length
          ? await admin.from("crew_members").select("phone, user_id").in("id", ids) : { data: [] };
        for (const c of crew ?? []) {
          if (c.phone) { await sendSms(String(c.phone), `Date change: ${job} is being rescheduled. You'll get a new call-out with the new days soon.`); told++; }
        }
        await sendPush((crew ?? []).map((c: { user_id: string | null }) => c.user_id ?? "").filter(Boolean),
          "Job being rescheduled", `${job} — new days coming soon.`, { route: "/dashboard/crew-bids" });
        // Clear the old call-out so confirming new dates sends a fresh one.
        await admin.from("job_dispatch_responses").delete().eq("dispatch_id", disp.id);
        await admin.from("job_dispatch_recipients").delete().eq("dispatch_id", disp.id);
        await admin.from("job_dispatches").delete().eq("id", disp.id);
      }
      await admin.from("bid_requests").update({
        climber_dates_status: "requested", climber_dates_requested_at: new Date().toISOString(),
        climber_dates_reminded_at: null, confirmed_dates: null, awarded_date: null,
      }).eq("id", requestId);
      const { data: cm } = await admin.from("crew_members").select("phone").eq("id", climber?.id ?? "").maybeSingle();
      if (cm?.phone) await sendSms(String(cm.phone), `${job} needs new dates. Please open TreeCheck and pick the days you can do it: ${APP}?job=${requestId}`);
      if (climber?.user_id) await sendPush([climber.user_id], "Pick new dates", job, { route: `/dashboard/crew-bids?job=${requestId}` });
      return json({ success: true, told });
    }


    const t = today();
    const dates: string[] = Array.isArray(body.dates)
      ? [...new Set((body.dates as unknown[]).filter((d): d is string =>
          typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= t))].sort()
      : [];
    if (!dates.length) return json({ error: "Pick at least one day, today or later." }, 400);
    const closed = await closedWeekdays(admin, request.owner_contractor_id);
    const closedPicked = dates.filter((d) => isClosedDay(d, closed));
    if (closedPicked.length) return json({ error: `The company is closed on ${closedPicked.join(", ")}. Pick other days.` }, 400);
    const wasConfirmed = request.climber_dates_status === "confirmed";

    const { data: existing } = await admin.from("job_dispatches").select("id, status, awarded_date")
      .eq("bid_request_id", requestId).eq("role", "ground").maybeSingle();
    // Ground crew already hired for a day: that day can't be dropped here (office uses "Change date").
    const hiredDay = existing?.status === "filled" ? existing.awarded_date as string | null : null;
    if (hiredDay && hiredDay >= t && !dates.includes(hiredDay)) {
      return json({ error: `Ground crew is already hired for ${hiredDay}. Ask the office to move that day.` }, 409);
    }
    await admin.from("bid_requests").update({
      confirmed_dates: dates, climber_dates_status: "confirmed",
      awarded_date: hiredDay ?? (dates.length === 1 ? dates[0] : null),
    }).eq("id", requestId);

    let dispatch: unknown = null;
    if (existing) {
      await admin.from("job_dispatches").update({ offered_dates: dates }).eq("id", existing.id).eq("status", "open");
      dispatch = { already_open: true, dispatch_id: existing.id };
    } else {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/job-dispatch-open`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ bid_request_id: requestId, offered_dates: dates }),
      });
      dispatch = await r.json().catch(() => null);
    }

    const job = `${request.title}${request.city ? ` (${request.city})` : ""}`;
    const who = climber?.full_name ?? "The climber";
    const by = isClimber ? "" : ` (entered by ${me?.full_name ?? "the office"})`;
    const skipped = (dispatch as { skipped?: string } | null)?.skipped;
    const msg = `${who} confirmed ${dates.join(", ")} for ${job}${by}. ` +
      (hiredDay ? `Ground crew already hired for ${hiredDay}.` : skipped ? "No ground crew needed on this one." : (dispatch as { already_open?: boolean } | null)?.already_open ? "Call-out days updated." : "Ground crew call-out sent.");
    for (const p of await officePhones(admin, request.owner_contractor_id)) await sendSms(p, msg);
    await logJobActivity(admin, requestId, wasConfirmed ? "dates_changed" : "dates_confirmed",
      `${who.split(" ")[0]} ${wasConfirmed ? "changed" : "confirmed"} days${by}`, u.user.id);

    return json({ success: true, dates, dispatch });
  } catch (e) {
    console.error("bid-climber-dates error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
