// Releases jobs held for the subs with right of first refusal.
// Runs on a schedule (pg_cron) and can be called by the owner to release now
// or to decline a first-refusal offer and open the job to everyone.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  eligibleRecipients,
  notifyBidRequest,
  notifyDispatch,
  splitByRate, withWorkerRates,
} from "../_shared/crewRecipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const forceRequestId = typeof body.bid_request_id === "string" ? body.bid_request_id : null;
    const forceDispatchId = typeof body.dispatch_id === "string" ? body.dispatch_id : null;
    const force = !!(forceRequestId || forceDispatchId);

    // An owner asking to release now must own the job.
    let ownerGuard: string | null = null;
    if (force) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const token = authHeader.replace("Bearer ", "").trim();
      if (token !== SERVICE) {
        const { data: u } = await admin.auth.getUser(token);
        if (!u?.user) return json({ error: "Unauthorized" }, 401);
        const { data: me } = await admin
          .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
        ownerGuard = me?.parent_contractor_id ?? u.user.id;
      }
    }

    const now = new Date().toISOString();

    let releasedRequests = 0;
    let lateStump = 0;
    let releasedDispatches = 0;
    let releaseError: string | null = null;
    // The release loops have their own try: a crash in them must not stop the scheduled jobs chained below
    // (2026-10-20: one bad line here stopped the calendar sync, the auto-picks and the learning for a day).
    try {
      // ---- Jobs open for bids ----
      let rq = admin.from("bid_requests")
        .select("*")
        .eq("status", "open")
        .not("first_refusal_until", "is", null)
        .is("first_refusal_released_at", null);
      rq = forceRequestId ? rq.eq("id", forceRequestId) : rq.lte("first_refusal_until", now);
      const { data: requests } = await rq;

      for (const r of requests ?? []) {
        if (ownerGuard && r.owner_contractor_id !== ownerGuard) continue;

        const all = await eligibleRecipients(admin, r.owner_contractor_id, {
          roleNeeded: (r.role_needed as string) ?? "climber",
          needsStump: r.needs_stump_grinding === true,
          needsCrane: Array.isArray(r.equipment_needed) && r.equipment_needed.includes("crane"),
          stumpDiameter: r.stump_diameter_inches ?? null,
          includeNetwork: r.audience !== "own",
          inquiry: true,
        });
        const { data: already } = await admin
          .from("bid_request_recipients").select("crew_member_id").eq("bid_request_id", r.id);
        const notifiedIds = new Set((already ?? []).map((x: { crew_member_id: string }) => x.crew_member_id));

        if (!force) {
          // A flagged sub responded in time — it waits on the owner, nothing goes out.
          const { data: bids } = await admin
            .from("bids").select("crew_member_id").eq("bid_request_id", r.id);
          const bidders = new Set((bids ?? []).map((b: { crew_member_id: string }) => b.crew_member_id));
          const flaggedResponded = r.audience !== "own_then_network" &&
            all.some((c) => c.first_refusal === true && bidders.has(c.id));
          if (flaggedResponded) continue;
        }

        // Slot counting and the rate split belong to the dispatch loop below. Bid requests have
        // no slots, so every eligible crew member not yet texted hears now.
        const rest = all.filter((c) => !notifiedIds.has(c.id));
        const { data: ownerProfile } = await admin
          .from("profiles").select("company_name, full_name").eq("id", r.owner_contractor_id).maybeSingle();
        const company = ownerProfile?.company_name || ownerProfile?.full_name || "The company";
        if (rest.length) await notifyBidRequest(admin, r, company, rest);
        await admin.from("bid_requests")
          .update({ first_refusal_released_at: now, updated_at: now }).eq("id", r.id);
        releasedRequests++;
      }

      // ---- Stump grinding added after the job opened ----
      // If the office ticks "needs stump grinding" later, grinders who weren't
      // texted yet get the job now. Skips jobs still on a first-pick hold.
      if (!force) {
        const { data: stumpJobs } = await admin.from("bid_requests")
          .select("*")
          .eq("status", "open")
          .eq("needs_stump_grinding", true)
          .is("awarded_stump_bid_id", null);
        for (const r of stumpJobs ?? []) {
          const held = r.first_refusal_until && !r.first_refusal_released_at && r.first_refusal_until > now;
          if (held) continue;
          const grinders = (await eligibleRecipients(admin, r.owner_contractor_id, {
            roleNeeded: (r.role_needed as string) ?? "climber",
            needsStump: true,
            stumpDiameter: r.stump_diameter_inches ?? null,
          })).filter((c) => c.trade === "stump");
          if (!grinders.length) continue;
          const { data: already } = await admin
            .from("bid_request_recipients").select("crew_member_id").eq("bid_request_id", r.id);
          const notifiedIds = new Set((already ?? []).map((x: { crew_member_id: string }) => x.crew_member_id));
          const missing = grinders.filter((c) => !notifiedIds.has(c.id));
          if (!missing.length) continue;
          const { data: ownerProfile } = await admin
            .from("profiles").select("company_name, full_name").eq("id", r.owner_contractor_id).maybeSingle();
          const company = ownerProfile?.company_name || ownerProfile?.full_name || "The company";
          await notifyBidRequest(admin, r, company, missing);
          lateStump += missing.length;
        }
      }

      // ---- Ground-crew call-outs ----
      let dq = admin.from("job_dispatches")
        .select("*")
        .eq("status", "open")
        .not("first_refusal_until", "is", null)
        .is("released_at", null);
      dq = forceDispatchId ? dq.eq("id", forceDispatchId) : dq.lte("first_refusal_until", now);
      const { data: dispatches } = await dq;

      for (const d of dispatches ?? []) {
        if (ownerGuard && d.owner_contractor_id !== ownerGuard) continue;

        const { count: claimedCount } = await admin
          .from("job_dispatch_responses").select("id", { count: "exact", head: true })
          .eq("dispatch_id", d.id).eq("response", "claimed");
        const claimed = claimedCount ?? 0;

        const all = await withWorkerRates(admin, await eligibleRecipients(admin, d.owner_contractor_id, {
          roleNeeded: "ground",
          needsStump: false,
          stumpDiameter: null,
        }));
        const { data: already } = await admin
          .from("job_dispatch_recipients").select("crew_member_id").eq("dispatch_id", d.id);
        const notifiedIds = new Set((already ?? []).map((x: { crew_member_id: string }) => x.crew_member_id));
        let rest = all.filter((c) => !notifiedIds.has(c.id));
        // Every spot is taken: higher-rate workers (and anyone else) are never texted.
        if (claimed >= Number(d.slots || 1)) rest = [];
        else if (!force && claimed > 0) {
          // A first-pick sub claimed — standard crew wait on the owner; higher-rate workers
          // still hear only once the standard crew have had their turn.
          const { standard, premium } = splitByRate(rest);
          if (standard.length) continue;
          rest = premium;
        }

        const [{ data: request }, { data: ownerProfile }] = await Promise.all([
          admin.from("bid_requests").select("title, city").eq("id", d.bid_request_id).maybeSingle(),
          admin.from("profiles").select("company_name, full_name").eq("id", d.owner_contractor_id).maybeSingle(),
        ]);
        const company = ownerProfile?.company_name || ownerProfile?.full_name || "The company";
        const split = splitByRate(rest);
        if (split.standard.length && split.premium.length) {
          // Standard crew now; higher-rate workers get a second wait before they hear.
          await notifyDispatch(admin, d, request, company, split.standard, true);
          const { data: op } = await admin.from("profiles").select("first_refusal_minutes").eq("id", d.owner_contractor_id).maybeSingle();
          const mins = Number(op?.first_refusal_minutes) > 0 ? Number(op?.first_refusal_minutes) : 60;
          await admin.from("job_dispatches").update({
            first_refusal_until: new Date(Date.now() + mins * 60_000).toISOString(), updated_at: now,
          }).eq("id", d.id);
          releasedDispatches++;
          continue;
        }
        if (rest.length) await notifyDispatch(admin, d, request, company, rest, false);
        await admin.from("job_dispatches").update({ released_at: now, updated_at: now }).eq("id", d.id);
        releasedDispatches++;
      }
    } catch (e) {
      if (force) throw e;
      console.error("crew-release-holds: releasing held jobs failed", e);
      releaseError = e instanceof Error ? e.message : String(e);
    }

    // Climbers who haven't confirmed days after 24h get one reminder.
    let dateReminders: unknown = null;
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/bid-climber-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ action: "remind" }),
      });
      dateReminders = await r.json().catch(() => null);
    } catch (e) { console.warn("date reminders failed", e); }

    // Jobber's visit days for the Jobs calendar (JS2), on scheduled runs only. jobber-visit-days replies at once and
    // syncs after replying; its claim lets each company through at most every 10 minutes.
    let visitDays: unknown = null;
    if (!force) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/jobber-visit-days`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: "{}",
        });
        visitDays = await r.json().catch(() => null);
      } catch (e) { console.warn("visit days failed", e); }
    }
    // Owners set up for auto-picks get the Recommended quote picked 3 hours after the first climber bid.
    let autoPick: unknown = null;
    if (!force) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/quote-auto-pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: "{}",
        });
        autoPick = await r.json().catch(() => null);
      } catch (e) { console.warn("auto pick failed", e); }
    }
    // Scout learning (the weekly feedback loop), on scheduled runs only. scout-learning-run replies at once and decides
    // for itself whether a preview, a company's first run or a weekly run is due (Monday 07:00 Chicago, with catch-up).
    let scoutLearning: unknown = null;
    if (!force) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/scout-learning-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: "{}",
        });
        scoutLearning = await r.json().catch(() => null);
      } catch (e) { console.warn("scout learning failed", e); }
    }
    return json({ success: releaseError === null, release_error: releaseError, date_reminders: dateReminders, visit_days: visitDays, auto_pick: autoPick, scout_learning: scoutLearning, released_requests: releasedRequests, released_dispatches: releasedDispatches, late_stump_notified: lateStump });
  } catch (e) {
    console.error("crew-release-holds error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
