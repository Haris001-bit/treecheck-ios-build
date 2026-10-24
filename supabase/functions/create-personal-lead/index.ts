import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { activeGuidance, recordWebsiteEstimate } from "../_shared/scoutLearning.ts";
import { websiteFormInputs, withoutLearningFields } from "../_shared/scoutLearningCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

// Per-owner webhook secrets. Each owner has their own secret name in env.
// The matching contractor_id is the lead owner.
// To add a new owner: add an entry here AND add the secret in Supabase secrets.
// `publicMode: true` => leads from this owner are routed to ALL contractors in
// the city as normal public leads (no owner, no auto-purchase, full broadcast).
// Used when the owner temporarily can't take their own leads.
// `alsoAssignTo`: in private mode, also auto-assign the lead to these contractor
// accounts (in addition to the owner), so the same lead appears in both accounts.
// `crewBids`: also open the lead for bids in the owner's crew network
// (photo + description only — crew never see pricing or customer details).
// Off for every other owner so nothing changes for them.
const OWNERS: Array<{ secretName: string; contractorId: string; label: string; publicMode?: boolean; alsoAssignTo?: string[]; crewBids?: boolean }> = [
  {
    secretName: "PERSONAL_LEAD_WEBHOOK_SECRET",
    // mark@timberedmond.com — the Timber Edmond owner account.
    contractorId: "705cecc2-5926-48c1-a728-b3ebd6b920a2",
    label: "Mark Cafiero (Timber Tree Services)",
    // mark@tradesmarketing.ai — same leads also land in this account.
    alsoAssignTo: ["cf93d0f4-9365-4352-b0cb-10ce93646843"],
    crewBids: true,
    // Private mode: Timber leads belong to Mark's accounts, no broadcast.
  },
  {
    secretName: "PERSONAL_LEAD_WEBHOOK_SECRET_CONNER",
    contractorId: "d0e83890-0253-4beb-b71d-d5df571ec716",
    label: "Conner Mercer",
  },
];

function resolveOwnerFromSecret(provided: string): { contractorId: string; label: string; publicMode?: boolean; alsoAssignTo?: string[]; crewBids?: boolean } | null {
  for (const o of OWNERS) {
    const expected = Deno.env.get(o.secretName);
    if (expected && provided === expected) {
      return { contractorId: o.contractorId, label: o.label, publicMode: o.publicMode, alsoAssignTo: o.alsoAssignTo, crewBids: o.crewBids };
    }
  }
  return null;
}

const VALID_JOB_TYPES = ["Tree Removal", "Stump Grinding", "Pruning/Trimming"] as const;
const VALID_URGENCY = ["Emergency", "As soon as possible", "Within a month", "Flexible"] as const;
type LeadJobType = (typeof VALID_JOB_TYPES)[number];
type LeadUrgency = (typeof VALID_URGENCY)[number];

const JOB_TYPE_ALIASES: Record<string, LeadJobType> = {
  "tree removal": "Tree Removal",
  "tree removals": "Tree Removal",
  removal: "Tree Removal",
  pruning: "Pruning/Trimming",
  "tree pruning": "Pruning/Trimming",
  "tree trim": "Pruning/Trimming",
  "tree trimming": "Pruning/Trimming",
  trimming: "Pruning/Trimming",
  "pruning trimming": "Pruning/Trimming",
  "pruning/trimming": "Pruning/Trimming",
  "stump grinding": "Stump Grinding",
};

const URGENCY_ALIASES: Record<string, LeadUrgency> = {
  emergency: "Emergency",
  "as soon as possible": "As soon as possible",
  asap: "As soon as possible",
  "within a month": "Within a month",
  flexible: "Flexible",
};

interface LeadPayload {
  photo_url: string;
  city: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  estimated_cost_min: number;
  estimated_cost_max: number;
  job_type: string;
  urgency?: string;
  /** Optional: whatever the customer wrote about the tree / the job. */
  customer_notes?: string;
  /** Alias accepted for convenience. */
  description?: string;
  message?: string;
  /** Scout learning (optional): the website estimator's own words, as plain text. */
  ai_notes?: string;
  /** Scout learning (optional): the form's sizes and whether there was a photo or notes. */
  form_inputs?: Record<string, unknown>;
  /** Scout learning (optional): which guidance version the estimate used. */
  learning_version?: string;
}

function normalizeEnumValue(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeJobType(v?: string): LeadJobType | null {
  if (!v) return null;
  return JOB_TYPE_ALIASES[normalizeEnumValue(v)] ?? null;
}
function normalizeUrgency(v?: string): LeadUrgency | null {
  if (!v) return null;
  return URGENCY_ALIASES[normalizeEnumValue(v)] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Scout learning: the website estimator asks for its company's guidance before it prices (same secret as a
  // lead). Empty unless the owner turned learning on and Haris switched the website side on.
  if (req.method === "GET" && new URL(req.url).searchParams.get("guidance") === "website") {
    const guidanceOwner = resolveOwnerFromSecret(req.headers.get("x-webhook-secret") ?? "");
    if (!guidanceOwner || guidanceOwner.publicMode) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const guidance = url && key
      ? await activeGuidance(createClient(url, key), guidanceOwner.contractorId, "website")
      : { version_id: null, block: "" };
    return new Response(JSON.stringify(guidance), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const provided = req.headers.get("x-webhook-secret");
  if (!provided) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const owner = resolveOwnerFromSecret(provided);
  if (!owner) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const OWNER_CONTRACTOR_ID = owner.contractorId;

  let payload: LeadPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const required = [
    "city", "customer_name", "customer_email", "customer_phone",
    "customer_address", "estimated_cost_min", "estimated_cost_max", "job_type",
  ] as const;
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null || payload[f] === "") {
      return new Response(JSON.stringify({ error: `Missing required field: ${f}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (
    typeof payload.customer_name !== "string" || payload.customer_name.length > 200 ||
    typeof payload.customer_email !== "string" || payload.customer_email.length > 320 ||
    typeof payload.customer_phone !== "string" || payload.customer_phone.length > 50 ||
    typeof payload.customer_address !== "string" || payload.customer_address.length > 500 ||
    typeof payload.city !== "string" || payload.city.length > 200 ||
    (payload.photo_url !== undefined && payload.photo_url !== null && payload.photo_url !== "" &&
      (typeof payload.photo_url !== "string" || payload.photo_url.length > 2048)) ||
    typeof payload.job_type !== "string" || payload.job_type.length > 100
  ) {
    return new Response(JSON.stringify({ error: "Field exceeds maximum length or invalid type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.customer_email)) {
    return new Response(JSON.stringify({ error: "Invalid email format" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!/^\+?[1-9]\d{1,14}$|^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(payload.customer_phone.trim())) {
    return new Response(JSON.stringify({ error: "Invalid phone format" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Customer's own words about the job (optional). Accept a few field names.
  const customerNotesRaw =
    payload.customer_notes ?? payload.description ?? payload.message ?? null;
  const customerNotes =
    typeof customerNotesRaw === "string" && customerNotesRaw.trim()
      ? customerNotesRaw.trim().slice(0, 4000)
      : null;

  // Stump grinding can arrive many ways from the website form / n8n:
  // a boolean, "Yes", a services list, or just words in the notes.
  console.log(`[CREATE-PERSONAL-LEAD] Payload keys: ${Object.keys(payload ?? {}).join(", ")}`);
  const truthy = (v: unknown): boolean => {
    if (v === true) return true;
    if (typeof v === "number") return v > 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      return !!s && !["no", "false", "0", "none", "n", "n/a", "na", "off"].includes(s);
    }
    if (Array.isArray(v)) return v.some(truthy);
    return false;
  };
  let stumpRequested = false;
  let stumpInches: number | null = null;
  const scan = (obj: unknown, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 3) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (key.startsWith("customer_") && key !== "customer_notes") continue;
      if (/stump/.test(key)) {
        if (/diam|inch|size/.test(key)) {
          const n = parseFloat(String(v));
          if (Number.isFinite(n) && n > 0) { stumpInches = n; stumpRequested = true; }
        } else if (truthy(v)) stumpRequested = true;
      } else if (typeof v === "string" && /stump/i.test(v) && !/no stump|without stump|leave (the )?stump/i.test(v)) {
        stumpRequested = true;
      } else if (Array.isArray(v)) {
        if (v.some((x) => typeof x === "string" && /stump/i.test(x))) stumpRequested = true;
        else v.forEach((x) => scan(x, depth + 1));
      } else if (v && typeof v === "object") scan(v, depth + 1);
    }
  };
  // The learning fields (the estimator's own words, the form's sizes) never count as a stump request.
  scan(withoutLearningFields(payload as unknown as Record<string, unknown>));
  if (stumpRequested) console.log(`[CREATE-PERSONAL-LEAD] Stump grinding requested (${stumpInches ?? "size unknown"})`);

  const hasPhoto = !!(payload.photo_url && payload.photo_url.trim());
  if (hasPhoto) {
    try {
      const u = new URL(payload.photo_url);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad proto");
    } catch {
      return new Response(JSON.stringify({ error: "Invalid photo URL" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (
    typeof payload.estimated_cost_min !== "number" ||
    typeof payload.estimated_cost_max !== "number" ||
    payload.estimated_cost_min < 0 ||
    payload.estimated_cost_max < payload.estimated_cost_min ||
    payload.estimated_cost_max > 1000000
  ) {
    return new Response(JSON.stringify({ error: "Invalid cost range" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobType = normalizeJobType(payload.job_type);
  if (!jobType) {
    return new Response(JSON.stringify({
      error: "Invalid job_type. Use one of: Tree Removal, Stump Grinding, Pruning/Trimming",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const urgency = normalizeUrgency(payload.urgency) ?? "Flexible";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Archive the photo into our private bucket; placeholder if none provided.
  const PLACEHOLDER_PHOTO = "lead-photos/no-photo-placeholder.jpg";
  let storedPhotoUrl = hasPhoto ? payload.photo_url : PLACEHOLDER_PHOTO;
  if (hasPhoto) {
    try {
      const r = await fetch(payload.photo_url, { headers: { "User-Agent": "PersonalLeadIngest/1.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers.get("content-type") || "image/jpeg";
      if (!ct.startsWith("image/")) throw new Error(`non-image: ${ct}`);
      const ext = ct.split("/")[1]?.split(";")[0] || "jpg";
      const path = `personal/${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await r.arrayBuffer());
      const { error: upErr } = await supabase.storage.from("lead-photos")
        .upload(path, bytes, { contentType: ct, upsert: false });
      if (upErr) throw new Error(upErr.message);
      storedPhotoUrl = path;
      console.log(`[CREATE-PERSONAL-LEAD] Photo archived to lead-photos/${path}`);
    } catch (e) {
      console.error("[CREATE-PERSONAL-LEAD] Photo archive failed, using placeholder:", e);
      storedPhotoUrl = PLACEHOLDER_PHOTO;
    }
  } else {
    console.log("[CREATE-PERSONAL-LEAD] No photo provided — using placeholder");
  }

  // If owner is in public mode, insert as a normal public lead (no owner,
  // no auto-purchase) so it broadcasts to all contractors in the city.
  const isPublic = owner.publicMode === true;

  const insertRow: Record<string, unknown> = {
    photo_url: storedPhotoUrl,
    city: payload.city,
    customer_name: payload.customer_name,
    customer_email: payload.customer_email,
    customer_phone: payload.customer_phone,
    customer_address: payload.customer_address,
    estimated_cost_min: payload.estimated_cost_min,
    estimated_cost_max: payload.estimated_cost_max,
    job_type: jobType,
    urgency,
    customer_notes: customerNotes,
    status: "available",
    purchase_count: 0,
    source: isPublic ? `public_from_${owner.label}` : "personal",
  };
  if (!isPublic) {
    insertRow.owner_contractor_id = OWNER_CONTRACTOR_ID;
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert(insertRow)
    .select("id")
    .single();

  if (error || !lead) {
    console.error("[CREATE-PERSONAL-LEAD] Insert error:", error);
    return new Response(JSON.stringify({ error: "Failed to create lead" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (isPublic) {
    // Public-mode: run the same Premium rotation + broadcast SMS as create-lead.
    try {
      const { data: premiumMembers } = await supabase
        .from("service_areas")
        .select("contractor_id, profiles!inner(subscription_tier)")
        .ilike("city", payload.city)
        .in("profiles.subscription_tier", ["premium", "pro"]);

      if (premiumMembers && premiumMembers.length > 0) {
        const uniqueIds = [...new Set(premiumMembers.map((m: any) => m.contractor_id))].sort();
        const { data: rotState } = await supabase
          .from("premium_rotation_state").select("next_index").eq("id", 1).single();
        const nextIndex = rotState?.next_index || 0;
        const selectedCount = Math.min(3, uniqueIds.length);
        const selected: string[] = [];
        for (let i = 0; i < selectedCount; i++) {
          selected.push(uniqueIds[(nextIndex + i) % uniqueIds.length]);
        }
        const newIndex = (nextIndex + selectedCount) % uniqueIds.length;
        await supabase.from("premium_rotation_state")
          .update({ next_index: newIndex, updated_at: new Date().toISOString() }).eq("id", 1);
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabase.from("premium_rotation").insert(
          selected.map((contractorId, i) => ({
            contractor_id: contractorId, lead_id: lead.id, position: i + 1, expires_at: expiresAt,
          }))
        );
        console.log(`[CREATE-PERSONAL-LEAD][public] Premium rotation: ${selected.length} slots for ${lead.id}`);
      }
    } catch (rotErr) {
      console.error("[CREATE-PERSONAL-LEAD][public] Rotation error:", rotErr);
    }

    // Broadcast SMS to all contractors serving the city.
    try {
      fetch(`${supabaseUrl}/functions/v1/notify-new-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({
          lead_id: lead.id,
          city: payload.city,
          estimated_cost_min: payload.estimated_cost_min,
          estimated_cost_max: payload.estimated_cost_max,
        }),
      }).catch((e) => console.error("[CREATE-PERSONAL-LEAD][public] SMS notify error:", e));
    } catch (e) {
      console.error("[CREATE-PERSONAL-LEAD][public] SMS notify setup error:", e);
    }

    console.log(`[CREATE-PERSONAL-LEAD] Public-mode lead ${lead.id} from ${owner.label} broadcast to city=${payload.city}`);
  } else {
    // Private-mode: auto-purchase to owner (and any extra accounts) so it
    // lands in each account's Purchased Leads.
    const assignees = [OWNER_CONTRACTOR_ID, ...(owner.alsoAssignTo ?? [])];
    for (const contractorId of assignees) {
      const { error: purchaseErr } = await supabase
        .from("lead_purchases")
        .insert({ lead_id: lead.id, contractor_id: contractorId, purchase_amount: 0 });
      if (purchaseErr) {
        console.error(`[CREATE-PERSONAL-LEAD] Auto-purchase failed for ${contractorId}:`, purchaseErr);
      }
    }
    console.log(`[CREATE-PERSONAL-LEAD] Created personal lead ${lead.id} for ${assignees.length} account(s): ${assignees.join(", ")}`);

    // Scout learning: keep what the website estimate was based on, once per lead (best effort).
    if (payload.ai_notes !== undefined || payload.form_inputs !== undefined || payload.learning_version !== undefined) {
      await recordWebsiteEstimate(supabase, {
        leadId: lead.id,
        companyId: OWNER_CONTRACTOR_ID,
        priceMin: payload.estimated_cost_min,
        priceMax: payload.estimated_cost_max,
        notes: payload.ai_notes,
        formInputs: websiteFormInputs(payload.form_inputs),
        versionId: payload.learning_version,
      });
    }

    // Also open the job for crew bids when the owner has that switched on.
    // Crew only ever get photo + description + city — never price or customer.
    try {
      const { data: ownerProfile } = await supabase
        .from("profiles").select("crew_auto_broadcast").eq("id", OWNER_CONTRACTOR_ID).maybeSingle();
      const crewEnabled = ownerProfile
        ? ownerProfile.crew_auto_broadcast === true
        : owner.crewBids === true;
      if (crewEnabled) {
        const crewDescription = [
          `${jobType} in ${payload.city}.`,
          urgency ? `Customer timeline: ${urgency}.` : null,
          customerNotes ? `What the customer told us: ${customerNotes}` : null,
        ].filter(Boolean).join("\n\n");

        const r = await fetch(`${supabaseUrl}/functions/v1/bid-request-create`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({
            owner_contractor_id: OWNER_CONTRACTOR_ID,
            lead_id: lead.id,
            title: `${jobType}${payload.city ? ` — ${payload.city}` : ""}`,
            description: crewDescription,
            city: payload.city,
            photo_path: /^https?:/i.test(String(storedPhotoUrl)) ? null : storedPhotoUrl,
            deadline_hours: 48,
            job_type: jobType,
            needs_stump_grinding: stumpRequested || /stump/i.test(String(jobType)),
            // 0 / blank means "not measured" — let grinders see it.
            stump_diameter_inches: stumpInches ?? null,
          }),
        });
        const body = await r.json().catch(() => ({}));
        console.log(`[CREATE-PERSONAL-LEAD] Crew bid request: ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
      }
    } catch (crewErr) {
      console.error("[CREATE-PERSONAL-LEAD] Crew bid request failed:", crewErr);
    }
  }


  return new Response(JSON.stringify({
    success: true,
    lead_id: lead.id,
    source: isPublic ? "public" : "personal",
    owner_contractor_id: isPublic ? null : OWNER_CONTRACTOR_ID,
    job_type: jobType,
    urgency,
    message: isPublic
      ? "Lead created and broadcast to all contractors in the city"
      : "Personal lead created and auto-assigned to owner",
  }), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
