// Financial Pulse: turns Jobber jobs and visits into revenue rows.
//
// Pure functions only (no Deno or network APIs), so the same file runs in the edge functions
// and in the vitest suite (src/lib/pulse/jobberRevenue.test.ts).
//
// Revenue rules (A9 in Project Architecture.md):
// * One-off, fixed-price jobs earn their total on the day the job was completed. If Jobber has no
//   completion date yet but every visit is done and the job is waiting to be invoiced or archived,
//   the last visit's completion date is used instead.
// * Visit-billed jobs and recurring jobs earn per completed visit, dated by that visit:
//   visit-billed visits earn their own line items; recurring fixed-price jobs spread the job total
//   evenly over all of the job's visits.
// * Draft and voided invoices never count toward the invoiced totals.

export const JOBBER_REVENUE_VERSION = "jobber-revenue-1";

export interface JobberInvoiceNode {
  id?: string;
  invoiceStatus?: string | null;
  amounts?: { subtotal?: number | null; total?: number | null } | null;
}

export interface JobberVisitNode {
  id: string;
  completedAt?: string | null;
  isComplete?: boolean | null;
  lineItems?: { nodes?: Array<{ totalPrice?: number | null }> | null } | null;
}

export interface JobberJobNode {
  id: string;
  jobNumber?: number | null;
  title?: string | null;
  jobStatus?: string | null;
  jobType?: string | null;
  billingType?: string | null;
  total?: number | null;
  invoicedTotal?: number | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  invoices?: { nodes?: JobberInvoiceNode[] | null; pageInfo?: { hasNextPage?: boolean | null } | null } | null;
  visitsInfo?: { incompleteTotal?: number | null } | null;
}

export interface JobberJobRow {
  owner_id: string;
  jobber_account_id: string;
  jobber_job_id: string;
  job_number: number | null;
  title: string | null;
  job_status: string | null;
  job_type: string | null;
  billing_type: string | null;
  total: number | null;
  invoiced_total: number | null;
  invoices_nonvoid_total: number | null;
  invoices_nonvoid_subtotal: number | null;
  invoice_count: number;
  completed_at: string | null;
  completed_source: "job" | "last_visit" | null;
  per_visit_amount: number | null;
  deleted_at: null;
  jobber_created_at: string | null;
  jobber_updated_at: string | null;
  synced_at: string;
}

export interface VisitRevenueRow {
  owner_id: string;
  jobber_account_id: string;
  jobber_visit_id: string;
  jobber_job_id: string;
  amount: number;
  completed_at: string;
  deleted_at: null;
  synced_at: string;
}

export interface MapContext {
  ownerId: string;
  accountId: string;
  syncedAt: string;
  /** False when the Jobber app may not read invoices; invoice totals are then left empty. */
  invoicesAvailable: boolean;
  /** The job's completed visits (every page), or null when visits were not fetched. */
  completedVisits: JobberVisitNode[] | null;
}

export interface MappedJob {
  job: JobberJobRow;
  /** Revenue rows for a per-visit job; null when this job does not earn per visit. */
  visits: VisitRevenueRow[] | null;
  /** Human-readable notes about data that could not be used (for sync logs, never shown raw). */
  notes: string[];
}

const upper = (s: string | null | undefined) => (s ?? "").toUpperCase();
const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

export const cents = (n: number) => Math.round(n * 100) / 100;

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Visit-billed and recurring jobs earn per completed visit (matches pulse_window_totals). */
export function isPerVisitJob(job: Pick<JobberJobNode, "jobType" | "billingType">): boolean {
  return upper(job.jobType) === "RECURRING" || upper(job.billingType) === "VISIT_BASED";
}

/** Job statuses where the work is finished even if Jobber has not stamped completedAt yet. */
const WORK_DONE_STATUSES = new Set(["requires_invoicing", "archived"]);

/** Whether the job's completed visits must be fetched to work out its revenue. */
export function needsVisits(job: JobberJobNode): boolean {
  if (isPerVisitJob(job)) return true;
  return !job.completedAt && WORK_DONE_STATUSES.has(lower(job.jobStatus));
}

/** Draft and voided invoices are not real charges. */
export function isCountableInvoice(inv: JobberInvoiceNode): boolean {
  const s = lower(inv.invoiceStatus);
  return s !== "draft" && s !== "voided" && s !== "void";
}

export function visitLineItemTotal(visit: JobberVisitNode): number {
  let sum = 0;
  for (const li of visit.lineItems?.nodes ?? []) sum += num(li?.totalPrice) ?? 0;
  return cents(sum);
}

function latest(dates: string[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const d of dates) {
    const ms = Date.parse(d);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = d;
    }
  }
  return best;
}

export function mapJob(node: JobberJobNode, ctx: MapContext): MappedJob {
  const notes: string[] = [];
  const perVisit = isPerVisitJob(node);
  const recurringFixed = perVisit && upper(node.billingType) !== "VISIT_BASED";

  // Invoice totals (used only when the owner picks "invoiced total" or "before tax").
  let nonvoidTotal: number | null = null;
  let nonvoidSubtotal: number | null = null;
  let invoiceCount = 0;
  if (ctx.invoicesAvailable && node.invoices) {
    const countable = (node.invoices.nodes ?? []).filter(isCountableInvoice);
    invoiceCount = countable.length;
    if (node.invoices.pageInfo?.hasNextPage) {
      notes.push("more invoices than fetched; invoice totals left empty");
    } else if (countable.length > 0) {
      nonvoidTotal = cents(countable.reduce((s, i) => s + (num(i.amounts?.total) ?? 0), 0));
      nonvoidSubtotal = cents(countable.reduce((s, i) => s + (num(i.amounts?.subtotal) ?? 0), 0));
    }
  }

  const completedVisits = (ctx.completedVisits ?? []).filter((v) => v.completedAt);
  if ((ctx.completedVisits ?? []).length !== completedVisits.length) {
    notes.push("completed visit without a completion date skipped");
  }

  // Completion date for one-off jobs.
  let completedAt: string | null = node.completedAt ?? null;
  let completedSource: "job" | "last_visit" | null = completedAt ? "job" : null;
  if (!completedAt && !perVisit && WORK_DONE_STATUSES.has(lower(node.jobStatus))) {
    const incomplete = num(node.visitsInfo?.incompleteTotal);
    if (ctx.completedVisits === null) {
      notes.push("visits not available; completion date unknown");
    } else if (incomplete !== null && incomplete > 0) {
      // Work still outstanding: not earned yet.
    } else {
      const last = latest(completedVisits.map((v) => v.completedAt as string));
      if (last) {
        completedAt = last;
        completedSource = "last_visit";
      }
    }
  }

  // Per-visit amount for recurring fixed-price jobs: the job total spread over every visit.
  let perVisitAmount: number | null = null;
  if (recurringFixed && ctx.completedVisits !== null) {
    const incomplete = num(node.visitsInfo?.incompleteTotal) ?? 0;
    const totalVisits = completedVisits.length + incomplete;
    perVisitAmount = totalVisits > 0 ? cents((num(node.total) ?? 0) / totalVisits) : 0;
  }

  const job: JobberJobRow = {
    owner_id: ctx.ownerId,
    jobber_account_id: ctx.accountId,
    jobber_job_id: node.id,
    job_number: num(node.jobNumber),
    title: node.title ?? null,
    job_status: node.jobStatus ?? null,
    job_type: node.jobType ?? null,
    billing_type: node.billingType ?? null,
    total: num(node.total) === null ? null : cents(num(node.total) as number),
    invoiced_total: num(node.invoicedTotal) === null ? null : cents(num(node.invoicedTotal) as number),
    invoices_nonvoid_total: nonvoidTotal,
    invoices_nonvoid_subtotal: nonvoidSubtotal,
    invoice_count: invoiceCount,
    completed_at: completedAt,
    completed_source: completedSource,
    per_visit_amount: perVisitAmount,
    deleted_at: null,
    jobber_created_at: node.createdAt ?? null,
    jobber_updated_at: node.updatedAt ?? null,
    synced_at: ctx.syncedAt,
  };

  let visits: VisitRevenueRow[] | null = null;
  if (perVisit) {
    if (ctx.completedVisits === null) {
      notes.push("visits not available; per-visit revenue not updated");
    } else {
      visits = completedVisits.map((v) => ({
        owner_id: ctx.ownerId,
        jobber_account_id: ctx.accountId,
        jobber_visit_id: v.id,
        jobber_job_id: node.id,
        amount: recurringFixed ? (perVisitAmount ?? 0) : visitLineItemTotal(v),
        completed_at: v.completedAt as string,
        deleted_at: null,
        synced_at: ctx.syncedAt,
      }));
    }
  }

  return { job, visits, notes };
}

// ---------------------------------------------------------------------------
// Scheduled work for the month-end forecast
// ---------------------------------------------------------------------------

export interface ScheduledVisitNode {
  id: string;
  startAt?: string | null;
  isComplete?: boolean | null;
  isLastScheduledVisit?: boolean | null;
  lineItems?: { nodes?: Array<{ totalPrice?: number | null }> | null } | null;
  job?: {
    id: string;
    jobType?: string | null;
    billingType?: string | null;
    total?: number | null;
  } | null;
}

/** YYYY-MM-DD of an instant in the company's time zone. */
export function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Last day (YYYY-MM-DD) of the month containing a local date (YYYY-MM-DD). */
export function monthEndLocal(day: string): string {
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/**
 * Value of the incomplete visits still scheduled this month, summed per local day.
 * What each visit is worth is what it will add to revenue once completed:
 * * visit-billed: its line items;
 * * recurring fixed-price: the job's per-visit amount (from jobber_jobs; 0 when unknown);
 * * one-off fixed-price: the whole job total, on the job's last scheduled visit only.
 */
export function scheduledByDay(
  visits: ScheduledVisitNode[],
  timeZone: string,
  perVisitAmountByJob: Record<string, number | null | undefined>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of visits) {
    if (!v.startAt || !v.job) continue;
    let value = 0;
    if (upper(v.job.billingType) === "VISIT_BASED") {
      value = visitLineItemTotal(v);
    } else if (upper(v.job.jobType) === "RECURRING") {
      value = num(perVisitAmountByJob[v.job.id]) ?? 0;
    } else if (v.isLastScheduledVisit) {
      value = num(v.job.total) ?? 0;
    }
    if (value === 0) continue;
    const day = localDate(v.startAt, timeZone);
    out[day] = cents((out[day] ?? 0) + value);
  }
  return out;
}
