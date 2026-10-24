// Owner awards a bid: marks the winner, closes the request, texts everyone.
import { sendPush } from "../_shared/crewRecipients.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCompanyPermission } from '../_shared/companyPermission.ts';
import { ensureDraftQuote, loadQuoteRecords, officeQuoteLine, quoteStatusFor, type QuoteOutcome } from "../_shared/jobberQuote.ts";
import { calculatePricing } from "../_shared/bidPricing.ts";
import { toPricingInput, withBidExtras, type StoredPricingInputs } from "../_shared/bidPricingInputs.ts";

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
  if (!res.ok) console.error("award sms failed", res.status, await res.text());
  return res.ok;
}

function b64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!apiKey || !connKey) {
    console.warn("[bid-award] email not configured; skipping");
    return false;
  }
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
  const res = await fetch(
    "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: b64url(mime) }),
    },
  );
  if (!res.ok) console.error("[bid-award] gmail send failed", res.status, await res.text());
  return res.ok;
}

// ---- Jobber: create the customer quote at the calculated sale price ----
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (v: unknown) =>
  v == null || v === "" ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function row(label: string, value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return `<tr><td style="padding:6px 14px 6px 0;color:#666;font-size:14px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;font-size:14px;color:#111">${esc(value)}</td></tr>`;
}

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

    const { data: me } = await admin
      .from("profiles").select("parent_contractor_id, company_name, full_name").eq("id", u.user.id).maybeSingle();
    const ownerId = me?.parent_contractor_id ?? u.user.id;
    await requireCompanyPermission(req, ownerId, 'manageJobsSubs');
    const company = me?.company_name || me?.full_name || "The company";

    const { bid_id, awarded_date, ground_bid_id, ground_awarded_date } = await req.json().catch(() => ({}));
    if (typeof bid_id !== "string" || !bid_id) return json({ error: "bid_id required" }, 400);
    const dateOrNull = (v: unknown) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    const awardDate = dateOrNull(awarded_date);
    const groundBidId = typeof ground_bid_id === "string" && ground_bid_id ? ground_bid_id : null;

    const BID_COLS = "id, bid_request_id, crew_member_id, bid_role, rate_type, people_count, ideal_pay, min_pay, crew_size, equipment, est_hours, notes, available_dates, est_disposal_loads, needs_mini_skid, mini_skid_hours";

    const { data: winningBid } = await admin
      .from("bids").select(BID_COLS).eq("id", bid_id).maybeSingle();
    if (!winningBid) return json({ error: "Bid not found" }, 404);

    let groundBid: any = null;
    if (groundBidId) {
      const { data: gb } = await admin.from("bids").select(BID_COLS).eq("id", groundBidId).maybeSingle();
      if (gb && gb.bid_request_id === winningBid.bid_request_id) groundBid = gb;
    }
    const groundDate = dateOrNull(ground_awarded_date) ?? awardDate;

    const { data: request } = await admin
      .from("bid_requests")
      .select("id, owner_contractor_id, capture_id, lead_id, title, city, description, status, target_margin_pct, owner_cost, pricing_inputs, role_needed, jobber_quote_id, jobber_quote_number, quote_pick")
      .eq("id", winningBid.bid_request_id).maybeSingle();
    if (!request || request.owner_contractor_id !== ownerId) return json({ error: "Not your bid request" }, 403);

    const wonIds = [bid_id, ...(groundBid ? [groundBid.id] : [])];
    const awardedRoles = [
      String(winningBid.bid_role ?? "climber"),
      ...(groundBid ? [String(groundBid.bid_role ?? "ground")] : []),
    ];

    await admin.from("bids").update({ status: "won" }).in("id", wonIds);
    // Only the roles we actually filled get closed out; bids for the other role
    // stay open so we can still pick someone.
    await admin.from("bids").update({ status: "lost" })
      .eq("bid_request_id", request.id)
      .in("bid_role", awardedRoles)
      .not("id", "in", `(${wonIds.join(",")})`)
      .eq("status", "submitted");

    const stillNeedsOtherRole =
      String(request.role_needed ?? "climber") === "both" && !groundBid;
    await admin.from("bid_requests").update({
      status: stillNeedsOtherRole ? "open" : "awarded",
      awarded_bid_id: bid_id,
      awarded_date: awardDate,
      ...(groundBid ? { awarded_ground_bid_id: groundBid.id, awarded_ground_date: groundDate } : {}),
    }).eq("id", request.id);

    const { data: allBids } = await admin
      .from("bids").select("id, crew_member_id, status, bid_role").eq("bid_request_id", request.id);
    const crewIds = (allBids ?? []).map((b: any) => b.crew_member_id);
    const { data: crew } = await admin
      .from("crew_members")
      .select("id, phone, full_name, email, trade, certifications, equipment, rating_avg, jobs_completed")
      .in("id", crewIds.length ? crewIds : ["00000000-0000-0000-0000-000000000000"]);
    const crewMap = new Map((crew ?? []).map((c: any) => [c.id, c]));

    const where = request.city ? ` in ${request.city}` : "";
    const dateLabel = awardDate ? ` Scheduled for ${awardDate}.` : "";
    const groundDateLabel = groundDate ? ` Scheduled for ${groundDate}.` : "";
    let sent = 0;
    for (const b of allBids ?? []) {
      const c: any = crewMap.get(b.crew_member_id);
      if (!c?.phone) continue;
      // Only tell people about roles we've decided; nobody is told they lost.
      const isWinner = wonIds.includes(b.id);
      const roleDecided = awardedRoles.includes(String(b.bid_role ?? "climber"));
      if (!isWinner && !roleDecided) continue;
      const msg = isWinner
        ? `Good news — you're the crew we're going with on ${request.title}${where}.${b.id === bid_id ? dateLabel : groundDateLabel} We're sending the quote to the customer now. We'll confirm the moment they approve it.`
        : `Thank you for bidding on ${request.title}${where}. We'll let you know if we win the bid and you're hired. Check the app anytime to see if the job is still available.`;
      if (await sendSms(String(c.phone), msg)) sent++;
    }

    // ---- Office packet: everything needed to build the quote in Jobber ----
    // Goes to the account owner and every team member on the account
    // (that's how LesLee gets it), by text and by email.
    let officeSms = 0;
    let officeEmails = 0;
    let quoteOutcome: QuoteOutcome = { state: "off" };
    try {
      const winner: any = crewMap.get(winningBid.crew_member_id) ?? {};

      // Customer + property details live on the Scout capture, when the bid
      // request came from one.
      let capture: any = null;
      if (request.capture_id) {
        const { data: cap } = await admin
          .from("scout_captures")
          .select("customer_name, customer_phone, customer_email, address_street, address_city, address_state, address_zip, final_service, ai_service, final_price_min, final_price_max, ai_price_min, ai_price_max, final_notes, ai_notes")
          .eq("id", request.capture_id).maybeSingle();
        capture = cap;
      }

      // Website leads carry their own customer + property details.
      let lead: any = null;
      if (request.lead_id) {
        const { data: ld } = await admin
          .from("leads")
          .select("customer_name, customer_phone, customer_email, customer_address, city, job_type, estimated_cost_min, estimated_cost_max, customer_notes")
          .eq("id", request.lead_id).maybeSingle();
        lead = ld;
      }

      const customerName = capture?.customer_name ?? lead?.customer_name ?? null;
      const customerPhone = capture?.customer_phone ?? lead?.customer_phone ?? null;
      const customerEmail = capture?.customer_email ?? lead?.customer_email ?? null;
      const address = capture
        ? [capture.address_street, capture.address_city, capture.address_state, capture.address_zip].filter(Boolean).join(", ")
        : (lead?.customer_address ?? request.city ?? "");
      const service = capture?.final_service ?? capture?.ai_service ?? lead?.job_type ?? request.title;
      const quotedMin = capture?.final_price_min ?? capture?.ai_price_min ?? lead?.estimated_cost_min ?? null;
      const quotedMax = capture?.final_price_max ?? capture?.ai_price_max ?? lead?.estimated_cost_max ?? null;

      // Sale price needed to hit the target margin, using the crew's ideal pay
      // (climber plus ground crew when both were hired).
      const groundCrew: any = groundBid ? (crewMap.get(groundBid.crew_member_id) ?? {}) : null;
      const priced = calculatePricing(
        toPricingInput(withBidExtras(request.pricing_inputs as StoredPricingInputs | null, winningBid as any), {
          crewMinimum: Number(winningBid.min_pay ?? 0),
          crewIdeal: Number(winningBid.ideal_pay ?? 0),
          committedCrewPay: Number(groundBid?.ideal_pay ?? 0),
          legacyOwnerCost: Number(request.owner_cost ?? 0),
        }),
      );
      // Use the price the owner/office picked on the Bid Board for this offer, if any.
      const pick = (request as any).quote_pick;
      const pickedAmount = pick && pick.bid_id === winningBid.id && Number(pick.amount) > 0 ? Number(pick.amount) : null;
      const salePrice = pickedAmount ?? priced.baseSale ?? 0;
      const ownerKeeps = (priced.baseBreakdown?.owner ?? 0) + (salePrice - (priced.baseSale ?? salePrice));
      const ownerPercentLabel = priced.baseBreakdown && salePrice > 0
        ? `${((ownerKeeps / salePrice) * 100).toFixed(1)}%`
        : "—";

      // ---- The customer's draft quote in Jobber: made at the price pick, or now ----
      try {
        const records = await loadQuoteRecords(admin, request.id);
        if (records) {
          quoteOutcome = await ensureDraftQuote(admin, {
            ...records,
            salePrice,
            disposalLoads: Number(winningBid.est_disposal_loads ?? 0) || null,
          });
        }
      } catch (quoteErr) {
        console.error("bid-award jobber quote error", quoteErr);
        quoteOutcome = { state: "failed", error: "Unexpected error" };
      }
      if (quoteOutcome.state === "off" && !request.jobber_quote_id) {
        // Jobber quotes are switched off for this company, so the office builds the quote.
        await admin.from("bid_requests").update({ quote_status: "not_created" }).eq("id", request.id);
      }
      const quoteReady = quoteOutcome.state === "created" || quoteOutcome.state === "exists";
      const quoteLabel = officeQuoteLine(quoteOutcome, salePrice);

      const jobLabel = `${service}${request.city ? ` — ${request.city}` : ""}`;
      const subject = quoteReady
        ? `Crew awarded: ${jobLabel}. The draft quote is in Jobber`
        : `Crew awarded: ${jobLabel}. Build the quote`;

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px">
          <h2 style="margin:0 0 4px;font-size:20px;color:#111">${quoteReady ? "Crew awarded. The draft quote is in Jobber" : "Crew awarded. Ready to quote"}</h2>
          <p style="margin:0 0 18px;color:#555;font-size:14px">
            ${esc(company)} awarded this job. ${quoteReady ? "Check the draft quote in Jobber against the details below, then send it to the homeowner." : "Everything below is what you need to create the quote in Jobber and send it to the homeowner."}
          </p>

          <h3 style="font-size:15px;color:#111;margin:18px 0 6px">Customer &amp; property</h3>
          <table style="border-collapse:collapse">
            ${row("Customer", customerName)}
            ${row("Phone", customerPhone)}
            ${row("Email", customerEmail)}
            ${row("Address", address)}
            ${row("Service", service)}
          </table>

          <h3 style="font-size:15px;color:#111;margin:18px 0 6px">What to sell it for</h3>
          <table style="border-collapse:collapse">
            ${row("Quote the homeowner", money(salePrice))}
            ${row("Quote status", quoteLabel)}
            ${priced.minimumSaleFloor != null ? row("Lowest price this crew will take", money(priced.minimumSaleFloor)) : ""}
            ${priced.plus10Sale != null ? row("+10% option", money(priced.plus10Sale)) : ""}
            ${priced.plus15Sale != null ? row("+15% option", money(priced.plus15Sale)) : ""}
            ${row("Round-number options", `${money(priced.rounded25Quote)} or ${money(priced.rounded50Quote)}`)}
            ${row("Left after costs", money(priced.baseBreakdown?.net))}
            ${row("You keep", `${money(ownerKeeps)} (${ownerPercentLabel})`)}
            ${row("Fixed cost", money(priced.costs.fixed))}
            ${row("Ground labor", money(priced.costs.grounds))}
            ${row("Disposal", money(priced.costs.disposal))}
            ${row("Mini skid steer", money(priced.costs.equipment))}
            ${row("Stump grinding", money(priced.costs.stump))}
            ${row("Travel / other", money(priced.costs.travel + priced.costs.other))}
            ${priced.warnings.length ? row("Heads up", priced.warnings.join(" ")) : ""}
            ${row("Crew pay (their ideal)", money(winningBid.ideal_pay))}
            ${row("Crew pay (their minimum)", money(winningBid.min_pay))}
            ${groundBid ? row("Ground crew pay (their ideal)", money(groundBid.ideal_pay)) : ""}
            ${quotedMin != null ? row("Scout estimate given on site", quotedMin === quotedMax ? money(quotedMax) : `${money(quotedMin)} – ${money(quotedMax)}`) : ""}
          </table>

          <h3 style="font-size:15px;color:#111;margin:18px 0 6px">Crew doing the work</h3>
          <table style="border-collapse:collapse">
            ${row("Name", winner.full_name)}
            ${row("Phone", winner.phone)}
            ${row("Email", winner.email)}
            ${row("Trade", winner.trade)}
            ${row("Certifications", winner.certifications)}
            ${row("Rating", winner.rating_avg != null ? `${Number(winner.rating_avg).toFixed(1)} (${winner.jobs_completed ?? 0} rated jobs)` : null)}
            ${row("Scheduled date", awardDate)}
            ${row("Their available dates", (winningBid.available_dates ?? []).join(", "))}
            ${row("People needed", winningBid.crew_size)}
            ${row("Estimated hours", winningBid.est_hours)}
            ${row("Equipment needed", winningBid.equipment)}
            ${row("Crew notes", winningBid.notes)}
          </table>

          ${groundBid ? `
          <h3 style="font-size:15px;color:#111;margin:18px 0 6px">Ground crew</h3>
          <table style="border-collapse:collapse">
            ${row("Name", groundCrew?.full_name)}
            ${row("Phone", groundCrew?.phone)}
            ${row("Email", groundCrew?.email)}
            ${row("Rating", groundCrew?.rating_avg != null ? `${Number(groundCrew.rating_avg).toFixed(1)} (${groundCrew.jobs_completed ?? 0} rated jobs)` : null)}
            ${row("Pay agreed", `${money(groundBid.ideal_pay)}${groundBid.rate_type ? ` (${groundBid.rate_type === "day" ? "day rate" : "hourly"})` : ""}`)}
            ${row("People they're bringing", groundBid.people_count ?? groundBid.crew_size)}
            ${row("Estimated hours", groundBid.est_hours)}
            ${row("What they can run", groundBid.equipment)}
            ${row("Scheduled date", groundDate)}
            ${row("Their notes", groundBid.notes)}
          </table>` : ""}

          <h3 style="font-size:15px;color:#111;margin:18px 0 6px">Job description</h3>
          <p style="font-size:14px;color:#111;white-space:pre-wrap;margin:0">${esc(request.description || lead?.customer_notes || capture?.final_notes || capture?.ai_notes || "—")}</p>

          <p style="margin:22px 0 0;color:#888;font-size:12px">Sent automatically by TreeCheck when the crew was awarded.</p>
        </div>`;

      const smsText = [
        quoteReady ? "TreeCheck: crew awarded. The draft quote is in Jobber." : "TreeCheck: crew awarded, needs a quote in Jobber.",
        `Job: ${jobLabel}`,
        customerName ? `Customer: ${customerName}${customerPhone ? ` ${customerPhone}` : ""}` : null,
        address ? `Address: ${address}` : null,
        `Quote the homeowner: ${money(salePrice)} (you keep ${money(ownerKeeps)}, ${ownerPercentLabel})`,
        `Crew: ${winner.full_name ?? "crew"}${winner.phone ? ` ${winner.phone}` : ""} at ${money(winningBid.ideal_pay)}`,
        groundBid ? `Ground: ${groundCrew?.full_name ?? "ground crew"}${groundCrew?.phone ? ` ${groundCrew.phone}` : ""} at ${money(groundBid.ideal_pay)}` : null,
        awardDate ? `Scheduled: ${awardDate}` : null,
        winningBid.crew_size ? `Crew of ${winningBid.crew_size}${winningBid.est_hours ? `, ~${winningBid.est_hours} hrs` : ""}` : null,
        quoteLabel,
        `Full details emailed to you.`,
      ].filter(Boolean).join("\n");

      // Owner + everyone on the owner's team.
      const [{ data: ownerProfile }, { data: teamProfiles }] = await Promise.all([
        admin.from("profiles").select("phone, email, full_name").eq("id", ownerId).maybeSingle(),
        admin.from("profiles").select("phone, email, full_name, is_active").eq("parent_contractor_id", ownerId),
      ]);
      const office = [
        ownerProfile,
        ...((teamProfiles ?? []) as any[]).filter((p) => p.is_active !== false),
      ].filter(Boolean) as any[];

      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      for (const p of office) {
        if (p.phone && !seenPhones.has(String(p.phone))) {
          seenPhones.add(String(p.phone));
          if (await sendSms(String(p.phone), smsText)) officeSms++;
        }
        if (p.email && !seenEmails.has(String(p.email))) {
          seenEmails.add(String(p.email));
          if (await sendEmail(String(p.email), subject, html)) officeEmails++;
        }
      }
    } catch (notifyErr) {
      console.error("bid-award office notify error", notifyErr);
    }

    // Climber awarded → ask them to confirm fresh days; the ground call-out
    // opens once they (or the office) confirm. See bid-climber-dates.
    let dispatchResult: unknown = null;
    if (String(winningBid.bid_role ?? "climber") === "climber" && !groundBid) {
      await admin.from("bid_requests").update({
        climber_dates_status: "requested",
        climber_dates_requested_at: new Date().toISOString(),
        climber_dates_reminded_at: null,
        confirmed_dates: [],
      }).eq("id", request.id);
      const c: any = crewMap.get(winningBid.crew_member_id);
      const jobLabel = `${request.title}${where}`;
      if (c?.phone) await sendSms(String(c.phone), `You've got the job: ${jobLabel}. Please confirm the days you can do it: https://app.treecheck.ai/dashboard/crew-bids?job=${request.id}`);
      const { data: cm } = await admin.from("crew_members").select("user_id").eq("id", winningBid.crew_member_id).maybeSingle();
      if (cm?.user_id) await sendPush([cm.user_id], "Confirm your days", jobLabel, { route: `/dashboard/crew-bids?job=${request.id}` });
      dispatchResult = { waiting_on_climber_dates: true };
    }

    return json({
      success: true, sms_sent: sent, office_sms: officeSms, office_emails: officeEmails, ground_dispatch: dispatchResult,
      quote_status: quoteStatusFor(quoteOutcome),
      jobber_quote: { state: quoteOutcome.state, number: "quoteNumber" in quoteOutcome ? quoteOutcome.quoteNumber : null },
    });
  } catch (e) {
    console.error("bid-award error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
