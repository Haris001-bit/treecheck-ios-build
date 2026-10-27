// Large-company setup: publishing a rate card. Refuses while any blocking contradiction is open or the past-job check
// is missing (unless the owner gives a reason), freezes the pay-plus-return selling rates into the card, takes the next
// version number and archives the card it replaces. A published card never changes after this (PS1's trigger).
// Never texts anyone. Maintained outside Lovable.
import { z } from "npm:zod@3";
import { productionCaller, productionEligible, productionCors, productionJson, todayIso } from "../_shared/productionAccess.ts";
import { parseDefinition, PRICING_ENGINE_VERSION } from "../_shared/production/rules.ts";
import { publishBlockers } from "../_shared/production/contradictions.ts";
import { validatePastJobs } from "../_shared/production/validation.ts";
import { deriveCostPlusRates } from "../_shared/production/costs.ts";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    cardId: z.string().uuid(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().trim().max(120).optional(),
    skipReason: z.string().trim().max(300).optional(),
  }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: productionCors });
  if (req.method !== "POST") return productionJson({ error: "Method not allowed" }, 405);
  try {
    const caller = await productionCaller(req);
    if (!caller) return productionJson({ error: "Please sign in again." }, 401);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return productionJson({ error: "That request wasn't understood. Refresh and try again." }, 400);
    const body = parsed.data;
    if (!(await caller.can("setup")) || !(await productionEligible(caller))) {
      return productionJson({ error: "Only someone who sets up the company's pricing can publish a rate card." }, 403);
    }
    const { admin, ownerId } = caller;

    const { data: card, error: cardError } = await admin.from("production_rate_cards")
      .select("id, contractor_id, status, label, branch_key, definition").eq("id", body.cardId).eq("contractor_id", ownerId).maybeSingle();
    if (cardError) throw new Error(`card read failed: ${cardError.message}`);
    if (!card) return productionJson({ error: "That rate card wasn't found." }, 404);
    if (card.status !== "draft") return productionJson({ error: "That version is already published." }, 409);

    const def0 = parseDefinition(card.definition);
    if (def0.kind === "invalid") return productionJson({ error: `The rate card has a problem: ${def0.issues[0]}`, issues: def0.issues }, 400);
    const def = def0.def;
    if (body.skipReason) def.validation.skippedReason = body.skipReason;

    const blockers = publishBlockers(def);
    if (blockers.length) {
      return productionJson({ error: `Settle ${blockers.length} open item${blockers.length === 1 ? "" : "s"} first.`, blockers: blockers.slice(0, 20).map((b) => b.message) }, 400);
    }
    const today = todayIso();
    const check = validatePastJobs(def, today);
    if (!check.ready) return productionJson({ error: check.reason ?? "Check the rate card against past jobs first." }, 400);
    // A day of slack: the owner's "today" (US time) can be yesterday in UTC.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (body.effectiveFrom < yesterday) return productionJson({ error: "The start date can't be in the past." }, 400);

    if (def.pricing.method === "cost_plus") {
      const [roles, equipment, pricing] = await Promise.all([
        admin.from("production_labor_roles").select("role_key, loaded_hourly_cost").eq("contractor_id", ownerId),
        admin.from("production_equipment").select("equipment_key, hourly_cost").eq("contractor_id", ownerId),
        admin.from("production_pricing").select("target_margin, disposal_per_load").eq("contractor_id", ownerId).maybeSingle(),
      ]);
      if (roles.error || equipment.error || pricing.error) throw new Error("cost read failed");
      if (!roles.data?.length) return productionJson({ error: "Add your crew pay rates first: pay plus target return needs them." }, 400);
      if (!pricing.data) return productionJson({ error: "Set your target return first." }, 400);
      const cfg = {
        laborRates: Object.fromEntries(roles.data.map((r) => [r.role_key as string, Number(r.loaded_hourly_cost)])),
        equipmentRates: Object.fromEntries((equipment.data ?? []).map((e) => [e.equipment_key as string, Number(e.hourly_cost)])),
        targetMargin: Number(pricing.data.target_margin),
        disposalPerLoad: pricing.data.disposal_per_load !== null ? Number(pricing.data.disposal_per_load) : null,
      };
      def.pricing.targetMargin = cfg.targetMargin;
      def.pricing.derivedRates = deriveCostPlusRates(cfg);
    }
    const final = parseDefinition(def);
    if (final.kind === "invalid") return productionJson({ error: `The rate card has a problem: ${final.issues[0]}` }, 400);

    const { data: top } = await admin.from("production_rate_cards").select("version")
      .eq("contractor_id", ownerId).not("version", "is", null).order("version", { ascending: false }).limit(1);
    const version = ((top?.[0]?.version as number | undefined) ?? 0) + 1;
    const label = body.label || (card.label as string) || `Rates from ${body.effectiveFrom}`;
    const { data: done, error: pubError } = await admin.from("production_rate_cards").update({
      status: "published", version, effective_from: body.effectiveFrom, label, published_at: new Date().toISOString(),
      published_by: caller.userId, pricing_engine_version: PRICING_ENGINE_VERSION, definition: final.def,
    }).eq("id", card.id).eq("status", "draft").select("id");
    if (pubError) {
      if ((pubError as { code?: string }).code === "23505") return productionJson({ error: "Someone published at the same moment. Try once more." }, 409);
      throw new Error(`publish failed: ${pubError.message}`);
    }
    if (!done?.length) return productionJson({ error: "That version is already published." }, 409);

    let older = admin.from("production_rate_cards").update({ status: "archived" })
      .eq("contractor_id", ownerId).eq("status", "published").neq("id", card.id).lte("effective_from", body.effectiveFrom);
    older = card.branch_key ? older.eq("branch_key", card.branch_key) : older.is("branch_key", null);
    const { error: archError } = await older;
    if (archError) console.error("production-setup archive", archError.message.slice(0, 200));

    return productionJson({ ok: true, cardId: card.id, version, effectiveFrom: body.effectiveFrom });
  } catch (e) {
    console.error("production-setup error", String((e as Error)?.message ?? e).slice(0, 300));
    return productionJson({ error: "Something went wrong. Try again." }, 500);
  }
});
