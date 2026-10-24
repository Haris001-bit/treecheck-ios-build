// Returns a short-lived signed URL for a bid request's photo.
// Allowed for the owner of the request and for invited crew members only.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: u, error: authErr } = await admin.auth.getUser(token);
    if (!u?.user) {
      // Signed-out or expired session: no photo, but not a hard failure.
      console.warn("bid-photo-url: unauthenticated", authErr?.message);
      return json({ url: null, error: "Unauthorized" }, 200);
    }

    const body = await req.json().catch(() => ({}));
    const { bid_request_id } = body;
    const batchIds: string[] = Array.isArray(body?.bid_request_ids)
      ? (body.bid_request_ids as unknown[]).filter((x): x is string => typeof x === "string" && !!x).slice(0, 60)
      : [];
    if (!bid_request_id && batchIds.length === 0) return json({ error: "bid_request_id required" }, 400);

    const { data: me } = await admin
      .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
    const ownerId = me?.parent_contractor_id ?? u.user.id;

    const sign = async (p: string, thumb = false): Promise<string | null> => {
      const bucket = p.startsWith("dma/") || p.startsWith("personal/") ? "lead-photos" : "scout-media";
      const opts = thumb ? { transform: { width: 256, height: 256, quality: 60 } } : undefined;
      const { data: signed } = await admin.storage.from(bucket).createSignedUrl(p, 60 * 60, opts);
      if (signed?.signedUrl) return signed.signedUrl;
      const { data: alt } = await admin.storage.from("lead-photos").createSignedUrl(p, 60 * 60, opts);
      return alt?.signedUrl ?? null;
    };

    const isAllowed = async (reqRow: { owner_contractor_id: string; id: string }): Promise<boolean> => {
      if (reqRow.owner_contractor_id === ownerId) return true;
      const { data: recip } = await admin
        .from("bid_request_recipients")
        .select("id, crew_members!inner(user_id, status)")
        .eq("bid_request_id", reqRow.id)
        .eq("crew_members.user_id", u.user.id)
        .maybeSingle();
      if (recip) return true;
      // Ground workers called in on a won job also see the photo.
      const { data: disp } = await admin
        .from("job_dispatch_recipients")
        .select("id, job_dispatches!inner(bid_request_id), crew_members!inner(user_id, status)")
        .eq("job_dispatches.bid_request_id", reqRow.id)
        .eq("crew_members.user_id", u.user.id)
        .maybeSingle();
      return !!disp;
    };

    // Batch mode: one call signs cover + small thumbnail for many jobs at once.
    if (batchIds.length > 0) {
      const { data: rows } = await admin
        .from("bid_requests").select("id, owner_contractor_id, photo_path").in("id", batchIds);
      const results: Record<string, { url: string | null; thumb: string | null }> = {};
      await Promise.all((rows ?? []).map(async (row) => {
        if (!row.photo_path || !(await isAllowed(row))) return;
        const [url, thumb] = await Promise.all([sign(String(row.photo_path)), sign(String(row.photo_path), true)]);
        results[row.id] = { url, thumb };
      }));
      return json({ results });
    }

    const { data: request } = await admin
      .from("bid_requests").select("id, owner_contractor_id, photo_path").eq("id", bid_request_id).maybeSingle();
    if (!request?.photo_path) return json({ error: "No photo" }, 404);

    if (!(await isAllowed(request))) return json({ error: "Forbidden" }, 403);

    const [cover, thumb] = await Promise.all([sign(String(request.photo_path)), sign(String(request.photo_path), true)]);
    if (!cover) return json({ error: "Could not sign photo" }, 400);

    // Multi-tree pruning jobs carry every photo plus per-tree labels/notes.
    const { data: extra } = await admin
      .from("bid_requests").select("photo_paths, trees").eq("id", bid_request_id).maybeSingle();
    const paths: string[] = Array.isArray(extra?.photo_paths) ? (extra!.photo_paths as string[]).slice(0, 24) : [];
    const urls = paths.length > 1 ? await Promise.all(paths.map((p) => sign(String(p)))) : [];
    return json({ url: cover, thumb, urls, trees: Array.isArray(extra?.trees) ? extra!.trees : null });
  } catch (e) {
    console.error("bid-photo-url error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
