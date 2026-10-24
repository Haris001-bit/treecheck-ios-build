// Photos for the Scout learning card (App Improvements milestone 4): the weekly report shows each job's photo, as the
// 2026-10-08 scope promised. A photo lives in the folder of whoever took it (often a rep), which the owner's browser
// can't read, so this function signs them: only for jobs in the caller's own report (scout_learning_report, run as
// the caller, decides who may see what), for one hour. It reads and signs, nothing else. Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isUuid } from "../_shared/scoutLearningCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_PHOTOS = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ ok: false, error: "Unauthorized" }, 401);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

  try {
    // The caller's own report, read as the caller: only the jobs it shows them can have their photos signed.
    const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    });
    const { data: report, error } = await asCaller.rpc("scout_learning_report");
    if (error || !report || report.visible !== true) return json({ ok: false, error: "Not available" }, 403);
    const shown = new Set<string>();
    for (const run of (report.scout?.runs ?? []) as { jobs?: { ref?: unknown }[] }[]) {
      for (const j of run.jobs ?? []) if (isUuid(j?.ref)) shown.add(j.ref as string);
    }
    const body = await req.json().catch(() => ({}));
    const wanted = [...new Set((Array.isArray(body?.refs) ? body.refs : []) as unknown[])]
      .filter((r): r is string => isUuid(r) && shown.has(r as string)).slice(0, MAX_PHOTOS);
    if (!wanted.length) return json({ ok: true, photos: {} });

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { data: captures } = await admin.from("scout_captures").select("id, photo_path").in("id", wanted);
    const photos: Record<string, string> = {};
    for (const c of (captures ?? []) as { id: string; photo_path: string | null }[]) {
      if (!c.photo_path) continue;
      const { data } = await admin.storage.from("scout-media").createSignedUrl(c.photo_path, 60 * 60);
      if (data?.signedUrl) photos[c.id] = data.signedUrl;
    }
    return json({ ok: true, photos });
  } catch (e) {
    console.error("scout-learning-photos error", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
