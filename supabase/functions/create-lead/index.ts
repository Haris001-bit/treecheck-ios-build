import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

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
}

function normalizeEnumValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJobType(value?: string): LeadJobType | null {
  if (!value) return null;
  return JOB_TYPE_ALIASES[normalizeEnumValue(value)] ?? null;
}

function normalizeUrgency(value?: string): LeadUrgency | null {
  if (!value) return null;
  return URGENCY_ALIASES[normalizeEnumValue(value)] ?? null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate webhook secret
  const webhookSecret = Deno.env.get("LEAD_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("LEAD_WEBHOOK_SECRET is not configured");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const providedSecret = req.headers.get("x-webhook-secret");
  if (!providedSecret || providedSecret !== webhookSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse the payload
  let payload: LeadPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate required fields (photo_url is optional — falls back to placeholder)
  const requiredFields = [
    "city",
    "customer_name",
    "customer_email",
    "customer_phone",
    "customer_address",
    "estimated_cost_min",
    "estimated_cost_max",
    "job_type",
  ] as const;

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      return new Response(
        JSON.stringify({ error: `Missing required field: ${field}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  // Validate string lengths
  if (
    typeof payload.customer_name !== "string" || payload.customer_name.length > 200 ||
    typeof payload.customer_email !== "string" || payload.customer_email.length > 320 ||
    typeof payload.customer_phone !== "string" || payload.customer_phone.length > 50 ||
    typeof payload.customer_address !== "string" || payload.customer_address.length > 500 ||
    typeof payload.city !== "string" || payload.city.length > 200 ||
    (payload.photo_url !== undefined && payload.photo_url !== null && payload.photo_url !== "" &&
      (typeof payload.photo_url !== "string" || payload.photo_url.length > 2048)) ||
    typeof payload.job_type !== "string" || payload.job_type.length > 100 ||
    (payload.urgency !== undefined && (typeof payload.urgency !== "string" || payload.urgency.length > 100))
  ) {
    return new Response(
      JSON.stringify({ error: "Field exceeds maximum length or has invalid type" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.customer_email)) {
    return new Response(
      JSON.stringify({ error: "Invalid email format" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate phone format (E.164 or common US formats)
  const phoneRegex = /^\+?[1-9]\d{1,14}$|^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
  if (!phoneRegex.test(payload.customer_phone.trim())) {
    return new Response(
      JSON.stringify({ error: "Invalid phone format" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate photo URL format if provided (otherwise we'll use placeholder)
  const hasPhoto = !!(payload.photo_url && payload.photo_url.trim());
  if (hasPhoto) {
    try {
      const url = new URL(payload.photo_url);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid photo URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Validate numeric fields
  if (
    typeof payload.estimated_cost_min !== "number" ||
    typeof payload.estimated_cost_max !== "number" ||
    payload.estimated_cost_min < 0 ||
    payload.estimated_cost_max < payload.estimated_cost_min ||
    payload.estimated_cost_max > 1000000
  ) {
    return new Response(
      JSON.stringify({
        error: "Invalid cost range: min must be >= 0, max must be >= min and <= 1,000,000",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Normalize and validate job_type
  const jobType = normalizeJobType(payload.job_type);
  if (!jobType) {
    return new Response(
      JSON.stringify({
        error: "Invalid job_type. Use one of: Tree Removal, Stump Grinding, Pruning/Trimming",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Validate urgency if provided
  const urgency = normalizeUrgency(payload.urgency) ?? "Flexible";

  if (normalizeEnumValue(payload.job_type) !== normalizeEnumValue(jobType)) {
    console.log(`[CREATE-LEAD] Normalized job type "${payload.job_type}" -> "${jobType}"`);
  }

  // Create Supabase client with service role for admin access
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Supabase environment variables not configured");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Auto-download external photo into our private lead-photos bucket so the
  // source URL going dead (e.g. WordPress takedown) doesn't break the lead.
  // If no photo provided, use the "Photo Not Provided" placeholder.
  const PLACEHOLDER_PHOTO = "lead-photos/no-photo-placeholder.jpg";
  let storedPhotoUrl = hasPhoto ? payload.photo_url : PLACEHOLDER_PHOTO;
  if (hasPhoto) {
    try {
      const photoResp = await fetch(payload.photo_url, {
        headers: { "User-Agent": "TreeCheckLeadIngest/1.0" },
      });
      if (!photoResp.ok) {
        throw new Error(`Source returned HTTP ${photoResp.status}`);
      }
      const contentType = photoResp.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        throw new Error(`Source returned non-image content-type: ${contentType}`);
      }
      const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
      const objectPath = `ingested/${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await photoResp.arrayBuffer());

      const { error: uploadErr } = await supabase.storage
        .from("lead-photos")
        .upload(objectPath, bytes, { contentType, upsert: false });

      if (uploadErr) {
        throw new Error(`Storage upload failed: ${uploadErr.message}`);
      }
      storedPhotoUrl = objectPath;
      console.log(`[CREATE-LEAD] Photo archived to lead-photos/${objectPath}`);
    } catch (photoErr) {
      console.error("[CREATE-LEAD] Photo archive failed, using placeholder:", photoErr);
      storedPhotoUrl = PLACEHOLDER_PHOTO;
    }
  } else {
    console.log("[CREATE-LEAD] No photo provided — using placeholder");
  }

  // Insert the lead
  const { data, error } = await supabase
    .from("leads")
    .insert({
      photo_url: storedPhotoUrl,
      city: payload.city,
      customer_name: payload.customer_name,
      customer_email: payload.customer_email,
      customer_phone: payload.customer_phone,
      estimated_cost_min: payload.estimated_cost_min,
      estimated_cost_max: payload.estimated_cost_max,
      customer_address: payload.customer_address,
      job_type: jobType,
      urgency: urgency,
      status: "available",
      purchase_count: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error inserting lead:", error);
    return new Response(
      JSON.stringify({ error: "Failed to create lead" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Assign Premium rotation slots (3 members get 60-min early access)
  try {
    // Find all Premium members who serve this city
    const { data: premiumMembers } = await supabase
      .from("service_areas")
      .select("contractor_id, profiles!inner(subscription_tier)")
      .ilike("city", payload.city)
      .in("profiles.subscription_tier", ["premium", "pro"]);

    if (premiumMembers && premiumMembers.length > 0) {
      // Get unique contractor IDs, sorted for stable rotation
      const uniqueIds = [...new Set(premiumMembers.map((m: any) => m.contractor_id))].sort();
      
      // Get current rotation index
      const { data: rotState } = await supabase
        .from("premium_rotation_state")
        .select("next_index")
        .eq("id", 1)
        .single();
      
      let nextIndex = rotState?.next_index || 0;
      
      // Pick up to 3 members starting from the rotation index
      const selectedCount = Math.min(3, uniqueIds.length);
      const selected: string[] = [];
      
      for (let i = 0; i < selectedCount; i++) {
        const idx = (nextIndex + i) % uniqueIds.length;
        selected.push(uniqueIds[idx]);
      }
      
      // Advance rotation index
      const newIndex = (nextIndex + selectedCount) % uniqueIds.length;
      await supabase
        .from("premium_rotation_state")
        .update({ next_index: newIndex, updated_at: new Date().toISOString() })
        .eq("id", 1);
      
      // Insert rotation assignments
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const rotationRows = selected.map((contractorId, i) => ({
        contractor_id: contractorId,
        lead_id: data.id,
        position: i + 1,
        expires_at: expiresAt,
      }));
      
      await supabase.from("premium_rotation").insert(rotationRows);
      
      console.log(`[CREATE-LEAD] Assigned ${selected.length} Premium rotation slots for lead ${data.id}`, {
        selected,
        newIndex,
        totalPremium: uniqueIds.length,
      });
    } else {
      console.log(`[CREATE-LEAD] No Premium members in service area: ${payload.city}`);
    }
  } catch (rotError) {
    // Don't fail the lead creation if rotation assignment fails
    console.error("[CREATE-LEAD] Error assigning rotation:", rotError);
  }

  // Trigger SMS notifications (fire-and-forget)
  try {
    const notifyUrl = `${supabaseUrl}/functions/v1/notify-new-lead`;
    fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        lead_id: data.id,
        city: payload.city,
        estimated_cost_min: payload.estimated_cost_min,
        estimated_cost_max: payload.estimated_cost_max,
      }),
    }).catch((e) => console.error("[CREATE-LEAD] SMS notify error:", e));
  } catch (e) {
    console.error("[CREATE-LEAD] SMS notify setup error:", e);
  }

  return new Response(
    JSON.stringify({
      success: true,
      lead_id: data.id,
      job_type: jobType,
      urgency,
      message: "Lead created successfully",
    }),
    {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
