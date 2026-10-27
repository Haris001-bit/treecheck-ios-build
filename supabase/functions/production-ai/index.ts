// Large-company setup: the AI reads things for people, it never prices. import_sheet turns a company's price sheet
// (pasted text, photos of its pages, or a PDF) into a draft rate card plus findings for an admin to settle; nothing is
// saved here. analyze_tree stores a tree's photos and voice memo in the salesperson's own storage folder, transcribes
// the memo, and returns facts with a confidence each (the company's rules set the price). Never texts anyone, never
// calls n8n or Scout's workflow. Maintained outside Lovable.
import { z } from "npm:zod@3";
import { productionCaller, productionEligible, productionCors, productionJson, todayIso, effectiveCard, MEDIA_BUCKET } from "../_shared/productionAccess.ts";
import { callResponses } from "../_shared/aiResponses.ts";
import { IMPORT_SCHEMA, normalizeImport, type ImportedSheet } from "../_shared/production/importSheet.ts";
import { parseDefinition } from "../_shared/production/rules.ts";
import { starterDefinition } from "../_shared/production/starter.ts";
import { aiSchema, AI_FACTS } from "../_shared/production/aiFacts.ts";
import { isOffered } from "../_shared/production/pricing.ts";

const MODEL = "openai/gpt-6-astra";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("import_sheet"),
    text: z.string().max(60_000).optional(),
    images: z.array(z.string().max(4_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/)).max(10).optional(),
    pdf: z.string().max(12_000_000).regex(/^data:application\/pdf;base64,/).optional(),
  }),
  z.object({
    action: z.literal("analyze_tree"),
    estimateKey: z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/),
    treeKey: z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/),
    photos: z.array(z.string().max(4_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/)).max(4).default([]),
    voice: z.string().max(11_000_000).regex(/^data:audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|aac)(;[^,]*)?;base64,/).optional(),
    notes: z.string().max(2000).optional(),
  }),
]);

const IMPORT_PROMPT = `You read a tree-care company's price sheet and fill the schema with its pricing rules.
- Copy numbers exactly as written. Never invent, round or average a price. When something isn't on the sheet, use null.
- One entry per service. Pick the kind that matches how the sheet prices it: per_unit (a price per item, such as per cable), first_additional (the first item, then each extra), threshold (one price up to a size, another above it), measurement (a price per inch or foot of something measured, such as stump diameter), time_block (a price per block of minutes), per_dbh (per inch of trunk diameter, with a per-tree minimum), matrix (a table by type and size), height (per foot of tree height), crew_time (crew hours or day rates), recurring_plan (memberships with an initial and a monthly payment), fixed (one price), manual (anything else).
- A range such as "$5 to $10" goes in range_low and range_high with the condition it applies to. Never pick a value inside a range.
- sell_months: the months a service may be sold, only if the sheet limits them. not_offered: true when the sheet says the company doesn't offer it.
- crew_pricing: the target revenue per man-hour, the normal day length in hours, full-day prices by crew size, and any job minimum.
- playbook_hints: steps the sheet ties to kinds of work (utility contact for a safety trim, a line drop, an OKIE locate, checking or ordering cable or brace materials, renting an AirSpade, booking a crane or grapple truck, ASAP or priority scheduling, getting the gate code).
- discounts and payment_plans: every version the sheet gives, even when two disagree.
- conflicts: every place the sheet contradicts itself (two prices for the same thing, a full-day price that doesn't match the hourly target, two discount or payment rules), each with a short quote.
- quote fields: the exact words from the sheet the entry came from.
- Never include customer names, phone numbers or addresses.`;

const TREE_PROMPT = `You help a tree-care salesperson write an estimate. From the photos and the salesperson's notes or voice memo, fill in the facts about the tree or trees in this visit.
- For every fact give a value and a confidence from 0 to 1. Use null with confidence 0 when you can't tell. Never guess to fill a fact.
- crew_size and duration_hours only when the salesperson says them.
- services: which of the allowed services this visit includes, from what you see and what the salesperson says.
- One entry in trees per tree the salesperson talks about; usually one.
- Never give a price. Don't name people, read house numbers or license plates, or include addresses.`;

const bytesOf = (dataUrl: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(dataUrl.split(",")[1] ?? "");
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const mimeOf = (dataUrl: string) => dataUrl.slice(5, dataUrl.indexOf(";"));

async function transcribe(apiKey: string, audio: Uint8Array<ArrayBuffer>, ext: string): Promise<string> {
  const form = new FormData();
  form.append("model", "openai/gpt-4o-transcribe");
  form.append("file", new Blob([audio]), `memo.${ext}`);
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  const text = await resp.text();
  if (!resp.ok) { console.error("production-ai transcribe", resp.status, text.slice(0, 300)); return ""; }
  try { return String((JSON.parse(text) as { text?: string }).text ?? "").trim().slice(0, 4000); } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: productionCors });
  if (req.method !== "POST") return productionJson({ error: "Method not allowed" }, 405);
  try {
    const caller = await productionCaller(req);
    if (!caller) return productionJson({ error: "Please sign in again." }, 401);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return productionJson({ error: "That request wasn't understood. Refresh and try again." }, 400);
    const body = parsed.data;

    if (body.action === "import_sheet") {
      if (!(await caller.can("setup")) || !(await productionEligible(caller))) {
        return productionJson({ error: "Only someone who sets up the company's pricing can import a price sheet." }, 403);
      }
      const text = body.text?.trim() ?? "";
      const images = body.images ?? [];
      if (!text && !images.length && !body.pdf) return productionJson({ error: "Paste the price sheet's text, or add photos of its pages." }, 400);
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) return productionJson({ error: "The AI isn't set up for this project." }, 500);

      // The company's current draft (crews, profiles, policies) is the base the sheet is mapped onto.
      const { data: draft } = await caller.admin.from("production_rate_cards").select("definition")
        .eq("contractor_id", caller.ownerId).eq("status", "draft").is("branch_key", null).maybeSingle();
      const current = draft ? parseDefinition(draft.definition) : null;
      const base = current && current.kind === "ok" ? current.def : starterDefinition();

      const content: unknown[] = [{ type: "input_text", text: text ? `${IMPORT_PROMPT}\n\nThe price sheet's text:\n${text}` : IMPORT_PROMPT }];
      for (const url of images) content.push({ type: "input_image", image_url: url });
      if (body.pdf) content.push({ type: "input_file", filename: "price-sheet.pdf", file_data: body.pdf });

      const r = await callResponses({
        apiKey, model: MODEL, name: "price_sheet", schema: IMPORT_SCHEMA, content, effort: "medium",
        unreadable: body.pdf ? "That PDF couldn't be read. Add photos of its pages or paste the text instead." : "The sheet couldn't be read. Try clearer photos, or paste the text.",
      });
      if (r.kind === "error") return productionJson({ error: r.message }, r.status);
      const n = normalizeImport(r.value as ImportedSheet, base);
      return productionJson({ ok: true, definition: n.def, findings: n.findings, warnings: n.warnings });
    }

    if (body.action === "analyze_tree") {
      if (!(await caller.can("price")) || !(await productionEligible(caller))) {
        return productionJson({ error: "Only salespeople and the office can use this." }, 403);
      }
      if (!body.photos.length && !body.voice && !body.notes?.trim()) return productionJson({ error: "Add a photo, a voice memo or a note first." }, 400);
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) return productionJson({ error: "The AI isn't set up for this project." }, 500);
      const card = await effectiveCard(caller.admin, caller.ownerId, todayIso());
      const def0 = card ? parseDefinition(card.definition) : null;
      if (!def0 || def0.kind === "invalid") return productionJson({ error: "Publish a rate card first (Settings, Crews and pricing)." }, 409);
      const services = def0.def.services.filter((s) => isOffered(s, todayIso()).kind === "ok");

      // Files go in the salesperson's own folder, the way scout-submit stores Scout media.
      const folder = `${caller.userId}/production/${body.estimateKey}/${body.treeKey}`;
      const photoPaths: string[] = [];
      for (let i = 0; i < body.photos.length; i++) {
        const mime = mimeOf(body.photos[i]);
        const ext = mime.endsWith("png") ? "png" : mime.endsWith("webp") ? "webp" : "jpg";
        const path = `${folder}/photo-${Date.now()}-${i}.${ext}`;
        const { error } = await caller.admin.storage.from(MEDIA_BUCKET).upload(path, bytesOf(body.photos[i]), { contentType: mime, upsert: false });
        if (error) throw new Error(`photo upload failed: ${error.message}`);
        photoPaths.push(path);
      }
      let voicePath: string | null = null;
      let transcript = "";
      if (body.voice) {
        const mime = mimeOf(body.voice);
        const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
        const audio = bytesOf(body.voice);
        voicePath = `${folder}/voice-${Date.now()}.${ext}`;
        const { error } = await caller.admin.storage.from(MEDIA_BUCKET).upload(voicePath, audio, { contentType: mime.split(";")[0], upsert: false });
        if (error) throw new Error(`voice upload failed: ${error.message}`);
        transcript = await transcribe(apiKey, audio, ext);
      }

      const said = [
        body.notes?.trim() ? `Salesperson's notes: ${body.notes.trim()}` : "",
        transcript ? `Salesperson's voice memo: ${transcript}` : "",
      ].filter(Boolean).join("\n");
      const allowedList = services.map((s) => `${s.key} (${s.name})`).join(", ");
      const content: unknown[] = [{ type: "input_text", text: `${TREE_PROMPT}\nAllowed services: ${allowedList}${said ? `\n${said}` : ""}` }];
      for (const url of body.photos) content.push({ type: "input_image", image_url: url });
      const r = await callResponses({
        apiKey, model: MODEL, name: "tree_facts", schema: aiSchema(services), content, effort: "low",
        unreadable: "The AI couldn't read these photos. Fill the answers in by hand.",
      });
      if (r.kind === "error") return productionJson({ error: r.message, photoPaths, voicePath, transcript }, r.status);
      const allowed = new Set(services.map((s) => s.key));
      const keys = new Set(AI_FACTS.map((f) => f.key));
      type RawTree = { label?: string; services?: string[]; facts?: Record<string, { value?: unknown; confidence?: unknown } | null>; observations?: string };
      const trees = (((r.value as { trees?: RawTree[] })?.trees ?? []) as RawTree[]).slice(0, 10).map((t) => ({
        label: String(t.label ?? "").slice(0, 60),
        services: (t.services ?? []).filter((k) => allowed.has(k)),
        facts: Object.fromEntries(Object.entries(t.facts ?? {}).filter(([k]) => keys.has(k))
          .map(([k, v]) => [k, { value: v?.value ?? null, confidence: Math.max(0, Math.min(1, Number(v?.confidence) || 0)) }])),
        observations: String(t.observations ?? "").slice(0, 1000),
      }));
      return productionJson({ ok: true, photoPaths, voicePath, transcript, trees });
    }
    return productionJson({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("production-ai error", String((e as Error)?.message ?? e).slice(0, 300));
    return productionJson({ error: "Something went wrong. Try again." }, 500);
  }
});
