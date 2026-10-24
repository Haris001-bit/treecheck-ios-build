import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ensureDraftQuote, loadQuoteRecords, officeQuoteLine, type QuoteOutcome } from "../_shared/jobberQuote.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LABELS: Record<string, string> = { min: "Lowest", lowest: "Lowest", recommended: "Recommended", plus10: "+10%", plus15: "+15%", ai: "Scout AI price", custom: "custom price" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));
    const id = typeof body.bid_request_id === "string" ? body.bid_request_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bid_request_id required" }, 400);
    const admin = createClient(url, service);

    // quote-auto-pick calls with the service key after picking for the owner.
    const isAuto = auth.replace("Bearer ", "").trim() === service && body.auto === true;
    let user: { id: string } | null = null;
    if (!isAuto) {
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      user = (await userClient.auth.getUser()).data.user;
      if (!user) return json({ error: "Unauthorized" }, 401);
    }

    const { data: r } = await admin.from("bid_requests").select("id, title, city, owner_contractor_id, quote_pick").eq("id", id).maybeSingle();
    if (!r) return json({ error: "Not found" }, 404);
    if (isAuto) user = { id: r.owner_contractor_id };
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const { data: me } = await admin.from("profiles").select("id, full_name, parent_contractor_id").eq("id", user.id).maybeSingle();
    const ownerId = me?.parent_contractor_id ?? user.id;
    if (r.owner_contractor_id !== ownerId) return json({ error: "Not found" }, 404);
    if (!isAuto) {
      const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: auth } } });
      const { data: allowed, error } = await caller.rpc('company_has_permission', { p_owner: ownerId, p_permission: 'reviewEstimates' });
      if (error || !allowed) return json({ error: 'Estimate approval permission required.' }, 403);
    }
    const pick = r.quote_pick as any;
    if (!pick?.amount) return json({ sent: 0 });
    if (isAuto && !pick.auto) return json({ sent: 0 });

    // The draft quote in Jobber, made now at the price picked; bid-award reuses it.
    let outcome: QuoteOutcome = { state: "off" };
    try {
      const records = await loadQuoteRecords(admin, id);
      if (records) {
        const { data: pickedBid } = pick.bid_id
          ? await admin.from("bids").select("est_disposal_loads").eq("id", pick.bid_id).maybeSingle()
          : { data: null };
        outcome = await ensureDraftQuote(admin, {
          ...records,
          salePrice: Number(pick.amount),
          disposalLoads: Number(pickedBid?.est_disposal_loads ?? 0) || null,
        });
      }
    } catch (e) {
      console.error("quote-pick-alert jobber quote error", e);
      outcome = { state: "failed", error: "Unexpected error" };
    }

    // Office team only (e.g. LesLee): never the owner, never any subcontractor.
    const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
    const { data: owner } = await admin.from("profiles").select("phone").eq("id", ownerId).maybeSingle();
    const { data: team } = await admin.from("profiles").select("id, phone").eq("parent_contractor_id", ownerId);
    const ids = (team ?? []).map((p: any) => p.id);
    const { data: crew } = ids.length ? await admin.from("crew_members").select("user_id").in("user_id", ids) : { data: [] };
    const crewIds = new Set((crew ?? []).map((c: any) => c.user_id));
    const ownerPhone = digits(owner?.phone);
    const recipients = (team ?? []).filter((p: any) =>
      p.id !== user.id && p.phone && !crewIds.has(p.id) && digits(p.phone) !== ownerPhone);

    const who = (me?.full_name || "").split(" ")[0] || "The owner";
    const amt = `$${Math.round(Number(pick.amount)).toLocaleString("en-US")}`;
    const quoteNote = outcome.state === "off"
      ? "It's ready to send."
      : outcome.state === "exists"
        ? `Jobber quote${outcome.quoteNumber ? ` #${outcome.quoteNumber}` : ""} already exists. If the price changed, change it there to ${amt}.`
        : officeQuoteLine(outcome, Number(pick.amount));
    const picker = isAuto ? "No pick was made within 3 hours, so TreeCheck auto-picked" : `${who} picked`;
    const msg = `TreeCheck: ${picker} the ${LABELS[pick.option] ?? "quote"} (${amt}) for "${r.title}"${r.city ? ` in ${r.city}` : ""}. ${quoteNote} https://app.treecheck.ai/dashboard/bid-board`;

    const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const from = Deno.env.get("TWILIO_PHONE_NUMBER")!;
    let sent = 0;
    for (const p of recipients) {
      let phone = String(p.phone).replace(/\D/g, "");
      if (phone.length === 10) phone = "+1" + phone; else phone = "+" + phone;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${sid}:${tok}`) },
        body: new URLSearchParams({ To: phone, From: from, Body: msg }),
      });
      if (res.ok) sent++; else console.error("sms failed", await res.text());
    }
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
