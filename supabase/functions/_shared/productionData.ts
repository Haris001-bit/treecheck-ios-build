// Large-company setup: the company data the production-* functions read with the service role (the rate card in force,
// settings, Mark's cost tables, capacity and the current backlog), and the media path rule. No Deno globals and no npm
// imports, so vitest runs the modules built on it. Maintained outside Lovable.
import { backlogWeeks, capacitySettingsOf } from "./production/capacity.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Today in UTC as YYYY-MM-DD. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** The rate card in force on a day: the latest published card with effective_from on or before it (branch, then all). */
export async function effectiveCard(admin: Admin, ownerId: string, day: string, branchKey: string | null = null) {
  const { data, error } = await admin.from("production_rate_cards")
    .select("id, version, branch_key, effective_from, definition")
    .eq("contractor_id", ownerId).eq("status", "published").lte("effective_from", day)
    .order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(20);
  if (error) throw new Error(`card read failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; version: number; branch_key: string | null; effective_from: string; definition: unknown }[];
  return rows.find((r) => branchKey && r.branch_key === branchKey) ?? rows.find((r) => r.branch_key === null) ?? null;
}

export interface SettingsLite {
  active_profile?: string | null;
  profile_schedule?: { key: string; from: string; to: string }[] | null;
  resources?: { key: string; ownership?: string; units?: number; hoursPerDay?: number }[] | null;
  crew_counts?: Record<string, number | Record<string, number>> | null;
  basics?: { workingDays?: number[]; dayHours?: number } | null;
  isa_credentials?: Record<string, string> | null;
  send_unit_cost?: boolean | null;
}

export async function companySettings(admin: Admin, ownerId: string): Promise<SettingsLite> {
  const { data } = await admin.from("production_settings")
    .select("active_profile, profile_schedule, resources, crew_counts, basics, isa_credentials, send_unit_cost").eq("contractor_id", ownerId).maybeSingle();
  return (data ?? {}) as SettingsLite;
}

/** Mark's cost tables for a company, as the engine's cost config (units, and which resources come from a vendor). */
export async function companyCosts(admin: Admin, ownerId: string, settings: SettingsLite) {
  const [roles, equipment, pricing] = await Promise.all([
    admin.from("production_labor_roles").select("role_key, loaded_hourly_cost").eq("contractor_id", ownerId),
    admin.from("production_equipment").select("equipment_key, hourly_cost, unit").eq("contractor_id", ownerId),
    admin.from("production_pricing").select("target_margin, minimum_job_charge, disposal_per_load").eq("contractor_id", ownerId).maybeSingle(),
  ]);
  type Role = { role_key: string; loaded_hourly_cost: number | string };
  type Equipment = { equipment_key: string; hourly_cost: number | string; unit: "hour" | "each" | "job" | null };
  return {
    laborRates: Object.fromEntries(((roles.data ?? []) as Role[]).map((r) => [r.role_key, Number(r.loaded_hourly_cost)])),
    equipmentRates: Object.fromEntries(((equipment.data ?? []) as Equipment[]).map((e) => [e.equipment_key, Number(e.hourly_cost)])),
    equipmentUnits: Object.fromEntries(((equipment.data ?? []) as Equipment[]).map((e) => [e.equipment_key, e.unit ?? "hour"])),
    vendorKeys: (settings.resources ?? []).filter((r) => r.ownership === "vendor").map((r) => r.key),
    targetMargin: Number(pricing.data?.target_margin ?? 0.3),
    minimumJobCharge: pricing.data?.minimum_job_charge !== null && pricing.data?.minimum_job_charge !== undefined ? Number(pricing.data.minimum_job_charge) : null,
    disposalPerLoad: pricing.data?.disposal_per_load !== null && pricing.data?.disposal_per_load !== undefined ? Number(pricing.data.disposal_per_load) : null,
  };
}

/** The company's capacity settings in the shape capacity.ts takes (one number of crews per template). */
export const capacitySettings = (s: SettingsLite) => capacitySettingsOf(s);

/** Weeks of work already sold and not done, from the open packets and the company's crews (null when it has no crews set). */
export async function backlogNow(admin: Admin, ownerId: string, settings: SettingsLite): Promise<number | null> {
  const capacity = capacitySettings(settings);
  if (!Object.values(capacity.crewCounts).some((n) => n > 0)) return null;
  const { data: open } = await admin.from("production_packets").select("id, crew, est_crew_hours, resources, status")
    .eq("contractor_id", ownerId).in("status", ["ready", "planned", "scheduled", "in_progress"]);
  type Open = { id: string; crew: { template?: string | null } | null; est_crew_hours: number | string | null; resources: { key: string; hours: number }[] | null; status: string };
  return backlogWeeks(((open ?? []) as Open[]).map((p) => ({
    id: p.id, crewTemplate: p.crew?.template ?? null, estCrewHours: Number(p.est_crew_hours) || 0, resources: p.resources ?? [], status: p.status,
  })), capacity);
}

/** True when the first folder of a storage path is the owner or one of the company's people. */
export async function pathInCompany(admin: Admin, ownerId: string, path: string): Promise<boolean> {
  const m = /^([0-9a-f-]{36})\/production\/[A-Za-z0-9_-]{1,60}\/[A-Za-z0-9_-]{1,60}\/[A-Za-z0-9_.-]{1,60}$/.exec(path);
  if (!m) return false;
  if (m[1] === ownerId) return true;
  const { data } = await admin.from("profiles").select("id").eq("id", m[1]).eq("parent_contractor_id", ownerId).maybeSingle();
  return !!data;
}

export const MEDIA_BUCKET = "scout-media";
