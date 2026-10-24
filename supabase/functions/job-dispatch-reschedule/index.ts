// Office tools for a ground crew call-out:
//  action "reschedule": the job's date changed. Tell everyone already hired,
//    reopen the call-out for the new date and send it out again.
//  action "nudge": nobody has stepped up in a while. Re-send an urgent call-out
//    to ground workers who haven't picked days yet (at most once per hour).
import { createClient } from "npm:@supabase/supabase-js@2";
import { eligibleRecipients, officePhones, sendPush, sendSms } from "../_shared/crewRecipients.ts";
import { closedWeekdays, isClosedDay } from "../_shared/jobActivity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const LINK = "https://app.treecheck.ai/dashboard/crew-bids";
const money = (n: unknown) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const okPhone = (p: unknown) => !!p && String(p).replace(/\D/g, "").length >= 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: u } = token ? await admin.auth.getUser(token) : { data: null };
    if (!u?.user) return json({ error: "Please sign in again." }, 401);
    const body = await req.json().catch(() => ({}));
    const dispatchId = typeof body.dispatch_id === "string" ? body.dispatch_id : null;
    if (!dispatchId) return json({ error: "dispatch_id required" }, 400);

    const { data: d } = await admin.from("job_dispatches").select("*").eq("id", dispatchId).maybeSingle();
    if (!d) return json({ error: "Call-out not found" }, 404);
    const { data: me } = await admin.from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
    if ((me?.parent_contractor_id ?? u.user.id) !== d.owner_contractor_id) return json({ error: "Not your job" }, 403);
    const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: allowed, error } = await caller.rpc('company_has_permission', { p_owner: d.owner_contractor_id, p_permission: 'manageJobsSubs' });
    if (error || !allowed) return json({ error: 'Company Jobs and Subs permission required.' }, 403);

    const { data: request } = await admin.from("bid_requests").select("id, title, city").eq("id", d.bid_request_id).maybeSingle();
    const { data: owner } = await admin.from("profiles").select("company_name, full_name").eq("id", d.owner_contractor_id).maybeSingle();
    const company = owner?.company_name || owner?.full_name || "The company";
    const job = `${request?.title ?? "a job"}${request?.city ? ` in ${request.city}` : ""}`;
    const spots = Number(d.slots) || 1;
    const pay = d.pay_per_worker ? ` Pay ${money(d.pay_per_worker)}${d.pay_rate_type === "hourly" ? " per hour" : ""}.` : "";

    // ---------- Date changed ----------
    if (body.action === "reschedule") {
      const date = typeof body.new_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.new_date) ? body.new_date : null;
      if (!date || date < today()) return json({ error: "Pick a new date, today or later." }, 400);
      if (isClosedDay(date, await closedWeekdays(admin, d.owner_contractor_id))) {
        return json({ error: "The company is closed that day of the week. Pick another date." }, 400);
      }

      const hiredIds: string[] = d.hired_crew_member_ids ?? [];
      const { data: responders } = await admin.from("job_dispatch_responses").select("crew_member_id").eq("dispatch_id", d.id);
      const affectedIds = [...new Set([...hiredIds, ...(responders ?? []).map((r: { crew_member_id: string }) => r.crew_member_id)])];

      // Reopen for the new date; everyone picks again.
      await admin.from("job_dispatch_responses").delete().eq("dispatch_id", d.id);
      await admin.from("job_dispatches").update({
        status: "open", offered_dates: [date], scheduled_date: null, awarded_date: null,
        hired_crew_member_ids: [], rescheduled_at: new Date().toISOString(), last_nudged_at: null,
        jobber_status: null, jobber_error: null, updated_at: new Date().toISOString(),
      }).eq("id", d.id);
      await admin.from("bid_requests").update({ awarded_date: date, confirmed_dates: [date] }).eq("id", d.bid_request_id);

      // Tell anyone already hired or lined up.
      const { data: affected } = affectedIds.length
        ? await admin.from("crew_members").select("id, phone, user_id").in("id", affectedIds)
        : { data: [] };
      for (const c of affected ?? []) {
        if (okPhone(c.phone)) await sendSms(String(c.phone),
          `Date change: ${company} moved ${job} to ${date}. If you can still work it, open TreeCheck and pick ${date} again to keep your spot: ${LINK}?dispatch=${d.id}`);
      }
      await sendPush((affected ?? []).map((c: { user_id: string | null }) => c.user_id ?? "").filter(Boolean),
        "Job date changed", `${job} is now ${date}. Pick the day again to keep your spot.`, { route: `/dashboard/crew-bids?dispatch=${d.id}`, dispatch_id: d.id });

      // Re-send the call-out to every other ground worker.
      const crew = (await eligibleRecipients(admin, d.owner_contractor_id, { roleNeeded: "ground" }))
        .filter((c) => !affectedIds.includes(c.id));
      if (crew.length) {
        await admin.from("job_dispatch_recipients").upsert(
          crew.map((c) => ({ dispatch_id: d.id, crew_member_id: c.id, notified_at: new Date().toISOString() })),
          { onConflict: "dispatch_id,crew_member_id", ignoreDuplicates: true });
      }
      for (const c of crew) {
        if (okPhone(c.phone)) await sendSms(String(c.phone),
          `${company} needs ${spots} ground worker${spots === 1 ? "" : "s"} for ${job} on ${date} (new date).${pay} Open TreeCheck to claim a spot: ${LINK}?dispatch=${d.id}`);
      }
      await sendPush(crew.map((c) => c.user_id ?? "").filter(Boolean), "Ground crew needed",
        `${job} — ${date}. Tap to claim.`, { route: `/dashboard/crew-bids?dispatch=${d.id}`, dispatch_id: d.id, source: "job_dispatch" });

      for (const p of await officePhones(admin, d.owner_contractor_id)) {
        await sendSms(p, `${request?.title ?? "Job"} moved to ${date}. ${affectedIds.length} crew told about the change; call-out re-sent to ${crew.length} more.`);
      }
      return json({ success: true, told: affectedIds.length, resent: crew.length });
    }

    // ---------- Urgent re-send ----------
    if (body.action === "nudge") {
      if (d.status !== "open") return json({ error: "This call-out is already full." }, 409);
      if (d.last_nudged_at && Date.now() - new Date(d.last_nudged_at).getTime() < 3600_000) {
        return json({ error: "An urgent call-out already went out in the last hour. Try again later." }, 429);
      }
      const offered: string[] = (d.offered_dates ?? []).filter((x: string) => x >= today());
      if ((d.offered_dates ?? []).length && !offered.length) return json({ error: "All the offered dates have passed. Change the date first." }, 400);

      const { data: responders } = await admin.from("job_dispatch_responses").select("crew_member_id").eq("dispatch_id", d.id);
      const answered = new Set((responders ?? []).map((r: { crew_member_id: string }) => r.crew_member_id));
      const crew = (await eligibleRecipients(admin, d.owner_contractor_id, { roleNeeded: "ground" })).filter((c) => !answered.has(c.id));
      if (!crew.length) return json({ error: "Every ground worker has already answered." }, 409);

      await admin.from("job_dispatch_recipients").upsert(
        crew.map((c) => ({ dispatch_id: d.id, crew_member_id: c.id, notified_at: new Date().toISOString() })),
        { onConflict: "dispatch_id,crew_member_id", ignoreDuplicates: true });
      const open = spots - answered.size > 0 ? spots - answered.size : spots;
      const when = offered.length ? ` Days: ${offered.join(", ")}.` : d.scheduled_date ? ` Date: ${d.scheduled_date}.` : "";
      const msg = `URGENT: ${company} is really looking for ground crew for ${job}. Still need ${open} worker${open === 1 ? "" : "s"}.${when}${pay} Open TreeCheck and grab a spot: ${LINK}?dispatch=${d.id}`;
      let sent = 0;
      for (const c of crew) if (okPhone(c.phone) && await sendSms(String(c.phone), msg)) sent++;
      await sendPush(crew.map((c) => c.user_id ?? "").filter(Boolean), "Ground crew urgently needed",
        `${job}.${when} Tap to claim.`, { route: `/dashboard/crew-bids?dispatch=${d.id}`, dispatch_id: d.id, source: "job_dispatch" });
      await admin.from("job_dispatches").update({ last_nudged_at: new Date().toISOString() }).eq("id", d.id);
      return json({ success: true, resent: crew.length, sms_sent: sent });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("job-dispatch-reschedule error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
