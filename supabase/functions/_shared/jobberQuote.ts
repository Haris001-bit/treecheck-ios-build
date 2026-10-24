// TreeCheck Jobber sync: the draft quote in Jobber. It is made when the owner picks a price on the Bid
// Board (quote-pick-alert) or, when no price was picked, when the crew is awarded (bid-award). One quote
// per job: whichever comes second finds it already made. The quote carries the line items, the AI's
// description and the customer's name, address, email and phone, on the customer's existing Jobber
// client when there is one. It stays a Draft for the office to check and send.
// Server-side only. Maintained outside Lovable.
//
// One attempt per job: bid_requests.quote_status is set to "creating" with a conditional update before
// anything is sent to Jobber, and only while it is still empty. So a second caller backs off, and a job
// whose earlier attempt ended without a quote (failed, not connected, switched off) stays with the
// office, which was told then to build it. A claim left behind by a crash counts as abandoned after 5
// minutes. "uncertain" means Jobber may have made the quote without confirming it; TreeCheck never
// makes another one by itself after that, and the office checks Jobber.
//
// Jobs created before the company's switch row (company_jobber_settings.created_at, written when its
// quotes were switched on) never get an automatic quote, because the office may already have quoted them.

import { deadline, JobberUncertainError, jobberMutate, shortJobberError, tokenFor } from "./jobberApi.ts";
import { jobberSwitches, type JobberSwitches } from "./jobberSwitches.ts";
import {
  customerDetails,
  jobCardAddress,
  NO_STREET_REASON,
  type CaptureFields,
  type JobCardFields,
  type LeadFields,
} from "./jobberAddress.ts";
import { buildQuoteLineItems, quoteTemplateFrom, quoteTitle, type QuoteLineItem } from "./quoteBuilder.ts";
import { findOrCreateClient } from "./jobberClient.ts";
import { TC_QuoteCreate } from "./jobberQueries.quote.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** The bid_requests columns the quote reads. */
export interface QuoteRequest extends JobCardFields {
  id: string;
  owner_contractor_id: string;
  title: string;
  description?: string | null;
  needs_stump_grinding?: boolean | null;
  jobber_quote_id?: string | null;
  jobber_quote_number?: string | null;
  quote_status?: string | null;
  capture_id?: string | null;
  lead_id?: string | null;
  created_at?: string | null;
}

/** The scout_captures columns the quote reads. */
export interface QuoteCapture extends CaptureFields {
  final_service?: string | null;
  ai_service?: string | null;
  final_notes?: string | null;
  ai_notes?: string | null;
}

/** The leads columns the quote reads. */
export interface QuoteLead extends LeadFields {
  job_type?: string | null;
  customer_notes?: string | null;
}

/** A job's records and the price for its quote. */
export interface QuoteJob {
  request: QuoteRequest;
  capture?: QuoteCapture | null;
  lead?: QuoteLead | null;
  /** The sale price in dollars: the price picked, or the award's formula price. */
  salePrice: number;
  /** The awarded crew's estimated disposal loads, for the haul-away line. */
  disposalLoads?: number | null;
}

/** What happened to the job's quote. */
export type QuoteOutcome =
  | { state: "created"; quoteId: string; quoteNumber: string | null; clientMatch: string }
  | { state: "exists"; quoteId: string; quoteNumber: string | null }
  | { state: "busy" }
  | { state: "uncertain"; error: string }
  | { state: "off" }
  | { state: "not_connected" }
  | { state: "manual"; reason: string }
  | { state: "failed"; error: string };

/** For tests: replacements for the switch read, the token, the clock and the time budget. */
export interface QuoteDeps {
  switches?: (admin: Admin, ownerId: string) => Promise<JobberSwitches>;
  token?: (admin: Admin, ownerId: string) => Promise<string | null>;
  quotesSince?: (admin: Admin, ownerId: string) => Promise<number | null>;
  now?: () => number;
  budgetMs?: number;
}

export const REQUEST_COLUMNS =
  "id, owner_contractor_id, title, city, description, customer_name, customer_phone, customer_address, " +
  "needs_stump_grinding, jobber_quote_id, jobber_quote_number, quote_status, capture_id, lead_id, created_at";
export const CAPTURE_COLUMNS =
  "customer_name, customer_phone, customer_email, address_street, address_city, address_state, address_zip, " +
  "final_service, ai_service, final_notes, ai_notes";
export const LEAD_COLUMNS = "customer_name, customer_phone, customer_email, customer_address, city, job_type, customer_notes";

const BUDGET_MS = 40_000;
const CLAIM_STALE_MS = 5 * 60_000;
export const UNCERTAIN_TEXT = "Jobber may have made the quote but didn't confirm it. Check Jobber before building one.";
export const STARTED_BEFORE_TEXT = "This job started before automatic Jobber quotes, so handle its quote in Jobber as usual.";
export const NOT_MADE_TEXT = "TreeCheck didn't make a Jobber quote for this job, so handle it in Jobber as usual.";

const present = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The job's request, Scout capture and website lead, or null when the request doesn't exist. */
export async function loadQuoteRecords(admin: Admin, requestId: string) {
  const { data: request } = await admin.from("bid_requests").select(REQUEST_COLUMNS).eq("id", requestId).maybeSingle();
  if (!request) return null;
  let capture: QuoteCapture | null = null;
  let lead: QuoteLead | null = null;
  if (request.capture_id) {
    const { data } = await admin.from("scout_captures").select(CAPTURE_COLUMNS).eq("id", request.capture_id).maybeSingle();
    capture = data ?? null;
  }
  if (request.lead_id) {
    const { data } = await admin.from("leads").select(LEAD_COLUMNS).eq("id", request.lead_id).maybeSingle();
    lead = data ?? null;
  }
  return { request: request as QuoteRequest, capture, lead };
}

/** When the company's automatic quotes were switched on (its company_jobber_settings row was made), or null. */
async function quotesSwitchedOnAt(admin: Admin, ownerId: string): Promise<number | null> {
  const { data, error } = await admin
    .from("company_jobber_settings").select("created_at").eq("contractor_id", ownerId).maybeSingle();
  const at = error ? NaN : Date.parse(String(data?.created_at ?? ""));
  return Number.isFinite(at) ? at : null;
}

/** The service the quote is for: Scout's final or AI service, the website lead's job type, or the job's title. */
export function quoteService(job: Pick<QuoteJob, "request" | "capture" | "lead">): string {
  return present(job.capture?.final_service) || present(job.capture?.ai_service) || present(job.lead?.job_type) ||
    present(job.request.title);
}

/** The AI's description of the work: the job's description, plus Scout's notes when they add something. */
export function quoteOverview(job: Pick<QuoteJob, "request" | "capture" | "lead">): string {
  const base = present(job.request.description) || present(job.lead?.customer_notes);
  const notes = present(job.capture?.final_notes) || present(job.capture?.ai_notes);
  if (!notes || base.includes(notes.slice(0, 60))) return base;
  return base ? `${base}\n\n${notes}` : notes;
}

/**
 * Jobber's line item attributes. Scope lines go as $0 lines rather than text-only lines, which quoteCreate
 * may not take; every line stays out of the saved Products and Services.
 */
export function toJobberLineItems(items: readonly QuoteLineItem[]): Record<string, unknown>[] {
  return items.map((i) => ({
    name: i.name,
    description: i.description,
    quantity: 1,
    unitPrice: i.unitPrice,
    taxable: i.taxable,
    saveToProductsAndServices: false,
  }));
}

/** bid_requests.quote_status as bid-award reports it: "pending" when a quote exists or is being made. */
export function quoteStatusFor(outcome: QuoteOutcome): "pending" | "not_created" {
  return outcome.state === "created" || outcome.state === "exists" || outcome.state === "busy" ? "pending" : "not_created";
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const numbered = (n: string | null) => (n ? ` #${n}` : "");

/** One plain sentence for the office about the job's quote. */
export function officeQuoteLine(outcome: QuoteOutcome, salePrice: number): string {
  switch (outcome.state) {
    case "created":
      return `Draft quote${numbered(outcome.quoteNumber)} is in Jobber for ${money(salePrice)}, ready to check and send.`;
    case "exists":
      return `Jobber quote${numbered(outcome.quoteNumber)} is already in Jobber.`;
    case "busy":
      return "The Jobber quote is being made right now.";
    case "uncertain":
      return outcome.error;
    case "not_connected":
      return "Jobber isn't connected, so build the quote in Jobber.";
    case "manual":
      return outcome.reason;
    case "failed":
      return `Couldn't make the Jobber quote: ${outcome.error.replace(/[.\s]+$/, "")}. Build it in Jobber.`;
    default:
      return "Build the quote in Jobber.";
  }
}

/** Makes the job's draft quote in Jobber, once. Never throws. */
export async function ensureDraftQuote(admin: Admin, job: QuoteJob, deps: QuoteDeps = {}): Promise<QuoteOutcome> {
  const r = job.request;
  if (r.jobber_quote_id) return { state: "exists", quoteId: r.jobber_quote_id, quoteNumber: r.jobber_quote_number ?? null };
  if (r.quote_status === "uncertain") return { state: "uncertain", error: UNCERTAIN_TEXT };

  let switches: JobberSwitches;
  try {
    switches = await (deps.switches ?? jobberSwitches)(admin, r.owner_contractor_id);
  } catch {
    return { state: "off" };
  }
  if (!switches.quotesOnAward) return { state: "off" };

  // A job already under way when the quotes were switched on stays with the office.
  const since = await (deps.quotesSince ?? quotesSwitchedOnAt)(admin, r.owner_contractor_id).catch(() => null);
  const created = Date.parse(String(r.created_at ?? ""));
  if (since === null || !Number.isFinite(created)) return { state: "manual", reason: NOT_MADE_TEXT };
  if (created < since) return { state: "manual", reason: STARTED_BEFORE_TEXT };

  // Claim the job: only a first attempt, or one a crash abandoned.
  const staleBefore = new Date((deps.now ?? Date.now)() - CLAIM_STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("bid_requests")
    .update({ quote_status: "creating" })
    .eq("id", r.id)
    .is("jobber_quote_id", null)
    .or(`quote_status.is.null,and(quote_status.eq.creating,updated_at.lt.${staleBefore})`)
    .select("id");
  if (claimError) return { state: "failed", error: "TreeCheck couldn't save the quote's progress." };
  if (!claimed?.length) {
    const { data: latest } = await admin
      .from("bid_requests").select("jobber_quote_id, jobber_quote_number, quote_status").eq("id", r.id).maybeSingle();
    if (latest?.jobber_quote_id) return { state: "exists", quoteId: latest.jobber_quote_id, quoteNumber: latest.jobber_quote_number ?? null };
    if (latest?.quote_status === "uncertain") return { state: "uncertain", error: UNCERTAIN_TEXT };
    if (latest?.quote_status === "creating") return { state: "busy" };
    return { state: "manual", reason: NOT_MADE_TEXT };
  }

  const finish = async (status: string, extra: Record<string, unknown> = {}) => {
    const { error } = await admin.from("bid_requests").update({ quote_status: status, ...extra }).eq("id", r.id);
    if (error) console.error("jobber quote: saving the outcome failed", status, error.message ?? error);
  };

  try {
    const token = await (deps.token ?? tokenFor)(admin, r.owner_contractor_id);
    if (!token) {
      await finish("not_created");
      return { state: "not_connected" };
    }
    const records = { request: r, capture: job.capture ?? null, lead: job.lead ?? null };
    const sourced = jobCardAddress({ ...records, defaultProvince: switches.defaultProvince });
    if (!sourced) {
      await finish("failed");
      return { state: "failed", error: NO_STREET_REASON };
    }
    const template = quoteTemplateFrom(switches.quoteTemplate);
    const service = quoteService(job);
    const items = buildQuoteLineItems({
      template,
      salePrice: job.salePrice,
      service,
      overview: quoteOverview(job),
      needsStump: r.needs_stump_grinding === true,
      disposalLoads: job.disposalLoads ?? null,
    });
    const title = quoteTitle({ template, service, city: sourced.address.city || r.city });
    const details = customerDetails(records);

    // The token is in hand before the budget starts (the token rule in jobberApi.ts).
    const signal = deadline(deps.budgetMs ?? BUDGET_MS);
    const client = await findOrCreateClient(
      token,
      { name: details.name, email: details.email, phone: details.phone, address: sourced.address },
      { signal, needProperty: true },
    );
    if (!client.propertyId) {
      await finish("failed");
      return { state: "failed", error: "Jobber has no property for this customer." };
    }

    let quote: { id?: string; quoteNumber?: string | number | null } | null | undefined;
    try {
      const { data } = await jobberMutate<{ quoteCreate?: { quote?: { id?: string; quoteNumber?: string | number | null } | null } | null }>(
        token,
        TC_QuoteCreate,
        { attributes: { clientId: client.clientId, propertyId: client.propertyId, title, lineItems: toJobberLineItems(items) } },
        { signal },
      );
      quote = data.quoteCreate?.quote;
    } catch (e) {
      if (e instanceof JobberUncertainError) {
        await finish("uncertain");
        return { state: "uncertain", error: UNCERTAIN_TEXT };
      }
      throw e;
    }
    if (!quote?.id) {
      await finish("uncertain");
      return { state: "uncertain", error: UNCERTAIN_TEXT };
    }
    const quoteNumber = quote.quoteNumber == null ? null : String(quote.quoteNumber);
    await finish("pending", { jobber_quote_id: quote.id, jobber_quote_number: quoteNumber });
    return { state: "created", quoteId: quote.id, quoteNumber, clientMatch: client.match };
  } catch (e) {
    await finish("failed");
    return { state: "failed", error: shortJobberError(e) };
  }
}
