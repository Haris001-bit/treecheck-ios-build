// Internal Scout calibration photo reader. Never texts anyone, never creates jobs, never calls n8n.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

const Body = z.object({
  photos: z.array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,/)).min(1).max(4),
  hints: z.string().max(1000).nullable().optional(),
});

const conf = { type: "string", enum: ["high", "medium", "low", "unknown"] };
const field = (valueSchema: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, required: ["value", "confidence"],
  properties: { value: valueSchema, confidence: conf },
});
const nNum = { type: ["number", "null"] };
const nBool = { type: ["boolean", "null"] };
const nEnum = (vals: string[]) => ({ type: ["string", "null"], enum: [...vals, null] });
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["dbh_inches", "height_ft", "canopy_dense", "multiple_leaders", "condition", "near_structure", "access", "drop_zone", "power_lines", "crane_indicated", "loads", "tree_count", "observations"],
  properties: {
    dbh_inches: field(nNum), height_ft: field(nNum), canopy_dense: field(nBool), multiple_leaders: field(nBool),
    condition: field(nEnum(["healthy", "declining", "dead"])), near_structure: field(nBool),
    access: field(nEnum(["easy", "moderate", "tight"])), drop_zone: field(nEnum(["open", "restricted"])),
    power_lines: field(nBool), crane_indicated: field(nBool), loads: field(nNum), tree_count: field(nNum),
    observations: { type: "array", items: { type: "string" } },
  },
};

const PROMPT = `You are Scout, reviewing photos of a tree-removal job a tree company already completed.
Estimate the job characteristics before work began. For every field return a value and a confidence.
If a field cannot be judged from the photos, return value null with confidence "unknown". Never guess to fill a field.
Do not name or guess the tree species. Give 2-5 short, factual observations.
dbh_inches = trunk diameter at chest height. loads = chip-truck debris loads. drop_zone "restricted" if targets prevent free felling.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = authData.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Add 1 to 4 photos (JPG, PNG, or WebP)." }, 400);

    const { data: me } = await admin.from("profiles").select("id, parent_contractor_id, role").eq("id", user.id).maybeSingle();
    const ownerId = me?.parent_contractor_id ?? user.id;
    if (!(me?.role === "admin" || me?.role === "contractor" || me?.parent_contractor_id)) return json({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI is not configured" }, 500);

    // Create the calibration record and store photos.
    const { data: row, error: insErr } = await admin.from("production_calibrations")
      .insert({ contractor_id: ownerId, owner_hints: parsed.data.hints ? { text: parsed.data.hints } : null, status: "draft" })
      .select("id").single();
    if (insErr) throw insErr;

    const paths: string[] = [];
    const signed: string[] = [];
    for (let i = 0; i < parsed.data.photos.length; i++) {
      const [meta, b64] = parsed.data.photos[i].split(",");
      const ext = meta.includes("png") ? "png" : meta.includes("webp") ? "webp" : "jpg";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `calibration/${ownerId}/${row.id}/${i}.${ext}`;
      const { error: upErr } = await admin.storage.from("lead-photos").upload(path, bytes, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: true });
      if (upErr) throw upErr;
      paths.push(path);
      const { data: s } = await admin.storage.from("lead-photos").createSignedUrl(path, 600);
      if (s?.signedUrl) signed.push(s.signedUrl);
    }
    await admin.from("production_calibrations").update({ photo_paths: paths }).eq("id", row.id);

    const content: unknown[] = [{ type: "input_text", text: `${PROMPT}${parsed.data.hints ? `\nOwner notes (may help): ${parsed.data.hints}` : ""}` }];
    for (const url of signed) content.push({ type: "input_image", image_url: url });

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "job_characteristics", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => "");
      console.error("calibration-analyze gateway", res.status, msg.slice(0, 500));
      const friendly = res.status === 402 ? "AI credits are used up. Add credits to keep analyzing photos."
        : res.status === 429 ? "Scout is busy. Try again in a minute." : "Scout couldn't read these photos.";
      return json({ error: friendly, calibration_id: row.id }, res.status === 402 || res.status === 429 ? res.status : 502);
    }

    // Consume SSE stream.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = ""; let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
          if (ev.type === "response.failed" || ev.type === "error") console.error("calibration-analyze stream", data.slice(0, 300));
        } catch { /* ignore partial */ }
      }
    }

    let ai: unknown = null;
    try { ai = JSON.parse(text); } catch { ai = null; }
    if (!ai) return json({ error: "Scout couldn't read these photos. You can still fill in the details yourself.", calibration_id: row.id }, 200);

    await admin.from("production_calibrations").update({ ai_characteristics: ai, ai_model: MODEL }).eq("id", row.id);
    return json({ calibration_id: row.id, ai, photo_urls: signed });
  } catch (e) {
    console.error("calibration-analyze", e);
    return json({ error: "Something went wrong analyzing the photos." }, 500);
  }
});
