// Large-company setup: the Jobber parts that wait on Jobber's review of TreeCheck's app (Users, Requests, Products &
// Services, Custom Fields, Time Sheets, Expenses). Switched off: nothing here runs until production_rollout.jobber_extras
// is true, and each company reconnects Jobber once after the permissions are added to the app. Setup checks which
// permissions the connection has, matches the rate card's services and the team to Jobber's, and adds the five quote
// fields; Crew work lists open Jobber requests to start estimates from; quoteExtrasFor is what a send adds to the quote;
// jobberActuals reads a job's time sheets and expenses as its crew jobs' actual hours, a suggestion until someone saves
// it. The choices are kept in production_settings.jobber (server-only). Writes to Jobber only to add the five quote
// fields. Server-side only. Maintained outside Lovable.
import { JobberCallError, jobberMutate, jobberRead, shortJobberError, tokenFor } from "./jobberApi.ts";
import { killSwitchOn } from "./jobberSwitches.ts";
import {
  TC_ExtrasFieldCreateLink, TC_ExtrasFieldCreateText, TC_ExtrasFieldUnarchive, TC_ExtrasJobTime, TC_ExtrasProbeExpenses, TC_ExtrasProbeFields,
  TC_ExtrasProbeProducts, TC_ExtrasProbeRequests, TC_ExtrasProbeTimeSheets, TC_ExtrasProbeUsers, TC_ExtrasProducts, TC_ExtrasQuoteFields,
  TC_ExtrasRequest, TC_ExtrasRequests, TC_ExtrasUsers,
} from "./jobberQueries.extras.ts";
import {
  actualsFromJobber, jobShares, matchServices, matchTeam, openRequests, QUOTE_FIELDS, quoteFieldValues,
  type ActualsFromJobber, type JobberExpense, type JobberProduct, type JobberRequestNode, type JobberTimeEntry, type JobberUser, type OpenRequest,
  type QuoteExtras, type QuoteFieldKey, type ServicesPreview, type TeamMember, type TeamPreview,
} from "./production/jobberExtras.ts";
import type { RateCardDefinition } from "./production/rules.ts";
import type { PricedItem } from "./production/estimate.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** For tests: a replacement for the token. */
export interface ExtrasDeps { token?: (admin: Admin, ownerId: string) => Promise<string | null> }

/** true: the connection has it; false: Jobber refused; null: Jobber couldn't be asked just now. */
export type Permission = boolean | null;
export interface ExtrasProbe {
  connected: boolean; users: Permission; requests: Permission; products: Permission; customFields: Permission;
  timeSheets: Permission; expenses: Permission; checkedAt: string;
}
export interface ExtrasSettings {
  productIds?: Record<string, string>;
  userIds?: Record<string, string>;
  fieldIds?: Partial<Record<QuoteFieldKey, string>>;
  probe?: ExtrasProbe;
}
export type ExtrasResult<T> = { ok: true } & T | { ok: false; error: string };

const APP_URL = "https://app.treecheck.ai";
const REQUEST_DAYS = 60;
const PRODUCT_PAGES = 5;
const NOT_CONNECTED = "Jobber isn't connected for this company.";

function env(key: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(key);
}

/** The rollout's jobber_extras switch, under both kill switches (TC_JOBBER_KILL, and TC_PRODUCTION_KILL as in productionJobber.ts). */
export async function extrasSwitchOn(admin: Admin): Promise<boolean> {
  if (killSwitchOn() || env("TC_PRODUCTION_KILL")?.trim() === "1") return false;
  try {
    const { data, error } = await admin.from("production_rollout").select("jobber_extras").eq("id", 1).maybeSingle();
    return !error && data?.jobber_extras === true;
  } catch {
    return false;
  }
}

export async function readExtras(admin: Admin, ownerId: string): Promise<ExtrasSettings> {
  const { data } = await admin.from("production_settings").select("jobber").eq("contractor_id", ownerId).maybeSingle();
  const j = data?.jobber;
  return j && typeof j === "object" && !Array.isArray(j) ? j as ExtrasSettings : {};
}

/** Merges into production_settings.jobber. False when the company hasn't started setup (no settings row). */
async function saveExtras(admin: Admin, ownerId: string, patch: Partial<ExtrasSettings>): Promise<boolean> {
  const current = await readExtras(admin, ownerId);
  const { data, error } = await admin.from("production_settings").update({ jobber: { ...current, ...patch } }).eq("contractor_id", ownerId).select("contractor_id");
  if (error) throw new Error(`saving the Jobber choices failed: ${error.message}`);
  return !!data?.length;
}

/** A refusal (GraphQL error, or HTTP 401 or 403) means the permission is missing; anything else can't tell. */
async function permitted(token: string, doc: string): Promise<Permission> {
  try {
    await jobberRead(token, doc, {}, { retries: 1, retryOn: "throttle" });
    return true;
  } catch (e) {
    if (e instanceof JobberCallError && (e.kind === "graphql" || (e.kind === "http" && (e.status === 401 || e.status === 403)))) return false;
    console.warn("[productionJobberExtras] permission not checked", shortJobberError(e));
    return null;
  }
}

/** Which of the six permissions the company's Jobber connection has. Saved, so setup can say "Reconnect Jobber". */
export async function probeExtras(admin: Admin, ownerId: string, deps: ExtrasDeps = {}, now = Date.now()): Promise<ExtrasProbe> {
  const checkedAt = new Date(now).toISOString();
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  const probe: ExtrasProbe = token
    ? {
      connected: true, checkedAt,
      users: await permitted(token, TC_ExtrasProbeUsers),
      requests: await permitted(token, TC_ExtrasProbeRequests),
      products: await permitted(token, TC_ExtrasProbeProducts),
      customFields: await permitted(token, TC_ExtrasProbeFields),
      timeSheets: await permitted(token, TC_ExtrasProbeTimeSheets),
      expenses: await permitted(token, TC_ExtrasProbeExpenses),
    }
    : { connected: false, users: null, requests: null, products: null, customFields: null, timeSheets: null, expenses: null, checkedAt };
  await saveExtras(admin, ownerId, { probe });
  return probe;
}

async function products(token: string): Promise<JobberProduct[]> {
  type Reply = { products?: { nodes?: JobberProduct[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
  const all: JobberProduct[] = [];
  let after: string | null = null;
  for (let n = 0; n < PRODUCT_PAGES; n++) {
    const reply: { data: Reply } = await jobberRead<Reply>(token, TC_ExtrasProducts, { after }, { retries: 1, retryOn: "throttle" });
    const page = reply.data.products;
    all.push(...(page?.nodes ?? []).filter((p: JobberProduct) => !!p?.id));
    after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? null : null;
    if (!after) break;
  }
  return all;
}

/** The rate card's services against Jobber's products and services, with the saved choices. */
export async function servicesPreview(admin: Admin, ownerId: string, def: RateCardDefinition, deps: ExtrasDeps = {}): Promise<ExtrasResult<{ preview: ServicesPreview }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  try {
    const saved = (await readExtras(admin, ownerId)).productIds ?? {};
    return { ok: true, preview: matchServices(def, await products(token), saved) };
  } catch (e) {
    return { ok: false, error: `Jobber's products and services couldn't be read: ${shortJobberError(e)}` };
  }
}

/** Saves which Jobber item each service uses. Only the card's services and items that exist in Jobber are kept. */
export async function saveServices(admin: Admin, ownerId: string, def: RateCardDefinition, choice: Record<string, string | null>, deps: ExtrasDeps = {}): Promise<ExtrasResult<{ saved: number }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  let ids: Set<string>;
  try {
    ids = new Set((await products(token)).map((p) => p.id));
  } catch (e) {
    return { ok: false, error: `Jobber's products and services couldn't be read: ${shortJobberError(e)}` };
  }
  const keys = new Set(def.services.map((s) => s.key));
  const productIds = Object.fromEntries(Object.entries(choice).filter(([k, id]) => keys.has(k) && !!id && ids.has(id)) as [string, string][]);
  if (!(await saveExtras(admin, ownerId, { productIds }))) return { ok: false, error: "Start the setup first." };
  return { ok: true, saved: Object.keys(productIds).length };
}

/** The owner and the active employees, with their names and emails. */
async function teamOf(admin: Admin, ownerId: string): Promise<TeamMember[]> {
  const { data: members } = await admin.from("team_member_access").select("user_id")
    .eq("owner_id", ownerId).eq("status", "active").eq("member_kind", "employee");
  const ids = [ownerId, ...(members ?? []).map((m: { user_id: string | null }) => m.user_id).filter(Boolean)] as string[];
  const { data: people } = await admin.from("profiles").select("id, email, full_name").in("id", ids);
  return ids.map((id) => {
    const p = (people ?? []).find((x: { id: string }) => x.id === id) as { email?: string | null; full_name?: string | null } | undefined;
    return { id, name: p?.full_name?.trim() || p?.email || "Team member", email: p?.email ?? null };
  });
}

async function jobberUsers(token: string): Promise<JobberUser[]> {
  type Reply = { users?: { nodes?: { id: string; isAccountOwner?: boolean; name?: { full?: string } | null; email?: { raw?: string } | null }[] } };
  const { data } = await jobberRead<Reply>(token, TC_ExtrasUsers, {}, { retries: 1, retryOn: "throttle" });
  return (data.users?.nodes ?? []).filter((u) => !!u?.id).map((u) => ({ id: u.id, name: u.name?.full?.trim() || "Jobber user", email: u.email?.raw ?? null, isAccountOwner: u.isAccountOwner ?? null }));
}

/** TreeCheck's team against the company's Jobber users, with the saved choices. */
export async function teamPreview(admin: Admin, ownerId: string, deps: ExtrasDeps = {}): Promise<ExtrasResult<{ preview: TeamPreview }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  try {
    const saved = (await readExtras(admin, ownerId)).userIds ?? {};
    return { ok: true, preview: matchTeam(await teamOf(admin, ownerId), await jobberUsers(token), saved) };
  } catch (e) {
    return { ok: false, error: `Jobber's users couldn't be read: ${shortJobberError(e)}` };
  }
}

/** Saves who is who, used as the salesperson on quotes. Only the company's people and active Jobber users are kept. */
export async function saveTeam(admin: Admin, ownerId: string, choice: Record<string, string | null>, deps: ExtrasDeps = {}): Promise<ExtrasResult<{ saved: number }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  let users: Set<string>;
  try {
    users = new Set((await jobberUsers(token)).map((u) => u.id));
  } catch (e) {
    return { ok: false, error: `Jobber's users couldn't be read: ${shortJobberError(e)}` };
  }
  const people = new Set((await teamOf(admin, ownerId)).map((m) => m.id));
  const userIds = Object.fromEntries(Object.entries(choice).filter(([id, j]) => people.has(id) && !!j && users.has(j)) as [string, string][]);
  if (!(await saveExtras(admin, ownerId, { userIds }))) return { ok: false, error: "Start the setup first." };
  return { ok: true, saved: Object.keys(userIds).length };
}

/**
 * Adds the five quote fields to the company's Jobber, once: fields this app made before are reused (and brought back
 * if archived). They are transferable, so Jobber copies them to the jobs made from a quote, and read-only, so the
 * office sees what TreeCheck wrote without editing it there.
 */
export async function setupQuoteFields(admin: Admin, ownerId: string, deps: ExtrasDeps = {}): Promise<ExtrasResult<{ created: number; reused: number }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  try {
    type Node = { id?: string; name?: string; archived?: boolean; valueType?: string };
    const { data } = await jobberRead<{ customFieldConfigurations?: { nodes?: Node[] } }>(token, TC_ExtrasQuoteFields, {}, { retries: 1, retryOn: "throttle" });
    const existing = (data.customFieldConfigurations?.nodes ?? []).filter((n) => !!n?.id && !!n.name);
    const fieldIds: Partial<Record<QuoteFieldKey, string>> = {};
    let created = 0;
    let reused = 0;
    for (const f of QUOTE_FIELDS) {
      const found = existing.find((n) => n.name === f.name && n.valueType === f.type);
      if (found?.id) {
        if (found.archived) await jobberMutate(token, TC_ExtrasFieldUnarchive, { ids: [found.id] });
        fieldIds[f.key] = found.id;
        reused++;
        continue;
      }
      const input = { appliesTo: "ALL_QUOTES", name: f.name, transferable: true, readOnly: true };
      type Made = Record<string, { customFieldConfiguration?: { id?: string } | null } | undefined>;
      const made = f.type === "LINK"
        ? (await jobberMutate<Made>(token, TC_ExtrasFieldCreateLink, { input })).data.customFieldConfigurationCreateLink
        : (await jobberMutate<Made>(token, TC_ExtrasFieldCreateText, { input })).data.customFieldConfigurationCreateText;
      const id = made?.customFieldConfiguration?.id;
      if (!id) throw new Error(`Jobber didn't confirm the ${f.name} field`);
      fieldIds[f.key] = id;
      created++;
    }
    if (!(await saveExtras(admin, ownerId, { fieldIds }))) return { ok: false, error: "Start the setup first." };
    return { ok: true, created, reused };
  } catch (e) {
    // Fields made before a failure are found and reused next time, so trying again never makes twins.
    return { ok: false, error: `The quote fields couldn't be added: ${shortJobberError(e)}` };
  }
}

/** Jobber requests from the last 60 days still waiting on an estimate. */
export async function listRequests(admin: Admin, ownerId: string, deps: ExtrasDeps = {}, now = Date.now()): Promise<ExtrasResult<{ requests: OpenRequest[] }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  try {
    const after = new Date(now - REQUEST_DAYS * 86_400_000).toISOString();
    const { data } = await jobberRead<{ requests?: { nodes?: JobberRequestNode[] } }>(token, TC_ExtrasRequests, { after }, { retries: 1, retryOn: "throttle" });
    return { ok: true, requests: openRequests(data.requests?.nodes ?? []) };
  } catch (e) {
    return { ok: false, error: `Jobber's requests couldn't be read: ${shortJobberError(e)}` };
  }
}

export interface ExtrasEstimate {
  id: string; number: number; salesperson_id: string | null; work_items: PricedItem[] | null;
  customer: Record<string, string | undefined> | null;
}

/**
 * What a send adds to the quote when the extras are on: each work line's Jobber product, the salesperson, the request
 * the estimate started from (with its client, so the quote lands on the same one) and the five fields. Null when off.
 * Never throws: a send goes ahead without the extras rather than fail on them.
 */
export async function quoteExtrasFor(admin: Admin, token: string, ownerId: string, est: ExtrasEstimate, def: RateCardDefinition): Promise<{ extras: QuoteExtras; requestClientId: string | null } | null> {
  try {
    if (!(await extrasSwitchOn(admin))) return null;
    const s = await readExtras(admin, ownerId);
    let requestId: string | null = null;
    let requestClientId: string | null = null;
    const askedFor = est.customer?.jobberRequestId;
    if (askedFor) {
      try {
        type Reply = { request?: { id: string; client?: { id?: string } | null } | null };
        const { data } = await jobberRead<Reply>(token, TC_ExtrasRequest, { id: askedFor }, { retries: 1, retryOn: "throttle" });
        if (data.request?.id) {
          requestId = data.request.id;
          requestClientId = data.request.client?.id ?? null;
        }
      } catch (e) {
        console.warn("[productionJobberExtras] request not read, quote goes without it", shortJobberError(e));
      }
    }
    let fieldValues: QuoteExtras["fieldValues"] = null;
    if (s.fieldIds && Object.keys(s.fieldIds).length) {
      const { data: eq } = await admin.from("production_equipment").select("equipment_key, name").eq("contractor_id", ownerId);
      const equipmentNames = Object.fromEntries(((eq ?? []) as { equipment_key: string; name: string | null }[]).map((e) => [e.equipment_key, e.name ?? ""]));
      fieldValues = quoteFieldValues(def, est.work_items ?? [], { estimateUrl: `${APP_URL}/dashboard/instant-estimator/crew/${est.id}`, estimateNumber: est.number, equipmentNames });
    }
    return {
      extras: {
        productIds: s.productIds ?? {}, salespersonId: est.salesperson_id ? s.userIds?.[est.salesperson_id] ?? null : null,
        requestId, fieldIds: s.fieldIds ?? {}, fieldValues,
      },
      requestClientId,
    };
  } catch (e) {
    console.warn("[productionJobberExtras] extras skipped", String((e as Error)?.message ?? e).slice(0, 200));
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// Actual hours from Jobber's time sheets

/**
 * A Jobber job's time entries and expenses as the actual hours of the crew jobs linked to it, split by their estimated
 * man-hours when there are several. Read only; nothing is saved here.
 */
export async function jobberActuals(admin: Admin, ownerId: string, jobId: string, deps: ExtrasDeps = {}, now = Date.now()): Promise<ExtrasResult<{ byPacket: Record<string, ActualsFromJobber> }>> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, error: NOT_CONNECTED };
  const { data: rows } = await admin.from("production_packets").select("id, est_man_hours").eq("contractor_id", ownerId).eq("jobber_job_id", jobId);
  const packets = ((rows ?? []) as { id: string; est_man_hours: number | string | null }[]).map((p) => ({ id: p.id, estManHours: Number(p.est_man_hours) || 0 }));
  if (!packets.length) return { ok: true, byPacket: {} };
  try {
    type Conn<T> = { totalCount?: number | null; nodes?: T[] | null } | null;
    type Reply = { job?: { id: string; jobNumber?: number | string | null; timeSheetEntries?: Conn<JobberTimeEntry>; expenses?: Conn<JobberExpense> } | null };
    const { data } = await jobberRead<Reply>(token, TC_ExtrasJobTime, { id: jobId }, { retries: 1, retryOn: "throttle" });
    const job = data.job;
    if (!job) return { ok: false, error: "That job is no longer in Jobber." };
    const entries = (job.timeSheetEntries?.nodes ?? []).filter((e) => !!e?.id);
    const expenses = (job.expenses?.nodes ?? []).filter((x) => !!x?.id);
    const partial = (job.timeSheetEntries?.totalCount ?? 0) > entries.length || (job.expenses?.totalCount ?? 0) > expenses.length;
    const shares = jobShares(packets);
    const readAt = new Date(now).toISOString();
    const jobNumber = job.jobNumber == null ? null : String(job.jobNumber);
    const byPacket: Record<string, ActualsFromJobber> = {};
    for (const p of packets) {
      const a = actualsFromJobber(entries, expenses, { share: shares[p.id], partial, jobNumber, readAt });
      if (a) byPacket[p.id] = a;
    }
    return { ok: true, byPacket };
  } catch (e) {
    return { ok: false, error: `Jobber's time sheets couldn't be read: ${shortJobberError(e)}` };
  }
}

/**
 * When Jobber closes a job: its time sheets become the suggested actual hours of each linked crew job that has none
 * saved yet (production_packets.actuals.fromJobber). Hours someone saved are never touched. Only with the extras on;
 * never throws. Returns how many crew jobs got a suggestion.
 */
export async function fillActualsFromJobber(admin: Admin, ownerId: string, jobId: string, deps: ExtrasDeps = {}, now = Date.now()): Promise<number> {
  try {
    if (!(await extrasSwitchOn(admin))) return 0;
    const r = await jobberActuals(admin, ownerId, jobId, deps, now);
    if (r.ok === false) {
      console.warn("[productionJobberExtras] time sheets not read", r.error);
      return 0;
    }
    const ids = Object.keys(r.byPacket);
    if (!ids.length) return 0;
    const { data: rows } = await admin.from("production_packets").select("id, actuals, updated_at").in("id", ids);
    let filled = 0;
    for (const row of (rows ?? []) as { id: string; actuals: Record<string, unknown> | null; updated_at: string }[]) {
      if (typeof row.actuals?.manHours === "number") continue;
      const { data } = await admin.from("production_packets").update({ actuals: { fromJobber: r.byPacket[row.id] } })
        .eq("id", row.id).eq("updated_at", row.updated_at).select("id");
      if (data?.length) filled++;
    }
    return filled;
  } catch (e) {
    console.warn("[productionJobberExtras] time sheets skipped", String((e as Error)?.message ?? e).slice(0, 200));
    return 0;
  }
}
