// Daily ground-crew digest + "climber, please add more dates" requests.
// Daily run is public-key callable (idempotent). Body: {} = full daily run; { action: "check", dispatch_id } = climber check for one job.
import { createClient } from "npm:@supabase/supabase-js@2";
import { eligibleRecipients, officePhones, sendPush, sendSms } from "../_shared/crewRecipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const APP = "https://app.treecheck.ai/dashboard/crew-bids";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const label = (r: { title?: string; city?: string }) => {
  const t = String(r?.title ?? "Job").split(" — ")[0];
  return r?.city ? `${r.city} ${t.toLowerCase()}` : t;
};

// deno-lint-ignore no-explicit-any
async function climberCheck(admin: any, d: any, req: any, future: string[], sandbox: boolean, company: string) {
  if (future.length !== 1) return false;
  const last = future[0];
  if (d.more_dates_requested_for === last) return false;
  // Can the one remaining date still fill?
  const { data: resp } = await admin.from("job_dispatch_responses")
    .select("available_dates").eq("dispatch_id", d.id).eq("response", "available");
  const onDay = (resp ?? []).filter((r: { available_dates: string[] }) => (r.available_dates ?? []).includes(last)).length;
  if (onDay >= d.slots) return false;
  if (!req?.awarded_bid_id) return false;
  const { data: bid } = await admin.from("bids").select("crew_member_id").eq("id", req.awarded_bid_id).maybeSingle();
  const { data: c } = bid
    ? await admin.from("crew_members").select("full_name, phone, user_id").eq("id", bid.crew_member_id).maybeSingle()
    : { data: null };
  const now = new Date().toISOString();
  await admin.from("job_dispatches").update({ more_dates_requested_at: now, more_dates_requested_for: last }).eq("id", d.id);
  await admin.from("bid_requests").update({
    climber_dates_status: "requested", climber_dates_requested_at: now, climber_dates_reminded_at: null,
  }).eq("id", req.id);
  if (sandbox) return true;
  const job = label(req);
  if (c?.phone) {
    await sendSms(String(c.phone),
      `${company}: We're short on ground crew for ${job}. Only ${nice(last)} is left. Can you add more days you're available? ${APP}?job=${req.id}`);
  }
  if (c?.user_id) await sendPush([c.user_id], "Add more days", `Short on ground crew for ${job}. Tap to add days.`, { route: `/dashboard/crew-bids?job=${req.id}` });
  for (const p of await officePhones(admin, req.owner_contractor_id)) {
    await sendSms(p, `Copy: we asked ${c?.full_name ?? "the climber"} for more days on ${job}. Only ${nice(last)} is left and ground crew is still short.`);
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const body = await req.json().catch(() => ({}));
    // The daily cron calls with the public key; the run is idempotent per day. Single-job checks need service role.
    if (token !== SERVICE && body.action === "check") return json({ error: "Forbidden" }, 403);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });
    const t = today();

    let q = admin.from("job_dispatches").select("*").eq("status", "open").eq("role", "ground");
    if (body.action === "check") q = q.eq("id", String(body.dispatch_id ?? ""));
    const { data: dispatches } = await q;
    const byOwner = new Map<string, any[]>();
    for (const d of dispatches ?? []) {
      const list = byOwner.get(d.owner_contractor_id) ?? [];
      list.push(d);
      byOwner.set(d.owner_contractor_id, list);
    }

    let texts = 0, climberAsks = 0;
    for (const [ownerId, list] of byOwner) {
      const { data: owner } = await admin.from("profiles").select("company_name, is_sandbox").eq("id", ownerId).maybeSingle();
      const company = owner?.company_name ?? "Your tree company";
      const ids = list.map((d) => d.bid_request_id);
      const { data: reqs } = await admin.from("bid_requests")
        .select("id, title, city, owner_contractor_id, awarded_bid_id").in("id", ids);
      const reqMap = new Map((reqs ?? []).map((r: any) => [r.id, r]));
      const testville = (r: any) => /testville/i.test(String(r?.city ?? ""));

      const live: { d: any; r: any; future: string[] }[] = [];
      for (const d of list) {
        const r = reqMap.get(d.bid_request_id);
        const offered: string[] = Array.isArray(d.offered_dates) ? d.offered_dates : [];
        const future = offered.filter((x) => typeof x === "string" && x >= t).sort();
        if (!future.length) continue;
        const sandbox = owner?.is_sandbox === true || testville(r);
        if (await climberCheck(admin, d, r, future, sandbox, company)) climberAsks++;
        if (!sandbox) live.push({ d, r, future });
      }
      if (body.action === "check" || !live.length) continue;

      // Daily digest, once per day per job.
      const due = live.filter(({ d }) =>
        !d.last_daily_reminder_at ||
        new Date(d.last_daily_reminder_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) < t);
      if (!due.length) continue;
      const { data: resp } = await admin.from("job_dispatch_responses")
        .select("dispatch_id, crew_member_id").in("dispatch_id", due.map((x) => x.d.id));
      const responded = new Set((resp ?? []).map((r: any) => `${r.dispatch_id}:${r.crew_member_id}`));
      const crew = await eligibleRecipients(admin, ownerId, { roleNeeded: "ground" });
      for (const c of crew) {
        if (!c.phone || String(c.phone).replace(/\D/g, "").length < 10) continue;
        const mine = due.filter(({ d }) => !responded.has(`${d.id}:${c.id}`));
        if (!mine.length) continue;
        const lines = mine.map(({ d, r, future }) =>
          `${label(r)} — ${future.map(nice).join(", ")} (${d.slots} spot${d.slots === 1 ? "" : "s"})`);
        const msg = `${company} still needs ground workers: ${lines.join(". ")}. Log in and pick your days: ${APP}`;
        if (await sendSms(String(c.phone), msg)) texts++;
      }
      const now = new Date().toISOString();
      await admin.from("job_dispatches").update({ last_daily_reminder_at: now }).in("id", due.map((x) => x.d.id));
    }
    return json({ success: true, texts, climber_requests: climberAsks });
  } catch (e) {
    console.error("ground-crew-daily error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
