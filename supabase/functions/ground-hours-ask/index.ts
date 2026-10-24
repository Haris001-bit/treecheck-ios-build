// Daily: the day after a job is marked complete, text each picked ground worker
// to enter the hours they worked. One reminder after 2 days. Idempotent.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPush, sendSms } from "../_shared/crewRecipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const APP = "https://app.treecheck.ai/dashboard/ground-hours";
const LAUNCH = "2026-10-13T00:00:00Z";

function chicagoMidnightUtc(): Date {
  const now = new Date();
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  // Chicago is UTC-5/-6; find the UTC instant of local midnight.
  for (const off of [5, 6]) {
    const d = new Date(`${ymd}T${String(off).padStart(2, "0")}:00:00Z`);
    if (d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) === ymd &&
      d.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false }).startsWith("00")) return d;
  }
  return new Date(`${ymd}T05:00:00Z`);
}

// deno-lint-ignore no-explicit-any
export async function pickedGroundWorkers(admin: any, requestId: string): Promise<string[]> {
  const { data: ds } = await admin.from("job_dispatches")
    .select("id, hired_crew_member_ids").eq("bid_request_id", requestId).eq("role", "ground");
  const ids = new Set<string>();
  for (const d of ds ?? []) for (const c of d.hired_crew_member_ids ?? []) ids.add(c);
  const dIds = (ds ?? []).map((d: { id: string }) => d.id);
  if (dIds.length) {
    const { data: rs } = await admin.from("job_dispatch_responses")
      .select("crew_member_id").in("dispatch_id", dIds).eq("status", "confirmed");
    for (const r of rs ?? []) ids.add(r.crew_member_id);
  }
  return [...ids];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const todayStart = chicagoMidnightUtc();
    const since = new Date(Math.max(Date.parse(LAUNCH), todayStart.getTime() - 5 * 86400000)).toISOString();
    const { data: jobs } = await admin.from("bid_requests")
      .select("id, title, city, owner_contractor_id, completed_at")
      .eq("workflow_status", "job_complete")
      .gte("completed_at", since).lt("completed_at", todayStart.toISOString());

    let asked = 0, reminded = 0;
    const sandboxCache = new Map<string, { sandbox: boolean; company: string }>();
    for (const j of jobs ?? []) {
      let co = sandboxCache.get(j.owner_contractor_id);
      if (!co) {
        const { data: p } = await admin.from("profiles").select("company_name, is_sandbox").eq("id", j.owner_contractor_id).maybeSingle();
        co = { sandbox: p?.is_sandbox === true, company: p?.company_name ?? "Your tree company" };
        sandboxCache.set(j.owner_contractor_id, co);
      }
      const workers = await pickedGroundWorkers(admin, j.id);
      if (!workers.length) continue;
      const { data: existing } = await admin.from("job_ground_hours")
        .select("id, crew_member_id, hours, asked_at, reminded_at").eq("bid_request_id", j.id);
      const byCrew = new Map((existing ?? []).map((e: any) => [e.crew_member_id, e]));
      const { data: crews } = await admin.from("crew_members").select("id, phone, user_id, full_name").in("id", workers);
      const job = `${j.city ? j.city + " " : ""}${String(j.title ?? "job").split(" — ")[0].toLowerCase()}`;
      const now = new Date().toISOString();
      for (const c of crews ?? []) {
        const row: any = byCrew.get(c.id);
        if (row?.hours != null) continue;
        const link = `${APP}?job=${j.id}`;
        if (!row || !row.asked_at) {
          if (row) await admin.from("job_ground_hours").update({ asked_at: now }).eq("id", row.id);
          else {
            const { error } = await admin.from("job_ground_hours").insert({
              bid_request_id: j.id, owner_contractor_id: j.owner_contractor_id, crew_member_id: c.id, asked_at: now,
            });
            if (error) continue;
          }
          if (!co.sandbox) {
            if (c.phone) await sendSms(String(c.phone), `${co.company}: How many hours did you work on the ${job}? Tap to enter them: ${link}`);
            if (c.user_id) await sendPush([c.user_id], "Enter your hours", `How many hours did you work on the ${job}?`, { route: `/dashboard/ground-hours?job=${j.id}` });
          }
          asked++;
        } else if (!row.reminded_at && Date.parse(row.asked_at) < Date.now() - 2 * 86400000 + 3600000) {
          await admin.from("job_ground_hours").update({ reminded_at: now }).eq("id", row.id);
          if (!co.sandbox && c.phone) {
            await sendSms(String(c.phone), `${co.company}: Reminder — we still need your hours for the ${job} so we can pay you. ${link}`);
          }
          reminded++;
        }
      }
    }
    return json({ ok: true, jobs: jobs?.length ?? 0, asked, reminded });
  } catch (e) {
    console.error("ground-hours-ask error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
