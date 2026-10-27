// Receives Jobber webhooks (INVOICE_UPDATE, JOB_UPDATE, etc.) and syncs
// completion state back into lead_closeouts. Creates a matching lead +
// closeout if the Jobber invoice was originated outside the app.
//
// Every event is routed to the ONE TreeCheck company whose Jobber connection holds the event's
// accountId (jobber_tokens.jobber_account_id). An event no company holds is logged and dropped;
// it is never processed with another company's connection. Jobber needs an answer within 1 s, so
// the work runs after the reply (EdgeRuntime.waitUntil) when the runtime supports it.
// For companies with Financial Pulse switched on, job, visit and invoice events also refresh
// the Pulse revenue rows (supabase/functions/_shared/pulse/jobberSync.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJobberToken, jobberHmac, timingSafeEqual } from "../_shared/jobber.ts";
import {
  grantedScopes,
  jobIdsForInvoice,
  jobIdsForVisit,
  markDirty,
  markJobDeleted,
  markPaymentDeleted,
  markVisitDeleted,
  openConnection,
  pulseEnabledFor,
  refreshPaymentsSoon,
  saveState,
  syncOneJob,
  syncOnePayment,
} from "../_shared/pulse/jobberSync.ts";
import { jobberSwitches } from "../_shared/jobberSwitches.ts";
import { completeFromJobber } from "../_shared/jobberCompletion.ts";

/** Time for a payments refresh started by a webhook (W3-10a), inside the background processing. */
const PAYMENTS_WEBHOOK_MS = 25_000;

/**
 * A quick payments refresh after an invoice or quote change. A problem here is logged and does not fail
 * the event (the job update it came with is already saved; the screen's own refresh catches up).
 */
async function paymentsAfterChange(admin: Loose, conn: { ownerId: string; accountId: string; token: string }) {
  try {
    return await refreshPaymentsSoon(admin, conn, Date.now() + PAYMENTS_WEBHOOK_MS);
  } catch (e) {
    console.error("[jobber-webhook] payments refresh failed", String((e as Error)?.message ?? e).slice(0, 200));
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jobber-hmac-sha256",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Untyped Supabase client and Jobber/database rows, as throughout this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const GRAPHQL = "https://api.getjobber.com/api/graphql";
const GQL_VERSION = "2024-04-01";

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const secret = Deno.env.get("JOBBER_CLIENT_SECRET");
  if (!secret) return false;
  // Jobber sends a base64 HMAC-SHA256 of the raw body. Constant-time comparison.
  return timingSafeEqual(header.trim(), await jobberHmac(rawBody, secret));
}

async function gql(token: string, query: string, variables: Record<string, unknown>) {
  const r = await fetch(GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": GQL_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("Jobber GraphQL error: " + JSON.stringify(j.errors ?? j));
  return j.data;
}

async function fetchInvoice(token: string, invoiceId: string) {
  const query = `
    query GetInvoice($id: EncodedId!) {
      invoice(id: $id) {
        id
        invoiceNumber
        invoiceStatus
        total
        subject
        client {
          id
          firstName
          lastName
          companyName
          phones { number primary }
          emails { address primary }
          billingAddress { street city province postalCode country }
        }
      }
    }`;
  const data = await gql(token, query, { id: invoiceId });
  return data?.invoice ?? null;
}

async function fetchJob(token: string, jobId: string) {
  const query = `
    query GetJob($id: EncodedId!) {
      job(id: $id) {
        id
        jobStatus
        completedAt
        total
        title
        client {
          id
          firstName
          lastName
          companyName
          phones { number primary }
          emails { address primary }
          billingAddress { street city province postalCode country }
        }
      }
    }`;
  const data = await gql(token, query, { id: jobId });
  return data?.job ?? null;
}

function primaryPhone(c: Loose) {
  const p = (c?.phones || []).find((x: Loose) => x.primary) || c?.phones?.[0];
  return p?.number || null;
}
function primaryEmail(c: Loose) {
  const e = (c?.emails || []).find((x: Loose) => x.primary) || c?.emails?.[0];
  return e?.address || null;
}
function fullName(c: Loose) {
  return [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim()
    || c?.companyName
    || "Homeowner";
}

// The routed company: its owner plus the owner's team members.
interface Company {
  ownerId: string;
  memberIds: string[];
}

async function companyOf(admin: Loose, ownerId: string): Promise<Company> {
  const { data, error } = await admin.from("profiles").select("id").eq("parent_contractor_id", ownerId);
  if (error) throw new Error("team read failed: " + error.message);
  return { ownerId, memberIds: [ownerId, ...(data ?? []).map((p: Loose) => p.id)] };
}

// Newest lead matching column = value that belongs to the company: created by one of its members,
// or bought by one of its members. Never another company's lead.
async function findCompanyLead(admin: Loose, company: Company, column: string, value: string) {
  const { data: candidates } = await admin.from("leads").select("*")
    .eq(column, value).order("created_at", { ascending: false }).limit(20);
  if (!candidates?.length) return null;
  const { data: purchases } = await admin.from("lead_purchases").select("lead_id")
    .in("lead_id", candidates.map((l: Loose) => l.id)).in("contractor_id", company.memberIds);
  const bought = new Set((purchases ?? []).map((p: Loose) => p.lead_id));
  return candidates.find((l: Loose) =>
    company.memberIds.includes(l.owner_contractor_id) || bought.has(l.id)
  ) ?? null;
}

async function findOrCreateLeadFromClient(
  admin: Loose,
  company: Company,
  client: Loose,
  jobberInvoiceId?: string | null,
  jobberJobId?: string | null,
) {
  const contractorId = company.ownerId;
  const phone = primaryPhone(client);
  const email = primaryEmail(client);

  // Try to match an existing lead of this company first by jobber_client_id, then phone/email.
  let lead: Loose = null;
  if (client?.id) lead = await findCompanyLead(admin, company, "jobber_client_id", client.id);
  if (!lead && phone) lead = await findCompanyLead(admin, company, "customer_phone", phone);
  if (!lead && email) lead = await findCompanyLead(admin, company, "customer_email", email);

  if (lead) {
    // Backfill Jobber ids on the lead so future syncs match instantly.
    const patch: Loose = {};
    if (client?.id && !lead.jobber_client_id) patch.jobber_client_id = client.id;
    if (jobberInvoiceId && !lead.jobber_invoice_id) patch.jobber_invoice_id = jobberInvoiceId;
    if (jobberJobId && !lead.jobber_job_id) patch.jobber_job_id = jobberJobId;
    if (Object.keys(patch).length) {
      await admin.from("leads").update(patch).eq("id", lead.id);
    }
    return lead;
  }

  // Create a new lead from Jobber data.
  const addr = client?.billingAddress;
  const insertLead: Loose = {
    source: "jobber",
    status: "sold_out", // not for sale in-app; it originated in Jobber
    customer_name: fullName(client),
    customer_phone: phone,
    customer_email: email,
    customer_address: addr?.street || null,
    city: addr?.city || null,
    state: addr?.province || null,
    zip_code: addr?.postalCode || null,
    job_type: "Tree Removal",
    urgency: "normal",
    owner_contractor_id: contractorId,
    jobber_client_id: client?.id || null,
    jobber_invoice_id: jobberInvoiceId || null,
    jobber_job_id: jobberJobId || null,
    purchase_count: 1,
  };
  const { data: newLead, error: leadErr } = await admin.from("leads")
    .insert(insertLead).select().single();
  if (leadErr) throw new Error("lead insert failed: " + leadErr.message);

  // Create a purchase row so the lead appears in the contractor's "Your Leads".
  const { data: purchase } = await admin.from("lead_purchases").insert({
    lead_id: newLead.id,
    contractor_id: contractorId,
    price_paid: 0,
  }).select().single();

  return { ...newLead, __purchase_id: purchase?.id };
}

async function ensurePurchase(admin: Loose, contractorId: string, lead: Loose) {
  let { data: purchase } = await admin.from("lead_purchases").select("*")
    .eq("lead_id", lead.id).eq("contractor_id", contractorId).maybeSingle();
  if (!purchase) {
    const { data: p } = await admin.from("lead_purchases").insert({
      lead_id: lead.id,
      contractor_id: contractorId,
      price_paid: 0,
    }).select().single();
    purchase = p;
  }
  return purchase;
}

async function newestCloseout(admin: Loose, company: Company, column: string, value: string) {
  const { data } = await admin.from("lead_closeouts").select("*")
    .eq(column, value).in("contractor_id", company.memberIds)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function upsertCloseoutFromInvoice(admin: Loose, company: Company, lead: Loose, invoice: Loose) {
  const contractorId = company.ownerId;
  // Find an existing closeout of this company to update (by invoice or by lead+contractor).
  let existing: Loose = await newestCloseout(admin, company, "jobber_invoice_id", invoice.id);
  if (!existing) {
    const { data: byLead } = await admin.from("lead_closeouts").select("*")
      .eq("lead_id", lead.id).eq("contractor_id", contractorId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    existing = byLead;
  }

  const amount = Number(invoice.total ?? 0);
  const isPaid = String(invoice.invoiceStatus || "").toLowerCase().includes("paid");

  if (existing) {
    await admin.from("lead_closeouts").update({
      jobber_client_id: invoice.client?.id || existing.jobber_client_id,
      jobber_invoice_id: invoice.id,
      jobber_invoice_number: invoice.invoiceNumber,
      jobber_sync_status: isPaid ? "paid" : "synced",
      jobber_synced_at: new Date().toISOString(),
      sale_amount: existing.sale_amount || amount,
    }).eq("id", existing.id);
    return existing.id;
  }

  // No closeout yet — need a purchase to attach to.
  const purchase = await ensurePurchase(admin, contractorId, lead);

  const { data: created } = await admin.from("lead_closeouts").insert({
    purchase_id: purchase!.id,
    lead_id: lead.id,
    contractor_id: contractorId,
    sale_amount: amount,
    notes: invoice.subject ? `Closed in Jobber: ${invoice.subject}` : "Closed in Jobber",
    source_origin: "jobber",
    jobber_client_id: invoice.client?.id || null,
    jobber_invoice_id: invoice.id,
    jobber_invoice_number: invoice.invoiceNumber,
    jobber_sync_status: isPaid ? "paid" : "synced",
    jobber_synced_at: new Date().toISOString(),
  }).select().single();

  return created?.id;
}

// A completed Jobber job. Stored under jobber_job_id (as jobber-backfill does). Before V1 the job id
// was written into jobber_invoice_id; such rows are still matched and cleaned up here.
async function upsertCloseoutFromJob(admin: Loose, company: Company, lead: Loose, job: Loose) {
  const contractorId = company.ownerId;
  let existing: Loose = await newestCloseout(admin, company, "jobber_job_id", job.id);
  if (!existing) existing = await newestCloseout(admin, company, "jobber_invoice_id", job.id);
  if (!existing) {
    const { data: byLead } = await admin.from("lead_closeouts").select("*")
      .eq("lead_id", lead.id).eq("contractor_id", contractorId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    existing = byLead;
  }

  const amount = Number(job.total ?? 0);

  if (existing) {
    const patch: Loose = {
      jobber_client_id: job.client?.id || existing.jobber_client_id,
      jobber_job_id: job.id,
      // A paid invoice status is never downgraded by a job event.
      jobber_sync_status: existing.jobber_sync_status === "paid" ? "paid" : "synced",
      jobber_synced_at: new Date().toISOString(),
      sale_amount: existing.sale_amount || amount,
    };
    if (existing.jobber_invoice_id === job.id) {
      patch.jobber_invoice_id = null;
      patch.jobber_invoice_number = null;
    }
    await admin.from("lead_closeouts").update(patch).eq("id", existing.id);
    return existing.id;
  }

  const purchase = await ensurePurchase(admin, contractorId, lead);

  const { data: created } = await admin.from("lead_closeouts").insert({
    purchase_id: purchase!.id,
    lead_id: lead.id,
    contractor_id: contractorId,
    sale_amount: amount,
    notes: job.title ? `Closed in Jobber: ${job.title}` : "Closed in Jobber",
    source_origin: "jobber",
    jobber_client_id: job.client?.id || null,
    jobber_job_id: job.id,
    jobber_sync_status: "synced",
    jobber_synced_at: new Date().toISOString(),
  }).select().single();

  return created?.id;
}

interface LegacyResult {
  leadId?: string | null;
  closeoutId?: string | null;
  outcome?: string;
}

// The pre-V1 behaviour (lead/closeout sync and crew-bid quote approval), scoped to the routed company.
async function processLegacy(
  admin: Loose,
  company: Company,
  topic: string,
  itemId: string,
  SUPABASE_URL: string,
  SERVICE: string,
): Promise<LegacyResult> {
  // TreeCheck's Jobber modules (API version 2026-09-25): a job closed in Jobber marks its TreeCheck job
  // complete when the company's completion_sync switch is on. The older import of Jobber invoices and
  // jobs as leads and closeouts below still calls the retired API version, so it runs only with the
  // jobber_import switch on; off, it records an outcome instead of failing and holding up the Pulse part.
  const switches = await jobberSwitches(admin, company.ownerId);
  if (topic.startsWith("JOB_") || topic.startsWith("INVOICE_")) {
    const completion = topic.startsWith("JOB_")
      ? await completeFromJobber(admin, company.ownerId, itemId, { switches: async () => switches })
      : null;
    if (!switches.jobberImport) return { outcome: completion ?? "tc: jobber import off" };
    if (completion) console.log("jobber-webhook:", completion);
  }
  // The older hire-on-approval below never ran before TreeCheck stored Jobber quote ids, and it can hire a
  // crew before the climber confirms days. It stays off unless the company's auto_hire switch is on.
  if (topic.startsWith("QUOTE_") && !switches.autoHire) return { outcome: "tc: auto hire off" };

  const token = await getJobberToken(admin, company.ownerId);
  if (!token) throw new Error("No Jobber token connected");

  if (topic.startsWith("INVOICE_")) {
    const invoice = await fetchInvoice(token, itemId);
    if (!invoice) throw new Error("invoice not found in Jobber");
    const lead = await findOrCreateLeadFromClient(admin, company, invoice.client, invoice.id);
    const closeoutId = await upsertCloseoutFromInvoice(admin, company, lead, invoice);
    return { leadId: lead.id, closeoutId };
  }

  if (topic.startsWith("JOB_")) {
    const job = await fetchJob(token, itemId);
    if (!job) throw new Error("job not found in Jobber");
    const status = String(job.jobStatus || "").toLowerCase();
    if (!(status.includes("archived") || status.includes("complete") || job.completedAt)) {
      // Only act on completed jobs — ignore mid-flight updates.
      return { outcome: `ignored job status: ${job.jobStatus}` };
    }
    const lead = await findOrCreateLeadFromClient(admin, company, job.client, null, job.id);
    const closeoutId = await upsertCloseoutFromJob(admin, company, lead, job);
    return { leadId: lead.id, closeoutId };
  }

  // QUOTE_*: a quote we created when awarding a crew bid. If the customer approved
  // it, the crew is officially hired.
  const { data: bidRequest } = await admin
    .from("bid_requests").select("id, quote_status, hired_at").eq("jobber_quote_id", itemId).maybeSingle();
  let outcome = "no matching bid request";
  if (bidRequest) {
    const qData = await gql(
      token,
      `query GetQuote($id: EncodedId!) { quote(id: $id) { id quoteNumber quoteStatus } }`,
      { id: itemId },
    ).catch(() => null);
    const status = String(qData?.quote?.quoteStatus ?? "").toLowerCase();
    if (status.includes("approved") || status.includes("converted")) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/bid-hire`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ bid_request_id: bidRequest.id }),
      });
      outcome = `quote approved — hire notified (${r.status})`;
    } else {
      const map = status.includes("reject") || status.includes("declin")
        ? "declined"
        : status.includes("expire") ? "expired" : "pending";
      await admin.from("bid_requests").update({ quote_status: map }).eq("id", bidRequest.id);
      if (map === "declined" || map === "expired") {
        await admin.from("bid_requests").update({ status: "closed" }).eq("id", bidRequest.id);
      }
      outcome = `quote ${map}`;
    }
  }
  return { outcome };
}

// Financial Pulse: keep the company's revenue rows current. Only for companies with Pulse on.
async function processPulse(admin: Loose, ownerId: string, topic: string, itemId: string): Promise<string> {
  const conn = await openConnection(admin, ownerId);
  if (!conn) return "pulse: Jobber not connected";
  const scopes = await grantedScopes(admin, conn);
  if (topic === "JOB_DESTROY") {
    await markJobDeleted(admin, ownerId, itemId);
  } else if (topic.startsWith("JOB_")) {
    await syncOneJob(admin, conn, scopes, itemId);
  } else if (topic === "VISIT_DESTROY") {
    await markVisitDeleted(admin, ownerId, itemId);
    await saveState(admin, ownerId, { scheduled_fetched_at: null });
  } else if (topic.startsWith("VISIT_")) {
    if (scopes.visits) {
      for (const jobId of await jobIdsForVisit(conn, itemId)) await syncOneJob(admin, conn, scopes, jobId);
    }
    // The schedule changed: the forecast re-reads it on the next screen open.
    await saveState(admin, ownerId, { scheduled_fetched_at: null });
  } else if (topic.startsWith("INVOICE_") && topic !== "INVOICE_DESTROY") {
    if (scopes.invoices) {
      for (const jobId of await jobIdsForInvoice(conn, itemId)) await syncOneJob(admin, conn, scopes, jobId);
    }
    // A payment recorded on the invoice changes it: read the recent months' payments again (not on a new
    // invoice, which has no payment yet; collecting one sends INVOICE_UPDATE).
    if (topic !== "INVOICE_CREATE") await paymentsAfterChange(admin, conn);
  } else if (topic === "INVOICE_DESTROY") {
    await paymentsAfterChange(admin, conn);
  } else if (topic === "PAYMENT_DESTROY") {
    // Matched by the record id; if Jobber's id here differs, the quick refresh finds it gone.
    if ((await markPaymentDeleted(admin, ownerId, itemId)) === 0) {
      await refreshPaymentsSoon(admin, conn, Date.now() + PAYMENTS_WEBHOOK_MS);
    }
  } else if (topic.startsWith("PAYMENT_")) {
    await syncOnePayment(admin, conn, itemId);
  } else if (topic.startsWith("QUOTE_")) {
    // A deposit taken on a quote (before there is an invoice) shows up as a quote change.
    if (!(await paymentsAfterChange(admin, conn))) return "pulse: payments read moments ago";
  } else {
    return "pulse: topic not used";
  }
  await markDirty(admin, ownerId);
  return "pulse: updated";
}

// Large-company setup: a cheap check that the event can concern one of the company's crew estimates in Jobber (the
// quote itself, or any job or visit while the company has one), then production-jobber does the work with the service
// key, as bid-hire does above. Companies without crew estimates in Jobber (or before PS1 exists) cost one query.
const PRODUCTION_MS = 25_000;
async function productionEvent(
  admin: Loose,
  ownerId: string,
  topic: string,
  itemId: string,
  SUPABASE_URL: string,
  SERVICE: string,
): Promise<string | null> {
  const base = admin.from("production_estimates").select("id").eq("contractor_id", ownerId);
  const { data, error } = topic.startsWith("QUOTE_")
    ? await base.eq("jobber_quote_id", itemId).limit(1)
    : await base.not("jobber_quote_id", "is", null).limit(1);
  if (error || !data?.length) return null;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/production-jobber`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ ownerId, topic, itemId }),
    signal: AbortSignal.timeout(PRODUCTION_MS),
  });
  const reply = await r.json().catch(() => null) as { outcome?: string } | null;
  return `production: ${reply?.outcome ?? `HTTP ${r.status}`}`;
}

// The company whose live Jobber connection holds this Jobber account. No match, no processing.
async function routeOwner(admin: Loose, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const { data, error } = await admin.from("jobber_tokens").select("contractor_id")
    .eq("jobber_account_id", accountId).is("disconnected_at", null).limit(1);
  if (error || !data?.length) return null;
  return data[0].contractor_id as string;
}

// Background processing retries a failed event after these pauses (throttling, a busy sign-in
// refresh, a database blip). Jobber gets its 200 before any of this, so it never retries itself.
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

function isRetryable(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return !/not found in Jobber|No Jobber token connected|reconnect/i.test(msg);
}

async function withRetries<T>(fn: () => Promise<T>, retry: boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!retry || attempt >= RETRY_DELAYS_MS.length || !isRetryable(e)) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

interface WebhookEvent {
  topic: string;
  itemId: string | null;
  accountId: string | null;
  occurredAt: string | null;
  logId: string | null;
}

async function processEvent(
  admin: Loose,
  ev: WebhookEvent,
  SUPABASE_URL: string,
  SERVICE: string,
  background: boolean,
) {
  const { topic, itemId } = ev;
  const finish = async (patch: Record<string, unknown>) => {
    if (!ev.logId) return;
    await admin.from("jobber_webhook_events")
      .update({ processed_at: new Date().toISOString(), ...patch }).eq("id", ev.logId);
  };

  // Jobber retries a delivery with the same occurredAt: process each event once.
  let dedupeKey: string | null = null;
  if (ev.occurredAt && itemId) {
    dedupeKey = `${topic}|${itemId}|${ev.occurredAt}`;
    const { error } = await admin.from("pulse_events").insert({
      source: "jobber",
      external_id: itemId,
      event_type: topic,
      dedupe_key: dedupeKey,
      payload: { topic, itemId, accountId: ev.accountId, occurredAt: ev.occurredAt },
    });
    if (error?.code === "23505") {
      await finish({ processed: true, process_error: "duplicate delivery" });
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    if (error) dedupeKey = null; // inbox unavailable: carry on without it
  }
  const closeInbox = async (err: string | null) => {
    if (!dedupeKey) return;
    await admin.from("pulse_events")
      .update({ processed_at: new Date().toISOString(), attempts: 1, error: err }).eq("dedupe_key", dedupeKey);
  };

  const ownerId = await routeOwner(admin, ev.accountId);
  if (!ownerId) {
    await finish({ processed: true, process_error: "unrouted: no TreeCheck company holds this Jobber account" });
    await closeInbox("unrouted");
    return { status: 200, body: { ok: true, unrouted: true } };
  }

  if (topic === "APP_DISCONNECT") {
    // The owner disconnected TreeCheck inside Jobber: the stored sign-in is dead.
    const { error } = await admin.from("jobber_tokens").update({
      access_token: "",
      refresh_token: "",
      disconnected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("contractor_id", ownerId);
    // The Pulse screen must say Jobber is disconnected (best effort; the sign-in is cleared either way).
    if (!error) await admin.from("pulse_snapshots").update({ dirty: true }).eq("owner_id", ownerId);
    await finish({ processed: !error, process_error: error ? error.message : "app disconnected" });
    await closeInbox(error ? error.message : null);
    return { status: error ? 500 : 200, body: { ok: !error } };
  }

  const errors: string[] = [];
  let legacy: LegacyResult = {};
  let handled = false;
  if (/^(INVOICE|JOB|QUOTE)_/.test(topic) && !topic.endsWith("_DESTROY") && itemId) {
    handled = true;
    try {
      const company = await companyOf(admin, ownerId);
      legacy = await withRetries(
        () => processLegacy(admin, company, topic, itemId, SUPABASE_URL, SERVICE),
        background,
      );
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
    }
  }

  let pulse: string | null = null;
  if (itemId && /^(INVOICE|JOB|VISIT|QUOTE|PAYMENT)_/.test(topic) && await pulseEnabledFor(admin, ownerId)) {
    handled = true;
    try {
      pulse = await withRetries(() => processPulse(admin, ownerId, topic, itemId), background);
    } catch (e) {
      errors.push("pulse: " + String((e as Error).message ?? e));
    }
  }

  // Large-company setup: crew estimates sent to Jobber and the jobs made from them. Its own try, and its outcome is only
  // added to the log, so it never changes how the parts above are recorded.
  let production: string | null = null;
  if (itemId && /^(QUOTE|JOB|VISIT)_/.test(topic)) {
    try {
      production = await productionEvent(admin, ownerId, topic, itemId, SUPABASE_URL, SERVICE);
    } catch (e) {
      production = "production: " + String((e as Error).message ?? e).slice(0, 200);
    }
  }

  let outcome = errors.length
    ? errors.join("; ")
    : legacy.outcome ?? (handled ? pulse : `ignored topic: ${topic}`);
  if (production) outcome = handled || errors.length ? [outcome, production].filter(Boolean).join("; ") : production;
  if (errors.length) console.error("jobber-webhook error", outcome);
  await finish({
    processed: errors.length === 0,
    process_error: outcome ?? null,
    ...(legacy.leadId ? { lead_id: legacy.leadId } : {}),
    ...(legacy.closeoutId ? { closeout_id: legacy.closeoutId } : {}),
  });
  if (errors.length && dedupeKey) {
    // Failed for good: forget the dedupe key so a redelivery of this event is processed again.
    // The failure itself stays in jobber_webhook_events (processed = false, process_error).
    await admin.from("pulse_events").delete().eq("dedupe_key", dedupeKey);
  } else {
    await closeInbox(null);
  }
  return {
    status: errors.length ? 500 : 200,
    body: errors.length
      ? { error: outcome }
      : { ok: true, lead_id: legacy.leadId ?? null, closeout_id: legacy.closeoutId ?? null },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE);

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-jobber-hmac-sha256");
  const signatureValid = await verifySignature(rawBody, sigHeader);

  let payload: Loose = {};
  try { payload = JSON.parse(rawBody); } catch { /* ignore */ }

  // Jobber webhook payload shape: { data: { webHookEvent: { topic, itemId, accountId, occuredAt } } }
  const evt = payload?.data?.webHookEvent ?? payload?.webHookEvent ?? payload;
  const topic = String(evt?.topic || payload?.topic || "unknown");
  const itemId = evt?.itemId || evt?.item?.id || payload?.itemId || null;
  const accountId = evt?.accountId || payload?.accountId || null;
  // Jobber spells it "occuredAt"; accept both.
  const occurredAt = evt?.occurredAt ?? evt?.occuredAt ?? null;

  // Log first — always, so we have a trail even on bad signatures.
  const { data: logRow } = await admin.from("jobber_webhook_events").insert({
    topic,
    item_id: itemId,
    account_id: accountId ? String(accountId) : null,
    payload,
    signature_valid: signatureValid,
  }).select("id").single();

  if (!signatureValid) {
    return json({ error: "invalid signature" }, 401);
  }

  const ev: WebhookEvent = {
    topic,
    itemId: itemId ? String(itemId) : null,
    accountId: accountId ? String(accountId) : null,
    occurredAt: occurredAt ? String(occurredAt) : null,
    logId: logRow?.id ?? null,
  };
  const runtime = (globalThis as Loose).EdgeRuntime;
  const background = typeof runtime?.waitUntil === "function";
  const work = processEvent(admin, ev, SUPABASE_URL, SERVICE, background).catch((e) => {
    console.error("jobber-webhook error", String((e as Error).message ?? e));
    return { status: 500, body: { error: "processing failed" } };
  });

  // Answer Jobber straight away and finish the work after the reply when the runtime allows it.
  if (background) {
    runtime.waitUntil(work);
    return json({ ok: true, queued: true });
  }
  const result = await work;
  return json(result.body, result.status);
});
