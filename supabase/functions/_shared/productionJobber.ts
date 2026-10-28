// Large-company setup: crew estimates in Jobber. sendEstimate makes the estimate's draft quote in Jobber (TreeCheck
// never sends it to the customer: the office checks it and sends it from Jobber), checkEstimate finds a quote Jobber
// made without confirming it, and the event handlers (production-jobber, which jobber-webhook calls) follow the quote's
// approval and the jobs and visits the office makes from it. Once Jobber approves the app's extra permissions and
// production_rollout.jobber_extras is on, the quote also carries the approval extras (productionJobberExtras.ts).
// Server-side only. Maintained outside Lovable.
//
// One attempt per estimate, as in jobberQuote.ts: production_estimates.quote_state is claimed with a conditional
// update before anything goes to Jobber, and a claim left behind by a crash counts as abandoned after 5 minutes.
// "uncertain" means Jobber may have made the quote without confirming it; TreeCheck never makes another one by itself
// after that, and checkEstimate looks for it among the client's quotes. TreeCheck never creates Jobber jobs: the
// office converts the quote, and the job events link the packets and bring back the visit day and completion. Packets
// get links, the scheduled day and done from here, never a price.

import { deadline, JobberDefiniteError, JobberUncertainError, jobberMutate, jobberRead, shortJobberError, tokenFor } from "./jobberApi.ts";
import { jobberSwitches, killSwitchOn, type JobberSwitches } from "./jobberSwitches.ts";
import { parseUsAddress } from "./jobberAddress.ts";
import { findOrCreateClient } from "./jobberClient.ts";
import { TC_QuoteCreate } from "./jobberQueries.quote.ts";
import { TC_ProductionClientQuotes, TC_ProductionJob, TC_ProductionQuote, TC_ProductionVisit } from "./jobberQueries.production.ts";
import { completionDecision } from "./jobberStatus.ts";
import { localDateOf } from "./freeDays.ts";
import { activateEstimate } from "./productionActivate.ts";
import { backlogNow, companySettings } from "./productionData.ts";
import { fillActualsFromJobber, quoteExtrasFor } from "./productionJobberExtras.ts";
import { withQuoteExtras } from "./production/jobberExtras.ts";
import { parseDefinition } from "./production/rules.ts";
import type { PricedItem } from "./production/estimate.ts";
import {
  chosenFromQuote, matchLineIds, packetsForJob, quoteCreateAttributes, quotePlan, withoutTextOnly, workWindowText,
  type JobberQuoteLine, type QuotePlan,
} from "./production/quoteLines.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** For tests: replacements for the token, the switches (province and time zone only), the clock and the time budget. */
export interface ProductionJobberDeps {
  token?: (admin: Admin, ownerId: string) => Promise<string | null>;
  switches?: (admin: Admin, ownerId: string) => Promise<JobberSwitches>;
  now?: () => number;
  budgetMs?: number;
}

export type SendOutcome =
  | { state: "sent"; quoteId: string; quoteNumber: string | null }
  | { state: "exists"; quoteId: string; quoteNumber: string | null }
  | { state: "busy" }
  | { state: "uncertain"; error: string }
  | { state: "not_found" }
  | { state: "not_connected" }
  | { state: "off" }
  | { state: "invalid"; error: string }
  | { state: "failed"; error: string };

export const UNCERTAIN_TEXT = "Jobber may have made the quote but didn't confirm it. Press Check Jobber before sending again.";
const BUDGET_MS = 40_000;
const CLAIM_STALE_MS = 5 * 60_000;
const OPEN = ["draft", "sent", "changes_requested"];
const EST_COLUMNS =
  "id, contractor_id, status, number, customer, trees, work_items, totals, promised_window, rate_card_id, salesperson_id, " +
  "jobber_client_id, jobber_property_id, jobber_quote_id, jobber_quote_number, quote_state, quote_claimed_at, sent_snapshot";

function env(key: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(key);
}
/** True when the secret TC_PRODUCTION_KILL is "1": crew estimates stop talking to Jobber, nothing else changes. */
export const productionKillOn = () => env("TC_PRODUCTION_KILL")?.trim() === "1";

/** The kill switches, then the company being in the rollout with its own crews (production_status's rule, by owner). */
export async function productionJobberOn(admin: Admin, ownerId: string): Promise<boolean> {
  if (killSwitchOn() || productionKillOn() || !ownerId) return false;
  try {
    const [rollout, company] = await Promise.all([
      admin.from("production_rollout").select("live, test_owner_ids").eq("id", 1).maybeSingle(),
      admin.from("company_settings").select("operating_model").eq("contractor_id", ownerId).maybeSingle(),
    ]);
    if (rollout.error || company.error) return false;
    const r = rollout.data as { live?: boolean; test_owner_ids?: string[] } | null;
    const inRollout = r?.live === true || (Array.isArray(r?.test_owner_ids) && r!.test_owner_ids!.includes(ownerId));
    return inRollout && ["employees", "hybrid"].includes(String(company.data?.operating_model ?? ""));
  } catch {
    return false;
  }
}

interface EstimateRow {
  id: string; status: string; number: number; customer: Record<string, string | undefined> | null; trees: { key: string; label?: string | null }[] | null;
  work_items: PricedItem[] | null; totals: { discountKey?: string | null; paymentPlanKey?: string | null } | null;
  promised_window: { from?: string | null } | null; rate_card_id: string; salesperson_id: string | null;
  jobber_client_id: string | null; jobber_property_id: string | null; jobber_quote_id: string | null; jobber_quote_number: string | null;
  quote_state: string | null; quote_claimed_at: string | null; sent_snapshot: { title?: string; plan?: QuotePlan } | null;
}

async function loadEstimate(admin: Admin, ownerId: string, estimateId: string): Promise<EstimateRow | null> {
  const { data } = await admin.from("production_estimates").select(EST_COLUMNS).eq("id", estimateId).eq("contractor_id", ownerId).maybeSingle();
  return (data ?? null) as EstimateRow | null;
}

async function cardOf(admin: Admin, rateCardId: string) {
  const { data } = await admin.from("production_rate_cards").select("definition").eq("id", rateCardId).maybeSingle();
  const parsed = data ? parseDefinition(data.definition) : null;
  return parsed && parsed.kind === "ok" ? parsed.def : null;
}

async function salespersonName(admin: Admin, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
  return (data?.full_name as string | null) ?? null;
}

/** The quote as TreeCheck will send it, from the estimate as saved. */
async function planFor(admin: Admin, ownerId: string, est: EstimateRow, def: NonNullable<Awaited<ReturnType<typeof cardOf>>>) {
  const settings = await companySettings(admin, ownerId);
  let unitCosts: Record<string, number> | null = null;
  if (settings.send_unit_cost) {
    const { data } = await admin.from("production_estimate_costs").select("items").eq("estimate_id", est.id).maybeSingle();
    const rows = (data?.items ?? []) as { id: string; cost?: { total?: number } }[];
    unitCosts = Object.fromEntries(rows.filter((c) => Number.isFinite(c.cost?.total)).map((c) => [c.id, c.cost!.total as number]));
  }
  const backlog = await backlogNow(admin, ownerId, settings).catch(() => null);
  const plan = quotePlan(def, {
    items: est.work_items ?? [], trees: est.trees ?? [],
    discountKey: est.totals?.discountKey ?? null, paymentPlanKey: est.totals?.paymentPlanKey ?? null,
    salespersonName: await salespersonName(admin, est.salesperson_id),
    isa: est.salesperson_id ? settings.isa_credentials?.[est.salesperson_id] ?? null : null,
    workWindow: workWindowText(est.promised_window?.from ?? null, backlog), unitCosts,
  });
  return { plan, backlog };
}

type Created = { kind: "ok"; id: string; quoteNumber: string | null; plan: QuotePlan } | { kind: "uncertain" } | { kind: "refused"; error: string };
type AddExtras = (attributes: Record<string, unknown>, plan: QuotePlan) => Record<string, unknown>;

/**
 * quoteCreate, once. Only when Jobber definitely refuses: again without the approval extras (when there were any),
 * then with text-only lines sent as $0 lines. Never again after an answer Jobber may have acted on.
 */
async function createQuote(token: string, plan: QuotePlan, clientId: string, propertyId: string, signal: AbortSignal, extras: AddExtras | null = null): Promise<Created> {
  type Reply = { quoteCreate?: { quote?: { id?: string; quoteNumber?: string | number | null } | null } | null };
  const attempt = async (p: QuotePlan, withExtras: boolean) => {
    const attributes = quoteCreateAttributes(p, clientId, propertyId);
    return (await jobberMutate<Reply>(token, TC_QuoteCreate, { attributes: withExtras && extras ? extras(attributes, p) : attributes }, { signal })).data.quoteCreate?.quote ?? null;
  };
  const tries: [QuotePlan, boolean][] = [...(extras ? [[plan, true] as [QuotePlan, boolean]] : []), [plan, false]];
  if (plan.lineItems.some((l) => l.textOnly)) tries.push([withoutTextOnly(plan), false]);
  let error = "";
  for (const [used, withExtras] of tries) {
    try {
      const quote = await attempt(used, withExtras);
      if (!quote?.id) return { kind: "uncertain" };
      return { kind: "ok", id: quote.id, quoteNumber: quote.quoteNumber == null ? null : String(quote.quoteNumber), plan: used };
    } catch (e) {
      if (e instanceof JobberUncertainError) return { kind: "uncertain" };
      error = shortJobberError(e);
      const refused = e instanceof JobberDefiniteError && (e.kind === "user_errors" || e.kind === "graphql");
      if (!refused) return { kind: "refused", error };
    }
  }
  return { kind: "refused", error };
}

/** Stores the quote on the estimate (with each item's Jobber line) and marks the estimate sent, which freezes it. */
async function recordQuote(admin: Admin, token: string, est: EstimateRow, quoteId: string, quoteNumber: string | null, plan: QuotePlan, backlog: number | null, now: number): Promise<SendOutcome> {
  let lineIds: Record<string, string> = {};
  try {
    const { data } = await jobberRead<{ quote?: { lineItems?: { nodes?: JobberQuoteLine[] } } | null }>(token, TC_ProductionQuote, { id: quoteId }, { retries: 1 });
    lineIds = matchLineIds(plan, data.quote?.lineItems?.nodes ?? []);
  } catch (e) {
    // Approval then reads the line flags instead; nothing else depends on the line ids.
    console.warn("[productionJobber] quote lines not read", shortJobberError(e));
  }
  const items = (est.work_items ?? []).map((i) => ({ ...i, jobberLineId: lineIds[i.id] ?? null }));
  const { error } = await admin.from("production_estimates").update({
    jobber_quote_id: quoteId, jobber_quote_number: quoteNumber, quote_state: "pending", quote_error: null, work_items: items,
  }).eq("id", est.id);
  if (error) {
    // The quote exists in Jobber but its id wasn't saved: never make another one by itself.
    console.error("[productionJobber] saving the quote failed", error.message ?? error);
    await admin.from("production_estimates").update({ quote_state: "uncertain", quote_error: UNCERTAIN_TEXT }).eq("id", est.id);
    return { state: "uncertain", error: UNCERTAIN_TEXT };
  }
  const at = new Date(now).toISOString();
  await admin.from("production_estimates").update({ status: "sent", sent_at: at, sent_snapshot: { title: plan.title, plan, at }, backlog_weeks_at_send: backlog })
    .eq("id", est.id).eq("status", "draft");
  return { state: "sent", quoteId, quoteNumber };
}

/** Makes the estimate's draft quote in Jobber, once. Never throws. */
export async function sendEstimate(admin: Admin, input: { ownerId: string; estimateId: string }, deps: ProductionJobberDeps = {}): Promise<SendOutcome> {
  if (killSwitchOn() || productionKillOn()) return { state: "off" };
  const now = (deps.now ?? Date.now)();
  const est = await loadEstimate(admin, input.ownerId, input.estimateId);
  if (!est) return { state: "invalid", error: "That estimate wasn't found." };
  if (est.jobber_quote_id) return { state: "exists", quoteId: est.jobber_quote_id, quoteNumber: est.jobber_quote_number };
  if (est.quote_state === "uncertain") return { state: "uncertain", error: UNCERTAIN_TEXT };
  if (est.status !== "draft") return { state: "invalid", error: "Only a draft goes to Jobber. Use Revise to make a new version." };
  const items = est.work_items ?? [];
  if (!items.length) return { state: "invalid", error: "Add the work first." };
  const unpriced = items.find((i) => i.status !== "ok");
  if (unpriced) return { state: "invalid", error: `Finish this first: ${unpriced.serviceName}, ${unpriced.message ?? "no price yet"}.` };
  const switches = await (deps.switches ?? jobberSwitches)(admin, input.ownerId);
  const customer = est.customer ?? {};
  const address = parseUsAddress(customer.address, { defaultProvince: switches.defaultProvince });
  if (!address) return { state: "invalid", error: "Add the customer's street address first." };
  const def = await cardOf(admin, est.rate_card_id);
  if (!def) return { state: "failed", error: "This estimate's rate card can't be read." };
  const { plan, backlog } = await planFor(admin, input.ownerId, est, def);

  // Claim the estimate: only a first attempt, one that failed, or one a crash abandoned.
  const claimedAt = new Date(now).toISOString();
  const staleBefore = new Date(now - CLAIM_STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await admin.from("production_estimates")
    .update({ quote_state: "creating", quote_claimed_at: claimedAt, quote_error: null, sent_snapshot: { title: plan.title, plan, at: claimedAt } })
    .eq("id", est.id).eq("status", "draft").is("jobber_quote_id", null)
    .or(`quote_state.is.null,quote_state.in.(failed,not_created),and(quote_state.eq.creating,quote_claimed_at.lt.${staleBefore})`)
    .select("id");
  if (claimError) return { state: "failed", error: "TreeCheck couldn't save the quote's progress." };
  if (!claimed?.length) {
    const latest = await loadEstimate(admin, input.ownerId, est.id);
    if (latest?.jobber_quote_id) return { state: "exists", quoteId: latest.jobber_quote_id, quoteNumber: latest.jobber_quote_number };
    if (latest?.quote_state === "uncertain") return { state: "uncertain", error: UNCERTAIN_TEXT };
    if (latest?.quote_state === "creating") return { state: "busy" };
    return { state: "invalid", error: "This estimate changed meanwhile. Refresh and try again." };
  }
  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await admin.from("production_estimates").update(patch).eq("id", est.id);
    if (error) console.error("[productionJobber] saving the quote's progress failed", error.message ?? error);
  };

  try {
    const token = await (deps.token ?? tokenFor)(admin, input.ownerId);
    if (!token) {
      await finish({ quote_state: "not_created", quote_error: "Jobber isn't connected." });
      return { state: "not_connected" };
    }
    // The approval extras (off until Jobber approves the app's permissions); null when off.
    const extras = await quoteExtrasFor(admin, token, input.ownerId, est, def);
    // The token is in hand before the budget starts (the token rule in jobberApi.ts).
    const signal = deadline(deps.budgetMs ?? BUDGET_MS);
    const client = await findOrCreateClient(
      token,
      { name: customer.name?.trim() || null, email: customer.email?.trim() || null, phone: customer.phone?.trim() || null, address },
      { signal, needProperty: true, storedClientId: est.jobber_client_id ?? extras?.requestClientId ?? null },
    );
    if (!client.propertyId) {
      await finish({ quote_state: "failed", quote_error: "Jobber has no property for this customer." });
      return { state: "failed", error: "Jobber has no property for this customer." };
    }
    // Saved before the quote, so checkEstimate can look among this client's quotes if Jobber doesn't confirm it.
    await finish({ jobber_client_id: client.clientId, jobber_property_id: client.propertyId });
    const addExtras: AddExtras | null = extras ? (attributes, p) => withQuoteExtras(attributes, p, est.work_items ?? [], extras.extras) : null;
    const made = await createQuote(token, plan, client.clientId, client.propertyId, signal, addExtras);
    if (made.kind === "uncertain") {
      await finish({ quote_state: "uncertain", quote_error: UNCERTAIN_TEXT });
      return { state: "uncertain", error: UNCERTAIN_TEXT };
    }
    if (made.kind === "refused") {
      await finish({ quote_state: "failed", quote_error: made.error.slice(0, 500) });
      return { state: "failed", error: made.error };
    }
    return await recordQuote(admin, token, est, made.id, made.quoteNumber, made.plan, backlog, now);
  } catch (e) {
    const error = shortJobberError(e);
    await finish({ quote_state: "failed", quote_error: error.slice(0, 500) });
    return { state: "failed", error };
  }
}

/** After an uncertain send: finds the quote among the client's quotes made since the claim, or frees the estimate to send again. */
export async function checkEstimate(admin: Admin, input: { ownerId: string; estimateId: string }, deps: ProductionJobberDeps = {}): Promise<SendOutcome> {
  if (killSwitchOn() || productionKillOn()) return { state: "off" };
  const now = (deps.now ?? Date.now)();
  const est = await loadEstimate(admin, input.ownerId, input.estimateId);
  if (!est) return { state: "invalid", error: "That estimate wasn't found." };
  if (est.jobber_quote_id) return { state: "exists", quoteId: est.jobber_quote_id, quoteNumber: est.jobber_quote_number };
  const claimed = Date.parse(String(est.quote_claimed_at ?? ""));
  const abandoned = est.quote_state === "creating" && Number.isFinite(claimed) && claimed < now - CLAIM_STALE_MS;
  if (est.quote_state !== "uncertain" && !abandoned) return { state: "invalid", error: "There is nothing to check. Send it to Jobber." };
  const free = async () => {
    await admin.from("production_estimates").update({ quote_state: "not_created", quote_error: null }).eq("id", est.id).is("jobber_quote_id", null);
    return { state: "not_found" } as SendOutcome;
  };
  // No client was reached yet, so Jobber can't hold a quote for this estimate.
  if (!est.jobber_client_id || !Number.isFinite(claimed)) return await free();
  const token = await (deps.token ?? tokenFor)(admin, input.ownerId);
  if (!token) return { state: "not_connected" };
  try {
    type Reply = { quotes?: { nodes?: { id: string; quoteNumber?: string | number | null; title?: string | null }[] } };
    const { data } = await jobberRead<Reply>(token, TC_ProductionClientQuotes, { clientId: est.jobber_client_id, after: new Date(claimed - 60_000).toISOString() }, { retries: 1 });
    const title = est.sent_snapshot?.title ?? null;
    const match = (data.quotes?.nodes ?? []).find((q) => !!title && q.title === title);
    if (!match || !est.sent_snapshot?.plan) return await free();
    const settings = await companySettings(admin, input.ownerId);
    const backlog = await backlogNow(admin, input.ownerId, settings).catch(() => null);
    return await recordQuote(admin, token, est, match.id, match.quoteNumber == null ? null : String(match.quoteNumber), est.sent_snapshot.plan, backlog, now);
  } catch (e) {
    return { state: "failed", error: shortJobberError(e) };
  }
}

interface QuoteNode {
  id: string; quoteNumber?: string | number | null; quoteStatus?: string | null;
  lineItems?: { nodes?: JobberQuoteLine[] } | null; approvedLines?: { nodes?: { id: string }[] } | null;
  jobs?: { nodes?: { id: string; jobNumber?: number | null }[] } | null;
}

/** A quote event: approval makes the packets (with the options the customer took), changes requested and archive follow. */
export async function applyQuoteEvent(admin: Admin, ownerId: string, quoteId: string, deps: ProductionJobberDeps = {}, followJobs = true): Promise<string> {
  const { data: est } = await admin.from("production_estimates").select("id, status, work_items, rate_card_id, salesperson_id")
    .eq("jobber_quote_id", quoteId).eq("contractor_id", ownerId).maybeSingle();
  if (!est) return "not a crew estimate";
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return "no Jobber token";
  const { data } = await jobberRead<{ quote?: QuoteNode | null }>(token, TC_ProductionQuote, { id: quoteId }, { retries: 1, retryOn: "throttle" });
  const q = data.quote;
  if (!q) return "quote no longer in Jobber, left as is";
  const status = String(q.quoteStatus ?? "").toLowerCase();
  const number = q.quoteNumber == null ? "" : ` #${q.quoteNumber}`;

  if (status === "approved" || status === "converted") {
    let outcome = `quote${number} ${status}, already ${est.status}`;
    if (OPEN.includes(est.status)) {
      const def = await cardOf(admin, est.rate_card_id);
      if (!def) return "the estimate's rate card can't be read";
      const chosen = chosenFromQuote((est.work_items ?? []) as PricedItem[], q.lineItems?.nodes ?? [], (q.approvedLines?.nodes ?? []).map((n) => n.id));
      const settings = await companySettings(admin, ownerId);
      const r = await activateEstimate(admin, {
        ownerId, estimateId: est.id, def, via: "jobber", by: null, chosen,
        salespersonName: await salespersonName(admin, est.salesperson_id), backlogWeeks: await backlogNow(admin, ownerId, settings).catch(() => null),
        now: new Date((deps.now ?? Date.now)()),
      });
      outcome = r.kind === "ok" ? `approved in Jobber (quote${number}), ${r.packets} packet${r.packets === 1 ? "" : "s"} made` : `quote${number} ${status}, already ${r.kind === "already" ? r.status : "gone"}`;
    }
    // A converted quote has its jobs already: link them now rather than waiting for their own events.
    if (followJobs) for (const j of q.jobs?.nodes ?? []) outcome += `; ${await refreshJob(admin, ownerId, j.id, deps)}`;
    return outcome;
  }
  if (status === "changes_requested") {
    const { data: moved } = await admin.from("production_estimates").update({ status: "changes_requested" })
      .eq("id", est.id).eq("status", "sent").select("id");
    return moved?.length ? `changes requested on quote${number}` : `changes requested on quote${number}, estimate already ${est.status}`;
  }
  if (status === "archived") {
    const { data: lost } = await admin.from("production_estimates").update({ status: "lost", lost_at: new Date((deps.now ?? Date.now)()).toISOString(), lost_reason: "Archived in Jobber" })
      .eq("id", est.id).in("status", ["sent", "changes_requested"]).select("id");
    return lost?.length ? `quote${number} archived in Jobber, marked lost` : `quote${number} archived, estimate already ${est.status}`;
  }
  if (status === "awaiting_response" && est.status === "changes_requested") {
    await admin.from("production_estimates").update({ status: "sent" }).eq("id", est.id).eq("status", "changes_requested");
    return `quote${number} sent again`;
  }
  return `quote${number} ${status || "unknown"}, nothing to do`;
}

interface JobNode {
  id: string; jobNumber?: number | string | null; jobStatus?: string | null; completedAt?: string | null;
  quote?: { id?: string | null; jobs?: { nodes?: { id: string }[] } | null } | null;
  visitsInfo?: { incompleteTotal?: number | null } | null;
  visits?: { nodes?: ({ id: string; startAt?: string | null; endAt?: string | null; isComplete?: boolean | null } | null)[] } | null;
  lineItems?: { nodes?: { name?: string | null }[] } | null;
}

/** The day the crew is booked: the first open visit's start day in the company's zone (or the first visit's when all are done). */
function scheduledDay(job: JobNode, timezone: string): string | null {
  const visits = (job.visits?.nodes ?? []).filter((v): v is NonNullable<typeof v> => !!v && !!v.startAt);
  const open = visits.filter((v) => v.isComplete !== true);
  const pick = (open.length ? open : visits).map((v) => v.startAt as string).sort()[0];
  if (!pick) return null;
  try {
    return localDateOf(pick, timezone);
  } catch {
    return null;
  }
}

/**
 * A job made from a crew estimate's quote: links its packets, brings back the scheduled day, and marks them done when
 * Jobber closed the job with its visits done. Writes are conditional, so an office change is never overwritten.
 */
export async function refreshJob(admin: Admin, ownerId: string, jobId: string, deps: ProductionJobberDeps = {}): Promise<string> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return "no Jobber token";
  const { data } = await jobberRead<{ job?: JobNode | null }>(token, TC_ProductionJob, { id: jobId }, { retries: 1, retryOn: "throttle" });
  const job = data.job;
  if (!job) {
    const { data: unlinked } = await admin.from("production_packets").update({ jobber_job_id: null, jobber_job_number: null, scheduled_date: null })
      .eq("contractor_id", ownerId).eq("jobber_job_id", jobId).select("id");
    return unlinked?.length ? `job deleted in Jobber, ${unlinked.length} packet${unlinked.length === 1 ? "" : "s"} unlinked` : "job not in Jobber";
  }
  const quoteId = job.quote?.id;
  if (!quoteId) return "not a crew job";
  const { data: est } = await admin.from("production_estimates").select("id, status").eq("jobber_quote_id", quoteId).eq("contractor_id", ownerId).maybeSingle();
  if (!est) return "not a crew job";
  const number = job.jobNumber == null ? "" : ` #${job.jobNumber}`;
  // A job exists, so the quote was converted: approve first if its own event hasn't arrived yet.
  if (OPEN.includes(est.status)) {
    const approval = await applyQuoteEvent(admin, ownerId, quoteId, { ...deps, token: async () => token }, false);
    console.log("[productionJobber]", approval);
  }
  const { data: rows } = await admin.from("production_packets").select("id, jobber_job_id, scope, status").eq("estimate_id", est.id);
  type Row = { id: string; jobber_job_id: string | null; scope: { tree: string | null; service: string }[]; status: string };
  const packets = (rows ?? []) as Row[];
  const ids = packetsForJob(packets, job.id, (job.lineItems?.nodes ?? []).map((l) => String(l.name ?? "")), job.quote?.jobs?.nodes?.length ?? 1);
  if (!ids.length) return `job${number}: no packet to link`;

  const switches = await (deps.switches ?? jobberSwitches)(admin, ownerId);
  const day = scheduledDay(job, switches.timezone);
  await admin.from("production_packets").update({ jobber_job_id: job.id, jobber_job_number: job.jobNumber == null ? null : String(job.jobNumber), scheduled_date: day })
    .in("id", ids);
  if (day) await admin.from("production_packets").update({ status: "scheduled" }).in("id", ids).in("status", ["ready", "planned"]);

  const visits = (job.visits?.nodes ?? []).filter(Boolean);
  const decision = completionDecision(
    { jobStatus: job.jobStatus ?? null, completedAt: job.completedAt ?? null, incompleteVisits: job.visitsInfo?.incompleteTotal ?? null, completedVisits: visits.filter((v) => v?.isComplete === true).length },
    { workflowStatus: "open", completionSyncedAt: null, jobberCompletedAt: null },
  );
  let done = 0;
  let fromTime = 0;
  if (decision === "complete") {
    const { data: finished } = await admin.from("production_packets").update({ status: "done", completed_at: job.completedAt ?? new Date((deps.now ?? Date.now)()).toISOString() })
      .in("id", ids).not("status", "in", "(done,cancelled)").select("id");
    done = finished?.length ?? 0;
    // With the approval extras on, the job's time sheets become the suggested actual hours (never over saved ones).
    fromTime = await fillActualsFromJobber(admin, ownerId, job.id, { token: async () => token }, (deps.now ?? Date.now)());
  }
  const hoursNote = fromTime ? `hours from Jobber's time sheets on ${fromTime} to check` : "actual hours still to enter";
  return `job${number}: ${ids.length} packet${ids.length === 1 ? "" : "s"} linked${day ? `, scheduled ${day}` : ""}${done ? `, ${done} done (${hoursNote})` : decision === "cancelled" ? ", closed in Jobber with no visit done, left as is" : fromTime ? `, ${hoursNote}` : ""}`;
}

/** A visit event: the job it belongs to is read again. */
export async function refreshVisit(admin: Admin, ownerId: string, visitId: string, deps: ProductionJobberDeps = {}): Promise<string> {
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return "no Jobber token";
  const { data } = await jobberRead<{ visit?: { id: string; job?: { id?: string | null } | null } | null }>(token, TC_ProductionVisit, { id: visitId }, { retries: 1, retryOn: "throttle" });
  const jobId = data.visit?.job?.id;
  if (!jobId) return "visit not in Jobber";
  const { data: linked } = await admin.from("production_estimates").select("id").eq("contractor_id", ownerId).not("jobber_quote_id", "is", null).limit(1);
  if (!linked?.length) return "no crew estimate in Jobber";
  return await refreshJob(admin, ownerId, jobId, deps);
}

/** "Refresh from Jobber" on a packet: the estimate's quote is read again, then each of its jobs. */
export async function refreshEstimate(admin: Admin, ownerId: string, estimateId: string, deps: ProductionJobberDeps = {}): Promise<{ outcome: string; jobs: { id: string; jobNumber: string | null }[] }> {
  const { data: est } = await admin.from("production_estimates").select("jobber_quote_id").eq("id", estimateId).eq("contractor_id", ownerId).maybeSingle();
  if (!est?.jobber_quote_id) return { outcome: "This estimate wasn't sent to Jobber.", jobs: [] };
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { outcome: "Jobber isn't connected.", jobs: [] };
  const withToken = { ...deps, token: async () => token };
  const outcome = await applyQuoteEvent(admin, ownerId, est.jobber_quote_id, withToken);
  const { data } = await jobberRead<{ quote?: QuoteNode | null }>(token, TC_ProductionQuote, { id: est.jobber_quote_id }, { retries: 1, retryOn: "throttle" });
  return { outcome, jobs: (data.quote?.jobs?.nodes ?? []).map((j) => ({ id: j.id, jobNumber: j.jobNumber == null ? null : String(j.jobNumber) })) };
}

/** The office links a packet to one of the jobs made from its estimate's quote (null unlinks it). */
export async function linkPacket(admin: Admin, ownerId: string, packetId: string, jobId: string | null, deps: ProductionJobberDeps = {}): Promise<{ ok: boolean; outcome: string }> {
  const { data: packet } = await admin.from("production_packets").select("id, estimate_id").eq("id", packetId).eq("contractor_id", ownerId).maybeSingle();
  if (!packet) return { ok: false, outcome: "That job packet wasn't found." };
  if (!jobId) {
    await admin.from("production_packets").update({ jobber_job_id: null, jobber_job_number: null }).eq("id", packetId);
    return { ok: true, outcome: "Unlinked from Jobber." };
  }
  const { data: est } = await admin.from("production_estimates").select("jobber_quote_id").eq("id", packet.estimate_id).maybeSingle();
  const token = await (deps.token ?? tokenFor)(admin, ownerId);
  if (!token) return { ok: false, outcome: "Jobber isn't connected." };
  const { data } = await jobberRead<{ job?: JobNode | null }>(token, TC_ProductionJob, { id: jobId }, { retries: 1, retryOn: "throttle" });
  if (!data.job || !est?.jobber_quote_id || data.job.quote?.id !== est.jobber_quote_id) return { ok: false, outcome: "That Jobber job wasn't made from this estimate's quote." };
  await admin.from("production_packets").update({ jobber_job_id: jobId, jobber_job_number: data.job.jobNumber == null ? null : String(data.job.jobNumber) }).eq("id", packetId);
  return { ok: true, outcome: await refreshJob(admin, ownerId, jobId, { ...deps, token: async () => token }) };
}
