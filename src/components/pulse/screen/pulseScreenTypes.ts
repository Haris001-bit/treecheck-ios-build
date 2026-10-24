// Financial Pulse screen: shared types, wording and formatting.
// The screen renders the engine's Snapshot (supabase/functions/_shared/pulse/engine.ts); the rows behind
// each number come from a PulseDataSource (the owner's own rows, read through RLS).

import type { Change, PayrollUnknownReason, PeriodDays, RevenueBasis, Snapshot } from "../../../../supabase/functions/_shared/pulse/engine";

export type { PeriodDays, RevenueBasis };

/** A part of the setup page a button can open at ("Open setup", Reconnect). */
export type SetupSection = "jobber" | "banks" | "accounts" | "payroll";

/** Jobber is connected but its past jobs are not all in yet, so sales would read as $0. */
export function jobberImporting(s: Snapshot): boolean {
  const j = s.freshness.jobber;
  return j.connected && !j.disconnected && !j.last_synced_at;
}

/** Jobber was connected but its past jobs never came in (still importing, or the sign-in stopped working). */
export function jobberNeverRead(s: Snapshot): boolean {
  return s.freshness.jobber.connected && !s.freshness.jobber.last_synced_at;
}

/** A bank whose connection is broken (its numbers stopped). */
export const BROKEN_BANK = new Set(["login_required", "revoked", "error"]);

/** Every bank has finished its first update and past months, none is broken, and Jobber's jobs are in. */
export function allArrived(s: Snapshot): boolean {
  const f = s.freshness;
  return f.banks.length > 0 &&
    f.banks.every((b) => b.last_successful_update && b.historical_update_complete && !BROKEN_BANK.has(b.status)) &&
    !jobberNeverRead(s);
}

/** The first numbers are still arriving (a bank's first update, its past months, or Jobber's jobs). */
export function stillArriving(s: Snapshot): boolean {
  return jobberImporting(s) ||
    s.status.reasons.some((r) => r.code === "no_numbers_yet") ||
    s.freshness.banks.some((b) => !b.last_successful_update || !b.historical_update_complete);
}

/** The owner said in setup that the business doesn't pay a crew from its bank. */
export function payrollNotTracked(pr: Snapshot["payroll"]): boolean {
  return pr.state === "unknown" && pr.unknown_reasons.includes("no_schedule") && pr.unknown_reasons.includes("no_payroll_account");
}

/** One bank or card transaction behind a number on the screen. */
export interface PulseTxnRow {
  id: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  name: string;
  /** For example "Checking ...7001". */
  account: string;
  /** Plaid sign: positive = money out. */
  amount: number;
  pending: boolean;
  treatment: "cost" | "refund" | "excluded" | "unsorted";
  category_key: string | null;
  exclude_reason: string | null;
  /** The merchant name an "every charge from" choice would use; null when only "just this one" is allowed. */
  merchant_rule_label: string | null;
  /** Counted, but flagged to check (a transfer to an account that is not linked). */
  review?: boolean;
}

/** One Jobber job or visit behind revenue. */
export interface PulseRevenueRow {
  id: string;
  /** For example "#1196 Large oak removal", "#1012 Monthly maintenance, visit" or "Invoice #17, #1196 Large oak removal". */
  label: string;
  /** Local date, YYYY-MM-DD: when the job was completed, or when the payment was received. */
  date: string;
  amount: number;
}

export type PersonalScope = "one" | "merchant";

export interface PulseDataSource {
  /** Posted costs and refunds in [from, to]; categoryKey null = every category. */
  costRows(categoryKey: string | null, from: string, to: string): Promise<PulseTxnRow[]>;
  /** Rows not counted for one reason in [from, to]. */
  excludedRows(reason: string, from: string, to: string): Promise<PulseTxnRow[]>;
  /** What makes up revenue in [from, to]: jobs and visits completed, or payments received (basis "payments"). */
  revenueRows(from: string, to: string, basis?: RevenueBasis): Promise<PulseRevenueRow[]>;
  /** Marks a cost as personal or owner draw; resolves to an undo function. */
  markPersonal(row: PulseTxnRow, scope: PersonalScope): Promise<() => Promise<void>>;
  /** Counts an item marked personal as a business cost again (lasting undo). */
  countAsBusiness(row: PulseTxnRow): Promise<void>;
}

export const PERIOD_LABEL: Record<PeriodDays, string> = { "7": "Last 7 days", "14": "Last 14 days", "30": "Last 30 days" };

/** Names for the default categories (pulse_seed_categories); a company's own list wins. */
export const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  payroll_contractors: "Payroll and contractors",
  fuel_equipment: "Fuel and equipment",
  job_fees: "Job fees",
  operating: "Operating costs",
  other: "Other",
};

/** Money that moved but is not a cost, in the owner's words. */
export const NOT_COUNTED_TEXT: Record<string, { label: string; why: string }> = {
  card_payment: { label: "Card bill payments", why: "What you buy on the card already counts, so paying the bill doesn't count again." },
  loan_payment: { label: "Loan payments", why: "Paying back a loan isn't a cost." },
  own_transfer: { label: "Moves between your own accounts", why: "Moving your own money isn't a cost." },
  personal: { label: "Personal or owner draw", why: "Items you said were personal." },
  pending: { label: "Not cleared yet", why: "Counts once the bank clears it." },
  before_count_from: { label: "Card spending before its start date", why: "The card counts from the date you chose in setup." },
  inflow: { label: "Deposits", why: "Not added in. Your sales come from completed jobs in Jobber, so deposits won't match them exactly." },
  non_business_account: { label: "Personal accounts", why: "Accounts you didn't mark as business." },
};

/** Why money isn't counted, for this company's revenue basis (deposits read differently when sales are payments). */
export function notCountedWhy(reason: string, basis: RevenueBasis | undefined): string | undefined {
  if (reason === "inflow" && basis === "payments") {
    return "Not added in. Your sales are the payments you record in Jobber, so adding bank deposits would count them twice.";
  }
  return NOT_COUNTED_TEXT[reason]?.why;
}

/**
 * The screen's words for revenue (M6, W3-10a): completed jobs, or payments received when the company
 * records payments in Jobber (Joe's rule). The numbers are the same kind either way; only the words change.
 */
/** Adds money amounts in whole cents, so a list's total matches the rounded total the server sends. */
export function sumCents(amounts: number[]): number {
  const c = amounts.reduce((s, a) => s + Math.round((Number(a) || 0) * 100), 0);
  return c / 100;
}

export function revenueWords(basis: RevenueBasis | undefined) {
  return basis === "payments"
    ? {
      title: "Payments received",
      lower: "payments received",
      one: "payment",
      many: "payments",
      /** How a row's date is introduced in the revenue list. */
      dated: "Received",
      /** What the revenue list holds, after its date range. */
      list: "Payments recorded in Jobber, by the day the customer paid. Refunds take money back out.",
      /** What Jobber sends that counts (Jobber problems). */
      updates: "payments",
      none: "No payments received or costs",
      noneLong: "No payments received or business costs in the last 30 days yet. Your numbers start with the first payment you record in Jobber or the first cleared bank payment.",
      pace: "a day in payments so far",
      paceOnly: "the payments you've received so far",
      rule: "Sales count on the day the customer paid, as recorded in Jobber.",
    }
    : {
      title: "Completed jobs",
      lower: "completed jobs",
      one: "job or visit",
      many: "jobs and visits",
      dated: "Completed",
      list: "Jobs and visits marked complete in Jobber, paid or not.",
      updates: "jobs",
      none: "No completed jobs or costs",
      noneLong: "No completed jobs or business costs in the last 30 days yet. Your numbers start with the first completed job or cleared payment.",
      pace: "a day of jobs you've completed so far",
      paceOnly: "the jobs you've completed so far",
      rule: "Completed jobs count on the day they're marked complete in Jobber, even before the customer pays.",
    };
}

/** Whole sentences for each reason payroll can't be worked out yet. */
export const PAYROLL_UNKNOWN_SENTENCE: Record<PayrollUnknownReason, string> = {
  no_schedule: "Set your payday in Setup to see this.",
  no_payroll_account: "Choose the account payroll comes out of in Setup.",
  no_balance: "Waiting for your bank to send the payroll account balance.",
  partial_history: "Still learning your payroll from your bank. Type what one payday usually costs in Setup to see it now.",
  no_payroll_history: "No payroll payments found yet. Type what one payday usually costs in Setup.",
};

/** Whole dollars by default ("$14,664", "-$8,821"); cents on request (payment lists). */
export function usd(n: number | null | undefined, cents = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "--";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  const zero = abs.replace(/[^1-9]/g, "") === "";
  return `${n < 0 && !zero ? "-" : ""}$${abs}`;
}

export function day(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The day of an instant (ISO), in the viewer's own time zone: "Oct 18". */
export function dayOfInstant(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** When an instant (ISO) was, in the viewer's own time zone: "2:05 PM" today, else "Oct 18, 2:05 PM". */
export function timeOfInstant(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(nowMs).toDateString() ? time : `${dayOfInstant(iso)}, ${time}`;
}

/**
 * Text that must not break across lines (a date such as "Fri, Oct 23" or "by Oct 31"): its spaces become
 * non-breaking, so a narrow phone wraps the words before it instead of splitting it.
 */
export function keepTogether(text: string): string {
  return text.replace(/ /g, " ");
}

export function weekdayDay(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function weekday(date: string | null | undefined): string {
  if (!date) return "";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export function monthName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/**
 * "up $10,370 (32%)", "down $3,607 (11%)", "no change". The percent is whole and left out when it
 * means nothing (a swing from a loss, or off a tiny base).
 */
export function upDownText(c: Change): string {
  if (c.amount === 0) return "no change";
  const pct = c.percent === null || Math.abs(c.percent) >= 500 ? "" : ` (${Math.round(Math.abs(c.percent))}%)`;
  return `${c.amount > 0 ? "up" : "down"} ${usd(Math.abs(c.amount))}${pct}`;
}

/** "2 hours ago", "12 minutes ago". */
export function agoText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "not yet";
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(hours / 24);
  return `${d} days ago`;
}
