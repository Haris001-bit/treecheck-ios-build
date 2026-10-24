// Financial Pulse: reads a company's jobs and visits from Jobber into jobber_jobs,
// jobber_visit_revenue and jobber_sync_state. Used by jobber-revenue-sync and jobber-webhook.
// Server-side only (service role).

import {
  getJobberToken,
  JobberGraphqlError,
  jobberGraphql,
  PULSE_JOBBER_VERSION,
} from "../jobber.ts";
import {
  isPerVisitJob,
  type JobberJobNode,
  type JobberVisitNode,
  localDate,
  mapJob,
  monthEndLocal,
  needsVisits,
  scheduledByDay,
  type ScheduledVisitNode,
} from "./jobberRevenue.ts";
import { WATERMARK_OVERLAP_MS } from "./jobberFreshness.ts";
import {
  dedupeById,
  inWindow,
  type JobberPaymentNode,
  mapPayment,
  monthWindows,
  type PaymentRow,
  type PaymentWindow,
  queryBounds,
  shouldSplitEarly,
  splitWindow,
  windowRead,
} from "./jobberPayments.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface JobberConn {
  ownerId: string;
  accountId: string;
  token: string;
}

export interface Scopes {
  invoices: boolean;
  visits: boolean;
}

const PAGE_SIZE = 25;
const SCHEDULED_MAX_PAGES = 20;

// ---------------------------------------------------------------------------
// Queries (validated against Jobber's schema; version PULSE_JOBBER_VERSION)
// ---------------------------------------------------------------------------

function jobFields(withInvoices: boolean): string {
  return `
      id jobNumber title jobStatus jobType billingType total invoicedTotal
      completedAt createdAt updatedAt
      visitsInfo { incompleteTotal }${withInvoices ? `
      invoices(first: 10) { nodes { id invoiceStatus amounts { subtotal total } } pageInfo { hasNextPage } }` : ""}`;
}

export const jobsPageQuery = (withInvoices: boolean) => `
  query PulseJobs($first: Int!, $after: String) {
    jobs(first: $first, after: $after, sort: [{ key: UPDATED_AT, direction: DESCENDING }]) {
      nodes {${jobFields(withInvoices)}
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export const jobQuery = (withInvoices: boolean) => `
  query PulseJob($id: EncodedId!) {
    job(id: $id) {${jobFields(withInvoices)}
    }
  }`;

export const JOB_COMPLETED_VISITS_QUERY = `
  query PulseJobVisits($id: EncodedId!, $after: String) {
    job(id: $id) {
      id
      visits(first: 20, after: $after, filter: { status: COMPLETED }) {
        nodes { id completedAt isComplete lineItems(first: 50) { nodes { totalPrice } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

export const VISIT_JOB_QUERY = `
  query PulseVisitJob($id: EncodedId!) {
    visit(id: $id) { id job { id } }
  }`;

export const INVOICE_JOBS_QUERY = `
  query PulseInvoiceJobs($id: EncodedId!) {
    invoice(id: $id) { id jobs(first: 10) { nodes { id } } }
  }`;

export const SCHEDULED_VISITS_QUERY = `
  query PulseScheduled($after: String, $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
    visits(
      first: 25
      after: $after
      filter: { startAt: { after: $from, before: $to } }
      sort: [{ key: START_AT, direction: ASCENDING }]
    ) {
      nodes {
        id startAt isComplete isLastScheduledVisit
        lineItems(first: 40) { nodes { totalPrice } }
        job { id jobType billingType total }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export const ACCOUNT_QUERY = `query PulseAccount { account { id name } }`;
export const PROBE_INVOICES_QUERY = `query PulseProbeInvoices { jobs(first: 1) { nodes { id invoices(first: 1) { nodes { id } } } } }`;
export const PROBE_VISITS_QUERY = `query PulseProbeVisits { visits(first: 1) { nodes { id } } }`;

// ---------------------------------------------------------------------------
// Connection, state, switches
// ---------------------------------------------------------------------------

/** Whether the company has Financial Pulse switched on. */
export async function pulseEnabledFor(admin: Admin, ownerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("pulse_access").select("enabled").eq("owner_id", ownerId).maybeSingle();
  if (error) return false;
  return data?.enabled === true;
}

/**
 * Opens the company's Jobber connection: a valid token plus the Jobber account id.
 * Returns null when the company has no live Jobber connection.
 */
export async function openConnection(admin: Admin, ownerId: string): Promise<JobberConn | null> {
  const token = await getJobberToken(admin, ownerId);
  if (!token) return null;
  const { data: row, error } = await admin
    .from("jobber_tokens").select("jobber_account_id").eq("contractor_id", ownerId).maybeSingle();
  if (error) throw new Error(`Jobber connection read failed: ${error.message}`);
  let accountId = row?.jobber_account_id as string | null;
  if (!accountId) accountId = await fillAccountId(admin, ownerId, token);
  return { ownerId, accountId, token };
}

/** Looks up and saves the Jobber account id for a connection saved without one. */
export async function fillAccountId(admin: Admin, ownerId: string, token: string): Promise<string> {
  const d = await jobberGraphql(token, ACCOUNT_QUERY, {}, PULSE_JOBBER_VERSION);
  const accountId = d?.account?.id as string | undefined;
  if (!accountId) throw new Error("Jobber did not return an account id");
  const patch: Record<string, unknown> = { jobber_account_id: accountId };
  if (d?.account?.name) patch.account_name = d.account.name;
  const { error } = await admin.from("jobber_tokens").update(patch).eq("contractor_id", ownerId);
  if (error) {
    if (error.code === "23505") {
      throw new Error("This Jobber account is already connected to another TreeCheck company.");
    }
    throw new Error(`Jobber account id save failed: ${error.message}`);
  }
  return accountId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getState(admin: Admin, ownerId: string): Promise<any> {
  const { data, error } = await admin
    .from("jobber_sync_state").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`sync state read failed: ${error.message}`);
  return data ?? { owner_id: ownerId, jobs_seen: 0 };
}

export { failureText, importFailing, needsReconnect, RECONNECT_ERROR } from "./jobberFailure.ts";

export async function saveState(admin: Admin, ownerId: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("jobber_sync_state").upsert({ owner_id: ownerId, ...patch }, { onConflict: "owner_id" });
  if (error) throw new Error(`sync state save failed: ${error.message}`);
}

export async function markDirty(admin: Admin, ownerId: string) {
  const { error } = await admin
    .from("pulse_snapshots").upsert({ owner_id: ownerId, dirty: true }, { onConflict: "owner_id" });
  if (error) throw new Error(`snapshot mark failed: ${error.message}`);
}

/**
 * Which parts of Jobber the app may read. A query touching a part the app has no permission for
 * fails as a whole, so each part is probed once and remembered (reset on every reconnect).
 */
export async function grantedScopes(admin: Admin, conn: JobberConn, force = false): Promise<Scopes> {
  if (!force) {
    const state = await getState(admin, conn.ownerId);
    if (state.granted_scopes) {
      try {
        const s = JSON.parse(state.granted_scopes);
        if (typeof s?.invoices === "boolean" && typeof s?.visits === "boolean") return s;
      } catch { /* re-probe */ }
    }
  }
  const probe = async (query: string) => {
    try {
      await jobberGraphql(conn.token, query, {}, PULSE_JOBBER_VERSION);
      return true;
    } catch (e) {
      if (e instanceof JobberGraphqlError && e.isPermissionError) return false;
      throw e;
    }
  };
  const scopes: Scopes = { invoices: await probe(PROBE_INVOICES_QUERY), visits: await probe(PROBE_VISITS_QUERY) };
  await saveState(admin, conn.ownerId, { granted_scopes: JSON.stringify(scopes) });
  return scopes;
}

// ---------------------------------------------------------------------------
// Jobs and visits
// ---------------------------------------------------------------------------

async function fetchCompletedVisits(conn: JobberConn, jobId: string): Promise<JobberVisitNode[]> {
  const out: JobberVisitNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const d = await jobberGraphql(conn.token, JOB_COMPLETED_VISITS_QUERY, { id: jobId, after }, PULSE_JOBBER_VERSION);
    const conn2 = d?.job?.visits;
    if (!conn2) break;
    out.push(...(conn2.nodes ?? []).filter((v: JobberVisitNode) => v.isComplete !== false));
    if (!conn2.pageInfo?.hasNextPage) break;
    after = conn2.pageInfo.endCursor;
  }
  return out;
}

export interface SyncCounts {
  jobs: number;
  visits: number;
  notes: number;
}

/** Maps and saves a batch of Jobber jobs (fetching completed visits where a job needs them). */
export async function saveJobNodes(
  admin: Admin,
  conn: JobberConn,
  scopes: Scopes,
  nodes: JobberJobNode[],
): Promise<SyncCounts> {
  const counts: SyncCounts = { jobs: 0, visits: 0, notes: 0 };
  if (nodes.length === 0) return counts;
  const syncedAt = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobRows: any[] = [];
  const perVisitResults: Array<{ jobId: string; rows: NonNullable<ReturnType<typeof mapJob>["visits"]> }> = [];
  const notPerVisitIds: string[] = [];

  for (const node of nodes) {
    const completedVisits = needsVisits(node) && scopes.visits ? await fetchCompletedVisits(conn, node.id) : null;
    const mapped = mapJob(node, {
      ownerId: conn.ownerId,
      accountId: conn.accountId,
      syncedAt,
      invoicesAvailable: scopes.invoices,
      completedVisits,
    });
    jobRows.push(mapped.job);
    counts.notes += mapped.notes.length;
    if (mapped.visits) perVisitResults.push({ jobId: node.id, rows: mapped.visits });
    else if (!isPerVisitJob(node)) notPerVisitIds.push(node.id);
  }

  const { error: jErr } = await admin
    .from("jobber_jobs").upsert(jobRows, { onConflict: "owner_id,jobber_job_id" });
  if (jErr) throw new Error(`jobber_jobs save failed: ${jErr.message}`);
  counts.jobs = jobRows.length;

  for (const { jobId, rows } of perVisitResults) {
    if (rows.length > 0) {
      const { error } = await admin
        .from("jobber_visit_revenue").upsert(rows, { onConflict: "owner_id,jobber_visit_id" });
      if (error) throw new Error(`jobber_visit_revenue save failed: ${error.message}`);
      counts.visits += rows.length;
    }
    // Visits no longer completed (or removed) stop counting.
    const { data: existing, error: rErr } = await admin
      .from("jobber_visit_revenue").select("jobber_visit_id")
      .eq("owner_id", conn.ownerId).eq("jobber_job_id", jobId);
    if (rErr) throw new Error(`jobber_visit_revenue read failed: ${rErr.message}`);
    const keep = new Set(rows.map((r) => r.jobber_visit_id));
    const stale = (existing ?? [])
      .map((r: { jobber_visit_id: string }) => r.jobber_visit_id)
      .filter((id: string) => !keep.has(id));
    if (stale.length > 0) {
      const { error } = await admin.from("jobber_visit_revenue").delete()
        .eq("owner_id", conn.ownerId).in("jobber_visit_id", stale);
      if (error) throw new Error(`jobber_visit_revenue cleanup failed: ${error.message}`);
    }
  }

  // A job that no longer earns per visit keeps no visit rows.
  if (notPerVisitIds.length > 0) {
    const { error } = await admin.from("jobber_visit_revenue").delete()
      .eq("owner_id", conn.ownerId).in("jobber_job_id", notPerVisitIds);
    if (error) throw new Error(`jobber_visit_revenue cleanup failed: ${error.message}`);
  }
  return counts;
}

/** Re-reads one job from Jobber (webhook path). A job Jobber no longer returns is marked deleted. */
export async function syncOneJob(admin: Admin, conn: JobberConn, scopes: Scopes, jobId: string): Promise<SyncCounts> {
  const d = await jobberGraphql(conn.token, jobQuery(scopes.invoices), { id: jobId }, PULSE_JOBBER_VERSION);
  if (!d?.job) {
    await markJobDeleted(admin, conn.ownerId, jobId);
    return { jobs: 0, visits: 0, notes: 0 };
  }
  return await saveJobNodes(admin, conn, scopes, [d.job]);
}

export async function markJobDeleted(admin: Admin, ownerId: string, jobId: string) {
  const now = new Date().toISOString();
  const a = await admin.from("jobber_jobs").update({ deleted_at: now })
    .eq("owner_id", ownerId).eq("jobber_job_id", jobId);
  if (a.error) throw new Error(`jobber_jobs delete mark failed: ${a.error.message}`);
  const b = await admin.from("jobber_visit_revenue").update({ deleted_at: now })
    .eq("owner_id", ownerId).eq("jobber_job_id", jobId);
  if (b.error) throw new Error(`jobber_visit_revenue delete mark failed: ${b.error.message}`);
}

export async function markVisitDeleted(admin: Admin, ownerId: string, visitId: string) {
  const { error } = await admin.from("jobber_visit_revenue").update({ deleted_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("jobber_visit_id", visitId);
  if (error) throw new Error(`jobber_visit_revenue delete mark failed: ${error.message}`);
}

/** Job ids a visit or invoice belongs to (webhook path). */
export async function jobIdsForVisit(conn: JobberConn, visitId: string): Promise<string[]> {
  const d = await jobberGraphql(conn.token, VISIT_JOB_QUERY, { id: visitId }, PULSE_JOBBER_VERSION);
  return d?.visit?.job?.id ? [d.visit.job.id] : [];
}

export async function jobIdsForInvoice(conn: JobberConn, invoiceId: string): Promise<string[]> {
  const d = await jobberGraphql(conn.token, INVOICE_JOBS_QUERY, { id: invoiceId }, PULSE_JOBBER_VERSION);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (d?.invoice?.jobs?.nodes ?? []).map((n: any) => n.id).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Full history and incremental runs
// ---------------------------------------------------------------------------

export interface RunResult {
  done: boolean;
  jobs: number;
  visits: number;
  jobs_seen?: number;
  needs_backfill?: boolean;
}

/**
 * Full history, newest update first, 25 jobs per page, no cap. Resumable: each call continues
 * from the saved cursor until the deadline, then returns done=false so the caller calls again.
 * When it finishes, the incremental watermark is set to when the backfill started.
 */
export async function runBackfill(
  admin: Admin,
  conn: JobberConn,
  scopes: Scopes,
  deadline: number,
  restart = false,
): Promise<RunResult> {
  const state = await getState(admin, conn.ownerId);
  let cursor: string | null = state.backfill_cursor ?? null;
  let startedAt: string = state.backfill_started_at ?? new Date().toISOString();
  let seen: number = state.jobs_seen ?? 0;
  if (state.backfill_completed_at && !restart) return { done: true, jobs: 0, visits: 0, jobs_seen: seen };
  if (restart || !state.backfill_started_at) {
    cursor = null;
    startedAt = new Date().toISOString();
    seen = 0;
    await saveState(admin, conn.ownerId, {
      backfill_cursor: null, backfill_started_at: startedAt, backfill_completed_at: null, jobs_seen: 0, last_error: null,
    });
  }

  const total = { jobs: 0, visits: 0 };
  while (Date.now() < deadline) {
    const d = await jobberGraphql(conn.token, jobsPageQuery(scopes.invoices), { first: PAGE_SIZE, after: cursor }, PULSE_JOBBER_VERSION);
    const page = d?.jobs;
    const nodes: JobberJobNode[] = page?.nodes ?? [];
    const c = await saveJobNodes(admin, conn, scopes, nodes);
    total.jobs += c.jobs;
    total.visits += c.visits;
    seen += nodes.length;
    if (!page?.pageInfo?.hasNextPage) {
      await saveState(admin, conn.ownerId, {
        backfill_cursor: null,
        backfill_completed_at: new Date().toISOString(),
        jobs_seen: seen,
        incremental_watermark: new Date(Date.parse(startedAt) - WATERMARK_OVERLAP_MS).toISOString(),
        last_error: null,
      });
      return { done: true, ...total, jobs_seen: seen };
    }
    cursor = page.pageInfo.endCursor;
    // A page that came in clears any earlier error: the import is moving again.
    await saveState(admin, conn.ownerId, { backfill_cursor: cursor, jobs_seen: seen, last_error: null });
  }
  return { done: false, ...total, jobs_seen: seen };
}

/** Jobs updated since the last run (newest first, stopping at the watermark). */
export async function runIncremental(
  admin: Admin,
  conn: JobberConn,
  scopes: Scopes,
  deadline: number,
): Promise<RunResult> {
  const state = await getState(admin, conn.ownerId);
  if (!state.incremental_watermark) return { done: false, jobs: 0, visits: 0, needs_backfill: true };
  const runStart = Date.now();
  const since = Date.parse(state.incremental_watermark);
  let after: string | null = null;
  const total = { jobs: 0, visits: 0 };

  while (Date.now() < deadline) {
    const d = await jobberGraphql(conn.token, jobsPageQuery(scopes.invoices), { first: PAGE_SIZE, after }, PULSE_JOBBER_VERSION);
    const page = d?.jobs;
    const nodes: JobberJobNode[] = page?.nodes ?? [];
    const newer = nodes.filter((n) => !n.updatedAt || Date.parse(n.updatedAt) >= since);
    const c = await saveJobNodes(admin, conn, scopes, newer);
    total.jobs += c.jobs;
    total.visits += c.visits;
    if (newer.length < nodes.length || !page?.pageInfo?.hasNextPage) {
      await saveState(admin, conn.ownerId, {
        incremental_watermark: new Date(runStart - WATERMARK_OVERLAP_MS).toISOString(),
        last_error: null,
      });
      return { done: true, ...total };
    }
    after = page.pageInfo.endCursor;
  }
  // Out of time before reaching the watermark: keep it, the next run starts from the top again.
  return { done: false, ...total };
}

// ---------------------------------------------------------------------------
// Scheduled work (forecast)
// ---------------------------------------------------------------------------

export async function companyTimezone(admin: Admin, ownerId: string): Promise<string> {
  const { data } = await admin.from("pulse_settings").select("timezone").eq("owner_id", ownerId).maybeSingle();
  return (data?.timezone as string | undefined) || "America/Chicago";
}

/**
 * Values the incomplete visits scheduled from now to the end of this month (company time zone)
 * and saves them per day in jobber_sync_state. Missing permission is saved as 'no_scope' so the
 * forecast falls back to pace-only and says so.
 */
export async function refreshScheduled(admin: Admin, conn: JobberConn, scopes: Scopes): Promise<string> {
  const now = new Date();
  if (!scopes.visits) {
    await saveState(admin, conn.ownerId, {
      scheduled_status: "no_scope", scheduled_by_day: null, scheduled_fetched_at: now.toISOString(),
    });
    return "no_scope";
  }
  const tz = await companyTimezone(admin, conn.ownerId);
  const today = localDate(now.toISOString(), tz);
  const monthEnd = monthEndLocal(today);
  // Query a little past the end of the month in UTC, then keep only this month's local days.
  const [y, m] = today.split("-").map(Number);
  const to = new Date(Date.UTC(y, m, 2)).toISOString();

  try {
    const visits: ScheduledVisitNode[] = [];
    let after: string | null = null;
    let truncated = false;
    for (let page = 0; ; page++) {
      if (page >= SCHEDULED_MAX_PAGES) {
        truncated = true;
        break;
      }
      const d = await jobberGraphql(conn.token, SCHEDULED_VISITS_QUERY, { after, from: now.toISOString(), to }, PULSE_JOBBER_VERSION);
      const pageData = d?.visits;
      // Jobber 2026-09-25 can't filter visits by isComplete: completed ones are skipped here.
      visits.push(...(pageData?.nodes ?? []).filter((v: ScheduledVisitNode) => v.isComplete !== true));
      if (!pageData?.pageInfo?.hasNextPage) break;
      after = pageData.pageInfo.endCursor;
    }

    const recurringJobIds = [...new Set(
      visits.filter((v) => v.job && (v.job.jobType ?? "").toUpperCase() === "RECURRING" &&
        (v.job.billingType ?? "").toUpperCase() !== "VISIT_BASED").map((v) => v.job!.id),
    )];
    const perVisit: Record<string, number | null> = {};
    if (recurringJobIds.length > 0) {
      const { data, error } = await admin.from("jobber_jobs").select("jobber_job_id, per_visit_amount")
        .eq("owner_id", conn.ownerId).in("jobber_job_id", recurringJobIds);
      if (error) throw new Error(`jobber_jobs read failed: ${error.message}`);
      for (const r of data ?? []) perVisit[r.jobber_job_id] = r.per_visit_amount;
    }

    const byDay = scheduledByDay(visits, tz, perVisit);
    for (const day of Object.keys(byDay)) {
      if (day < today || day > monthEnd) delete byDay[day];
    }
    await saveState(admin, conn.ownerId, {
      scheduled_status: "ok",
      scheduled_by_day: { month_end: monthEnd, truncated, days: byDay },
      scheduled_fetched_at: now.toISOString(),
    });
    return "ok";
  } catch (e) {
    const noScope = e instanceof JobberGraphqlError && e.isPermissionError;
    // last_error is the import's failure record (counted tries, the reconnect marker): a forecast
    // problem must not overwrite it. The forecast shows pace only while scheduled_status is "error".
    if (!noScope) console.error("[pulse] scheduled visits failed", String((e as Error)?.message ?? e).slice(0, 300));
    await saveState(admin, conn.ownerId, {
      scheduled_status: noScope ? "no_scope" : "error",
      scheduled_fetched_at: now.toISOString(),
    });
    return noScope ? "no_scope" : "error";
  }
}

// ---------------------------------------------------------------------------
// Payments recorded in Jobber (W3-10a): money in by the day received
// ---------------------------------------------------------------------------

/** How far back the full read goes (the bank history Plaid gives goes back two years). */
export const PAYMENT_MONTHS = 24;
/**
 * The quick refresh re-reads this month and the two before (new, changed and removed payments), so the
 * "30 days before" comparison (59 days back at most) is always current.
 */
export const PAYMENT_QUICK_MONTHS = 3;
/** The whole history is read again this often, for changes to older payments. */
export const PAYMENTS_FULL_EVERY_MS = 7 * 86_400_000;
/** How long one payments read holds the company's lock (runs stop at their own deadline well before). */
const PAYMENTS_LOCK_SECONDS = 150;
const PAYMENT_PAGE = 50;

// Literal strings (no interpolation), so they can be checked against Jobber's schema as written.
export const PAYMENTS_WINDOW_QUERY = `
  query PulsePayments($first: Int!, $after: String, $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
    paymentRecords(
      first: $first
      after: $after
      filter: { entryDate: { after: $from, before: $to } }
      sort: { key: ENTRY_DATE, direction: DESCENDING }
    ) {
      totalCount
      nodes {
        __typename id adjustmentType entryDate amount rawAmount
        invoice { id invoiceNumber amounts { subtotal taxAmount total } jobs(first: 1) { nodes { id jobNumber } } }
        quote { id amounts { subtotal taxAmount total } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export const PAYMENT_QUERY = `
  query PulsePayment($id: EncodedId!) {
    paymentRecord(id: $id) {
      __typename id adjustmentType entryDate amount rawAmount
      invoice { id invoiceNumber amounts { subtotal taxAmount total } jobs(first: 1) { nodes { id jobNumber } } }
      quote { id amounts { subtotal taxAmount total } }
    }
  }`;

export interface PaymentsResult {
  done: boolean;
  saved: number;
  removed: number;
  /** Another payments read held the lock: it was asked to run once more instead. */
  deferred?: boolean;
}

async function savePayments(admin: Admin, rows: PaymentRow[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("jobber_payments")
      .upsert(rows.slice(i, i + 200), { onConflict: "owner_id,jobber_payment_id" });
    if (error) throw new Error(`jobber_payments save failed: ${error.message}`);
  }
}

/**
 * Reads one window of Jobber's payment records, saves the money-in ones, and marks saved ones that
 * Jobber no longer lists in that window as deleted. Jobber describes the list as "100 recently sent
 * payment records", so a window with more than that, or one that comes back short of its own count, is
 * read as two halves. Payments are only marked deleted after a complete read (windowRead), and only
 * rows saved before this read started (a payment saved meanwhile by a webhook is never touched).
 */
async function syncPaymentWindow(admin: Admin, conn: JobberConn, w: PaymentWindow, deadline: number): Promise<PaymentsResult> {
  const readStartedAt = new Date().toISOString();
  const bounds = queryBounds(w);
  const nodes: JobberPaymentNode[] = [];
  const totals: Array<number | null> = [];
  let after: string | null = null;
  for (;;) {
    if (Date.now() > deadline) return { done: false, saved: 0, removed: 0 };
    const d = await jobberGraphql(conn.token, PAYMENTS_WINDOW_QUERY,
      { first: PAYMENT_PAGE, after, from: bounds.from, to: bounds.to }, PULSE_JOBBER_VERSION);
    const page = d?.paymentRecords;
    totals.push(typeof page?.totalCount === "number" ? page.totalCount : null);
    if (totals.length === 1 && shouldSplitEarly(totals[0], w)) break;
    nodes.push(...((page?.nodes ?? []) as Array<JobberPaymentNode | null>).filter((n): n is JobberPaymentNode => !!n));
    if (!page?.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  const unique = dedupeById(nodes);
  const read = windowRead(totals, unique.length);
  if (read.short || shouldSplitEarly(totals[0], w)) {
    const halves = splitWindow(w);
    if (halves) {
      const out: PaymentsResult = { done: true, saved: 0, removed: 0 };
      for (const h of halves) {
        const r = await syncPaymentWindow(admin, conn, h, deadline);
        out.saved += r.saved;
        out.removed += r.removed;
        if (!r.done) return { ...out, done: false };
      }
      return out;
    }
    console.error("[pulse] payments window still short of Jobber's count", w.from, unique.length, read.total);
  }

  const syncedAt = new Date().toISOString();
  const rows = unique
    .map((n) => mapPayment(n, { ownerId: conn.ownerId, accountId: conn.accountId, syncedAt }))
    .filter((r): r is PaymentRow => r !== null);
  await savePayments(admin, rows);

  let removed = 0;
  if (read.complete) {
    const seen = new Set(unique.map((n) => n.id));
    const { data: saved, error } = await admin.from("jobber_payments").select("jobber_payment_id, received_at")
      .eq("owner_id", conn.ownerId).is("deleted_at", null).gte("received_at", w.from).lt("received_at", w.to)
      .lt("synced_at", readStartedAt);
    if (error) throw new Error(`jobber_payments read failed: ${error.message}`);
    const gone = ((saved ?? []) as Array<{ jobber_payment_id: string; received_at: string }>)
      .filter((r) => inWindow(r.received_at, w) && !seen.has(r.jobber_payment_id))
      .map((r) => r.jobber_payment_id);
    for (let i = 0; i < gone.length; i += 100) {
      const { error: dErr } = await admin.from("jobber_payments").update({ deleted_at: syncedAt })
        .eq("owner_id", conn.ownerId).in("jobber_payment_id", gone.slice(i, i + 100)).lt("synced_at", readStartedAt);
      if (dErr) throw new Error(`jobber_payments delete mark failed: ${dErr.message}`);
    }
    removed = gone.length;
  }
  return { done: true, saved: rows.length, removed };
}

/** One pass over the windows. full: resumable from payments_backfill_next, the newest months first. */
async function importPaymentsOnce(admin: Admin, conn: JobberConn, deadline: number, full: boolean): Promise<PaymentsResult> {
  const state = await getState(admin, conn.ownerId);
  const all = monthWindows(new Date(), full ? PAYMENT_MONTHS : PAYMENT_QUICK_MONTHS);
  let next = full ? Math.min(Math.max(Number(state.payments_backfill_next ?? 0) || 0, 0), all.length) : 0;
  // Resuming a full read: the newest months first, so the screen isn't waiting on two years of history.
  const order = full && next > 0
    ? [...all.slice(0, Math.min(PAYMENT_QUICK_MONTHS, next)), ...all.slice(next)]
    : all.slice(next);
  const out: PaymentsResult = { done: false, saved: 0, removed: 0 };
  let finished = 0;
  for (const w of order) {
    if (Date.now() > deadline - 5_000) break;
    const r = await syncPaymentWindow(admin, conn, w, deadline);
    out.saved += r.saved;
    out.removed += r.removed;
    if (!r.done) break;
    finished++;
    if (full && all.indexOf(w) >= next) next = all.indexOf(w) + 1;
  }
  const now = new Date().toISOString();
  if (finished === order.length) {
    await saveState(admin, conn.ownerId, full
      ? { payments_backfill_next: null, payments_backfill_completed_at: now, payments_refreshed_at: now, payments_error: null }
      : { payments_refreshed_at: now, payments_error: null });
    return { ...out, done: true };
  }
  if (full) await saveState(admin, conn.ownerId, { payments_backfill_next: next });
  return out;
}

/**
 * Reads payments from Jobber, one read at a time per company (M6 lock). full: the last PAYMENT_MONTHS
 * months, resumable (done=false means call again); when it finishes, payments_backfill_completed_at
 * records when the whole history was last read. Otherwise the quick refresh (PAYMENT_QUICK_MONTHS).
 * When another read holds the lock, that read is asked to run once more (a quick refresh) and this one
 * returns deferred. A failure is recorded in payments_error (and thrown); it never touches the job
 * import's last_error.
 */
export async function runPaymentsImport(
  admin: Admin,
  conn: JobberConn,
  deadline: number,
  full: boolean,
): Promise<PaymentsResult> {
  const claim = await admin.rpc("jobber_claim_payments", { p_owner: conn.ownerId, p_seconds: PAYMENTS_LOCK_SECONDS });
  if (claim.error) throw new Error(`payments lock failed: ${claim.error.message}`);
  let token: string | null = typeof claim.data === "string" ? claim.data : null;
  if (!token) return { done: false, saved: 0, removed: 0, deferred: true };
  const total: PaymentsResult = { done: false, saved: 0, removed: 0 };
  try {
    for (let round = 0; round < 3 && token; round++) {
      // A follow-up asked for during this read only needs the recent months.
      const r = await importPaymentsOnce(admin, conn, deadline, round === 0 ? full : false);
      total.saved += r.saved;
      total.removed += r.removed;
      if (round === 0) total.done = r.done;
      if (!r.done) break;
      const released = await admin.rpc("jobber_release_payments", { p_owner: conn.ownerId, p_token: token, p_drop_request: false });
      if (released.error) throw new Error(`payments lock release failed: ${released.error.message}`);
      if (released.data === true) {
        token = null;
        break;
      }
      if (Date.now() > deadline - 10_000) break;
      const renewed: { data: unknown; error: { message: string } | null } = await admin.rpc("jobber_take_payments_request",
        { p_owner: conn.ownerId, p_token: token, p_seconds: PAYMENTS_LOCK_SECONDS });
      if (renewed.error) throw new Error(`payments lock renew failed: ${renewed.error.message}`);
      token = typeof renewed.data === "string" ? renewed.data : null;
    }
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 300);
    await saveState(admin, conn.ownerId, { payments_error: message }).catch(() => {});
    throw e;
  } finally {
    // Still holding the lock (out of time, an error, or three rounds): let go and drop any pending request;
    // the screen's own refresh (30 minutes) or the next webhook reads again.
    if (token) await admin.rpc("jobber_release_payments", { p_owner: conn.ownerId, p_token: token, p_drop_request: true });
  }
  return total;
}

/** Marks one payment as deleted (webhook PAYMENT_DESTROY). Returns how many saved rows it matched. */
export async function markPaymentDeleted(admin: Admin, ownerId: string, paymentId: string): Promise<number> {
  const { data, error } = await admin.from("jobber_payments").update({ deleted_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("jobber_payment_id", paymentId).is("deleted_at", null).select("id");
  if (error) throw new Error(`jobber_payments delete mark failed: ${error.message}`);
  return (data ?? []).length;
}

/** Re-reads one payment record (webhook PAYMENT_CREATE / PAYMENT_UPDATE). */
export async function syncOnePayment(admin: Admin, conn: JobberConn, paymentId: string): Promise<"saved" | "removed" | "skipped"> {
  const d = await jobberGraphql(conn.token, PAYMENT_QUERY, { id: paymentId }, PULSE_JOBBER_VERSION);
  const node = d?.paymentRecord as JobberPaymentNode | null | undefined;
  if (!node) {
    await markPaymentDeleted(admin, conn.ownerId, paymentId);
    return "removed";
  }
  const row = mapPayment(node, { ownerId: conn.ownerId, accountId: conn.accountId, syncedAt: new Date().toISOString() });
  if (!row) return "skipped";
  await savePayments(admin, [row]);
  return "saved";
}

/**
 * The quick refresh after an invoice or quote change (webhooks). The lock turns a burst of events into
 * one read plus one follow-up; returns null when another read was running (it reads again afterwards).
 */
export async function refreshPaymentsSoon(admin: Admin, conn: JobberConn, deadline: number): Promise<PaymentsResult | null> {
  const r = await runPaymentsImport(admin, conn, deadline, false);
  return r.deferred ? null : r;
}
