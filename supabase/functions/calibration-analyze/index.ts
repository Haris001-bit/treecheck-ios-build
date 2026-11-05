// Scout calibration photo reader. Every calibration detail comes from the Scout webhook (n8n), the same AI and the
// same fields live Scout sends (photos, address, service, trunk size, cleaned notes, company guidance).
// Its answer goes to calibration-estimate-callback, which saves the reading only: never texts anyone, never creates
// jobs or Scout learning rows, and never keeps the price.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { activeGuidance } from "../_shared/scoutLearning.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const N8N_WEBHOOK = "https://treecheck.app.n8n.cloud/webhook/scout-tree-automation";
const SIGNED_SECONDS = 60 * 60 * 24; // same as live Scout

// Owners don't enter an address for calibration (Mark, 2026-10-29). The Scout webhook needs one, so a fixed
// stand-in goes in the same address field. It is never shown to the owner and never saved on the calibration.
export const CALIBRATION_STAND_IN_ADDRESS = { street: "24 E 1st St", city: "Edmond", state: "OK", zip: "73034" };

const Body = z.object({
  photos: z.array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,/)).min(1).max(3),
  hints: z.string().max(1000).nullable().optional(),
  circumferenceInches: z.number().positive().max(700).nullable().optional(),
});

// Same clean-up live Scout (scout-submit) gives field notes before they go to the webhook.
async function cleanNotes(raw: string): Promise<string> {
  const notes = raw.trim();
  if (!notes) return "";
  try {
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!aiKey) return notes;
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You clean up rough field notes from a tree-service estimator into ONE short, simple paragraph (2-4 sentences). STRICT RULES: Do NOT assume, infer, guess, or invent ANY detail that is not explicitly stated in the notes. If something is unclear, garbled, ambiguous, or not understandable, OMIT it entirely — do not try to interpret it. Only include facts that are clearly stated. NEVER identify, guess, or name the tree species (e.g. oak, maple, pine) — even if the notes mention or hint at one, omit the species entirely. No bullet points, no headings, no fluff, no filler. If nothing is clearly understandable, return an empty string." },
          { role: "user", content: notes },
        ],
      }),
    });
    if (!res.ok) return notes;
    const j = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() || notes;
  } catch {
    return notes;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = authData.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const raw = await req.json().catch(() => ({}));
    // Any address an older screen sends is ignored; calibration always uses the hidden stand-in.
    const parsed = Body.safeParse({ photos: raw?.photos, hints: raw?.hints ?? null, circumferenceInches: raw?.circumferenceInches ?? null });
    if (!parsed.success) return json({ error: "Add 1 to 3 photos of the tree." }, 400);

    const { data: me } = await admin.from("profiles").select("id, parent_contractor_id, role").eq("id", user.id).maybeSingle();
    const ownerId = me?.parent_contractor_id ?? user.id;
    if (!(me?.role === "admin" || me?.role === "contractor" || me?.parent_contractor_id)) return json({ error: "Forbidden" }, 403);

    const { hints, circumferenceInches } = parsed.data;
    const address = CALIBRATION_STAND_IN_ADDRESS;
    const { data: row, error: insErr } = await admin.from("production_calibrations")
      .insert({
        contractor_id: ownerId,
        owner_hints: { text: hints || null, circumference_inches: circumferenceInches ?? null },
        status: "draft",
      })
      .select("id").single();
    if (insErr) throw insErr;

    const paths: string[] = [];
    const signed: string[] = [];
    for (let i = 0; i < parsed.data.photos.length; i++) {
      const [meta, b64] = parsed.data.photos[i].split(",");
      const ext = meta.includes("png") ? "png" : meta.includes("webp") ? "webp" : "jpg";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // Same bucket and file names as a live Scout photo (scout-submit).
      const path = i === 0 ? `${user.id}/${row.id}/photo.${ext}` : `${user.id}/${row.id}/photo-${i + 1}.${ext}`;
      const { error: upErr } = await admin.storage.from("scout-media").upload(path, bytes, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: true });
      if (upErr) throw upErr;
      paths.push(path);
      const { data: s } = await admin.storage.from("scout-media").createSignedUrl(path, SIGNED_SECONDS);
      if (s?.signedUrl) signed.push(s.signedUrl);
    }
    await admin.from("production_calibrations").update({ photo_paths: paths }).eq("id", row.id);

    const notesSummary = await cleanNotes(hints ?? "");
    // Company guidance exactly as live Scout gets it; calibration never records Scout learning rows.
    const learning = await activeGuidance(admin, ownerId, "scout");
    const diameterInches = circumferenceInches ? Number((circumferenceInches / Math.PI).toFixed(2)) : null;

    const payload = {
      capture_id: row.id,
      photo_url: signed[0] ?? null,
      photo_urls: signed,
      voice_memo_url: null,
      notes_summary: notesSummary || null,
      service: "Tree Removal",
      circumference_inches: circumferenceInches ?? null,
      diameter_inches: diameterInches,
      address: { ...address, full: `${address.street}, ${address.city}, ${address.state} ${address.zip}` },
      // Same callback as live Scout; it spots calibration ids and only saves the reading (no texts, no learning rows).
      callback_url: `${supabaseUrl}/functions/v1/scout-estimate-callback?src=scout`,
      submitted_at: new Date().toISOString(),
      company_guidance: learning.block,
    };

    let sent = false;
    try {
      const n8nRes = await fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Scout-Secret": Deno.env.get("SCOUT_WEBHOOK_SECRET") ?? "" },
        body: JSON.stringify(payload),
      });
      sent = n8nRes.ok;
      if (!n8nRes.ok) console.error("calibration-analyze n8n non-OK", n8nRes.status, (await n8nRes.text()).slice(0, 300));
    } catch (e) {
      console.error("calibration-analyze n8n failed", e);
    }
    if (!sent) return json({ error: "Scout couldn't take these photos right now. Try again in a minute.", calibration_id: row.id }, 502);
    await admin.from("production_calibrations").update({ webhook_requested_at: new Date().toISOString() }).eq("id", row.id);
    return json({ calibration_id: row.id, ai: null, webhook_pending: true });
  } catch (e) {
    console.error("calibration-analyze", e);
    return json({ error: "Something went wrong sending the photos to Scout." }, 500);
  }
});
