// Creates a crew bid request from a Scout capture (or from scratch), pulls the
// owner's next open dates from Jobber when available, and alerts the crew.
import { createClient } from "npm:@supabase/supabase-js@2";
import { jobberSwitches } from "../_shared/jobberSwitches.ts";
import { companyMode } from "../_shared/tcNotify.ts";
import { calendarDays } from "../_shared/jobberCalendar.ts";
import { pickOfferedDates } from "../_shared/freeDays.ts";
import { closedWeekdays } from "../_shared/jobActivity.ts";
import {
  eligibleRecipients,
  linkNetworkSubs,
  notifyBidRequest,
  splitFirstRefusal,
} from "../_shared/crewRecipients.ts";
import { companyHasScout } from "../_shared/callerGuard.ts";
import { claimFreeUse, companyPlan, companyTrialUsed, freeLimitMessage } from "../_shared/freePlan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function nextBusinessDays(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  while (out.length < count) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The days offered to climbers. With the company's free_days switch on: the next free weekdays, leaving
 * out days already booked in Jobber and days the company is closed. Otherwise, or if anything fails: the
 * next weekdays, as before.
 */
async function offeredDatesFor(
  admin: any,
  ownerId: string,
  isInternal: boolean,
  want = 4,
): Promise<{ dates: string[]; source: string }> {
  const fallback = { dates: nextBusinessDays(want), source: "weekdays" };
  try {
    const switches = await jobberSwitches(admin, ownerId);
    if (!switches.freeDays) return fallback;
    const closed = await closedWeekdays(admin, ownerId);
    const cal = await calendarDays(admin, ownerId, {
      tz: switches.timezone,
      closedWeekdays: closed,
      busyThreshold: switches.busyVisitsPerDay,
      startOffset: 1,
      days: 28,
      budgetMs: isInternal ? 3000 : 6000,
    });
    const dates = pickOfferedDates(cal.statuses, want);
    console.log(`offered dates: calendar source=${cal.source}`);
    return dates.length ? { dates, source: cal.source === "jobber" ? "jobber" : "weekdays" } : fallback;
  } catch (e) {
    console.warn("offeredDatesFor failed", e instanceof Error ? e.message : e);
    return fallback;
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SERVICE_KEY,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));

    // Internal call (service role) — e.g. a website lead auto-opening for bids.
    const isInternal = authHeader.replace("Bearer ", "").trim() === SERVICE_KEY;
    let ownerId: string;
    let createdBy: string | null = null;

    if (isInternal) {
      if (typeof body.owner_contractor_id !== "string" || !body.owner_contractor_id) {
        return json({ error: "owner_contractor_id required for internal calls" }, 400);
      }
      ownerId = body.owner_contractor_id;
    } else {
      const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: me } = await admin
        .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
      ownerId = me?.parent_contractor_id ?? u.user.id;
      createdBy = u.user.id;
    }

    const { data: ownerProfile } = await admin
      .from("profiles").select("company_name, full_name, account_type").eq("id", ownerId).maybeSingle();
    // Anyone can get a login from the public signups; only a tree company with Scout opens jobs for bids (as in
    // the app's Bid Board gate). Internal calls (service key) are already trusted.
    if (!isInternal && ownerProfile?.account_type === "subcontractor") {
      return json({ error: "Only a tree company can open jobs for bids." }, 403);
    }
    const { data: billingVersion } = await admin.from('company_billing').select('pricing_version').eq('owner_id', ownerId).maybeSingle();
    if (!isInternal && billingVersion?.pricing_version === '2026-10') {
      const callerClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
      const { data: permission, error: permissionError } = await callerClient.rpc('company_has_permission', { p_owner: ownerId, p_permission: 'manageJobsSubs' });
      if (permissionError || !permission) return json({ error: 'Company Jobs and Subs permission is required.' }, 403);
    }
    // Free plan (Oklahoma owners): Jobs and Subs stay open, with a monthly limit on jobs sent to subs.
    const plan = await companyPlan(admin, ownerId);
    if (!isInternal && billingVersion?.pricing_version !== '2026-10' && plan !== 'free'
      && (!createdBy || !(await companyHasScout(admin, ownerId, createdBy)))) {
      return json({ error: "The Bid Board is part of Scout. Start or renew Scout to open jobs for bids." }, 403);
    }
    const company = ownerProfile?.company_name || ownerProfile?.full_name || "A tree company";
    const { data: ownerSettings } = await admin
      .from("profiles").select("first_refusal_minutes").eq("id", ownerId).maybeSingle();
    const holdMinutes = Number(ownerSettings?.first_refusal_minutes) > 0
      ? Number(ownerSettings?.first_refusal_minutes)
      : 60;
    const captureId = typeof body.capture_id === "string" ? body.capture_id : null;
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Tree job";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const city = typeof body.city === "string" ? body.city.trim() : null;
    let photoPath = typeof body.photo_path === "string" ? body.photo_path : null;
    const deadlineHours = Number(body.deadline_hours) > 0 ? Number(body.deadline_hours) : 48;
    const targetMargin = Number(body.target_margin_pct) > 0 ? Number(body.target_margin_pct) : 30;
    const ownerCost = Number(body.owner_cost) >= 0 ? Number(body.owner_cost) : 0;
    const requestedIds: string[] | null = Array.isArray(body.crew_member_ids) ? body.crew_member_ids : null;
    const leadId = typeof body.lead_id === "string" ? body.lead_id : null;
    const roleNeeded = ["climber", "ground", "both", "stump"].includes(body.role_needed) ? body.role_needed : "climber";
    const audience = ["own", "own_then_network", "all"].includes(body.audience) ? body.audience : "own_then_network";
    const payMode = body.pay_mode === "fixed" ? "fixed" : "bid";
    const fixedPay = payMode === "fixed" && Number(body.fixed_pay) > 0 ? Number(body.fixed_pay) : null;
    const fixedPayType = ["hourly", "per_job"].includes(body.fixed_pay_type) ? body.fixed_pay_type : null;
    const equipmentNeeded = Array.isArray(body.equipment_needed)
      ? body.equipment_needed.filter((x: unknown) => typeof x === "string").slice(0, 20) : [];
    const crewCounts = body.crew_counts && typeof body.crew_counts === "object" ? body.crew_counts : {};
    let needsStump = body.needs_stump_grinding === true || roleNeeded === "stump" ||
      /stump/i.test(String(body.title ?? "")) ||
      /stump/i.test(String(body.job_type ?? ""));
    let stumpDiameter = Number.isFinite(Number(body.stump_diameter_inches))
      ? Number(body.stump_diameter_inches)
      : null;
    // Customer contact details shown to subs on the job card (owner's choice).
    let customerName = typeof body.customer_name === "string" ? body.customer_name.trim() || null : null;
    let customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() || null : null;
    let customerAddress = typeof body.customer_address === "string" ? body.customer_address.trim() || null : null;

    // Pull details from the Scout capture when one is supplied.
    let capTrees: unknown[] | null = null;
    let capPhotoPaths: string[] | null = null;
    if (captureId) {
      const { data: cap } = await admin
        .from("scout_captures")
        .select("owner_id, photo_path, photo_paths, trees, address_city, notes_summary, ai_notes, final_service, ai_service, requested_service, wk_stump, wk_stump_diameter_inches, wk_crane_required, customer_name, customer_phone, address_street, address_state, address_zip")
        .eq("id", captureId).maybeSingle();
      if (cap) {
        if (cap.owner_id !== ownerId) return json({ error: "That capture belongs to another account" }, 403);
        photoPath = photoPath ?? (cap.photo_path as string | null);
        if (Array.isArray((cap as any).trees) && (cap as any).trees.length > 0) {
          capTrees = (cap as any).trees;
          capPhotoPaths = Array.isArray((cap as any).photo_paths) ? (cap as any).photo_paths : null;
        }
        if (cap.wk_stump === true) needsStump = true;
        if ((cap as any).wk_crane_required === true && !equipmentNeeded.includes("crane")) equipmentNeeded.push("crane");
        if (/stump/i.test(String(cap.final_service ?? cap.requested_service ?? cap.ai_service ?? ""))) needsStump = true;
        if (stumpDiameter === null && cap.wk_stump_diameter_inches != null) {
          stumpDiameter = Number(cap.wk_stump_diameter_inches);
        }
        customerName = customerName ?? (cap.customer_name as string | null) ?? null;
        customerPhone = customerPhone ?? (cap.customer_phone as string | null) ?? null;
        customerAddress = customerAddress ??
          ([cap.address_street, cap.address_city, cap.address_state, cap.address_zip].filter(Boolean).join(", ") || null);
      }
    }

    // Website/n8n leads carry the customer's contact details.
    if (leadId) {
      const { data: lead } = await admin
        .from("leads")
        .select("customer_name, customer_phone, customer_address")
        .eq("id", leadId).maybeSingle();
      if (lead) {
        customerName = customerName ?? lead.customer_name ?? null;
        customerPhone = customerPhone ?? lead.customer_phone ?? null;
        customerAddress = customerAddress ?? lead.customer_address ?? null;
      }
    }

    const { dates: offeredDates, source: dateSource } = await offeredDatesFor(admin, ownerId, isInternal);

    // Every send counts on Free, automatic ones included; the claim happens before anything is saved or texted.
    const newRequestId = crypto.randomUUID();
    if (plan === 'free') {
      const claim = await claimFreeUse(admin, ownerId, 'job', newRequestId);
      if (!claim.ok) {
        const trialUsed = await companyTrialUsed(admin, ownerId);
        return json({ error: freeLimitMessage('job', claim.limit, trialUsed), code: 'free_job_limit', used: claim.used, limit: claim.limit, trial_used: trialUsed }, 403);
      }
    }
    const { data: request, error: reqErr } = await admin.from("bid_requests").insert({
      id: newRequestId,
      owner_contractor_id: ownerId,
      created_by: createdBy,
      capture_id: captureId,
      lead_id: leadId,
      title,
      description,
      city,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      photo_path: photoPath,
      photo_paths: capPhotoPaths,
      trees: capTrees,
      status: "open",
      deadline_at: null,
      offered_dates: offeredDates,
      target_margin_pct: targetMargin,
      pricing_inputs: body.pricing_inputs && typeof body.pricing_inputs === "object" ? body.pricing_inputs : {},
      owner_cost: ownerCost,
      role_needed: roleNeeded,
      needs_stump_grinding: needsStump,
      stump_diameter_inches: stumpDiameter,
      audience,
      pay_mode: payMode,
      fixed_pay: fixedPay,
      fixed_pay_type: fixedPayType,
      equipment_needed: equipmentNeeded,
      crew_counts: crewCounts,
    }).select("*").single();
    if (reqErr) {
      // Nothing was sent, so a failed save never uses up a Free job.
      if (plan === 'free') await admin.from('free_plan_usage').delete().eq('owner_id', ownerId).eq('kind', 'job').eq('ref_id', newRequestId);
      return json({ error: reqErr.message }, 400);
    }

    // Recipients: chosen crew, or every active member whose role fits the job
    // (stump grinders only when the job actually needs grinding). Network subs
    // near the job are added unless the owner kept it to their own subs.
    const needsCrane = equipmentNeeded.includes("crane");
    const filter = { roleNeeded, needsStump, needsCrane, stumpDiameter, requestedIds, inquiry: true };
    // A sandbox (demo) company never pulls in subs from other companies: linking needs a confirmed live company.
    if (audience !== "own" && !requestedIds?.length && (await companyMode(admin, ownerId)) === "live") {
      await linkNetworkSubs(admin, ownerId, city);
    }
    const own = await eligibleRecipients(admin, ownerId, filter);
    const all = audience === "own" || requestedIds?.length
      ? own
      : await eligibleRecipients(admin, ownerId, { ...filter, includeNetwork: true });

    let first: typeof all = [];
    let rest: typeof all = [];
    if (audience === "own_then_network") {
      // Own subs (favorites/first-refusal first) get the head start; network waits.
      const ownIds = new Set(own.map((c) => c.id));
      const split = splitFirstRefusal(own);
      const netw = all.filter((c) => !ownIds.has(c.id));
      if (split.first.length && (split.rest.length || netw.length)) { first = split.first; rest = [...split.rest, ...netw]; }
      else if (own.length && netw.length) { first = own; rest = netw; }
      else { first = []; rest = all; }
    } else {
      ({ first, rest } = splitFirstRefusal(all));
    }

    // Head start: the first group gets the job on their own for a while.
    let holdUntil: string | null = null;
    let notified = all;
    if (first.length && rest.length) {
      holdUntil = new Date(Date.now() + holdMinutes * 60_000).toISOString();
      notified = first;
      await admin.from("bid_requests").update({ first_refusal_until: holdUntil }).eq("id", request.id);
      request.first_refusal_until = holdUntil;
    }

    const smsSent = await notifyBidRequest(admin, request, company, notified, { holdUntil });

    return json({
      success: true,
      bid_request: request,
      recipients: notified.length,
      held_for_first_refusal: !!holdUntil,
      sms_sent: smsSent,
      date_source: dateSource,
    });
  } catch (e) {
    console.error("bid-request-create error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
