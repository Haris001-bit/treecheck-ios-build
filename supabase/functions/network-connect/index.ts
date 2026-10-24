// Shared sub network connections.
// Owner: 'request' (add a network sub to my subs), 'favorite'.
// Sub: 'list_requests', 'respond' (accept/decline), 'hide' (hide me from a company).
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { sendSms } from "../_shared/crewRecipients.ts";
import { companyMode } from "../_shared/tcNotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), user_id: z.string().uuid() }),
  z.object({ action: z.literal("favorite"), crew_member_id: z.string().uuid(), value: z.boolean() }),
  z.object({ action: z.literal("list_requests") }),
  z.object({ action: z.literal("respond"), crew_member_id: z.string().uuid(), accept: z.boolean() }),
  z.object({ action: z.literal("hide"), owner_id: z.string().uuid() }),
]);

const COPY_COLS = "user_id, full_name, phone, email, trade, certifications, equipment, insured, wants_ground_work, can_skid_steer, can_chipper, crane_certified, truck_trailer_experience, disposal_runs_ok, owns_saws, has_drivers_license, tree_experience_level, years_climbing, mini_skid_experience";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const me = u.user.id;
    const { data: prof } = await admin.from("profiles").select("parent_contractor_id").eq("id", me).maybeSingle();
    const myOwner = prof?.parent_contractor_id ?? me;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;

    if (body.action === "request") {
      // A sandbox (demo) company never adds or texts real subs.
      if ((await companyMode(admin, myOwner)) === "sandbox") {
        return json({ error: "The demo company can't add subs from the network." });
      }
      const { data: cp } = await admin.from("crew_profiles").select("*").eq("user_id", body.user_id).maybeSingle();
      if (!cp?.network_visible || (cp.hidden_owner_ids ?? []).includes(myOwner)) return json({ error: "That sub isn't available" }, 404);
      const { data: existing } = await admin.from("crew_members")
        .select("id, status").eq("owner_contractor_id", myOwner).eq("user_id", body.user_id).maybeSingle();
      if (existing?.status === "active") return json({ success: true, already: true });
      if (existing) {
        await admin.from("crew_members").update({ status: "requested", source: "network" }).eq("id", existing.id);
      } else {
        const { data: src } = await admin.from("crew_members").select(COPY_COLS)
          .eq("user_id", body.user_id).neq("trade", "pending").order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (!src) return json({ error: "Sub profile not found" }, 404);
        const { error } = await admin.from("crew_members").insert({ ...src, owner_contractor_id: myOwner, status: "requested", source: "network" });
        if (error) return json({ error: error.message }, 400);
      }
      const { data: owner } = await admin.from("profiles").select("company_name, full_name").eq("id", myOwner).maybeSingle();
      const { data: sub } = await admin.from("crew_members").select("phone").eq("user_id", body.user_id).not("phone", "is", null).limit(1).maybeSingle();
      if (sub?.phone) {
        try {
          await sendSms(sub.phone, `TreeCheck: ${owner?.company_name || owner?.full_name || "A tree company"} wants to add you to their subs. Open TreeCheck > Profile to accept or decline. https://app.treecheck.ai/dashboard/profile`);
        } catch (e) { console.warn("sms failed", e); }
      }
      return json({ success: true });
    }

    if (body.action === "favorite") {
      const { data: row } = await admin.from("crew_members").select("owner_contractor_id").eq("id", body.crew_member_id).maybeSingle();
      if (!row || row.owner_contractor_id !== myOwner) return json({ error: "Not your sub" }, 403);
      await admin.from("crew_members").update({ is_favorite: body.value, first_refusal: body.value }).eq("id", body.crew_member_id);
      return json({ success: true });
    }

    if (body.action === "list_requests") {
      const { data: rows } = await admin.from("crew_members")
        .select("id, owner_contractor_id, status").eq("user_id", me).in("status", ["requested", "network", "active"]);
      const ownerIds = [...new Set((rows ?? []).map((r: any) => r.owner_contractor_id))];
      const { data: owners } = ownerIds.length
        ? await admin.from("profiles").select("id, company_name, full_name, company_rating_avg, company_rating_count").in("id", ownerIds)
        : { data: [] };
      return json({
        items: (rows ?? []).map((r: any) => {
          const o = (owners ?? []).find((x: any) => x.id === r.owner_contractor_id);
          return { ...r, company: o?.company_name || o?.full_name || "Company", rating_avg: o?.company_rating_avg ?? null, rating_count: o?.company_rating_count ?? 0 };
        }),
      });
    }

    if (body.action === "respond") {
      const { data: row } = await admin.from("crew_members").select("id, user_id, status").eq("id", body.crew_member_id).maybeSingle();
      if (!row || row.user_id !== me) return json({ error: "Not your request" }, 403);
      await admin.from("crew_members").update({ status: body.accept ? "active" : "inactive" }).eq("id", row.id);
      return json({ success: true });
    }

    // hide
    const { data: cp } = await admin.from("crew_profiles").select("hidden_owner_ids").eq("user_id", me).maybeSingle();
    const hidden = new Set<string>(cp?.hidden_owner_ids ?? []);
    hidden.add(body.owner_id);
    await admin.from("crew_profiles").upsert({ user_id: me, hidden_owner_ids: [...hidden], updated_at: new Date().toISOString() });
    await admin.from("crew_members").update({ status: "inactive" })
      .eq("user_id", me).eq("owner_contractor_id", body.owner_id).in("status", ["network", "requested"]);
    return json({ success: true });
  } catch (e) {
    console.error("network-connect", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
