// Hourly sweep: jobs marked "Quote sent" 12+ hours ago and still not accepted
// get one office text suggesting a discount quote. The Jobs card shows a badge.
import { createClient } from "npm:@supabase/supabase-js@2";
import { officePhones, sendSms } from "../_shared/crewRecipients.ts";

Deno.serve(async (req) => {
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (token !== SERVICE && token !== Deno.env.get("SUPABASE_ANON_KEY")) return new Response("Forbidden", { status: 403 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: rows } = await admin.from("bid_requests")
    .select("id, title, city, customer_name, owner_contractor_id")
    .eq("workflow_status", "quote_sent").is("quote_followup_alerted_at", null).is("discount_quote_sent_at", null)
    .lt("quote_sent_at", cutoff).limit(100);
  for (const r of rows ?? []) {
    await admin.from("bid_requests").update({ quote_followup_alerted_at: new Date().toISOString() }).eq("id", r.id);
    const who = r.customer_name ? ` for ${r.customer_name}` : "";
    const msg = `Follow up: the quote${who} on ${r.title}${r.city ? ` (${r.city})` : ""} was sent 12+ hours ago and isn't accepted yet. Consider sending a discount quote. https://app.treecheck.ai/dashboard/bid-board`;
    for (const p of await officePhones(admin, r.owner_contractor_id)) await sendSms(p, msg);
  }
  return new Response(JSON.stringify({ alerted: (rows ?? []).length }), { headers: { "Content-Type": "application/json" } });
});
