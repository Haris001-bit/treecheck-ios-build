// A contract climber submits (or updates) their offer on a bid request.
// All the questions the owner requires are validated here, server-side.
import { createClient } from "npm:@supabase/supabase-js@2";
import { closedWeekdays, logJobActivity } from "../_shared/jobActivity.ts";
import { jobberSwitches } from "../_shared/jobberSwitches.ts";
import { calendarDays, refusalText } from "../_shared/jobberCalendar.ts";
import { validatePickedDates } from "../_shared/freeDays.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sendSms(to: string, body: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !from) return false;
  let phone = to.replace(/\D/g, "");
  if (phone.length === 10) phone = "+1" + phone;
  else if (!phone.startsWith("+")) phone = "+" + phone;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({ To: phone, From: from, Body: body }),
  });
  if (!res.ok) console.error("bid-submit sms failed", res.status, await res.text());
  return res.ok;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

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
    const requestId = typeof body.bid_request_id === "string" ? body.bid_request_id : null;
    if (!requestId) return json({ error: "bid_request_id required" }, 400);

    const bidRole = ["climber", "ground", "stump", "crane"].includes(body.bid_role) ? body.bid_role : "climber";
    const isGround = bidRole === "ground";
    const isStump = bidRole === "stump";
    const minPay = num(body.min_pay);
    const idealPay = num(body.ideal_pay);
    const crewSize = num(body.crew_size);
    const peopleCount = num(body.people_count);
    const estHours = num(body.est_hours);
    const rateType = ["day", "hourly"].includes(body.rate_type) ? body.rate_type : null;
    const equipment = typeof body.equipment === "string" ? body.equipment.trim() : "";
    const disposalLoads = num(body.est_disposal_loads);
    const groundCrewSize = num(body.ground_crew_size);
    const needsMiniSkid = typeof body.needs_mini_skid === "boolean" ? body.needs_mini_skid : null;
    const miniSkidHours = num(body.mini_skid_hours);
    const dates: string[] = Array.isArray(body.available_dates)
      ? body.available_dates.filter((d: unknown) => typeof d === "string")
      : [];
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;

    const errors: string[] = [];
    if (isStump) {
      // A grinder just tells us his price for the stump.
      if (!Number.isFinite(minPay) || minPay <= 0) errors.push("Enter your price for the stump.");
    } else {
    if (!Number.isFinite(minPay) || minPay <= 0) errors.push("Enter the minimum you'd be happy with.");
    if (!Number.isFinite(idealPay) || idealPay <= 0) errors.push("Enter the ideal amount you'd like to make.");
    if (Number.isFinite(minPay) && Number.isFinite(idealPay) && idealPay < minPay) {
      errors.push("Your ideal amount can't be less than your minimum.");
    }
    if (!Number.isFinite(estHours) || estHours <= 0) errors.push(isGround ? "Enter the total hours for the whole crew." : "Enter how many hours the job will take.");
    if (dates.length === 0) errors.push("Check at least one date you can work.");

    if (isGround) {
      if (!rateType) errors.push("Say whether that's a day rate or hourly.");
      if (!Number.isFinite(peopleCount) || peopleCount < 1) errors.push("Enter how many people you're bringing.");
      if (!equipment) errors.push("Tell us what you can run on this job.");
    } else {
      if (!equipment) errors.push("List the equipment you'll need.");
      // Disposal loads and ground crew are collected in the newer form. Older
      // installs don't send them, so accept the offer and leave them blank.
      if (Number.isFinite(disposalLoads) && disposalLoads < 0) errors.push("Disposal loads can't be negative.");
      if (Number.isFinite(groundCrewSize) && groundCrewSize < 0) errors.push("Ground crew can't be negative.");
    }
    }
    if (errors.length) return json({ error: errors.join(" ") }, 400);

    // The climber must be an active member who was actually sent this request.
    const { data: myMemberships } = await admin
      .from("crew_members").select("id, status, full_name, phone").eq("user_id", u.user.id);
    const active = (myMemberships ?? []).filter((m: any) => m.status === "active" || m.status === "network");
    if (!active.length) return json({ error: "Your crew profile is still waiting for approval." }, 403);

    const { data: request } = await admin
      .from("bid_requests")
      .select("id, status, offered_dates, title, city, role_needed, owner_contractor_id, needs_stump_grinding, pricing_inputs, awarded_stump_bid_id")
      .eq("id", requestId).maybeSingle();
    if (!request) return json({ error: "That job no longer exists." }, 404);
    if (request.status !== "open") return json({ error: "That job is no longer available." }, 409);
    const roleNeeded = (request.role_needed as string) ?? "climber";
    // Ground workers never bid — they're called in by date at the owner's set rate.
    if (isGround) {
      return json({ error: "Ground crew don't bid. You'll get a text to pick your days once the job is won." }, 400);
    }
    if (isStump && request.needs_stump_grinding !== true) {
      return json({ error: "This job has no stump grinding on it." }, 400);
    }
    if (!isStump && bidRole !== "crane" && roleNeeded !== "both" && roleNeeded !== bidRole) {
      return json({ error: roleNeeded === "ground" ? "This job is for ground crew." : "This job is for a climber." }, 400);
    }

    const { data: recipients } = await admin
      .from("bid_request_recipients").select("crew_member_id").eq("bid_request_id", requestId);
    const invited = new Set((recipients ?? []).map((r: any) => r.crew_member_id));
    const member = active.find((m: any) => invited.has(m.id)) ?? (invited.size === 0 ? active[0] : null);
    if (!member) return json({ error: "This job wasn't sent to you." }, 403);

    // Offered dates are preferred, but the crew may propose their own days
    // ("none of these work — pick your own"). With the company's free_days switch on, a climber's days
    // must be open: not past, not a day the company is closed, and not already booked in Jobber.
    let cleanDates = dates;
    if (bidRole === "climber" && dates.length) {
      const switches = await jobberSwitches(admin, request.owner_contractor_id);
      if (switches.freeDays) {
        const closed = await closedWeekdays(admin, request.owner_contractor_id);
        const cal = await calendarDays(admin, request.owner_contractor_id, {
          tz: switches.timezone,
          closedWeekdays: closed,
          busyThreshold: switches.busyVisitsPerDay,
          days: 62,
        });
        const picked = validatePickedDates(dates, { today: cal.today, statuses: cal.statuses });
        const refused = picked.rejected.find((r) => r.reason === "busy" || r.reason === "closed");
        if (refused) return json({ error: refusalText(refused.date, refused.reason as "busy" | "closed") }, 400);
        cleanDates = picked.kept;
      }
    }

    const payload = {
      bid_request_id: requestId,
      crew_member_id: member.id,
      bid_role: bidRole,
      min_pay: minPay,
      ideal_pay: isStump ? minPay : idealPay,
      crew_size: Number.isFinite(crewSize) ? Math.round(crewSize) : (Number.isFinite(peopleCount) ? Math.round(peopleCount) : null),
      people_count: Number.isFinite(peopleCount) ? Math.round(peopleCount) : null,
      rate_type: rateType,
      est_hours: Number.isFinite(estHours) ? estHours : null,
      equipment,
      est_disposal_loads: isGround ? null : (Number.isFinite(disposalLoads) ? Math.round(disposalLoads) : null),
      ground_crew_size: isGround ? null : (Number.isFinite(groundCrewSize) ? Math.round(groundCrewSize) : null),
      needs_mini_skid: isGround ? null : needsMiniSkid,
      // Mini skid runs the whole job: default its hours to the offer's total crew hours.
      mini_skid_hours: !isGround && needsMiniSkid
        ? (Number.isFinite(miniSkidHours) && miniSkidHours > 0 ? miniSkidHours : (Number.isFinite(estHours) && estHours > 0 ? estHours : null))
        : null,
      available_dates: cleanDates,
      notes,
      status: "submitted",
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await admin
      .from("bids").select("id, status").eq("bid_request_id", requestId)
      .eq("crew_member_id", member.id).eq("bid_role", bidRole).maybeSingle();

    if (existing && existing.status !== "submitted") {
      return json({ error: "Your offer was already accepted, so it can't be changed." }, 409);
    }

    if (existing) {
      const { error } = await admin.from("bids").update(payload).eq("id", existing.id);
      if (error) return json({ error: error.message }, 400);
    } else {
      const { error } = await admin.from("bids").insert(payload);
      if (error) return json({ error: error.message }, 400);
      await logJobActivity(admin, requestId, "new_offer",
        `New ${isStump ? "stump price" : isGround ? "ground crew offer" : bidRole === "crane" ? "crane price" : "climber offer"} from ${(member.full_name ?? "a sub").split(" ")[0]}`, u.user.id);


      // New offer: text the owner and every active team member (e.g. LesLee).
      try {
        const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
        const [{ data: ownerProfile }, { data: teamProfiles }] = await Promise.all([
          admin.from("profiles").select("phone, full_name").eq("id", request.owner_contractor_id).maybeSingle(),
          admin.from("profiles").select("phone, is_active").eq("parent_contractor_id", request.owner_contractor_id),
        ]);
        const people = [ownerProfile, ...((teamProfiles ?? []) as any[]).filter((p) => p.is_active !== false)];
        const msg = isStump
          ? `Stump price on "${request.title}" (${request.city}): ${member.full_name ?? "A grinder"} ` +
            `quoted ${money(minPay)}. See the Bid Board.`
          : `New bid on "${request.title}" (${request.city}): ${member.full_name ?? "A crew member"} ` +
          `offered ${money(minPay)} min / ${money(idealPay)} ideal, crew of ${payload.crew_size ?? "?"}, ` +
          `~${estHours} hrs, dates: ${cleanDates.slice(0, 4).join(", ")}. See the Bid Board.`;
        const seen = new Set<string>();
        for (const p of people) {
          if (p?.phone && !seen.has(String(p.phone))) {
            seen.add(String(p.phone));
            await sendSms(String(p.phone), msg);
          }
        }
      } catch (notifyErr) {
        console.error("bid-submit notify failed", notifyErr);
      }
    }

    // Stump grinding: the lowest price wins automatically, and that price becomes
    // the stump cost inside the homeowner quote.
    let stumpWinner: string | null = null;
    if (isStump) {
      const { data: stumpBids } = await admin
        .from("bids").select("id, crew_member_id, min_pay")
        .eq("bid_request_id", requestId).eq("bid_role", "stump");
      const sorted = (stumpBids ?? []).slice().sort((a: any, b: any) => Number(a.min_pay) - Number(b.min_pay));
      const winner = sorted[0];
      if (winner) {
        stumpWinner = winner.id;
        await admin.from("bids").update({ status: "won" }).eq("id", winner.id);
        const losers = sorted.slice(1).map((b: any) => b.id);
        if (losers.length) await admin.from("bids").update({ status: "lost" }).in("id", losers);
        const pricing = (request.pricing_inputs && typeof request.pricing_inputs === "object")
          ? { ...(request.pricing_inputs as Record<string, unknown>) }
          : {};
        pricing.stumpCost = Number(winner.min_pay);
        await admin.from("bid_requests").update({
          awarded_stump_bid_id: winner.id,
          pricing_inputs: pricing,
          updated_at: new Date().toISOString(),
        }).eq("id", requestId);
        if (winner.crew_member_id === member.id && member.phone) {
          await sendSms(
            String(member.phone),
            `Thanks — your price of ${"$" + Math.round(Number(winner.min_pay)).toLocaleString("en-US")} for the stump on "${request.title}" is the one we're taking to the homeowner. We'll confirm once they accept.`,
          );
        }
      }
    }

    return json({
      success: true,
      updated: !!existing,
      stump_winner: stumpWinner,
      message: isStump
        ? "Thanks — we'll let you know if we win the job."
        : "Thanks — we'll let you know if you're hired.",
    });
  } catch (e) {
    console.error("bid-submit error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
