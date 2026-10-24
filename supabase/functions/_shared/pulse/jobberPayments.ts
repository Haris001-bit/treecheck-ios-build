// Financial Pulse: Jobber payment records as money in (plan task W3-10a; Joe's rule 2026-10-05: count
// revenue on the day payment is received, without sales tax, when the company records payments in
// Jobber). Server-side only. No imports, so it can be unit-tested without Deno.
//
// Jobber's account-wide paymentRecords list (API 2026-09-25) is a ledger. Only money in is kept:
// PAYMENT and DEPOSIT add, REFUND and FAILED_ACH_PAYMENT take away. INVOICE, CORRECTION, BAD_DEBT,
// VOIDED and INITIAL_BALANCE entries are not money received and are skipped. `amount` is the absolute
// amount applied to the invoice or quote balance (tips are separate), so the sign comes from the kind.
// The amount without sales tax uses the share of the invoice (or, for a deposit not on an invoice yet,
// the quote) that is not tax: (total - tax) / total.

export type PaymentKind = "payment" | "deposit" | "refund" | "failed_payment";

const KINDS: Record<string, PaymentKind> = {
  PAYMENT: "payment",
  DEPOSIT: "deposit",
  REFUND: "refund",
  FAILED_ACH_PAYMENT: "failed_payment",
};

export interface JobberAmounts {
  subtotal?: number | null;
  taxAmount?: number | null;
  total?: number | null;
}

/** One node of Jobber's paymentRecords list, as PAYMENT_FIELDS asks for it (jobberSync.ts). */
export interface JobberPaymentNode {
  id: string;
  adjustmentType?: string | null;
  entryDate?: string | null;
  amount?: number | null;
  rawAmount?: number | null;
  invoice?: {
    id: string;
    invoiceNumber?: string | number | null;
    amounts?: JobberAmounts | null;
    jobs?: { nodes?: Array<{ id: string; jobNumber?: number | null }> | null } | null;
  } | null;
  quote?: { id: string; amounts?: JobberAmounts | null } | null;
}

/** A jobber_payments row (M6). */
export interface PaymentRow {
  owner_id: string;
  jobber_account_id: string;
  jobber_payment_id: string;
  kind: PaymentKind;
  received_at: string;
  amount: number;
  amount_pre_tax: number;
  jobber_invoice_id: string | null;
  invoice_number: string | null;
  jobber_quote_id: string | null;
  jobber_job_id: string | null;
  job_number: number | null;
  deleted_at: null;
  synced_at: string;
}

const cents = (n: number) => {
  const r = Math.round(Math.abs(n) * 100 + 1e-7) / 100;
  return (n < 0 ? -r : r) || 0;
};
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The money-in kind of a ledger entry, or null when it is not money received. */
export function paymentKind(adjustmentType: string | null | undefined): PaymentKind | null {
  return KINDS[(adjustmentType ?? "").toUpperCase()] ?? null;
}

/** The share of a total that is not sales tax, from 0 to 1; 1 when the amounts don't say. */
export function preTaxShare(amounts: JobberAmounts | null | undefined): number {
  const total = finite(amounts?.total);
  const tax = finite(amounts?.taxAmount);
  if (total === null || total <= 0 || tax === null || tax <= 0) return 1;
  if (tax >= total) return 0;
  return (total - tax) / total;
}

/** A Jobber payment record as a jobber_payments row, or null when it is not money in (or is unreadable). */
export function mapPayment(
  node: JobberPaymentNode,
  ctx: { ownerId: string; accountId: string; syncedAt: string },
): PaymentRow | null {
  const kind = paymentKind(node.adjustmentType);
  const amount = finite(node.amount);
  const at = typeof node.entryDate === "string" && Number.isFinite(Date.parse(node.entryDate)) ? node.entryDate : null;
  if (!kind || amount === null || !at || !node.id) return null;
  const sign = kind === "payment" || kind === "deposit" ? 1 : -1;
  const money = cents(sign * Math.abs(amount));
  const share = node.invoice ? preTaxShare(node.invoice.amounts) : preTaxShare(node.quote?.amounts);
  const job = node.invoice?.jobs?.nodes?.[0] ?? null;
  const number = node.invoice?.invoiceNumber;
  return {
    owner_id: ctx.ownerId,
    jobber_account_id: ctx.accountId,
    jobber_payment_id: node.id,
    kind,
    received_at: at,
    amount: money,
    amount_pre_tax: cents(money * share),
    jobber_invoice_id: node.invoice?.id ?? null,
    invoice_number: number === null || number === undefined || number === "" ? null : String(number),
    jobber_quote_id: node.quote?.id ?? null,
    jobber_job_id: job?.id ?? null,
    job_number: finite(job?.jobNumber) ?? null,
    deleted_at: null,
    synced_at: ctx.syncedAt,
  };
}

export interface PaymentWindow {
  /** Inclusive start (ISO instant). */
  from: string;
  /** Exclusive end (ISO instant). */
  to: string;
}

/** Calendar-month windows in UTC, newest first: this month and the `months - 1` before it. */
export function monthWindows(now: Date, months: number): PaymentWindow[] {
  const out: PaymentWindow[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = 0; i < months; i++) {
    out.push({
      from: new Date(Date.UTC(y, m - i, 1)).toISOString(),
      to: new Date(Date.UTC(y, m - i + 1, 1)).toISOString(),
    });
  }
  return out;
}

/** The two halves of a window, or null when it is already an hour or less (it can't usefully shrink). */
export function splitWindow(w: PaymentWindow): [PaymentWindow, PaymentWindow] | null {
  const a = Date.parse(w.from);
  const b = Date.parse(w.to);
  if (!(b - a > 3_600_000)) return null;
  const mid = new Date(a + Math.floor((b - a) / 2)).toISOString();
  return [{ from: w.from, to: mid }, { from: mid, to: w.to }];
}

/**
 * The bounds to ask Jobber for, one second wider on each side: whether its range filter includes the
 * boundary instant isn't documented, and a payment counted twice by two windows is saved once anyway.
 */
export function queryBounds(w: PaymentWindow): { from: string; to: string } {
  return {
    from: new Date(Date.parse(w.from) - 1000).toISOString(),
    to: new Date(Date.parse(w.to) + 1000).toISOString(),
  };
}

/** True when this saved row's date falls inside the window (for marking rows Jobber no longer lists). */
export function inWindow(receivedAt: string, w: PaymentWindow): boolean {
  const t = Date.parse(receivedAt);
  return t >= Date.parse(w.from) && t < Date.parse(w.to);
}

/** Jobber describes its payment list as "100 recently sent payment records": windows with more are split. */
export const PAYMENT_LIST_CAP = 100;

/** True when a window's first page says it holds more records than Jobber is likely to list in one go. */
export function shouldSplitEarly(firstTotal: number | null | undefined, w: PaymentWindow): boolean {
  return typeof firstTotal === "number" && firstTotal > PAYMENT_LIST_CAP && splitWindow(w) !== null;
}

/** The records once each (paging can repeat one when entries share a date or change while paging). */
export function dedupeById<T extends { id: string }>(nodes: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const n of nodes) {
    if (!n?.id || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

export interface WindowReadResult {
  /** Every page gave Jobber's count, it never changed while paging, and the distinct records equal it. */
  complete: boolean;
  /** Fewer distinct records than Jobber's count: read the window's two halves instead. */
  short: boolean;
  /** Jobber's count on the last page that gave one. */
  total: number | null;
}

/**
 * Whether a window was read completely, from the count each page reported and the distinct records
 * read. Only a complete read may mark saved payments as deleted: a page without a count, a count that
 * moved while paging or a skipped record must never make real payments disappear.
 */
export function windowRead(totals: Array<number | null>, uniqueCount: number): WindowReadResult {
  const known = totals.filter((t): t is number => typeof t === "number");
  const last = known.length > 0 ? known[known.length - 1] : null;
  const complete = totals.length > 0 && known.length === totals.length && known.every((t) => t === known[0]) &&
    uniqueCount === known[0];
  return { complete, short: last !== null && uniqueCount < last, total: last };
}
