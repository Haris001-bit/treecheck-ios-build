import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VALID_SERVICES = ["Tree Removal", "Stump Grinding", "Pruning/Trimming"];

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
    console.warn("[promote-scout] email not configured; skipping");
    return;
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
  if (!res.ok) console.error("[promote-scout] gmail send failed", res.status, await res.text());
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function row(label: string, value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return `<tr><td style="padding:6px 12px 6px 0;color:#666;font-size:14px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;font-size:14px;color:#111">${esc(value)}</td></tr>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const captureId = body?.capture_id as string | undefined;
    if (!captureId) return json({ error: "capture_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: cap, error: cErr } = await admin
      .from("scout_captures")
      .select("*")
      .eq("id", captureId)
      .maybeSingle();
    if (cErr || !cap) return json({ error: "Capture not found" }, 404);
    const { data: mayReview, error: permissionError } = await userClient.rpc('company_has_permission', { p_owner: cap.owner_id ?? cap.contractor_id, p_permission: 'reviewEstimates' });
    if (permissionError || !mayReview) return json({ error: 'Estimate approval permission required.' }, 403);

    // Authorize: capture owner, submitter, or admin
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const isAdmin = callerProfile?.role === "admin";
    if (cap.owner_id !== userId && cap.contractor_id !== userId && !isAdmin) {
      return json({ error: "Forbidden" }, 403);
    }

    // Idempotent: if already promoted, just return existing
    if (cap.promoted_lead_id) {
      return json({ success: true, lead_id: cap.promoted_lead_id, already: true });
    }

    // Must be approved/edited with a final price + service
    if (cap.status !== "approved" && cap.status !== "edited") {
      return json({ error: "Capture is not approved yet" }, 400);
    }
    const service = cap.final_service ?? cap.ai_service ?? cap.requested_service;
    const jobType = VALID_SERVICES.includes(service) ? service : "Tree Removal";
    const priceMin = Number(cap.final_price_min ?? cap.ai_price_min ?? 0);
    const priceMax = Number(cap.final_price_max ?? cap.ai_price_max ?? priceMin);
    if (!priceMin && !priceMax) return json({ error: "Missing estimate price" }, 400);

    // Copy photo from scout-media → lead-photos (so signed-url flow works unchanged)
    const PLACEHOLDER = "no-photo-placeholder.jpg";
    let photoPath = PLACEHOLDER;
    if (cap.photo_path) {
      try {
        const { data: blob, error: dErr } = await admin.storage
          .from("scout-media")
          .download(cap.photo_path);
        if (dErr || !blob) throw new Error(dErr?.message || "download failed");
        const ext = (cap.photo_path.split(".").pop() || "jpg").toLowerCase();
        const newPath = `scout/${cap.id}.${ext}`;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { error: upErr } = await admin.storage
          .from("lead-photos")
          .upload(newPath, bytes, { contentType: blob.type || "image/jpeg", upsert: true });
        if (upErr) throw upErr;
        photoPath = newPath;
      } catch (e) {
        console.error("[promote-scout] photo copy failed:", e);
      }
    }

    const ownerId = cap.owner_id ?? cap.contractor_id;
    const city = cap.address_city || "Unknown";
    const fullAddress = [
      cap.address_street,
      [cap.address_city, cap.address_state].filter(Boolean).join(", "),
      cap.address_zip,
    ].filter(Boolean).join(" ").trim() || null;

    const { data: lead, error: insErr } = await admin
      .from("leads")
      .insert({
        photo_url: photoPath,
        city,
        customer_name: (cap.customer_name && cap.customer_name.trim()) || "Homeowner",
        customer_phone: cap.customer_phone || "",
        customer_email: cap.customer_email || "",
        customer_address: fullAddress,
        estimated_cost_min: priceMin,
        estimated_cost_max: priceMax || priceMin,
        job_type: jobType,
        urgency: "Flexible",
        status: "available",
        purchase_count: 0,
        source: "scout",
        owner_contractor_id: ownerId,
      })
      .select("id")
      .single();

    if (insErr || !lead) {
      console.error("[promote-scout] lead insert failed", insErr);
      return json({ error: "Failed to create lead" }, 500);
    }

    // Auto $0 purchase so it lands in Your Leads with full PII access
    const { error: pErr } = await admin
      .from("lead_purchases")
      .insert({
        lead_id: lead.id,
        contractor_id: ownerId,
        purchase_amount: 0,
      });
    if (pErr) console.error("[promote-scout] auto-purchase failed", pErr);

    await admin
      .from("scout_captures")
      .update({ promoted_lead_id: lead.id })
      .eq("id", cap.id);

    // Notify the rep who submitted the capture
    try {
      const submitterId = cap.contractor_id;
      if (submitterId) {
        const { data: rep } = await admin
          .from("profiles")
          .select("phone, full_name, email")
          .eq("id", submitterId)
          .maybeSingle();

        const priceText = priceMax && priceMax !== priceMin
          ? `$${priceMin.toLocaleString()}–$${priceMax.toLocaleString()}`
          : `$${priceMin.toLocaleString()}`;
        const where = cap.address_street || cap.address_city || "the property";
        const edited = cap.status === "edited" ? " (with edits)" : "";

        const rawPhone = rep?.phone?.trim();
        if (rawPhone && submitterId !== userId) {
          let phone = rawPhone.replace(/\D/g, "");
          if (phone.length === 10) phone = "+1" + phone;
          else if (!phone.startsWith("+")) phone = "+" + phone;

          const msg = `TreeCheck: Your ${jobType} estimate for ${where} was approved${edited} — ${priceText}. Check your email for the full details.`;

          const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
          const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
          const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");
          if (accountSid && authToken && fromNumber) {
            const tw = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
                },
                body: new URLSearchParams({ To: phone, From: fromNumber, Body: msg }),
              },
            );
            if (!tw.ok) console.error("[promote-scout] twilio failed", await tw.text());
          } else {
            console.warn("[promote-scout] Twilio env not configured; skipping SMS");
          }
        }

        // Full details email to the original Scout submitter
        const repEmail = rep?.email?.trim();
        if (repEmail) {
          const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f6f7f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;color:#7a9b4d;font-weight:bold;letter-spacing:.5px;font-size:12px">TREECHECK SCOUT</p>
    <h1 style="margin:0 0 8px;font-size:20px;color:#111">Estimate approved${esc(edited)}</h1>
    <p style="margin:0 0 20px;font-size:15px;color:#444">Your ${esc(jobType)} capture was approved. Here are the full details.</p>
    <div style="background:#f2f5ee;border-radius:10px;padding:14px 16px;margin-bottom:20px">
      <div style="font-size:13px;color:#666">Approved price</div>
      <div style="font-size:24px;font-weight:bold;color:#3f5227">${esc(priceText)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${row("Job type", jobType)}
      ${row("Status", cap.status === "edited" ? "Approved with edits" : "Approved")}
      ${row("Address", fullAddress)}
      ${row("Client name", cap.customer_name)}
      ${row("Client phone", cap.customer_phone)}
      ${row("Client email", cap.customer_email)}
      ${row("Trunk diameter (in)", cap.diameter_inches)}
      ${row("Trunk circumference (in)", cap.circumference_inches)}
      ${row("Requested service", cap.requested_service)}
      ${row("AI estimate", cap.ai_price_min ? `$${Number(cap.ai_price_min).toLocaleString()}–$${Number(cap.ai_price_max ?? cap.ai_price_min).toLocaleString()}` : "")}
      ${row("Difficulty", cap.ai_difficulty)}
      ${row("Risk", cap.ai_risk)}
      ${row("Your notes", cap.notes_summary || cap.notes_raw)}
      ${row("Estimate notes", cap.final_notes || cap.ai_notes)}
      ${row("Submitted", new Date(cap.created_at).toLocaleString("en-US"))}
    </table>
    <p style="margin:24px 0 0"><a href="https://app.treecheck.ai/dashboard/purchased-leads" style="background:#7a9b4d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;font-size:14px;display:inline-block">Open in TreeCheck</a></p>
  </div>
</body></html>`;
          await sendEmail(
            repEmail,
            `Approved: ${jobType} — ${priceText}${cap.address_street ? ` (${cap.address_street})` : ""}`,
            html,
          );
        } else {
          console.log("[promote-scout] submitter has no email on file; skipping email");
        }
      }
    } catch (e) {
      console.error("[promote-scout] submitter notification failed", e);
    }

    return json({ success: true, lead_id: lead.id });
  } catch (e) {
    console.error("promote-scout-to-lead error", e);
    return json({ error: String(e) }, 500);
  }
});
