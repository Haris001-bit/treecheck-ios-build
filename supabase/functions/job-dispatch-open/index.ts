// Opens the ground-worker call-out on a job the homeowner just accepted.
// First come, first served: as many spots as the awarded climber asked for.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  eligibleRecipients,
  notifyDispatch,
  officePhones,
  sendSms,
  splitFirstRefusal, splitByRate, withWorkerRates,
} from "../_shared/crewRecipients.ts";
import { closedWeekdays, isClosedDay } from "../_shared/jobActivity.ts";
import { claimFreeUse, companyPlan, companyTrialUsed, freeLimitMessage } from "../_shared/freePlan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const token = authHeader.replace("Bearer ", "").trim();
    const isInternal = token === SERVICE;

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.bid_request_id === "string" ? body.bid_request_id : null;
    if (!requestId) return json({ error: "bid_request_id required" }, 400);

    const { data: request } = await admin
      .from("bid_requests")
      .select("id, owner_contractor_id, title, city, lead_id, awarded_bid_id, awarded_date, ground_pay_per_worker")
      .eq("id", requestId).maybeSingle();
    if (!request) return json({ error: "Job not found" }, 404);

    if (!isInternal) {
      const { data: u } = await admin.auth.getUser(token);
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: me } = await admin
        .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
      const ownerId = me?.parent_contractor_id ?? u.user.id;
      if (ownerId !== request.owner_contractor_id) return json({ error: "Not your job" }, 403);
      const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const { data: allowed, error } = await caller.rpc('company_has_permission', { p_owner: ownerId, p_permission: 'manageJobsSubs' });
      if (error || !allowed) return json({ error: 'Company Jobs and Subs permission required.' }, 403);
    }

    const { data: existing } = await admin
      .from("job_dispatches").select("id").eq("bid_request_id", requestId).eq("role", "ground").maybeSingle();
    if (existing) return json({ success: true, already_open: true, dispatch_id: existing.id });

    // Free plan: a ground call-out on a job already sent to subs uses the same monthly slot (never a second one).
    if ((await companyPlan(admin, request.owner_contractor_id)) === "free") {
      const claim = await claimFreeUse(admin, request.owner_contractor_id, "job", requestId);
      if (!claim.ok) {
        const trialUsed = await companyTrialUsed(admin, request.owner_contractor_id);
        return json({ error: freeLimitMessage("job", claim.limit, trialUsed), code: "free_job_limit", used: claim.used, limit: claim.limit, trial_used: trialUsed }, 403);
      }
    }

    // Spots = the ground crew the winning climber asked for.
    let slots = Number(body.slots) > 0 ? Math.round(Number(body.slots)) : 0;
    if (!slots && request.awarded_bid_id) {
      const { data: awarded } = await admin
        .from("bids").select("ground_crew_size").eq("id", request.awarded_bid_id).maybeSingle();
      slots = Number(awarded?.ground_crew_size) > 0 ? Math.round(Number(awarded.ground_crew_size)) : 0;
    }
    if (!slots) return json({ success: true, skipped: "no_ground_crew_needed" });

    const [{ data: ownerProfile }, { data: defaults }] = await Promise.all([
      admin.from("profiles").select("company_name, full_name, first_refusal_minutes")
        .eq("id", request.owner_contractor_id).maybeSingle(),
      admin.from("pricing_defaults").select("ground_pay_per_worker")
        .eq("contractor_id", request.owner_contractor_id).maybeSingle(),
    ]);
    const company = ownerProfile?.company_name || ownerProfile?.full_name || "The company";
    const holdMinutes = Number(ownerProfile?.first_refusal_minutes) > 0
      ? Number(ownerProfile.first_refusal_minutes) : 60;
    const pay = Number(request.ground_pay_per_worker) > 0
      ? Number(request.ground_pay_per_worker)
      : Number(defaults?.ground_pay_per_worker) > 0 ? Number(defaults.ground_pay_per_worker) : null;

    const closed = await closedWeekdays(admin, request.owner_contractor_id);
    const offeredDates: string[] = Array.isArray(body.offered_dates)
      ? [...new Set((body.offered_dates as unknown[]).filter((d): d is string =>
          typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
          .filter((d) => d >= new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }))
          .filter((d) => !isClosedDay(d, closed))
      : [];
    // Never send a call-out with only passed dates.
    if (Array.isArray(body.offered_dates) && body.offered_dates.length && !offeredDates.length) {
      return json({ error: "All of those dates have passed. Ask the climber for new days." }, 400);
    }

    // The address only goes out once the job is really happening.
    let address: string | null = null;
    if (request.lead_id && !offeredDates.length) {
      const { data: lead } = await admin
        .from("leads").select("customer_address, city").eq("id", request.lead_id).maybeSingle();
      address = lead?.customer_address ?? lead?.city ?? null;
    }

    const crew = await withWorkerRates(admin, await eligibleRecipients(admin, request.owner_contractor_id, {
      roleNeeded: "ground",
      needsStump: false,
      stumpDiameter: null,
    }));
    // Standard-rate crew first; higher-rate workers only if spots are still open after the wait.
    const { standard, premium } = splitByRate(crew);
    const pool = standard.length ? standard : premium;
    const { first: fav, rest: others } = splitFirstRefusal(pool);
    const favHold = fav.length > 0 && others.length > 0;
    const first = favHold ? fav : pool;
    const hold = favHold || (standard.length > 0 && premium.length > 0);

    const { data: dispatch, error: dErr } = await admin.from("job_dispatches").insert({
      bid_request_id: requestId,
      owner_contractor_id: request.owner_contractor_id,
      role: "ground",
      slots,
      pay_per_worker: pay,
      pay_rate_type: typeof body.pay_rate_type === "string" && body.pay_rate_type === "hourly" ? "hourly" : "day",
      scheduled_date: offeredDates.length ? null : (request.awarded_date ?? null),
      offered_dates: offeredDates,
      address,
      status: "open",
      first_refusal_until: hold ? new Date(Date.now() + holdMinutes * 60_000).toISOString() : null,
      released_at: hold ? null : new Date().toISOString(),
    }).select("*").single();
    if (dErr) return json({ error: dErr.message }, 400);

    const smsSent = await notifyDispatch(admin, dispatch, request, company, hold ? first : crew, hold);

    for (const phone of await officePhones(admin, request.owner_contractor_id)) {
      await sendSms(
        phone,
        `Ground crew call-out sent for "${request.title}"${request.city ? ` (${request.city})` : ""}: ${slots} spot${slots === 1 ? "" : "s"}${request.awarded_date ? ` on ${request.awarded_date}` : ""}. You'll get a text as each one is claimed.`,
      );
    }

    return json({ success: true, dispatch_id: dispatch.id, slots, notified: (hold ? first : crew).length, sms_sent: smsSent, held_for_first_refusal: hold });
  } catch (e) {
    console.error("job-dispatch-open error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
