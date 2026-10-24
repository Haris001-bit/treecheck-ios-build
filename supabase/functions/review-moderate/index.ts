// Admin queue for reported / held reviews.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("resolve"), review_id: z.string().uuid(), decision: z.enum(["keep", "hide_comment", "remove"]) }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: isAdmin } = await userClient.rpc("is_admin");
    if (!isAdmin) return json({ error: "Admins only" }, 403);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;

    if (body.action === "list") {
      const { data: reports } = await admin.from("review_reports")
        .select("id, review_id, reason, notes, created_at").eq("status", "open").order("created_at", { ascending: false });
      const ids = [...new Set((reports ?? []).map((r: any) => r.review_id))];
      const { data: reviews } = ids.length
        ? await admin.from("reviews").select("*").in("id", ids)
        : { data: [] };
      const userIds = [...new Set((reviews ?? []).flatMap((r: any) => [r.reviewer_user_id, r.reviewee_user_id]))];
      const { data: people } = userIds.length
        ? await admin.from("profiles").select("id, full_name, company_name, email").in("id", userIds)
        : { data: [] };
      const name = (id: string) => {
        const p = (people ?? []).find((x: any) => x.id === id);
        return p?.company_name || p?.full_name || p?.email || "Unknown";
      };
      const items = (reviews ?? []).map((rv: any) => ({
        ...rv,
        reviewer_name: name(rv.reviewer_user_id),
        reviewee_name: name(rv.reviewee_user_id),
        reports: (reports ?? []).filter((r: any) => r.review_id === rv.id),
      }));
      return json({ items });
    }

    const patch =
      body.decision === "keep" ? { status: "published", comment_hidden: false }
      : body.decision === "hide_comment" ? { status: "published", comment_hidden: true }
      : { status: "removed" };
    await admin.from("reviews").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", body.review_id);
    await admin.from("review_reports").update({
      status: "resolved", resolution: body.decision, resolved_at: new Date().toISOString(),
    }).eq("review_id", body.review_id).eq("status", "open");
    return json({ success: true });
  } catch (e) {
    console.error("review-moderate", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
