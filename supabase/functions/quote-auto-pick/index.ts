// Server-only: picks the Recommended quote for Mark's jobs when nobody picked within 3 hours
// of the first climber bid, then alerts the office (LesLee) through quote-pick-alert.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { AUTO_PICK_OWNERS, chooseAutoPick } from "./choose.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim() !== service) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: requests } = await admin.from("bid_requests")
      .select("id, owner_contractor_id, status, quote_pick, awarded_bid_id, pricing_inputs, owner_cost")
      .in("owner_contractor_id", [...AUTO_PICK_OWNERS])
      .eq("status", "open").is("quote_pick", null).is("awarded_bid_id", null);
    let picked = 0;
    for (const r of requests ?? []) {
      const { data: bids } = await admin.from("bids").select("*").eq("bid_request_id", r.id);
      const choice = chooseAutoPick(r as any, (bids ?? []) as any, Date.now());
      if (!choice) continue;
      const pick = { ...choice, auto: true, picked_by_name: "TreeCheck", picked_at: new Date().toISOString() };
      // Only if still unpicked, so a pick made a moment ago is never overwritten.
      const { data: done } = await admin.from("bid_requests").update({ quote_pick: pick })
        .eq("id", r.id).is("quote_pick", null).select("id");
      if (!done?.length) continue;
      await admin.from("bids").update({ agreed_pay: choice.climber_pay }).eq("id", choice.bid_id);
      await fetch(`${url}/functions/v1/quote-pick-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${service}` },
        body: JSON.stringify({ bid_request_id: r.id, auto: true }),
      }).catch((e) => console.warn("auto-pick alert failed", e));
      picked++;
    }
    return json({ picked });
  } catch (e) {
    console.error("quote-auto-pick error", e);
    return json({ error: String(e) }, 500);
  }
});
