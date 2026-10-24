// Ground workers pick the days they can work on an awarded job.
// As soon as enough workers line up on the same day, the job fills itself:
// hired workers are told, the office is told, and a visit is booked in Jobber.
// Owners/office can also call this with { action: "schedule" } to retry Jobber.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJobberToken } from "../_shared/jobber.ts";
import { officePhones, sendPush, sendSms } from "../_shared/crewRecipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GRAPHQL = "https://api.getjobber.com/api/graphql";
const GQL_VERSION = "2024-04-01";

// deno-lint-ignore no-explicit-any
async function jobberToken(admin: any, ownerId: string): Promise<string | null> {
  // Shared, locked refresh (see _shared/jobber.ts).
  return await getJobberToken(admin, ownerId);
}

async function gql(token: string, query: string, variables: Record<string, unknown>) {
  const r = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": GQL_VERSION },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors ?? j));
  return j.data;
}

/** Book the job in Jobber on the filled date. Records the outcome on the dispatch. */
// deno-lint-ignore no-explicit-any
async function scheduleInJobber(admin: any, dispatch: any, request: any, crewNames: string[]) {
  const set = (patch: Record<string, unknown>) =>
    admin.from("job_dispatches").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", dispatch.id);
  try {
    if (dispatch.jobber_job_id) return { ok: true, job_id: dispatch.jobber_job_id };
    const token = await jobberToken(admin, dispatch.owner_contractor_id);
    if (!token) {
      await set({ jobber_status: "not_connected", jobber_error: "Jobber isn't connected." });
      return { ok: false, reason: "Jobber isn't connected" };
    }
    if (!request.jobber_quote_id) {
      await set({ jobber_status: "failed", jobber_error: "No Jobber quote on this job yet." });
      return { ok: false, reason: "No Jobber quote on this job yet" };
    }
    const q = await gql(token,
      `query Q($id: EncodedId!) { quote(id: $id) { id quoteStatus client { id } property { id } } }`,
      { id: request.jobber_quote_id });
    const qs = String(q?.quote?.quoteStatus ?? "").toLowerCase();
    if (!["approved", "converted"].includes(qs)) {
      await set({ jobber_status: "waiting_for_quote", jobber_error: null });
      return { ok: false, waiting: true, reason: "waiting on the homeowner to approve the quote" };
    }
    let propertyId: string | null = q?.quote?.property?.id ?? null;
    const clientId: string | null = q?.quote?.client?.id ?? null;
    if (!propertyId && clientId) {
      const c = await gql(token, `query C($id: EncodedId!) { client(id: $id) { properties { id } } }`, { id: clientId });
      propertyId = c?.client?.properties?.[0]?.id ?? null;
    }
    if (!propertyId) {
      await set({ jobber_status: "failed", jobber_error: "The Jobber client has no property address to book the visit at." });
      return { ok: false, reason: "The Jobber client has no property address" };
    }
    const instructions = `Crew: ${crewNames.join(", ")}. Booked from TreeCheck.`;
    const res = await gql(token,
      `mutation J($input: JobCreateAttributes!) { jobCreate(input: $input) { job { id jobNumber } userErrors { message path } } }`,
      {
        input: {
          propertyId,
          title: request.title,
          instructions,
          invoicing: { invoicingType: "FIXED_PRICE", invoicingSchedule: "ON_COMPLETION" },
          timeframe: { startAt: dispatch.awarded_date },
        },
      });
    const errs = res?.jobCreate?.userErrors ?? [];
    if (errs.length || !res?.jobCreate?.job?.id) {
      const msg = errs.map((e: { message: string }) => e.message).join("; ") || "Jobber didn't create the job.";
      await set({ jobber_status: "failed", jobber_error: msg });
      return { ok: false, reason: msg };
    }
    await set({ jobber_status: "scheduled", jobber_error: null, jobber_job_id: res.jobCreate.job.id });
    if (request.lead_id) {
      await admin.from("leads").update({ jobber_job_id: res.jobCreate.job.id }).eq("id", request.lead_id).is("jobber_job_id", null);
    }
    return { ok: true, job_id: res.jobCreate.job.id, job_number: res.jobCreate.job.jobNumber };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("jobber schedule failed", msg);
    await set({ jobber_status: "failed", jobber_error: msg.slice(0, 500) });
    return { ok: false, reason: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const bearer = authHeader.replace("Bearer ", "").trim();
    const isInternal = bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const { data: u } = isInternal ? { data: null } : await admin.auth.getUser(bearer);
    if (!isInternal && !u?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const dispatchId = typeof body.dispatch_id === "string" ? body.dispatch_id : null;
    if (!dispatchId) return json({ error: "dispatch_id required" }, 400);

    const { data: dispatch } = await admin.from("job_dispatches").select("*").eq("id", dispatchId).maybeSingle();
    if (!dispatch) return json({ error: "That job no longer exists." }, 404);
    const { data: request } = await admin.from("bid_requests")
      .select("id, title, city, lead_id, awarded_bid_id, jobber_quote_id").eq("id", dispatch.bid_request_id).maybeSingle();

    // ---- Office retry of the Jobber booking ----
    if (body.action === "schedule") {
      if (!isInternal) {
        if (!u?.user) return json({ error: 'Unauthorized' }, 401);
        const { data: me } = await admin.from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
        if ((me?.parent_contractor_id ?? u.user.id) !== dispatch.owner_contractor_id) return json({ error: "Not your job" }, 403);
        const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
        const { data: allowed, error } = await caller.rpc('company_has_permission', { p_owner: dispatch.owner_contractor_id, p_permission: 'manageJobsSubs' });
        if (error || !allowed) return json({ error: 'Company Jobs and Subs permission required.' }, 403);
      }
      if (dispatch.status !== "filled" || !dispatch.awarded_date) return json({ error: "The crew isn't complete yet." }, 409);
      const { data: hired } = await admin.from("crew_members").select("full_name").in("id", dispatch.hired_crew_member_ids ?? []);
      const hiredNames = (hired ?? []).map((h: { full_name: string | null }) => h.full_name ?? "Ground worker");
      const r = await scheduleInJobber(admin, dispatch, request, hiredNames);
      if (isInternal) {
        const msg = r.ok
          ? `Quote approved — ${request?.title ?? "the job"} is now booked in Jobber for ${dispatch.awarded_date} with ${hiredNames.join(" and ")}.`
          : `Quote approved for ${request?.title ?? "the job"} (${dispatch.awarded_date}), but Jobber didn't take the booking: ${r.reason}. Please schedule.`;
        for (const phone of await officePhones(admin, dispatch.owner_contractor_id)) await sendSms(phone, msg);
      }
      return json({ success: r.ok, ...r });
    }

    // ---- A ground worker saves their days ----
    const offered: string[] = Array.isArray(dispatch.offered_dates) ? dispatch.offered_dates : [];
    if (isInternal) return json({ error: "Internal calls only schedule." }, 400);
    if (dispatch.status !== "open") return json({ error: "This job is now full. Thanks — watch for the next one." }, 409);
    const dates: string[] = Array.isArray(body.dates)
      ? [...new Set((body.dates as unknown[]).filter((d): d is string => typeof d === "string" && offered.includes(d)))].sort()
      : [];

    const { data: memberships } = await admin.from("crew_members").select("id, status").eq("user_id", u!.user!.id);
    const activeIds = (memberships ?? []).filter((m: { status: string }) => m.status === "active").map((m: { id: string }) => m.id);
    if (!activeIds.length) return json({ error: "Your crew profile is still waiting for approval." }, 403);
    const { data: invited } = await admin.from("job_dispatch_recipients").select("crew_member_id").eq("dispatch_id", dispatchId);
    const memberId = activeIds.find((id: string) => (invited ?? []).some((r: { crew_member_id: string }) => r.crew_member_id === id));
    if (!memberId) return json({ error: "This job wasn't sent to you." }, 403);

    if (!dates.length) {
      await admin.from("job_dispatch_responses").delete().eq("dispatch_id", dispatchId).eq("crew_member_id", memberId);
      return json({ success: true, filled: false, message: "Your days were cleared." });
    }
    const { error: upErr } = await admin.from("job_dispatch_responses").upsert({
      dispatch_id: dispatchId,
      crew_member_id: memberId,
      response: "available",
      status: "pending",
      available_dates: dates,
      updated_at: new Date().toISOString(),
    }, { onConflict: "dispatch_id,crew_member_id" });
    if (upErr) return json({ error: upErr.message }, 400);

    // Is any day full now? Earliest full day wins; picks saved first get the spots.
    const { data: all } = await admin.from("job_dispatch_responses")
      .select("crew_member_id, available_dates, updated_at").eq("dispatch_id", dispatchId).eq("response", "available")
      .order("updated_at", { ascending: true });
    const slots = Number(dispatch.slots) || 1;
    let fillDate: string | null = null;
    let hiredIds: string[] = [];
    for (const d of offered.slice().sort()) {
      const who = (all ?? []).filter((r: { available_dates: string[] }) => (r.available_dates ?? []).includes(d))
        .map((r: { crew_member_id: string }) => r.crew_member_id);
      if (who.length >= slots) { fillDate = d; hiredIds = who.slice(0, slots); break; }
    }
    if (!fillDate) {
      return json({ success: true, filled: false, message: "Saved. We'll text you the moment the crew is set." });
    }

    // Only one request gets to close it.
    const { data: closed } = await admin.from("job_dispatches").update({
      status: "filled",
      awarded_date: fillDate,
      scheduled_date: fillDate,
      hired_crew_member_ids: hiredIds,
      updated_at: new Date().toISOString(),
    }).eq("id", dispatchId).eq("status", "open").select("*").maybeSingle();
    if (!closed) return json({ success: true, filled: true, message: "This job just filled." });

    await admin.from("job_dispatch_responses").update({ status: "confirmed" })
      .eq("dispatch_id", dispatchId).in("crew_member_id", hiredIds);
    await admin.from("job_dispatch_responses").update({ status: "not_needed" })
      .eq("dispatch_id", dispatchId).not("crew_member_id", "in", `(${hiredIds.join(",")})`);

    // Address now that it's real.
    let address: string | null = null;
    if (request?.lead_id) {
      const { data: lead } = await admin.from("leads").select("customer_address, city").eq("id", request.lead_id).maybeSingle();
      address = lead?.customer_address ?? lead?.city ?? null;
      if (address) await admin.from("job_dispatches").update({ address }).eq("id", dispatchId);
    }

    const [{ data: responders }, { data: owner }, { data: climberBid }] = await Promise.all([
      admin.from("crew_members").select("id, full_name, phone, user_id")
        .in("id", (all ?? []).map((r: { crew_member_id: string }) => r.crew_member_id)),
      admin.from("profiles").select("company_name, full_name").eq("id", dispatch.owner_contractor_id).maybeSingle(),
      request?.awarded_bid_id
        ? admin.from("bids").select("crew_member_id").eq("id", request.awarded_bid_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    let climberName = "your climber";
    if (climberBid?.crew_member_id) {
      const { data: c } = await admin.from("crew_members").select("full_name").eq("id", climberBid.crew_member_id).maybeSingle();
      if (c?.full_name) climberName = c.full_name;
    }
    const company = owner?.company_name || owner?.full_name || "The company";
    const job = `${request?.title ?? "the job"}${request?.city ? ` (${request.city})` : ""}`;
    // deno-lint-ignore no-explicit-any
    const people = (responders ?? []) as any[];
    const hired = people.filter((p) => hiredIds.includes(p.id));
    const others = people.filter((p) => !hiredIds.includes(p.id));

    for (const p of hired) {
      if (p.phone) await sendSms(String(p.phone), `You're hired! ${company}: ${job} on ${fillDate}. The office will follow up with the address and start time.`);
    }
    await sendPush(hired.map((p) => p.user_id).filter(Boolean), "You're hired", `${job} on ${fillDate}`, { route: "/dashboard/crew-bids", dispatch_id: dispatchId });
    for (const p of others) {
      if (p.phone) await sendSms(String(p.phone), `Thanks for offering your days on ${job}. This job is now full — watch for the next one.`);
    }

    const names = hired.map((p) => p.full_name ?? "Ground worker");
    const jobber = await scheduleInJobber(admin, closed, request, [climberName, ...names]);
    const officeMsg = `Crew complete for ${job} on ${fillDate}: climber ${climberName}, ground ${names.join(" and ")}. ` +
      (jobber.ok ? "Scheduled in Jobber."
        : (jobber as { waiting?: boolean }).waiting
          ? "It will book in Jobber automatically as soon as the homeowner approves the quote."
          : `Please schedule in Jobber (${jobber.reason}).`);
    for (const phone of await officePhones(admin, dispatch.owner_contractor_id)) await sendSms(phone, officeMsg);
    const { data: team } = await admin.from("profiles").select("id").eq("parent_contractor_id", dispatch.owner_contractor_id);
    await sendPush([dispatch.owner_contractor_id, ...(team ?? []).map((t: { id: string }) => t.id)],
      "Crew complete", officeMsg, { route: "/dashboard/bid-board", dispatch_id: dispatchId });

    return json({ success: true, filled: true, date: fillDate, hired: hiredIds.includes(memberId), jobber });
  } catch (e) {
    console.error("job-dispatch-availability error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
