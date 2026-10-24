// Admin-only one-shot seeder for the App Review demo account.
// Creates (or updates) appreview@treecheck.com with a known password, marks
// the email confirmed, ensures a contractor profile, a service area, and 3
// sample already-owned leads (including one Scout-originated). No payments.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const REVIEWER_EMAIL = "appreview@treecheck.com";
const REVIEWER_PASSWORD = "Kfidid94#";

const SAMPLE_LEADS = [
  {
    customer_name: "Sarah Mitchell",
    customer_phone: "+14055550101",
    customer_email: "sarah.mitchell+demo@treecheck.com",
    customer_address: "1820 NW 24th St, Oklahoma City, OK 73106",
    city: "Oklahoma City",
    job_type: "Tree Removal",
    urgency: "Within 2 weeks",
    estimated_cost_min: 850,
    estimated_cost_max: 1450,
    source: "treecheck",
    photo_url:
      "https://images.unsplash.com/photo-1518604666860-9ed391f76460?w=1200&q=80",
  },
  {
    customer_name: "James Carter",
    customer_phone: "+14055550102",
    customer_email: "james.carter+demo@treecheck.com",
    customer_address: "3411 N Western Ave, Oklahoma City, OK 73118",
    city: "Oklahoma City",
    job_type: "Stump Grinding",
    urgency: "Flexible",
    estimated_cost_min: 220,
    estimated_cost_max: 380,
    source: "treecheck",
    photo_url:
      "https://images.unsplash.com/photo-1610847499832-918a1c3c6811?w=1200&q=80",
  },
  {
    customer_name: "Priya Desai",
    customer_phone: "+14055550103",
    customer_email: "priya.desai+demo@treecheck.com",
    customer_address: "5600 N May Ave, Oklahoma City, OK 73112",
    city: "Oklahoma City",
    job_type: "Pruning/Trimming",
    urgency: "This week",
    estimated_cost_min: 425,
    estimated_cost_max: 675,
    source: "scout",
    photo_url:
      "https://images.unsplash.com/photo-1444930694458-01babe71870d?w=1200&q=80",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is an admin
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub;

    const admin = createClient(url, service);
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .maybeSingle();
    if (callerProfile?.role !== "admin") {
      return json({ error: "Admin only" }, 403);
    }

    // 1. Find or create reviewer auth user
    let reviewerId: string | null = null;
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === REVIEWER_EMAIL);
    if (existing) {
      reviewerId = existing.id;
      // Reset password + ensure confirmed
      await admin.auth.admin.updateUserById(existing.id, {
        password: REVIEWER_PASSWORD,
        email_confirm: true,
      });
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: REVIEWER_EMAIL,
        password: REVIEWER_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "App Review Demo" },
      });
      if (createErr || !created.user) {
        return json({ error: createErr?.message ?? "create failed" }, 500);
      }
      reviewerId = created.user.id;
    }

    // 2. Upsert profile
    await admin.from("profiles").upsert(
      {
        id: reviewerId,
        email: REVIEWER_EMAIL,
        full_name: "App Review Demo",
        company_name: "TreeCheck App Review",
        phone: "+14055550100",
        role: "contractor",
        is_active: true,
        subscription_tier: "free",
      },
      { onConflict: "id" },
    );

    // 3. Ensure service area
    const { data: existingArea } = await admin
      .from("service_areas")
      .select("id")
      .eq("contractor_id", reviewerId)
      .eq("city", "Oklahoma City")
      .maybeSingle();
    if (!existingArea) {
      await admin.from("service_areas").insert({
        contractor_id: reviewerId,
        city: "Oklahoma City",
        region: "OK",
      });
    }

    // 4. Seed sample leads owned by reviewer (idempotent by customer_email)
    const insertedLeads: string[] = [];
    for (const lead of SAMPLE_LEADS) {
      const { data: existingLead } = await admin
        .from("leads")
        .select("id")
        .eq("customer_email", lead.customer_email)
        .maybeSingle();
      if (existingLead) {
        await admin
          .from("leads")
          .update({ owner_contractor_id: reviewerId, status: "available" })
          .eq("id", existingLead.id);
        insertedLeads.push(existingLead.id);
      } else {
        const { data: newLead, error: insErr } = await admin
          .from("leads")
          .insert({
            ...lead,
            owner_contractor_id: reviewerId,
            status: "available",
            purchase_count: 0,
            is_sample: true,
          })
          .select("id")
          .single();
        if (insErr) continue;
        if (newLead) insertedLeads.push(newLead.id);
      }
    }

    return json({
      ok: true,
      reviewer_id: reviewerId,
      email: REVIEWER_EMAIL,
      leads_seeded: insertedLeads.length,
      lead_ids: insertedLeads,
    });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
