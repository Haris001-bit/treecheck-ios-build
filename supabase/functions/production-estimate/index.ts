// Large-company setup: crew estimates. save re-prices every work item on the server from the rate card in force (the
// screen's price is only a preview), refuses a material override without a reason, and stores the internal costs apart
// (cost viewers only). revise copies a sent estimate into a new draft; approve (by hand) creates the production packets;
// lost records why; media signs one photo the estimate references; send makes the draft quote in Jobber (the office
// sends it to the customer from Jobber), check finds a quote Jobber made without confirming it, and jobber says whether
// the company has Jobber connected; jobber_requests lists open Jobber requests to start from (approval extras, empty
// while they are off). Never texts anyone, never calls n8n or Scout's workflow. Maintained outside Lovable.
import { z } from "npm:zod@3";
import {
  productionCaller, productionEligible, productionCors, productionJson, todayIso, effectiveCard, companySettings,
  companyCosts, backlogNow, pathInCompany, MEDIA_BUCKET,
} from "../_shared/productionAccess.ts";
import { activateEstimate } from "../_shared/productionActivate.ts";
import { parseDefinition, PRICING_ENGINE_VERSION } from "../_shared/production/rules.ts";
import { PRODUCTION_ENGINE_VERSION } from "../_shared/production/productionRules.ts";
import { approvedItems, priceEstimate, type PricedItem } from "../_shared/production/estimate.ts";
import { costEstimate } from "../_shared/production/costs.ts";
import { activeProfile } from "../_shared/production/profiles.ts";
import { checkEstimate, sendEstimate, type SendOutcome } from "../_shared/productionJobber.ts";
import { extrasSwitchOn, listRequests } from "../_shared/productionJobberExtras.ts";

const key = z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/);
const Item = z.object({
  id: key,
  serviceKey: z.string().min(1).max(40),
  treeKey: key.nullable().optional(),
  kind: z.enum(["required", "recommended", "optional"]),
  answers: z.record(z.string().max(40), z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])),
  answerSources: z.record(z.string().max(40), z.enum(["known", "ai", "default"])).optional(),
  sell: z.number().finite().min(0).max(10_000_000).nullable().optional(),
  overrideReason: z.string().max(60).nullable().optional(),
  selected: z.boolean().nullable().optional(),
});
const Tree = z.object({
  key, label: z.string().max(60).default(""), location: z.string().max(200).optional(),
  photos: z.array(z.string().max(300)).max(10).default([]), voice: z.string().max(300).nullable().optional(),
  transcript: z.string().max(4000).optional(), notes: z.string().max(2000).optional(),
  facts: z.record(z.string().max(40), z.unknown()).optional(), uncertain: z.array(z.string().max(40)).max(40).optional(),
});
const Customer = z.object({
  name: z.string().max(120).default(""), phone: z.string().max(40).default(""), email: z.string().max(200).default(""),
  address: z.string().max(300).default(""), gateCode: z.string().max(40).default(""), accessNotes: z.string().max(500).default(""),
  // The Jobber request the estimate started from (approval extras): the quote names it when the extras are on.
  jobberRequestId: z.string().max(200).regex(/^[A-Za-z0-9_=+/-]+$/).optional(),
});
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"), estimateId: z.string().uuid().optional(), branchKey: z.string().max(40).nullable().optional(),
    customer: Customer, trees: z.array(Tree).max(20), items: z.array(Item).max(60),
    discountKey: z.string().max(40).nullable().optional(), paymentPlanKey: z.string().max(40).nullable().optional(),
    promisedWindow: z.object({ from: z.string().max(10).optional(), to: z.string().max(10).optional() }).nullable().optional(),
  }),
  z.object({ action: z.literal("revise"), estimateId: z.string().uuid() }),
  z.object({ action: z.literal("approve"), estimateId: z.string().uuid(), chosen: z.array(key).max(60).nullable().optional() }),
  z.object({ action: z.literal("lost"), estimateId: z.string().uuid(), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("media"), estimateId: z.string().uuid(), path: z.string().max(300) }),
  z.object({ action: z.literal("send"), estimateId: z.string().uuid() }),
  z.object({ action: z.literal("check"), estimateId: z.string().uuid() }),
  z.object({ action: z.literal("jobber") }),
  z.object({ action: z.literal("jobber_requests") }),
]);

/** What the salesperson reads after Send to Jobber or Check Jobber. */
function sendReply(o: SendOutcome): Response {
  switch (o.state) {
    case "sent": return productionJson({ ok: true, state: o.state, quoteNumber: o.quoteNumber, message: `Draft quote${o.quoteNumber ? ` #${o.quoteNumber}` : ""} is in Jobber, ready for the office to check and send.` });
    case "exists": return productionJson({ ok: true, state: o.state, quoteNumber: o.quoteNumber, message: `It is already in Jobber${o.quoteNumber ? ` as quote #${o.quoteNumber}` : ""}.` });
    case "busy": return productionJson({ ok: true, state: o.state, message: "The Jobber quote is being made right now." });
    case "not_found": return productionJson({ ok: true, state: o.state, message: "Jobber has no quote for it, so you can send it again." });
    case "uncertain": return productionJson({ error: o.error, state: o.state }, 409);
    case "not_connected": return productionJson({ error: "Jobber isn't connected for this company.", state: o.state }, 409);
    case "off": return productionJson({ error: "Sending to Jobber is switched off right now.", state: o.state }, 409);
    case "invalid": return productionJson({ error: o.error, state: o.state }, 409);
    default: return productionJson({ error: `Couldn't make the Jobber quote: ${o.error.replace(/[.s]+$/, "")}.`, state: o.state }, 502);
  }
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
    const { admin, ownerId, userId } = caller;
    if (!(await productionEligible(caller))) return productionJson({ error: "Crew estimates aren't switched on for this company." }, 403);
    const day = todayIso();

    if (body.action === "save") {
      if (!(await caller.can("price"))) return productionJson({ error: "Only salespeople and the office can write estimates." }, 403);
      let existing: { id: string; status: string; number: number; salesperson_id: string | null } | null = null;
      if (body.estimateId) {
        const { data } = await admin.from("production_estimates").select("id, status, number, salesperson_id")
          .eq("id", body.estimateId).eq("contractor_id", ownerId).maybeSingle();
        if (!data) return productionJson({ error: "That estimate wasn't found." }, 404);
        if (data.status !== "draft") {
          return productionJson({ error: "A sent estimate can't be changed. Use Revise to make a new version." }, 409);
        }
        existing = data;
      }
      for (const t of body.trees) {
        for (const p of [...t.photos, ...(t.voice ? [t.voice] : [])]) {
          if (!(await pathInCompany(admin, ownerId, p))) return productionJson({ error: "A photo on this estimate isn't from your company." }, 400);
        }
      }
      const card = await effectiveCard(admin, ownerId, day, body.branchKey ?? null);
      if (!card) return productionJson({ error: "Publish a rate card first (Settings, Crews and pricing)." }, 409);
      const def0 = parseDefinition(card.definition);
      if (def0.kind === "invalid") return productionJson({ error: "The published rate card can't be read. Publish it again." }, 500);
      const def = def0.def;
      const settings = await companySettings(admin, ownerId);
      const priced = priceEstimate(def, body.items, { day, settings, discountKey: body.discountKey, paymentPlanKey: body.paymentPlanKey });
      const needsReason = priced.items.find((i) => i.status === "needs_reason");
      if (needsReason) return productionJson({ error: `${needsReason.serviceName}: ${needsReason.message}`, problems: priced.problems }, 400);

      const profile = activeProfile(def, settings, day);
      const plan = body.paymentPlanKey ? def.policies.paymentPlans.find((p) => p.key === body.paymentPlanKey) ?? null : null;
      const row = {
        contractor_id: ownerId,
        branch_key: body.branchKey ?? null,
        customer: body.customer,
        trees: body.trees,
        work_items: priced.items,
        rate_card_id: card.id,
        rate_card_version: card.version,
        pricing_engine_version: PRICING_ENGINE_VERSION,
        production_engine_version: PRODUCTION_ENGINE_VERSION,
        profile: profile?.key ?? "normal",
        totals: { ...priced.totals, discountKey: body.discountKey ?? null, paymentPlanKey: body.paymentPlanKey ?? null },
        payment_plan: plan,
        promised_window: body.promisedWindow ?? null,
        status: "draft",
      };
      let saved: { id: string; number: number; status: string } | null = null;
      if (existing) {
        const { data, error } = await admin.from("production_estimates").update(row).eq("id", existing.id)
          .eq("status", "draft").select("id, number, status").maybeSingle();
        if (error) throw new Error(`save failed: ${error.message}`);
        if (!data) return productionJson({ error: "This estimate was sent while you were editing. Use Revise." }, 409);
        saved = data;
      } else {
        for (let attempt = 0; attempt < 3 && !saved; attempt++) {
          const { data: top } = await admin.from("production_estimates").select("number").eq("contractor_id", ownerId).order("number", { ascending: false }).limit(1);
          const number = ((top?.[0]?.number as number | undefined) ?? 1000) + 1;
          const { data, error } = await admin.from("production_estimates")
            .insert({ ...row, number, salesperson_id: userId, created_by: userId }).select("id, number, status").maybeSingle();
          if (error && (error as { code?: string }).code !== "23505") throw new Error(`save failed: ${error.message}`);
          if (data) saved = data;
        }
        if (!saved) return productionJson({ error: "Couldn't number the estimate. Try again." }, 409);
      }

      const cfg = await companyCosts(admin, ownerId, settings);
      const costs = costEstimate(priced.items.filter((i) => i.status === "ok" && i.production).map((i) => ({
        id: i.id, price: i.price ?? 0, production: i.production!, counts: i.kind === "required" || (i.kind === "recommended" ? i.selected !== false : i.selected === true),
      })), cfg, def.policies.commission);
      const { error: costError } = await admin.from("production_estimate_costs").upsert({
        estimate_id: saved.id, contractor_id: ownerId, items: costs.items, totals: costs.totals,
        rates: { laborRates: cfg.laborRates, equipmentRates: cfg.equipmentRates, targetMargin: cfg.targetMargin }, computed_at: new Date().toISOString(),
      }, { onConflict: "estimate_id" });
      if (costError) console.error("production-estimate costs", costError.message.slice(0, 200));
      const showCosts = await caller.can("costs");
      return productionJson({ ok: true, estimate: saved, items: priced.items, totals: priced.totals, problems: priced.problems, costs: showCosts ? costs : null });
    }

    if (body.action === "revise") {
      if (!(await caller.can("price"))) return productionJson({ error: "Only salespeople and the office can revise estimates." }, 403);
      const { data: old } = await admin.from("production_estimates").select("*").eq("id", body.estimateId).eq("contractor_id", ownerId).maybeSingle();
      if (!old) return productionJson({ error: "That estimate wasn't found." }, 404);
      if (old.status !== "sent" && old.status !== "changes_requested") return productionJson({ error: "Only a sent estimate needs revising." }, 409);
      const { data: top } = await admin.from("production_estimates").select("number").eq("contractor_id", ownerId).order("number", { ascending: false }).limit(1);
      // The new version keeps the Jobber client but none of the old quote: it goes to Jobber as a new quote.
      const workItems = ((old.work_items ?? []) as PricedItem[]).map(({ jobberLineId: _line, ...w }) => w);
      const { data: fresh, error } = await admin.from("production_estimates").insert({
        contractor_id: ownerId, number: ((top?.[0]?.number as number | undefined) ?? 1000) + 1, revision_of: old.id, status: "draft",
        salesperson_id: old.salesperson_id, branch_key: old.branch_key, customer: old.customer, trees: old.trees, work_items: workItems,
        jobber_client_id: old.jobber_client_id,
        rate_card_id: old.rate_card_id, rate_card_version: old.rate_card_version, pricing_engine_version: old.pricing_engine_version,
        production_engine_version: old.production_engine_version, profile: old.profile, totals: old.totals, payment_plan: old.payment_plan,
        promised_window: old.promised_window, created_by: userId,
      }).select("id, number").maybeSingle();
      if (error || !fresh) throw new Error(`revise failed: ${error?.message ?? "no row"}`);
      await admin.from("production_estimates").update({ status: "archived" }).eq("id", old.id).in("status", ["sent", "changes_requested"]);
      return productionJson({ ok: true, estimate: fresh });
    }

    if (body.action === "approve") {
      if (!(await caller.can("price")) && !(await caller.can("dispatch"))) return productionJson({ error: "Only salespeople and the office can mark an estimate approved." }, 403);
      const { data: est } = await admin.from("production_estimates").select("rate_card_id, salesperson_id, work_items").eq("id", body.estimateId).eq("contractor_id", ownerId).maybeSingle();
      if (!est) return productionJson({ error: "That estimate wasn't found." }, 404);
      // Everything the customer is buying must have a price before it becomes crew work.
      const counted = approvedItems((est.work_items ?? []) as PricedItem[], body.chosen ?? null);
      const unfinished = counted.find((i) => i.status !== "ok");
      if (unfinished) return productionJson({ error: `Finish this first: ${unfinished.serviceName}, ${unfinished.message ?? "no price yet"}.` }, 409);
      if (!counted.length) return productionJson({ error: "Add the work first." }, 409);
      const { data: card } = await admin.from("production_rate_cards").select("definition").eq("id", est.rate_card_id).maybeSingle();
      const def0 = card ? parseDefinition(card.definition) : null;
      if (!def0 || def0.kind === "invalid") return productionJson({ error: "This estimate's rate card can't be read." }, 500);
      const settings = await companySettings(admin, ownerId);
      const backlog = await backlogNow(admin, ownerId, settings);
      const { data: sp } = est.salesperson_id ? await admin.from("profiles").select("full_name").eq("id", est.salesperson_id).maybeSingle() : { data: null };
      const r = await activateEstimate(admin, {
        ownerId, estimateId: body.estimateId, def: def0.def, via: "manual", by: userId, chosen: body.chosen ?? null,
        salespersonName: (sp?.full_name as string | null) ?? null, backlogWeeks: backlog,
      });
      if (r.kind === "not_found") return productionJson({ error: "That estimate wasn't found." }, 404);
      if (r.kind === "already") return productionJson({ error: `This estimate is already ${r.status}.` }, 409);
      return productionJson({ ok: true, packets: r.packets });
    }

    if (body.action === "lost") {
      if (!(await caller.can("price"))) return productionJson({ error: "Only salespeople and the office can mark an estimate lost." }, 403);
      const { data, error } = await admin.from("production_estimates").update({ status: "lost", lost_at: new Date().toISOString(), lost_reason: body.reason })
        .eq("id", body.estimateId).eq("contractor_id", ownerId).in("status", ["draft", "sent", "changes_requested"]).select("id");
      if (error) throw new Error(`lost failed: ${error.message}`);
      if (!data?.length) return productionJson({ error: "This estimate can't be marked lost now." }, 409);
      return productionJson({ ok: true });
    }

    if (body.action === "media") {
      if (!(await caller.can("price")) && !(await caller.can("dispatch"))) return productionJson({ error: "Not allowed." }, 403);
      const { data: est } = await admin.from("production_estimates").select("trees").eq("id", body.estimateId).eq("contractor_id", ownerId).maybeSingle();
      const referenced = ((est?.trees ?? []) as { photos?: string[]; voice?: string | null }[]).some((t) => (t.photos ?? []).includes(body.path) || t.voice === body.path);
      if (!referenced || !(await pathInCompany(admin, ownerId, body.path))) return productionJson({ error: "That file isn't on this estimate." }, 404);
      const { data: signed } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(body.path, 3600);
      if (!signed?.signedUrl) return productionJson({ error: "That file couldn't be opened." }, 404);
      return productionJson({ ok: true, url: signed.signedUrl });
    }
    if (body.action === "send" || body.action === "check") {
      if (!(await caller.can("price"))) return productionJson({ error: "Only salespeople and the office can send estimates." }, 403);
      const input = { ownerId, estimateId: body.estimateId };
      return sendReply(body.action === "send" ? await sendEstimate(admin, input) : await checkEstimate(admin, input));
    }

    if (body.action === "jobber") {
      if (!(await caller.can("price")) && !(await caller.can("dispatch"))) return productionJson({ error: "Not allowed." }, 403);
      const { data } = await admin.from("jobber_tokens").select("contractor_id").eq("contractor_id", ownerId).is("disconnected_at", null).maybeSingle();
      return productionJson({ ok: true, connected: !!data });
    }
    if (body.action === "jobber_requests") {
      if (!(await caller.can("price"))) return productionJson({ error: "Only salespeople and the office start estimates." }, 403);
      if (!(await extrasSwitchOn(admin))) return productionJson({ ok: true, on: false, requests: [] });
      const r = await listRequests(admin, ownerId);
      if (r.ok === false) return productionJson({ error: r.error }, 409);
      return productionJson({ ok: true, on: true, requests: r.requests });
    }
    return productionJson({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("production-estimate error", String((e as Error)?.message ?? e).slice(0, 300));
    return productionJson({ error: "Something went wrong. Try again." }, 500);
  }
});
