// Monday: text owners and their office team that last week's pay summary is ready.
// Totals only, never customer details. Once per company per week.
import { createClient } from "npm:@supabase/supabase-js@2";
import { officePhones, sendSms } from "../_shared/crewRecipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function ymd(d: Date) { return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); }
function addDays(s: string, n: number) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const today = ymd(new Date());
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const thisMonday = addDays(today, -dow);
    const lastMonday = addDays(thisMonday, -7);
    // Chicago midnight ≈ 05:00/06:00 UTC; 06:00 covers both safely for a weekly window.
    const from = `${lastMonday}T06:00:00Z`, to = `${thisMonday}T06:00:00Z`;

    const { data: jobs } = await admin.from("bid_requests")
      .select("id, owner_contractor_id, awarded_bid_id, awarded_stump_bid_id, paid_at")
      .eq("workflow_status", "job_complete").is("paid_at", null).lt("completed_at", to);
    const byOwner = new Map<string, any[]>();
    for (const j of jobs ?? []) {
      const l = byOwner.get(j.owner_contractor_id) ?? [];
      l.push(j); byOwner.set(j.owner_contractor_id, l);
    }
    let sent = 0;
    for (const [ownerId, list] of byOwner) {
      const { data: already } = await admin.from("pay_week_notices").select("week_start")
        .eq("owner_contractor_id", ownerId).eq("week_start", lastMonday).maybeSingle();
      if (already) continue;
      const { data: owner } = await admin.from("profiles").select("is_sandbox").eq("id", ownerId).maybeSingle();
      const bidIds = list.flatMap((j) => [j.awarded_bid_id, j.awarded_stump_bid_id]).filter(Boolean);
      const { data: bids } = bidIds.length
        ? await admin.from("bids").select("id, agreed_pay, min_pay, bid_role").in("id", bidIds) : { data: [] };
      const { data: hrs } = await admin.from("job_ground_hours").select("hours, pay").in("bid_request_id", list.map((j) => j.id));
      let total = 0, missingPay = 0;
      for (const b of bids ?? []) {
        const v = b.bid_role === "stump" ? Number(b.min_pay) : b.agreed_pay;
        if (v == null) missingPay++; else total += Number(v);
      }
      let missingHours = 0;
      for (const h of hrs ?? []) { if (h.hours == null) missingHours++; else total += Number(h.pay ?? 0); }
      await admin.from("pay_week_notices").insert({ owner_contractor_id: ownerId, week_start: lastMonday });
      if (owner?.is_sandbox) continue;
      const extras = [
        missingHours ? `${missingHours} worker${missingHours === 1 ? "" : "s"} missing hours` : "",
        missingPay ? `${missingPay} climber pay${missingPay === 1 ? "" : "s"} not set` : "",
      ].filter(Boolean).join(", ");
      const msg = `TreeCheck: Pay summaries are ready — ${list.length} job${list.length === 1 ? "" : "s"}, $${Math.round(total).toLocaleString("en-US")} total` +
        `${extras ? `, ${extras}` : ""}. https://app.treecheck.ai/dashboard/pay`;
      for (const p of await officePhones(admin, ownerId)) { await sendSms(p, msg); sent++; }
    }
    return json({ ok: true, week_start: lastMonday, from, to, companies: byOwner.size, sent });
  } catch (e) {
    console.error("pay-week-summary error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
