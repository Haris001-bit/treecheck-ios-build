// Scout learning (the weekly feedback loop, App Improvements milestone 4): the database reads and writes behind
// the hooks in scout-submit, scout-retry-estimate, scout-estimate-callback and create-personal-lead (tables from
// migration SL1). Server-side only. Maintained outside Lovable.
//
// Everything here is best effort and never throws: a learning problem must never stop an estimate or a lead.
// Guidance fails safe toward none (standard Scout): the kill switch (the Lovable secret TC_SCOUT_LEARNING_KILL=1),
// the company's switch off, no active guidance, a read error, or the tables not existing yet all give NO_GUIDANCE.

import { capText, guidanceOrEmpty, isUuid, RESULT_NOTES_MAX, type ScoutInputs, type Surface } from "./scoutLearningCore.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface Guidance {
  /** The scout_learning_runs row the block came from, or null for none. */
  version_id: string | null;
  /** The company's guidance block, or "" for none (the estimator then runs on its shared prompt only). */
  block: string;
}

export const NO_GUIDANCE: Readonly<Guidance> = Object.freeze({ version_id: null, block: "" });

/** True when the secret TC_SCOUT_LEARNING_KILL is "1": every company then gets standard Scout. */
export function learningKillSwitchOn(): boolean {
  return /^(1|true|yes|on)$/i.test(env("TC_SCOUT_LEARNING_KILL")?.trim() ?? "");
}

/** The company (owner) a user belongs to; the user's own id when they are the owner or on any read problem. */
export async function companyOf(admin: Admin, userId: string): Promise<string> {
  try {
    const { data } = await admin.from("profiles").select("parent_contractor_id").eq("id", userId).maybeSingle();
    return (data?.parent_contractor_id as string | null) ?? userId;
  } catch {
    return userId;
  }
}

/** The company's active guidance for one estimator, or NO_GUIDANCE. */
export async function activeGuidance(admin: Admin, companyId: string, surface: Surface): Promise<Guidance> {
  if (learningKillSwitchOn() || !isUuid(companyId)) return NO_GUIDANCE;
  try {
    const { data: settings, error: settingsError } = await admin.from("company_settings")
      .select("scout_learning_enabled, scout_learning_website").eq("contractor_id", companyId).maybeSingle();
    if (settingsError || settings?.scout_learning_enabled !== true) return NO_GUIDANCE;
    if (surface === "website" && settings?.scout_learning_website !== true) return NO_GUIDANCE;
    const { data: run, error: runError } = await admin.from("scout_learning_runs")
      .select("id, block").eq("company_id", companyId).eq("surface", surface).eq("active", true).maybeSingle();
    const block = guidanceOrEmpty(run?.block);
    if (runError || !block || !isUuid(run?.id)) return NO_GUIDANCE;
    return { version_id: run.id, block };
  } catch (e) {
    console.error("scout learning: guidance read failed", e);
    return NO_GUIDANCE;
  }
}

/** Records what Scout is about to be given for a capture (submit and retry). */
export async function recordScoutSent(admin: Admin, p: {
  captureId: string; companyId: string; versionId: string | null; inputs: ScoutInputs;
}): Promise<void> {
  if (!isUuid(p.captureId) || !isUuid(p.companyId)) return;
  try {
    const { error } = await admin.from("estimate_snapshots").upsert({
      surface: "scout",
      ref_id: p.captureId,
      company_id: p.companyId,
      version_id: isUuid(p.versionId) ? p.versionId : null,
      inputs: p.inputs,
      sent_at: new Date().toISOString(),
    }, { onConflict: "surface,ref_id" });
    if (error) console.error("scout learning: snapshot not saved", error.message);
  } catch (e) {
    console.error("scout learning: snapshot not saved", e);
  }
}

/**
 * Records Scout's first real answer for a capture (callbacks marked src=scout only). A later answer replaces it
 * only when the first had no price ("Unable to estimate" comes back as 0); "Request edit" answers never get here.
 */
export async function recordScoutResult(admin: Admin, p: {
  captureId: string; ownerId: string | null | undefined; price: unknown; difficulty: unknown; risk: unknown;
  service: string | null; notes: string | null;
}): Promise<void> {
  if (!isUuid(p.captureId)) return;
  const n = typeof p.price === "number" ? p.price
    : typeof p.price === "string" && p.price.trim() ? Number(p.price.trim()) : NaN;
  const price = Number.isFinite(n) && n >= 0 ? n : null;
  const row = {
    price_min: price,
    price_max: price,
    difficulty: typeof p.difficulty === "string" ? p.difficulty.slice(0, 40) : null,
    risk: typeof p.risk === "string" ? p.risk.slice(0, 40) : null,
    service: p.service,
    notes: capText(p.notes, RESULT_NOTES_MAX),
    result_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await admin.from("estimate_snapshots").update(row)
      .eq("surface", "scout").eq("ref_id", p.captureId)
      .or("result_at.is.null,price_max.is.null,price_max.lte.0")
      .select("ref_id");
    if (error) { console.error("scout learning: result not saved", error.message); return; }
    if (Array.isArray(data) && data.length) return;
    // Nothing updated: either a real answer is already saved, or the snapshot at submit failed.
    const { data: existing } = await admin.from("estimate_snapshots").select("ref_id")
      .eq("surface", "scout").eq("ref_id", p.captureId).maybeSingle();
    if (existing || !isUuid(p.ownerId)) return;
    const companyId = await companyOf(admin, p.ownerId);
    const { error: insertError } = await admin.from("estimate_snapshots").upsert(
      { surface: "scout", ref_id: p.captureId, company_id: companyId, inputs: {}, ...row },
      { onConflict: "surface,ref_id", ignoreDuplicates: true },
    );
    if (insertError) console.error("scout learning: result not saved", insertError.message);
  } catch (e) {
    console.error("scout learning: result not saved", e);
  }
}

/** Records a website estimate for a new private lead (what the form gave, the price range and the AI's text). */
export async function recordWebsiteEstimate(admin: Admin, p: {
  leadId: string; companyId: string; priceMin: unknown; priceMax: unknown; notes: unknown;
  formInputs: Record<string, string | number | boolean>; versionId: unknown;
}): Promise<void> {
  if (!isUuid(p.leadId) || !isUuid(p.companyId)) return;
  const now = new Date().toISOString();
  try {
    const { error } = await admin.from("estimate_snapshots").upsert({
      surface: "website",
      ref_id: p.leadId,
      company_id: p.companyId,
      version_id: isUuid(p.versionId) ? p.versionId : null,
      inputs: p.formInputs,
      sent_at: now,
      price_min: typeof p.priceMin === "number" && Number.isFinite(p.priceMin) ? p.priceMin : null,
      price_max: typeof p.priceMax === "number" && Number.isFinite(p.priceMax) ? p.priceMax : null,
      notes: capText(p.notes, RESULT_NOTES_MAX),
      result_at: now,
    }, { onConflict: "surface,ref_id", ignoreDuplicates: true });
    if (error) console.error("scout learning: website snapshot not saved", error.message);
  } catch (e) {
    console.error("scout learning: website snapshot not saved", e);
  }
}

function env(key: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(key);
}
