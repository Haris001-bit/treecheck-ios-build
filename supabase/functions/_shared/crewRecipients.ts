// Who should be told about a job — shared by bid-request-create, crew-release-holds
// and the ground-worker dispatch functions.

export const STUMP_GRINDER_MIN_INCHES = 12;

export interface CrewRecipient {
  id: string;
  phone: string | null;
  full_name: string | null;
  user_id: string | null;
  trade: string | null;
  wants_ground_work: boolean | null;
  first_refusal: boolean | null;
  hourly_rate?: number | null;
}

export interface RecipientFilter {
  /** 'climber' | 'ground' | 'both' | 'stump' */
  roleNeeded: string;
  needsStump?: boolean;
  /** Job needs a crane: crane operators hear about it. */
  needsCrane?: boolean;
  stumpDiameter?: number | null;
  requestedIds?: string[] | null;
  /** Also include subs who came in from the shared network for this owner. */
  includeNetwork?: boolean;
  /** New job inquiry: only climbers and stump grinders. Ground crew hear about
   *  a job only after a climber is awarded (job dispatch). */
  inquiry?: boolean;
}

const COLS = "id, phone, full_name, user_id, trade, wants_ground_work, first_refusal, hourly_rate";

/** True when the stump on this job belongs to the grinders (12in and up, or unknown). */
export function stumpIsForGrinders(needsStump?: boolean, diameter?: number | null): boolean {
  if (!needsStump) return false;
  if (diameter === null || diameter === undefined || !Number.isFinite(Number(diameter))) return true;
  return Number(diameter) >= STUMP_GRINDER_MIN_INCHES;
}

/** Active crew who fit the job, minus anyone who paused themselves. */
export async function eligibleRecipients(
  // deno-lint-ignore no-explicit-any
  admin: any,
  ownerId: string,
  f: RecipientFilter,
): Promise<CrewRecipient[]> {
  let q = admin
    .from("crew_members").select(COLS)
    .eq("owner_contractor_id", ownerId).in("status", f.includeNetwork ? ["active", "network"] : ["active"]);
  if (f.requestedIds?.length) q = q.in("id", f.requestedIds);
  const { data } = await q;
  let recipients: CrewRecipient[] = (data ?? []) as CrewRecipient[];

  const grinders = stumpIsForGrinders(f.needsStump, f.stumpDiameter);

  if (!f.requestedIds?.length) {
    recipients = recipients.filter((c) => {
      const trade = String(c.trade ?? "climber");
      if (trade === "stump") return grinders;
      if (trade === "crane") return f.needsCrane === true;
      if (f.roleNeeded === "stump") return false;
      if (f.roleNeeded === "both") return true;
      if (f.roleNeeded === "climber") return trade === "climber" || trade === "both";
      return trade === "ground" || trade === "both" || c.wants_ground_work === true;
    });
  }

  if (f.inquiry) {
    recipients = recipients.filter((c) => {
      const trade = String(c.trade ?? "climber");
      if (trade === "stump") return grinders;
      if (trade === "crane") return f.needsCrane === true;
      return trade === "climber" || trade === "both";
    });
  }

  if (recipients.length) {
    const { data: avail } = await admin
      .from("crew_availability").select("crew_member_id, taking_work")
      .in("crew_member_id", recipients.map((c) => c.id));
    const paused = new Set(
      // deno-lint-ignore no-explicit-any
      (avail ?? []).filter((a: any) => a.taking_work === false).map((a: any) => a.crew_member_id),
    );
    if (paused.size) recipients = recipients.filter((c) => !paused.has(c.id));
  }
  return recipients;
}

/** Split into the subs with right of first refusal and everyone else. */
export const STANDARD_GROUND_RATE = 25;

/** Fill each worker's hourly rate: the owner's number wins, else the worker's own. */
// deno-lint-ignore no-explicit-any
export async function withWorkerRates(admin: any, list: CrewRecipient[]): Promise<CrewRecipient[]> {
  const need = list.filter((c) => c.hourly_rate == null && c.user_id).map((c) => c.user_id as string);
  if (!need.length) return list;
  const { data } = await admin.from("crew_profiles").select("user_id, hourly_rate").in("user_id", need);
  const own = new Map((data ?? []).map((r: { user_id: string; hourly_rate: number | null }) => [r.user_id, r.hourly_rate]));
  return list.map((c) => (c.hourly_rate == null && c.user_id ? { ...c, hourly_rate: (own.get(c.user_id) as number | null) ?? null } : c));
}

/** Workers asking more than the standard rate hear about a job only after the standard crew. */
export function splitByRate(list: CrewRecipient[]) {
  const premium = (c: CrewRecipient) => Number(c.hourly_rate) > STANDARD_GROUND_RATE;
  return { standard: list.filter((c) => !premium(c)), premium: list.filter(premium) };
}

export function splitFirstRefusal(list: CrewRecipient[]) {
  const first = list.filter((c) => c.first_refusal === true);
  const rest = list.filter((c) => c.first_refusal !== true);
  return { first, rest };
}

export async function sendSms(to: string, body: string) {
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
  if (!res.ok) console.error("crew sms failed", res.status, await res.text());
  return res.ok;
}

export async function sendPush(
  userIds: string[],
  title: string,
  body: string,
  // deno-lint-ignore no-explicit-any
  data: Record<string, any>,
) {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        contractor_ids: ids,
        notification_type: "account_activity_non_payment",
        title,
        body,
        data,
      }),
    });
  } catch (e) {
    console.warn("crew push failed", e);
  }
}

/** The owner plus every active team member (e.g. the office manager). */
// deno-lint-ignore no-explicit-any
export async function officePhones(admin: any, ownerId: string): Promise<string[]> {
  const [{ data: owner }, { data: team }] = await Promise.all([
    admin.from("profiles").select("phone").eq("id", ownerId).maybeSingle(),
    admin.from("profiles").select("phone, is_active").eq("parent_contractor_id", ownerId),
  ]);
  const out: string[] = [];
  const push = (p: unknown) => {
    const s = p ? String(p) : "";
    if (s && !out.includes(s)) out.push(s);
  };
  push(owner?.phone);
  // deno-lint-ignore no-explicit-any
  for (const p of (team ?? []) as any[]) if (p.is_active !== false) push(p.phone);
  return out;
}

const APP_URL = "https://app.treecheck.ai";

/** Record recipients and text/push them about a job open for bids. */
export async function notifyBidRequest(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  request: any,
  company: string,
  recipients: CrewRecipient[],
  opts: { holdUntil?: string | null } = {},
): Promise<number> {
  if (!recipients.length) return 0;
  await admin.from("bid_request_recipients").upsert(
    recipients.map((c) => ({
      bid_request_id: request.id,
      crew_member_id: c.id,
      notified_at: new Date().toISOString(),
    })),
    { onConflict: "bid_request_id,crew_member_id", ignoreDuplicates: true },
  );

  const where = request.city ? ` in ${request.city}` : "";
  const link = `${APP_URL}/dashboard/crew-bids?job=${request.id}`;
  const holdNote = opts.holdUntil
    ? " You have first pick on this one for the next hour."
    : "";
  let sent = 0;
  for (const c of recipients) {
    const isGrinder = String(c.trade ?? "") === "stump";
    const msg = isGrinder
      ? `${company} has a stump for grinding: ${request.title}${where}. Open TreeCheck to see the photo and send your price:${holdNote} ${link}`
      : `${company} has a job open for bids: ${request.title}${where}. Open TreeCheck to see the photo and send your minimum + ideal pay:${holdNote} ${link}`;
    if (c.phone && String(c.phone).replace(/\D/g, "").length >= 10) {
      if (await sendSms(String(c.phone), msg)) sent++;
    }
  }
  await sendPush(
    recipients.map((c) => c.user_id ?? "").filter(Boolean),
    "New job open for bids",
    `${request.title}${request.city ? ` — ${request.city}` : ""}. Tap to send your price.`,
    { route: `/dashboard/crew-bids?job=${request.id}`, bid_request_id: request.id, source: "crew_bids" },
  );
  return sent;
}

const money = (n: unknown) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

/** Record dispatch recipients and text/push them about a ground-crew call-out. */
export async function notifyDispatch(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  dispatch: any,
  // deno-lint-ignore no-explicit-any
  request: any,
  company: string,
  crew: CrewRecipient[],
  hold: boolean,
): Promise<number> {
  if (!crew.length) return 0;
  await admin.from("job_dispatch_recipients").upsert(
    crew.map((c) => ({
      dispatch_id: dispatch.id,
      crew_member_id: c.id,
      notified_at: new Date().toISOString(),
    })),
    { onConflict: "dispatch_id,crew_member_id", ignoreDuplicates: true },
  );
  const when = dispatch.scheduled_date ? ` on ${dispatch.scheduled_date}` : "";
  const pay = dispatch.pay_per_worker
    ? (dispatch.pay_rate_type === "hourly"
      ? ` Pay ${money(dispatch.pay_per_worker)} per hour.`
      : ` Estimated pay ${money(dispatch.pay_per_worker)} for about ${Math.round((Number(dispatch.pay_per_worker) / 25) * 10) / 10} hours.`)
    : "";
  const spots = `${dispatch.slots} spot${dispatch.slots === 1 ? "" : "s"}`;
  const holdNote = hold ? " You have first pick for the next hour." : "";
  const link = `${APP_URL}/dashboard/crew-bids?dispatch=${dispatch.id}`;
  const offered: string[] = Array.isArray(dispatch.offered_dates) ? dispatch.offered_dates : [];
  const msg = offered.length
    ? `${company} needs ${spots.replace("spot", "ground worker")} for ${request?.title ?? "a job"}${request?.city ? ` in ${request.city}` : ""}.${pay} Possible days: ${offered.join(", ")}. Open TreeCheck and pick the days you can work — the first crew to line up on the same day gets it.${holdNote} ${link}`
    : `${company} needs ground crew: ${request?.title ?? "a job"}${request?.city ? ` in ${request.city}` : ""}${when}.${pay} ${spots}, first come first served.${holdNote} Claim it in TreeCheck: ${link}`;
  let sent = 0;
  for (const c of crew) {
    if (c.phone && String(c.phone).replace(/\D/g, "").length >= 10) {
      if (await sendSms(String(c.phone), msg)) sent++;
    }
  }
  await sendPush(
    crew.map((c) => c.user_id ?? "").filter(Boolean),
    "Ground crew needed",
    `${request?.title ?? "A job"}${request?.city ? ` — ${request.city}` : ""}${offered.length ? ". Pick the days you can work." : `${when}. ${spots} — tap to claim.`}`,
    { route: `/dashboard/crew-bids?dispatch=${dispatch.id}`, dispatch_id: dispatch.id, source: "job_dispatch" },
  );
  return sent;
}

const COPY_COLS = "user_id, full_name, phone, email, trade, certifications, equipment, insured, wants_ground_work, can_skid_steer, can_chipper, crane_certified, truck_trailer_experience, disposal_runs_ok, owns_saws, has_drivers_license, tree_experience_level, years_climbing, mini_skid_experience";

/**
 * Link opted-in network subs near this job to the owner (status 'network'),
 * so they can receive the job. Returns how many new links were made.
 */
// deno-lint-ignore no-explicit-any
export async function linkNetworkSubs(admin: any, ownerId: string, city: string | null): Promise<number> {
  const { data: profiles } = await admin
    .from("crew_profiles").select("user_id, home_city, hidden_owner_ids").eq("network_visible", true);
  const { data: areas } = await admin.from("service_areas").select("city").eq("contractor_id", ownerId);
  const places = [city, ...((areas ?? []).map((a: { city: string }) => a.city))]
    .filter(Boolean).map((c) => String(c).toLowerCase());
  const near = (profiles ?? []).filter((p: any) => {
    if (p.user_id === ownerId) return false;
    if ((p.hidden_owner_ids ?? []).includes(ownerId)) return false;
    if (!p.home_city || !places.length) return true;
    const h = String(p.home_city).toLowerCase();
    return places.some((c) => c.includes(h) || h.includes(c));
  });
  if (!near.length) return 0;
  const ids = near.map((p: any) => p.user_id);
  const { data: existing } = await admin
    .from("crew_members").select("user_id").eq("owner_contractor_id", ownerId).in("user_id", ids);
  const have = new Set((existing ?? []).map((e: any) => e.user_id));
  const missing = ids.filter((id: string) => !have.has(id));
  if (!missing.length) return 0;
  const { data: sources } = await admin
    .from("crew_members").select(COPY_COLS).in("user_id", missing).neq("trade", "pending")
    .order("updated_at", { ascending: false });
  const seen = new Set<string>();
  const rows = [];
  for (const s of sources ?? []) {
    if (seen.has(s.user_id)) continue;
    seen.add(s.user_id);
    rows.push({ ...s, owner_contractor_id: ownerId, status: "network", source: "network" });
  }
  if (!rows.length) return 0;
  const { error } = await admin.from("crew_members").insert(rows);
  if (error) console.warn("linkNetworkSubs insert failed", error.message);
  return error ? 0 : rows.length;
}
