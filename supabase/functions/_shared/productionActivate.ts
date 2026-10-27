// Approval of a crew estimate (by hand, or from Jobber's QUOTE_APPROVED in PR4): one conditional update moves it to
// approved, then the production packets (one per package, with their playbook tasks) are inserted, ignoring any that
// already exist. A webhook racing a manual approval, or Jobber delivering an event twice, can't make duplicates.
// No Deno and no npm import here, so vitest can test it with a stand-in database. Maintained outside Lovable.
import type { RateCardDefinition } from "./production/rules.ts";
import type { PricedItem } from "./production/estimate.ts";
import { approvedItems } from "./production/estimate.ts";
import { evaluatePlaybooks, type TaskDue } from "./production/playbooks.ts";
import { planPackets } from "./production/packaging.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = { from: (table: string) => any };

export interface ActivateInput {
  ownerId: string;
  estimateId: string;
  def: RateCardDefinition;
  via: "manual" | "jobber";
  by: string | null;
  /** The optional and recommended items the customer chose; null keeps recommended ones and drops optional ones. */
  chosen: string[] | null;
  salespersonName: string | null;
  backlogWeeks: number | null;
  now?: Date;
}

export type ActivateResult =
  | { kind: "ok"; packets: number }
  | { kind: "not_found" }
  | { kind: "already"; status: string };

interface TreeRow { key: string; label?: string | null; location?: string | null; photos?: string[] }

const OPEN = ["draft", "sent", "changes_requested"];

function dueAt(due: TaskDue, now: Date): string | null {
  if (due === "immediate") return now.toISOString();
  if (due === "before_job") return null;
  return new Date(now.getTime() + (due.daysAfterApproval ?? 0) * 86_400_000).toISOString();
}

export async function activateEstimate(db: Db, input: ActivateInput): Promise<ActivateResult> {
  const now = input.now ?? new Date();
  const { data: est, error } = await db.from("production_estimates")
    .select("id, contractor_id, status, number, rate_card_version, work_items, trees, customer, promised_window")
    .eq("id", input.estimateId).eq("contractor_id", input.ownerId).maybeSingle();
  if (error) throw new Error(`estimate read failed: ${error.message}`);
  if (!est) return { kind: "not_found" };
  if (!OPEN.includes(est.status)) return { kind: "already", status: est.status };

  const items = (est.work_items ?? []) as PricedItem[];
  const chosen = input.chosen;
  const marked = items.map((i) => (i.kind === "required" ? i : { ...i, selected: chosen ? chosen.includes(i.id) : i.kind === "recommended" ? i.selected !== false : i.selected === true }));
  const { data: moved, error: moveError } = await db.from("production_estimates").update({
    status: "approved", approved_at: now.toISOString(), approved_via: input.via, approved_by: input.by,
    backlog_weeks_at_sale: input.backlogWeeks, work_items: marked,
  }).eq("id", est.id).in("status", OPEN).select("id");
  if (moveError) throw new Error(`approve failed: ${moveError.message}`);
  if (!moved || moved.length === 0) return { kind: "already", status: "approved" };

  const sold = approvedItems(marked, chosen).filter((i) => i.status === "ok" && i.production);
  const trees = new Map(((est.trees ?? []) as TreeRow[]).map((t) => [t.key, t]));
  const services = new Map(input.def.services.map((s) => [s.key, s]));
  const playbook = evaluatePlaybooks(input.def, sold.filter((i) => services.has(i.serviceKey)).map((i) => ({
    id: i.id, serviceKey: i.serviceKey, serviceName: i.serviceName, category: services.get(i.serviceKey)!.category, answers: i.answers, flags: i.flags ?? {},
  })));
  const packets = planPackets(input.def, sold.filter((i) => services.has(i.serviceKey)).map((i) => {
    const t = i.treeKey ? trees.get(i.treeKey) : undefined;
    return {
      id: i.id, service: services.get(i.serviceKey)!, answers: i.answers, production: i.production!, flags: i.flags ?? {},
      treeLabel: t?.label ?? null, location: t?.location ?? null, photos: t?.photos ?? [],
    };
  }), playbook);
  if (!packets.length) return { kind: "ok", packets: 0 };

  const c = (est.customer ?? {}) as Record<string, string | undefined>;
  const rows = packets.map((p) => ({
    contractor_id: input.ownerId,
    estimate_id: est.id,
    package_key: p.packageKey,
    title: p.title,
    fulfillment: p.fulfillment,
    salesperson_name: input.salespersonName,
    estimate_number: est.number,
    rate_card_version: est.rate_card_version,
    scope: p.scope,
    customer: { name: c.name ?? null, phone: c.phone ?? null, address: c.address ?? null, gateCode: c.gateCode ?? null, accessNotes: c.accessNotes ?? null },
    crew: p.crew,
    est_hours: p.estHours,
    est_crew_hours: p.estCrewHours,
    est_man_hours: p.estManHours,
    resources: p.resources,
    scheduling_class: p.schedulingClass,
    promised_window: est.promised_window ?? null,
    depends_on: p.dependsOn,
    status: "ready",
    tasks: p.tasks.map((t) => ({ ...t, dueAt: dueAt(t.due, now) })),
  }));
  const { data: made, error: insError } = await db.from("production_packets")
    .upsert(rows, { onConflict: "estimate_id,package_key", ignoreDuplicates: true }).select("id");
  if (insError) throw new Error(`packets failed: ${insError.message}`);
  return { kind: "ok", packets: made?.length ?? 0 };
}
