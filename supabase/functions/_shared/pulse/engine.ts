// Financial Pulse: the calculation engine (A11 in Project Architecture.md).
//
// Pure functions only (no runtime-specific or network APIs), so the same file runs in the edge functions
// and in the vitest suite (src/lib/pulse/engine.test.ts).
//
// The engine never sees a transaction. It takes the window totals from the SQL function
// pulse_window_totals plus a few facts about settings, balances and freshness, and returns the
// snapshot the Pulse screen shows. Everything it returns is plain JSON. Money is rounded to cents
// only at the output, and every division is guarded, so no NaN or Infinity reaches the screen.
//
// The caller asks pulse_window_totals for windowsForSnapshot(today, settings, payrollFrom) (dates.ts),
// with payrollFrom = payrollCountedFrom(payroll_accounts) (each payroll account's counted_from set
// with accountCountedFrom), and passes the totals keyed as named there: MTD, L30, P30 and L7 always,
// the period filter's L14, P14 and P7, last month's same days PMTD (engine-6), and PAY (the payroll
// history) when there is one.
//
// Rules the spec leaves open, decided here (engine-2):
// * A window is partial when it starts before the latest date every business account is
//   counted from: for each account the later of its count-from date and its first transaction,
//   then the latest of those across accounts. The same test applies to every window.
// * Percent changes are measured against the size of the base (so a loss turning into a profit
//   is a positive change) and are null when the base is 0. Percents round half away from zero,
//   like money, so a gain and a loss of the same size show the same number.
// * The schedule is used only when it was fetched within 24 h, for this month, with status ok.
//   Anything else is pace-only, with the reason. On a tie the pace is named as the driver.
// * Scheduled work counts from today to month end: the schedule holds only visits not done yet
//   (starting after the fetch), and the pace covers the days after today only. A visit completed
//   since the fetch is not counted twice, because every Jobber visit event clears the fetch time,
//   which makes the forecast pace-only until the schedule is read again.
// * A profit target counts as set only when it is above 0.
// * The payroll estimate is the payroll-and-contractors cost of the PAY window divided by the pay
//   runs it holds (Haris, round 2). PAY is aligned to the pay schedule (payrollHistoryWindow in
//   dates.ts, Haris, round 3): the last 8 weekly, 4 biweekly, 6 semimonthly or 3 monthly paydays
//   at least A + 1 days old, from 6 days before the oldest to A days after the newest, where
//   A (PAYROLL_LATE_ALLOWANCE_DAYS) is weekly 0, biweekly 7, semimonthly 6, monthly 21. So a debit
//   from 6 days before payday (a provider's early debit) to A days after it (a check clearing, or
//   Zelle the next business day) counts for its own run, and a payday whose debit may still be
//   pending (today's included) is not counted yet. Paydays whose debit could predate the payroll
//   accounts' counted-from date are dropped, so PAY is never partial; it just holds fewer runs for
//   a while (estimate_partial). This replaces L56 and L3M (engine-1), which divided a partial
//   history by the full number of runs and could hold 2 or 4 monthly debits.
// * Known limit (round 3): a provider lead of more than 6 days before payday (for example 4
//   business days across a federal holiday), or a debit later than A days after payday, can make
//   one estimate off by one run. A debit dated today that has not posted yet cannot (a payday
//   counts only once its whole allowance ended by yesterday, round 4).
// * The drop rule uses the payroll accounts' own counted-from date (payrollCountedFrom: the latest
//   counted_from among the payroll accounts, each the later of that account's include_from and
//   history_start), not the company-wide coverage date, so a card or savings account counted from
//   a recent date does not hold payroll back (round 3). Without any counted_from nothing is dropped.
// * The engine works the PAY window out again from today, the settings and the payroll counted-from
//   date, and uses the PAY totals only when their dates match it (another window holds another
//   number of runs).
// * A payroll override of 0 or less counts as not set (a blank form field must not silence
//   payroll safety).
// * Payroll is "unknown" when the pay schedule is missing (no_schedule), no payroll account is
//   marked, any payroll account has no balance at all, the history is still building
//   (partial_history: no override and no PAY window yet, or its totals missing), or the PAY
//   window holds no payroll cost (no_payroll_history; an estimate of $0 would read as "covered").
//   Only partial_history changes the status (Haris, round 3): with a pay schedule set and no
//   override it adds the yellow problem payroll_history_building, so a company whose payroll
//   cannot be checked yet is never green. The other unknown reasons do not change the status.
// * "L30 profit below 80% of P30 profit" is read as "down more than 20% against the size of the
//   P30 profit", the same way percent changes are measured. For a profitable P30 that is exactly
//   the spec; after a loss or a break-even month it fires when the loss grew by more than 20% (or
//   any loss follows a break-even), instead of the literal reading, which would fire when a loss
//   shrinks. Compared in whole cents, so exactly 80% is not below 80%. To confirm with Haris/Joe.
//   The percent in its text is rounded up to one decimal and is at least 20.1, so it never shows
//   a number at or below the threshold.
// * Besides the spec's list, these also keep the status off green: no business bank linked,
//   Jobber never connected, any of MTD, L30, P30 or L7 missing from the input (numbers_missing),
//   an L30 window with no rows at all (no_numbers_yet, a brand-new company), and payroll history
//   still building (payroll_history_building, above). A missing PAY window is not numbers_missing;
//   it makes payroll unknown (partial_history), which is payroll_history_building.
// * Items that need logging in again soon (pending_expiration, pending_disconnect) only warn.
// * The pending warning and the "Pending" line under "Not counted" on the L30 screen both show
//   L30's pending outflow (the L7 screen's line shows L7's own). The line shows that outflow, not
//   the signed sum of every pending row, so a pending deposit does not shrink it; its count still
//   covers every pending row.
// * Break-even has no answer (null) when this month has no rows yet (revenue_count + cost_count
//   is 0) or its totals are missing, so a brand-new company does not read "costs covered".
// * money() and the one-decimal rounding return 0 for any result that is not finite, even when
//   the input was finite (so 1e307 dollars cannot overflow to Infinity).

import {
  addDays,
  dayOfMonth,
  daysInMonth,
  diffDays,
  formatDay,
  isLocalDate,
  isPayFrequency,
  monthEnd,
  nextPayday,
  type MonthWindowKey,
  monthWindowFor,
  type PayFrequency,
  PAYROLL_HISTORY_RUNS,
  payrollHistoryWindow,
  type PeriodWindowKey,
  periodWindowsFor,
  type PayrollHistoryWindow,
  payScheduleOf,
  type SnapshotWindowKey,
  WINDOW_KEYS,
  type WindowKey,
  windowsFor,
} from "./dates.ts";
import type { WindowTotals } from "./types.ts";

// engine-5 (2026-10-06): the "Not counted" list knows loan payments (sorter-6, Joe Evans: not a cost).
// engine-6 (2026-10-15): the month comparison (`month`: this month so far against the same days of last
// month, window PMTD) and homeSummaryOf, the numbers Home's Pulse card shows.
export const ENGINE_VERSION = "engine-7";

// ---------------------------------------------------------------------------
// Thresholds (defaults; Joe can adjust)
// ---------------------------------------------------------------------------

/** From this day of the month the pace is this month's own revenue per day; before it, the last 30 days'. */
export const PACE_FROM_DAY = 10;
/** A forecast loss is red from this day of the month (yellow before it). */
export const RED_FORECAST_LOSS_FROM_DAY = 10;
/** A loss so far this month is red from this day of the month. */
export const RED_MTD_LOSS_FROM_DAY = 20;
/**
 * Yellow when last-30-day profit is down more than this percent from the previous 30 days',
 * measured against the size of that profit (A11: "below 80% of P30 profit").
 */
export const PROFIT_DROP_PERCENT = 20;
/** A business bank with no successful update for longer than this keeps the status off green. */
export const BANK_STALE_HOURS = 72;
/** Jobber revenue older than this gets a warning. */
export const JOBBER_STALE_HOURS = 24;
/** Scheduled work older than this is not used: the forecast falls back to pace only. */
export const SCHEDULE_MAX_AGE_HOURS = 24;
/** The category whose cost over the payroll history window estimates payroll. */
export const PAYROLL_CATEGORY_KEY = "payroll_contractors";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type BankItemStatus =
  | "active"
  | "login_required"
  | "pending_expiration"
  | "pending_disconnect"
  | "revoked"
  | "removed"
  | "error";

/** One linked bank (plaid_items). */
export interface BankItemInput {
  /** plaid_items.id, echoed on warnings so the screen can offer Reconnect. */
  id: string;
  institution_name: string | null;
  status: BankItemStatus;
  /** Plaid's last_successful_update (ISO instant), null before the first update. */
  last_successful_update: string | null;
  historical_update_complete: boolean;
  new_accounts_available: boolean;
  /** True when the item holds at least one business account. Other items are ignored. */
  business: boolean;
}

/** One business account (plaid_accounts with is_business), for partial windows and count-from warnings. */
export interface BusinessAccountInput {
  id: string;
  name: string | null;
  mask: string | null;
  /** Plaid type: "credit" for cards, "depository" for bank accounts. */
  type: string | null;
  /** Count-from date chosen at setup (include_from), null for "count everything". */
  include_from: string | null;
  /** Local date of the account's earliest transaction (where its history starts), null when none yet. */
  history_start: string | null;
}

/** One account marked use_for_payroll. */
export interface PayrollAccountInput {
  available: number | null;
  current: number | null;
  /** balance_as_of (ISO instant). */
  as_of: string | null;
  /**
   * The date this account is counted from: the later of its include_from and its history_start
   * (accountCountedFrom). Paydays whose debit could predate the latest of these across the payroll
   * accounts are left out of the payroll history (payrollCountedFrom). Required so a caller cannot
   * forget it (a missing date would divide a partial history by every run); null only when the
   * account has neither an include_from nor any transactions yet.
   */
  counted_from: string | null;
}

/** pulse_settings fields the engine reads. */
export interface EngineSettings {
  profit_target_monthly: number | null;
  cash_reserve: number | null;
  pay_frequency: PayFrequency | null;
  /** A past or future payday (YYYY-MM-DD). */
  pay_anchor_date: string | null;
  payroll_amount_override: number | null;
}

/** jobber_sync_state.scheduled_by_day, as saved by refreshScheduled. */
export interface ScheduledByDay {
  month_end: string | null;
  truncated: boolean;
  /** Local date -> value of the incomplete visits scheduled that day. */
  days: Record<string, number>;
}

export interface ScheduledInput {
  /** jobber_sync_state.scheduled_status; null when never fetched. */
  status: "ok" | "no_scope" | "error" | null;
  /** jobber_sync_state.scheduled_fetched_at (ISO instant). */
  fetched_at: string | null;
  by_day: ScheduledByDay | null;
}

export interface JobberInput {
  /** A live Jobber connection exists for the owner. */
  connected: boolean;
  /** The connection was lost (app disconnected, or it must be reconnected). */
  disconnected: boolean;
  /** When Pulse last had news from Jobber (ISO instant; see jobberUpdatedAt), null until the first import is in. */
  last_synced_at: string | null;
}

/** What revenue is: money in recorded in Jobber, or completed jobs and visits (M6, W3-10a). */
export type RevenueBasis = "payments" | "completed_jobs";

export interface EngineInput {
  /** The company's local date today (localDate(now, timezone)). */
  today: string;
  /** The current instant (ISO), used only for staleness. */
  now: string;
  /**
   * pulse_window_totals for windowsForSnapshot(today, settings, payrollCountedFrom(payroll_accounts)),
   * keyed exactly as it names them. A missing MTD, L30, P30 or L7 counts as empty and keeps the
   * status off green (numbers_missing). PAY is optional: without it (or with totals for other
   * dates) payroll is unknown, partial_history (yellow, payroll_history_building), unless an
   * override is set.
   */
  windows: Partial<Record<SnapshotWindowKey, WindowTotals>>;
  scheduled: ScheduledInput | null;
  settings: EngineSettings | null;
  payroll_accounts: PayrollAccountInput[];
  business_accounts: BusinessAccountInput[];
  bank_items: BankItemInput[];
  jobber: JobberInput | null;
  /** Transfers to unlinked accounts counted as costs but flagged for review, in the last 30 days. */
  review_transfers_l30: number | null;
  /**
   * What revenue is (M6, pulse_revenue_basis): "payments" = money in recorded in Jobber, by the day
   * received; "completed_jobs" = jobs and visits by the day completed. Only the screen's wording and
   * the revenue drill-down change; the totals arrive in `windows` either way. Default completed_jobs.
   */
  revenue_basis?: RevenueBasis;
  /** pulse_settings.revenue_tax: "pre_tax" (the default since M6) leaves sales tax out of revenue. */
  revenue_tax?: "pre_tax" | "as_jobber";
  /** Per-day window totals from the same SQL calculation as the period totals. */
  daily_windows?: Record<string, WindowTotals>;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type StatusLevel = "green" | "yellow" | "red";

/** Every window the engine summarizes. */
export type SummaryKey = WindowKey | PeriodWindowKey | MonthWindowKey;

export interface WindowSummary {
  key: SummaryKey;
  from: string;
  to: string;
  revenue: number;
  revenue_count: number;
  cost: number;
  cost_count: number;
  profit: number;
  /** False when no totals were supplied for this window; its numbers are then 0. */
  has_data: boolean;
  /** The window starts before the date every business account is counted from. */
  partial: boolean;
  /** That date, when partial. */
  partial_from: string | null;
  /** For example "Business Card ending 4242 not counted before Oct 7, 2026". */
  partial_label: string | null;
}

export interface Change {
  amount: number;
  /** Change against the size of the base, one decimal; null when the base is 0. */
  percent: number | null;
}

export interface Comparison {
  last30: WindowSummary;
  prev30: WindowSummary;
  revenue: Change;
  cost: Change;
  profit: Change;
  /** Neither window is partial, so the change is like for like. */
  comparable: boolean;
}

/** This month so far against the same days of last month (engine-6), for Home's Pulse card. */
export interface MonthView {
  /** MTD: the 1st to today. */
  current: WindowSummary;
  /** PMTD: the 1st of last month to the same day, clamped to last month's length. */
  previous: WindowSummary;
  revenue: Change;
  cost: Change;
  profit: Change;
  /** Neither window is partial, so the change is like for like. */
  comparable: boolean;
}

/**
 * What Home's Pulse card shows (pulse-get's summary mode): numbers only, never a bank name, an account or a
 * transaction (the windows' partial_label, which names an account, is null).
 */
export interface HomeSummary {
  engine_version: string;
  today: string;
  /** Null for a snapshot from before engine-6. */
  month: MonthView | null;
  revenue_basis: RevenueBasis;
  /** When the numbers were last brought up to date: the oldest of the banks' last updates and Jobber's
   * last sync; null when a bank or Jobber has none yet. */
  updated_at: string | null;
  /** The first numbers are still arriving: the Pulse screen's stillArriving rule. */
  arriving: boolean;
  cashflow_30?: CashflowSeries;
}

export interface CashflowSeries {
  from: string;
  to: string;
  partial_from: string | null;
  points: Array<{ date: string; revenue: number | null; cost: number | null }>;
}

/** Exactly 30 company-local calendar days, including today, for pulse_window_totals. */
export function cashflowWindows(today: string) {
  return Array.from({ length: 30 }, (_, i) => {
    const date = addDays(today, i - 29);
    return { key: `DAY_${date}`, from: date, to: date };
  });
}

/** The period filter's choices, in days. */
export type PeriodDays = "7" | "14" | "30";
export const PERIOD_DAYS: readonly PeriodDays[] = ["7", "14", "30"];

/** One period of the filter: the last N days against the N days before, and where the money went. */
export interface PeriodView {
  days: number;
  last: WindowSummary;
  prev: WindowSummary;
  revenue: Change;
  cost: Change;
  profit: Change;
  /** Neither window is partial, so the change is like for like. */
  comparable: boolean;
  spending: Spending;
}

/**
 * Why the forecast is pace-only: never read, no permission, the read failed, read more than 24 h
 * ago, saved for another month, or cleared by a Jobber visit change and not read again yet.
 */
export type PaceOnlyReason = "missing" | "no_scope" | "fetch_error" | "stale" | "other_month" | "changed";

export interface Forecast {
  day_of_month: number;
  days_in_month: number;
  days_left: number;
  pace_basis: "month_to_date" | "last_30_days";
  pace_per_day: number;
  /** pace_per_day x days_left. */
  pace_rest: number;
  /** Scheduled work not done yet, from today to month end; null when pace-only. */
  scheduled_rest: number | null;
  /** The schedule was cut short (too many visits to read), so it may be low. */
  scheduled_truncated: boolean;
  driver: "schedule" | "pace";
  pace_only: boolean;
  pace_only_reason: PaceOnlyReason | null;
  pace_only_text: string | null;
  cost_per_day: number;
  /** The last 30 days are partial, so cost_per_day may be low. */
  cost_rate_partial: boolean;
  revenue: number;
  cost: number;
  profit: number;
}

/**
 * Every field but `target` is null when this month has no rows yet or its totals are missing
 * (show an empty state).
 */
export interface BreakEven {
  /** Costs so far this month are covered by revenue. */
  covered: boolean | null;
  /** max(0, cost - revenue) this month. */
  needed: number | null;
  /** revenue - cost when covered, else 0. */
  ahead_by: number | null;
  target: number | null;
  /** How much more profit this month reaches the target (0 once reached); null without a target. */
  to_target: number | null;
  /** Forecast profit minus the target; null without a target. */
  forecast_vs_target: number | null;
}

export type PayrollState = "covered" | "tight" | "short" | "unknown";
export type PayrollUnknownReason =
  | "no_schedule"
  | "no_payroll_account"
  | "no_balance"
  | "partial_history"
  | "no_payroll_history";

/** Plain-English text for each unknown reason, in the order the screen lists them. */
export const PAYROLL_UNKNOWN_TEXT: Readonly<Record<PayrollUnknownReason, string>> = {
  no_schedule: "set your pay schedule in setup to see this",
  no_payroll_account: "mark the account payroll is paid from in setup to see this",
  no_balance: "the bank has not sent a balance for the payroll account yet",
  partial_history: "payroll history is still building; enter a typical payroll amount in setup to see this now",
  no_payroll_history: "no payroll or contractor payments were found in recent pay runs; enter a typical payroll amount in setup",
};

export interface PayrollSafety {
  state: PayrollState;
  unknown_reasons: PayrollUnknownReason[];
  /** PAYROLL_UNKNOWN_TEXT for each unknown reason, in the same order. */
  unknown_texts: string[];
  pay_frequency: PayFrequency | null;
  pay_anchor_date: string | null;
  next_payday: string | null;
  days_to_payday: number | null;
  /** Available balance (current when there is none) summed over the payroll accounts. */
  cash: number | null;
  payroll_accounts: number;
  /** The oldest balance time among the payroll accounts. */
  balance_as_of: string | null;
  estimated_payroll: number | null;
  /** pay_history = the PAY window's payroll cost per pay run. */
  estimate_source: "override" | "pay_history" | null;
  /**
   * The PAY window (payrollHistoryWindow), whether or not the override is used; null without a
   * schedule or before any payday is counted. It ends A days after its newest payday (on or
   * before today), so the most recent payday or two may not be in it yet.
   */
  history_from: string | null;
  history_to: string | null;
  /** Pay runs that window holds (8, 4, 6 or 3 once complete); the estimate is history_cost / history_runs. */
  history_runs: number | null;
  /** Payroll-and-contractors cost over that window; null when its totals are missing or for other dates. */
  history_cost: number | null;
  /**
   * The estimate comes from fewer pay runs than a full history (the payroll accounts are counted
   * from a recent date). It is still a per-run figure, not a low one.
   */
  estimate_partial: boolean;
  reserve: number;
  /** cash - estimated_payroll. */
  margin: number | null;
}

export interface CategoryLine {
  key: string;
  amount: number;
  /** Share of the window's total cost, one decimal; null when the total is 0 or less. */
  share_pct: number | null;
  /** Payments behind the line (M5 totals); null when the totals do not say. */
  count: number | null;
}

export interface NotCountedLine {
  reason: string;
  label: string;
  /**
   * As summed by pulse_window_totals (Plaid sign: positive = money out). For "pending" it is the
   * pending money out only (on the L30 screen, the same figure as the pending warning).
   */
  total: number;
  /** Rows behind the line (for "pending", every pending row, deposits included). */
  count: number;
  /**
   * Money out and money in kept apart (engine-3, from M5's excluded_flow_by_reason), so a matched
   * card payment shows the money that moved instead of netting to about $0. Without the M5 totals
   * they are read from the signed total. money_out for "pending" is the pending money out.
   */
  money_out: number;
  count_out: number;
  money_in: number;
  count_in: number;
}

export interface Spending {
  key: SummaryKey;
  from: string;
  to: string;
  total_cost: number;
  categories: CategoryLine[];
  not_counted: NotCountedLine[];
  pending_outflow: number;
  partial: boolean;
  partial_label: string | null;
}

export type StatusReasonCode =
  | "payroll_short"
  | "forecast_loss"
  | "mtd_loss"
  | "payroll_tight"
  | "forecast_below_target"
  | "forecast_loss_early"
  | "profit_down"
  | "bank_login_required"
  | "bank_revoked"
  | "bank_error"
  | "bank_stale"
  | "no_bank_linked"
  | "jobber_disconnected"
  | "jobber_not_connected"
  | "numbers_missing"
  | "no_numbers_yet"
  | "payroll_history_building";

export interface StatusReason {
  code: StatusReasonCode;
  level: "red" | "yellow";
  text: string;
  /** The bank item it is about, when there is one. */
  ref: string | null;
}

export type WarningCode =
  | "bank_login_required"
  | "bank_revoked"
  | "bank_error"
  | "bank_stale"
  | "bank_expiring"
  | "bank_history_loading"
  | "bank_new_accounts"
  | "no_bank_linked"
  | "card_counted_from"
  | "account_counted_from"
  | "transfers_review"
  | "pending_not_counted"
  | "jobber_not_connected"
  | "jobber_disconnected"
  | "jobber_stale"
  | "forecast_pace_only"
  | "numbers_missing"
  | "no_numbers_yet"
  | "payroll_history_building";

export interface Warning {
  code: WarningCode;
  /** action = the owner must do something; warning = numbers may be off; info = good to know. */
  severity: "action" | "warning" | "info";
  text: string;
  /** Bank item id or account id the warning is about. */
  ref: string | null;
  date: string | null;
  count: number | null;
  amount: number | null;
}

export interface Freshness {
  computed_at: string;
  banks: Array<{
    id: string;
    name: string;
    status: BankItemStatus;
    last_successful_update: string | null;
    hours_since_update: number | null;
    historical_update_complete: boolean;
  }>;
  jobber: {
    connected: boolean;
    disconnected: boolean;
    last_synced_at: string | null;
    hours_since_sync: number | null;
  };
  schedule_fetched_at: string | null;
}

export interface Coverage {
  /** Latest date every business account is counted from; null when unknown. */
  counted_from: string | null;
  source: "count_from" | "history" | null;
  account_id: string | null;
  label: string | null;
}

export interface Snapshot {
  engine_version: string;
  computed_at: string;
  today: string;
  status: { level: StatusLevel; reasons: StatusReason[] };
  profit_mtd: WindowSummary;
  comparison: Comparison;
  forecast: Forecast;
  break_even: BreakEven;
  payroll: PayrollSafety;
  spending: { L7: Spending; L30: Spending };
  /** The 7 / 14 / 30 day period filter (engine-3): each period against the same number of days before it. */
  periods: Record<PeriodDays, PeriodView>;
  /** This month so far against the same days of last month (engine-6). */
  month: MonthView;
  coverage: Coverage;
  freshness: Freshness;
  warnings: Warning[];
  /** What revenue is on this snapshot (engine-4): see EngineInput.revenue_basis. */
  revenue_basis: RevenueBasis;
  /** Revenue leaves sales tax out (engine-4; pulse_settings.revenue_tax is not "as_jobber"). */
  revenue_without_tax: boolean;
  cashflow_30?: CashflowSeries;
}

// ---------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------

/** A finite number from a number or numeric string (Postgres numeric can arrive as text); else null. */
function finite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Cents, rounded half away from zero, never NaN, Infinity or -0 (0 when the result overflows). */
export function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
  // |n| * 100 overflows to Infinity from about 1.8e306.
  if (!Number.isFinite(r)) return 0;
  return r === 0 ? 0 : r;
}

function div(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  const r = a / b;
  return Number.isFinite(r) ? r : 0;
}

/** One decimal, rounded half away from zero like money(), never NaN, Infinity or -0. */
function oneDecimal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = (Math.sign(n) * Math.round(Math.abs(n) * 10 + 1e-7)) / 10;
  if (!Number.isFinite(r)) return 0;
  return r === 0 ? 0 : r;
}

function percentChange(current: number, base: number): number | null {
  if (base === 0) return null;
  return oneDecimal(div(current - base, Math.abs(base)) * 100);
}

function count(v: unknown): number {
  const n = finite(v);
  return n === null ? 0 : Math.max(0, Math.round(n));
}

/** Exact hours between an ISO instant and now (thresholds compare this; round only for display). */
function hoursSince(iso: string | null | undefined, nowMs: number): number | null {
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return (nowMs - ms) / 3_600_000;
}

function displayHours(h: number | null): number | null {
  return h === null ? null : oneDecimal(h);
}

function usd(n: number): string {
  const r = money(n);
  // Past 1e21 toFixed switches to exponent notation and has no "." part.
  const [whole, frac = "00"] = Math.abs(r).toFixed(2).split(".");
  return `${r < 0 ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Windows and coverage
// ---------------------------------------------------------------------------

interface CleanTotals {
  from: string;
  to: string;
  has_data: boolean;
  revenue: number;
  revenue_count: number;
  cost: number;
  cost_count: number;
  by_category: Record<string, number>;
  /** Null when the totals carry no counts (before M5). */
  count_by_category: Record<string, number> | null;
  excluded: Record<string, { total: number; count: number }>;
  /** Null when the totals carry no money-out / money-in split (before M5). */
  flow: Record<string, { out: number; out_count: number; in: number; in_count: number }> | null;
  pending: number;
  review_count: number;
}

function cleanTotals(spec: { from: string; to: string }, t: WindowTotals | undefined | null): CleanTotals {
  const byCategory: Record<string, number> = {};
  const excluded: Record<string, { total: number; count: number }> = {};
  let countByCategory: Record<string, number> | null = null;
  let flow: Record<string, { out: number; out_count: number; in: number; in_count: number }> | null = null;
  if (t && typeof t === "object") {
    if (t.cost_count_by_category && typeof t.cost_count_by_category === "object") {
      countByCategory = {};
      for (const [k, v] of Object.entries(t.cost_count_by_category)) countByCategory[k] = count(v);
    }
    if (t.excluded_flow_by_reason && typeof t.excluded_flow_by_reason === "object") {
      flow = {};
      for (const [k, v] of Object.entries(t.excluded_flow_by_reason)) {
        if (!v || typeof v !== "object") continue;
        flow[k] = {
          out: Math.max(0, finite(v.out) ?? 0),
          out_count: count(v.out_count),
          in: Math.max(0, finite(v.in) ?? 0),
          in_count: count(v.in_count),
        };
      }
    }
    for (const [k, v] of Object.entries(t.cost_by_category ?? {})) {
      const n = finite(v);
      if (n !== null) byCategory[k] = n;
    }
    for (const [k, v] of Object.entries(t.excluded_by_reason ?? {})) {
      if (!v || typeof v !== "object") continue;
      excluded[k] = { total: finite(v.total) ?? 0, count: count(v.count) };
    }
  }
  const has = !!t && typeof t === "object";
  return {
    from: has && isLocalDate(t.from) ? t.from : spec.from,
    to: has && isLocalDate(t.to) ? t.to : spec.to,
    has_data: has,
    revenue: finite(t?.revenue) ?? 0,
    revenue_count: count(t?.revenue_count),
    cost: finite(t?.cost) ?? 0,
    cost_count: count(t?.cost_count),
    by_category: byCategory,
    count_by_category: countByCategory,
    excluded,
    flow,
    pending: finite(t?.pending_outflow) ?? 0,
    review_count: count(t?.review_count),
  };
}

function accountName(a: { name: string | null; mask: string | null; type: string | null }): string {
  const base = a.name && a.name.trim() !== "" ? a.name.trim() : a.type === "credit" ? "Card" : "Account";
  return a.mask ? `${base} ending ${a.mask}` : base;
}

function bankName(item: BankItemInput): string {
  return item.institution_name && item.institution_name.trim() !== "" ? item.institution_name.trim() : "Your bank";
}

/** The dates an account is counted from (plaid_accounts include_from and its first transaction). */
export interface AccountDates {
  include_from: string | null;
  history_start: string | null;
}

// Each account counts from the later of its count-from date and its first transaction.
function countedStart(a: AccountDates): { start: string; source: "count_from" | "history" } | null {
  const inc = isLocalDate(a.include_from) ? a.include_from : null;
  const hist = isLocalDate(a.history_start) ? a.history_start : null;
  if (inc && (!hist || inc >= hist)) return { start: inc, source: "count_from" };
  if (hist) return { start: hist, source: "history" };
  return null;
}

/**
 * The date one account is counted from: the later of its include_from and its history_start;
 * null when neither is a date. The edge function sets each payroll account's counted_from with it.
 */
export function accountCountedFrom(a: AccountDates | null | undefined): string | null {
  if (!a || typeof a !== "object") return null;
  return countedStart(a)?.start ?? null;
}

/**
 * The payroll counted-from date: the latest counted_from among the payroll accounts, null when
 * none gives one. The edge function passes it to windowsForSnapshot, so the PAY window it asks for
 * is the one the engine expects; paydays whose debit could predate it are left out of PAY.
 */
export function payrollCountedFrom(accounts: PayrollAccountInput[] | null | undefined): string | null {
  let latest: string | null = null;
  for (const a of accounts ?? []) {
    if (!a || typeof a !== "object") continue;
    const d = a.counted_from;
    if (isLocalDate(d) && (latest === null || d > latest)) latest = d;
  }
  return latest;
}

/**
 * The latest date every business account is counted from: windows starting before it are partial.
 * (The payroll history uses the payroll accounts' own date instead, payrollCountedFrom.)
 */
export function coverageOf(accounts: BusinessAccountInput[] | null | undefined): Coverage {
  let best: Coverage = { counted_from: null, source: null, account_id: null, label: null };
  for (const a of accounts ?? []) {
    if (!a || typeof a !== "object") continue;
    const counted = countedStart(a);
    if (!counted) continue;
    const { start, source } = counted;
    const later = best.counted_from === null || start > best.counted_from;
    const sameButChosen = start === best.counted_from && source === "count_from" && best.source !== "count_from";
    if (later || sameButChosen) {
      const name = accountName(a);
      best = {
        counted_from: start,
        source,
        account_id: a.id,
        label: source === "count_from"
          ? `${name} not counted before ${formatDay(start)}`
          : `${name} history starts ${formatDay(start)}`,
      };
    }
  }
  return best;
}

function summarize(key: SummaryKey, t: CleanTotals, coverage: Coverage): WindowSummary {
  const revenue = money(t.revenue);
  const cost = money(t.cost);
  const partial = coverage.counted_from !== null && t.from < coverage.counted_from;
  return {
    key,
    from: t.from,
    to: t.to,
    revenue,
    revenue_count: t.revenue_count,
    cost,
    cost_count: t.cost_count,
    profit: money(revenue - cost),
    has_data: t.has_data,
    partial,
    partial_from: partial ? coverage.counted_from : null,
    partial_label: partial ? coverage.label : null,
  };
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

const PACE_ONLY_TEXT: Record<PaceOnlyReason, string> = {
  missing: "scheduled visits have not been read from Jobber yet",
  no_scope: "TreeCheck is not allowed to read scheduled visits in Jobber",
  fetch_error: "scheduled visits could not be read from Jobber",
  stale: "scheduled visits from Jobber are more than a day old",
  other_month: "scheduled visits have not been read for this month yet",
  changed: "scheduled visits changed in Jobber and have not been read again yet",
};

interface ScheduleRead {
  rest: number | null;
  reason: PaceOnlyReason | null;
  truncated: boolean;
}

function readSchedule(s: ScheduledInput | null, today: string, nowMs: number): ScheduleRead {
  if (!s || s.status === null || s.status === undefined) return { rest: null, reason: "missing", truncated: false };
  if (s.status === "no_scope") return { rest: null, reason: "no_scope", truncated: false };
  if (s.status === "error") return { rest: null, reason: "fetch_error", truncated: false };
  if (s.status !== "ok" || !s.by_day || typeof s.by_day !== "object") {
    return { rest: null, reason: "missing", truncated: false };
  }
  // A Jobber visit event clears the fetch time so the schedule is read again (jobber-webhook).
  if (s.fetched_at === null || s.fetched_at === undefined) return { rest: null, reason: "changed", truncated: false };
  const age = hoursSince(s.fetched_at, nowMs);
  const end = monthEnd(today);
  if (age === null || age > SCHEDULE_MAX_AGE_HOURS) return { rest: null, reason: "stale", truncated: false };
  // Saved for another month (e.g. just after midnight on the 1st): not usable for this one.
  if (s.by_day.month_end && s.by_day.month_end !== end) return { rest: null, reason: "other_month", truncated: false };
  let rest = 0;
  for (const [day, value] of Object.entries(s.by_day.days ?? {})) {
    const n = finite(value);
    if (n === null || !isLocalDate(day)) continue;
    // Today through month end. The schedule holds only visits not done yet, so today's entries
    // are work still to come today; the pace below covers only the days after today.
    if (day >= today && day <= end) rest += n;
  }
  return { rest, reason: null, truncated: s.by_day.truncated === true };
}

function forecastOf(
  today: string,
  mtd: WindowSummary,
  l30: WindowSummary,
  schedule: ScheduleRead,
  basis: RevenueBasis,
): Forecast {
  const e = dayOfMonth(today);
  const n = daysInMonth(today);
  const daysLeft = n - e;
  const fromMonth = e >= PACE_FROM_DAY;
  // Never below zero: a month that starts with a refund doesn't forecast money going out every day.
  const pacePerDay = Math.max(0, fromMonth ? div(mtd.revenue, e) : div(l30.revenue, 30));
  const paceRest = pacePerDay * daysLeft;
  const paceOnly = schedule.rest === null;
  const scheduledRest = schedule.rest ?? 0;
  // On payments (W3-10a) the schedule never drives: work is paid after it's done, often next month, so
  // the pace of payments is the better guess. The scheduled work is still reported.
  const driver: "schedule" | "pace" = basis !== "payments" && !paceOnly && scheduledRest > paceRest ? "schedule" : "pace";
  const revenue = money(mtd.revenue + (driver === "schedule" ? scheduledRest : paceRest));
  const costPerDay = div(l30.cost, 30);
  const cost = money(mtd.cost + costPerDay * daysLeft);
  return {
    day_of_month: e,
    days_in_month: n,
    days_left: daysLeft,
    pace_basis: fromMonth ? "month_to_date" : "last_30_days",
    pace_per_day: money(pacePerDay),
    pace_rest: money(paceRest),
    scheduled_rest: paceOnly ? null : money(scheduledRest),
    scheduled_truncated: schedule.truncated,
    driver,
    pace_only: paceOnly,
    pace_only_reason: schedule.reason,
    pace_only_text: schedule.reason ? PACE_ONLY_TEXT[schedule.reason] : null,
    cost_per_day: money(costPerDay),
    cost_rate_partial: l30.partial,
    revenue,
    cost,
    profit: money(revenue - cost),
  };
}

// ---------------------------------------------------------------------------
// Break-even and payroll
// ---------------------------------------------------------------------------

function targetOf(settings: EngineSettings | null): number | null {
  const t = finite(settings?.profit_target_monthly);
  return t !== null && t > 0 ? money(t) : null;
}

/** A window with no rows at all (nothing synced yet); a missing window counts as empty too. */
function noRows(w: WindowSummary): boolean {
  return !w.has_data || w.revenue_count + w.cost_count === 0;
}

function breakEvenOf(mtd: WindowSummary, forecast: Forecast, target: number | null): BreakEven {
  if (noRows(mtd)) {
    return { covered: null, needed: null, ahead_by: null, target, to_target: null, forecast_vs_target: null };
  }
  const needed = money(Math.max(0, mtd.cost - mtd.revenue));
  const covered = needed === 0;
  return {
    covered,
    needed,
    ahead_by: covered ? money(mtd.revenue - mtd.cost) : 0,
    target,
    to_target: target === null ? null : money(Math.max(0, target - mtd.profit)),
    forecast_vs_target: target === null ? null : money(forecast.profit - target),
  };
}

/**
 * The PAY totals, only when they were supplied for the window the engine expects. Totals for
 * other dates hold another number of pay runs, so dividing them by `history.runs` would be wrong.
 */
function payTotals(raw: WindowTotals | undefined | null, history: PayrollHistoryWindow): CleanTotals | null {
  if (!raw || typeof raw !== "object") return null;
  if ((isLocalDate(raw.from) && raw.from !== history.from) || (isLocalDate(raw.to) && raw.to !== history.to)) return null;
  return cleanTotals(history, raw);
}

function payrollOf(input: EngineInput, today: string): PayrollSafety {
  const s = input.settings;
  const frequency = s && isPayFrequency(s.pay_frequency) ? s.pay_frequency : null;
  const anchor = s && isLocalDate(s.pay_anchor_date) ? s.pay_anchor_date : null;
  const reserve = money(Math.max(0, finite(s?.cash_reserve) ?? 0));
  const unknown: PayrollUnknownReason[] = [];
  const accounts = input.payroll_accounts ?? [];

  const schedule = payScheduleOf(s);
  if (!schedule) unknown.push("no_schedule");
  const next = schedule ? nextPayday(today, schedule.frequency, schedule.anchor) : null;
  // The payroll accounts' own counted-from date, not the company-wide one (round 3).
  const payrollFrom = payrollCountedFrom(accounts);
  const history = schedule ? payrollHistoryWindow(today, schedule.frequency, schedule.anchor, payrollFrom) : null;
  const historyTotals = history ? payTotals(input.windows?.PAY, history) : null;

  let cash = 0;
  let missingBalance = false;
  let oldest: { iso: string; ms: number } | null = null;
  for (const a of accounts) {
    const balance = finite(a?.available) ?? finite(a?.current);
    if (balance === null) missingBalance = true;
    else cash += balance;
    const ms = typeof a?.as_of === "string" ? Date.parse(a.as_of) : NaN;
    if (Number.isFinite(ms) && (oldest === null || ms < oldest.ms)) oldest = { iso: a.as_of as string, ms };
  }
  if (accounts.length === 0) unknown.push("no_payroll_account");
  else if (missingBalance) unknown.push("no_balance");

  const override = finite(s?.payroll_amount_override);
  const historyCost = historyTotals ? historyTotals.by_category[PAYROLL_CATEGORY_KEY] ?? 0 : null;
  const perRun = history !== null && historyCost !== null ? money(div(historyCost, history.runs)) : 0;
  let estimate: number | null = null;
  let source: PayrollSafety["estimate_source"] = null;
  // An estimate that rounds to $0 would read as "covered", so it counts as none.
  if (override !== null && money(override) > 0) {
    estimate = money(override);
    source = "override";
  } else if (perRun > 0) {
    estimate = perRun;
    source = "pay_history";
  }
  if (estimate === null && schedule !== null) {
    unknown.push(history === null || historyTotals === null ? "partial_history" : "no_payroll_history");
  }

  const cashOut = accounts.length > 0 && !missingBalance ? money(cash) : null;
  const margin = cashOut !== null && estimate !== null ? money(cashOut - estimate) : null;
  let state: PayrollState = "unknown";
  if (unknown.length === 0 && cashOut !== null && estimate !== null && margin !== null) {
    if (cashOut < estimate) state = "short";
    else if (margin < reserve) state = "tight";
    else state = "covered";
  }

  return {
    state,
    unknown_reasons: unknown,
    unknown_texts: unknown.map((r) => PAYROLL_UNKNOWN_TEXT[r]),
    pay_frequency: frequency,
    pay_anchor_date: anchor,
    next_payday: next,
    days_to_payday: next ? diffDays(next, today) : null,
    cash: cashOut,
    payroll_accounts: accounts.length,
    balance_as_of: oldest ? oldest.iso : null,
    estimated_payroll: estimate,
    estimate_source: source,
    history_from: history ? history.from : null,
    history_to: history ? history.to : null,
    history_runs: history ? history.runs : null,
    history_cost: historyCost === null ? null : money(historyCost),
    estimate_partial: source === "pay_history" && schedule !== null && history !== null &&
      history.runs < PAYROLL_HISTORY_RUNS[schedule.frequency],
    reserve,
    margin,
  };
}

// ---------------------------------------------------------------------------
// Where the money goes
// ---------------------------------------------------------------------------

const NOT_COUNTED_ORDER = [
  "card_payment",
  "loan_payment",
  "own_transfer",
  "personal",
  "pending",
  "before_count_from",
  "inflow",
  "non_business_account",
];

const NOT_COUNTED_LABEL: Record<string, string> = {
  card_payment: "Card payments",
  loan_payment: "Loan payments",
  own_transfer: "Transfers between your own accounts",
  personal: "Personal or owner draw",
  pending: "Pending, not counted yet",
  before_count_from: "Before the count-from date",
  inflow: "Money in (revenue comes from Jobber)",
  non_business_account: "Non-business accounts",
};

function spendingOf(summary: WindowSummary, t: CleanTotals): Spending {
  const total = summary.cost;
  const categories: CategoryLine[] = Object.entries(t.by_category)
    .map(([key, amount]) => ({
      key,
      amount: money(amount),
      share_pct: total > 0 ? oneDecimal(div(amount, total) * 100) : null,
      count: t.count_by_category ? (t.count_by_category[key] ?? 0) : null,
    }))
    .sort((a, b) => b.amount - a.amount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const rank = (r: string) => {
    const i = NOT_COUNTED_ORDER.indexOf(r);
    return i === -1 ? NOT_COUNTED_ORDER.length : i;
  };
  const notCounted: NotCountedLine[] = Object.entries(t.excluded)
    .map(([reason, v]) => {
      const f = t.flow?.[reason] ?? null;
      const signedOut = v.total > 0 ? v.total : 0;
      const signedIn = v.total < 0 ? -v.total : 0;
      return {
        reason,
        label: NOT_COUNTED_LABEL[reason] ?? "Other items not counted",
        // Every pending row is excluded as pending, deposits too; show only the money going out.
        // On the L30 screen this is the same figure as the pending warning.
        total: money(reason === "pending" ? t.pending : v.total),
        count: v.count,
        money_out: money(reason === "pending" ? t.pending : f ? f.out : signedOut),
        count_out: f ? f.out_count : reason === "pending" || signedOut > 0 ? v.count : 0,
        money_in: money(f ? f.in : signedIn),
        count_in: f ? f.in_count : signedIn > 0 ? v.count : 0,
      };
    })
    .sort((a, b) => rank(a.reason) - rank(b.reason) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  return {
    key: summary.key,
    from: summary.from,
    to: summary.to,
    total_cost: total,
    categories,
    not_counted: notCounted,
    pending_outflow: money(t.pending),
    partial: summary.partial,
    partial_label: summary.partial_label,
  };
}

// ---------------------------------------------------------------------------
// Freshness, warnings and status
// ---------------------------------------------------------------------------

function warning(
  code: WarningCode,
  severity: Warning["severity"],
  text: string,
  extra: Partial<Pick<Warning, "ref" | "date" | "count" | "amount">> = {},
): Warning {
  return {
    code,
    severity,
    text,
    ref: extra.ref ?? null,
    date: extra.date ?? null,
    count: extra.count ?? null,
    amount: extra.amount ?? null,
  };
}

interface DataProblem {
  code: StatusReasonCode & WarningCode;
  text: string;
  ref: string | null;
}

/**
 * Missing totals, no rows yet, payroll history still building, bank and Jobber problems: each
 * becomes a warning, and each keeps the status off green.
 */
function dataProblems(
  missingWindows: WindowKey[],
  l30NoRows: boolean,
  payrollHistoryBuilding: boolean,
  items: BankItemInput[],
  jobber: JobberInput | null,
  nowMs: number,
): { problems: DataProblem[]; warnings: Warning[] } {
  const problems: DataProblem[] = [];
  const warnings: Warning[] = [];
  const add = (code: DataProblem["code"], severity: Warning["severity"], text: string, ref: string | null) => {
    problems.push({ code, text, ref });
    warnings.push(warning(code, severity, text, { ref }));
  };

  if (missingWindows.length > 0) {
    add("numbers_missing", "warning", "Some totals could not be read, so some numbers show $0 for now.", null);
  }
  if (l30NoRows) {
    add(
      "no_numbers_yet",
      "warning",
      "No revenue or costs in the last 30 days yet; numbers appear once Jobber and the bank have synced.",
      null,
    );
  }
  if (payrollHistoryBuilding) {
    add(
      "payroll_history_building",
      "warning",
      "Payroll history is still building; enter a typical payroll amount in setup to check payroll safety now.",
      null,
    );
  }
  if (items.length === 0) {
    add("no_bank_linked", "action", "No business bank account is linked yet, so costs are not counted.", null);
  }
  for (const item of items) {
    const name = bankName(item);
    if (item.status === "login_required") {
      add("bank_login_required", "action", `${name} needs you to log in again.`, item.id);
    } else if (item.status === "revoked") {
      add("bank_revoked", "action", `${name} access was turned off. Link it again so its costs keep counting.`, item.id);
    } else if (item.status === "error") {
      add("bank_error", "action", `${name} has a connection error and is not updating.`, item.id);
    } else if (item.status === "pending_expiration" || item.status === "pending_disconnect") {
      warnings.push(warning("bank_expiring", "warning", `${name} access ends soon. Log in again to keep it updating.`, { ref: item.id }));
    }
    const hours = hoursSince(item.last_successful_update, nowMs);
    if (hours === null) {
      add("bank_stale", "warning", `${name} has not finished its first update yet.`, item.id);
    } else if (hours > BANK_STALE_HOURS) {
      add("bank_stale", "warning", `${name} has not updated for ${plural(Math.floor(hours / 24), "day", "days")}.`, item.id);
    }
    if (!item.historical_update_complete) {
      warnings.push(warning("bank_history_loading", "info", `History is still loading for ${name}.`, { ref: item.id }));
    }
    if (item.new_accounts_available) {
      warnings.push(warning(
        "bank_new_accounts",
        "info",
        `New accounts are available at ${name}. Add any business accounts so their costs count.`,
        { ref: item.id },
      ));
    }
  }

  if (jobber?.disconnected) {
    add("jobber_disconnected", "action", "Jobber is disconnected. Reconnect it so new jobs count.", null);
  } else if (!jobber?.connected) {
    add("jobber_not_connected", "action", "Jobber is not connected yet, so revenue is not counted.", null);
  } else {
    const hours = hoursSince(jobber.last_synced_at, nowMs);
    if (hours === null) {
      warnings.push(warning("jobber_stale", "warning", "Jobber data has not been read yet."));
    } else if (hours > JOBBER_STALE_HOURS) {
      warnings.push(warning("jobber_stale", "warning", "Jobber data is more than a day old."));
    }
  }
  return { problems, warnings };
}

/**
 * L30 profit is down more than PROFIT_DROP_PERCENT against the size of P30 profit: below 80% of a
 * profit, a loss more than 20% deeper, or any loss after a break-even. In whole cents, so exactly
 * 80% does not count as below it.
 */
export function profitDropped(l30: number, p30: number): boolean {
  const l = Math.round(money(l30) * 100);
  const p = Math.round(money(p30) * 100);
  return 100 * (l - p) < -PROFIT_DROP_PERCENT * Math.abs(p);
}

/**
 * The drop from a profitable P30 for the profit_down text, in percent: rounded up to one decimal
 * and at least PROFIT_DROP_PERCENT + 0.1, so the text never shows a number at or below the
 * threshold (a 20.001% drop fires and reads 20.1%).
 */
export function shownProfitDrop(l30: number, p30: number): number {
  const l = Math.round(money(l30) * 100);
  const p = Math.round(money(p30) * 100);
  // Tenths of a percent; the small allowance keeps an exact 75.0 from rounding up to 75.1.
  const tenths = Math.ceil(div(1000 * (p - l), p) - 1e-6);
  const r = Math.max(PROFIT_DROP_PERCENT * 10 + 1, Number.isFinite(tenths) ? tenths : 0) / 10;
  return Number.isFinite(r) ? r : PROFIT_DROP_PERCENT + 0.1;
}

function statusOf(
  e: number,
  mtd: WindowSummary,
  comparison: Comparison,
  forecast: Forecast,
  payroll: PayrollSafety,
  target: number | null,
  problems: DataProblem[],
): { level: StatusLevel; reasons: StatusReason[] } {
  const reasons: StatusReason[] = [];
  const red = (code: StatusReasonCode, text: string) => reasons.push({ code, level: "red", text, ref: null });
  const yellow = (code: StatusReasonCode, text: string, ref: string | null = null) =>
    reasons.push({ code, level: "yellow", text, ref });

  if (payroll.state === "short") {
    red("payroll_short", `Cash in the payroll accounts (${usd(payroll.cash ?? 0)}) is less than the next payroll (about ${usd(payroll.estimated_payroll ?? 0)}).`);
  }
  if (forecast.profit < 0 && e >= RED_FORECAST_LOSS_FROM_DAY) {
    red("forecast_loss", `On pace to lose ${usd(-forecast.profit)} this month.`);
  }
  if (mtd.profit < 0 && e >= RED_MTD_LOSS_FROM_DAY) {
    red("mtd_loss", `Down ${usd(-mtd.profit)} so far this month.`);
  }
  if (payroll.state === "tight") {
    yellow("payroll_tight", `After the next payroll (about ${usd(payroll.estimated_payroll ?? 0)}), cash would be below your ${usd(payroll.reserve)} reserve.`);
  }
  if (target !== null && forecast.profit < target) {
    yellow("forecast_below_target", `Forecast profit of ${usd(forecast.profit)} is below your ${usd(target)} target.`);
  }
  if (forecast.profit < 0 && e < RED_FORECAST_LOSS_FROM_DAY) {
    yellow("forecast_loss_early", `Early in the month and on pace to lose ${usd(-forecast.profit)}.`);
  }
  const l30 = comparison.last30.profit;
  const p30 = comparison.prev30.profit;
  if (comparison.comparable && profitDropped(l30, p30)) {
    if (p30 > 0) {
      yellow("profit_down", `Profit in the last 30 days is down ${shownProfitDrop(l30, p30)}% from the 30 days before.`);
    } else {
      yellow("profit_down", `Profit in the last 30 days is ${usd(l30)}, down from ${usd(p30)} in the 30 days before.`);
    }
  }
  for (const p of problems) yellow(p.code, p.text, p.ref);

  const level: StatusLevel = reasons.some((r) => r.level === "red")
    ? "red"
    : reasons.length > 0
      ? "yellow"
      : "green";
  return { level, reasons };
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/** One period of the 7 / 14 / 30 day filter. */
function periodOf(
  days: number,
  lastKey: SummaryKey,
  prevKey: SummaryKey,
  summaries: Record<SummaryKey, WindowSummary>,
  totals: Record<SummaryKey, CleanTotals>,
): PeriodView {
  const last = summaries[lastKey];
  const prev = summaries[prevKey];
  return {
    days,
    last,
    prev,
    revenue: { amount: money(last.revenue - prev.revenue), percent: percentChange(last.revenue, prev.revenue) },
    cost: { amount: money(last.cost - prev.cost), percent: percentChange(last.cost, prev.cost) },
    profit: { amount: money(last.profit - prev.profit), percent: percentChange(last.profit, prev.profit) },
    comparable: !last.partial && !prev.partial,
    spending: spendingOf(last, totals[lastKey]),
  };
}

/** This month so far against the same days of last month, with the same change maths as periodOf. */
function monthOf(current: WindowSummary, previous: WindowSummary): MonthView {
  return {
    current,
    previous,
    revenue: { amount: money(current.revenue - previous.revenue), percent: percentChange(current.revenue, previous.revenue) },
    cost: { amount: money(current.cost - previous.cost), percent: percentChange(current.cost, previous.cost) },
    profit: { amount: money(current.profit - previous.profit), percent: percentChange(current.profit, previous.profit) },
    comparable: !current.partial && !previous.partial,
  };
}

/**
 * Home's Pulse card numbers from a snapshot (pulse-get's summary mode). Never throws. `arriving` is the Pulse
 * screen's stillArriving rule (src/components/pulse/screen/pulseScreenTypes.ts), kept equal by engine.test.ts.
 */
export function homeSummaryOf(s: Snapshot): HomeSummary {
  const banks = s.freshness?.banks ?? [];
  const jobber = s.freshness?.jobber ?? { connected: false, disconnected: false, last_synced_at: null };
  const jobberImporting = jobber.connected && !jobber.disconnected && !jobber.last_synced_at;
  const arriving = jobberImporting ||
    (s.status?.reasons ?? []).some((r) => r.code === "no_numbers_yet") ||
    banks.some((b) => !b.last_successful_update || !b.historical_update_complete);
  const sources = [...banks.map((b) => b.last_successful_update), jobber.last_synced_at];
  const known = sources.every((v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)));
  const updated_at = banks.length > 0 && known
    ? (sources as string[]).reduce((oldest, v) => (Date.parse(v) < Date.parse(oldest) ? v : oldest))
    : null;
  // Numbers only: the partial labels name an account (name and last four digits), so they are left out.
  const plain = (w: WindowSummary): WindowSummary => ({ ...w, partial_label: null });
  const month = s.month ? { ...s.month, current: plain(s.month.current), previous: plain(s.month.previous) } : null;
  return {
    engine_version: s.engine_version,
    today: s.today,
    month,
    revenue_basis: s.revenue_basis === "payments" ? "payments" : "completed_jobs",
    updated_at,
    arriving,
    cashflow_30: s.cashflow_30,
  };
}

export function computeSnapshot(input: EngineInput): Snapshot {
  const today = input.today;
  if (!isLocalDate(today)) throw new Error(`computeSnapshot: today must be YYYY-MM-DD, got ${JSON.stringify(today)}`);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error(`computeSnapshot: now must be an ISO instant, got ${JSON.stringify(input.now)}`);

  const windows = input.windows ?? {};
  const businessAccounts = (input.business_accounts ?? []).filter((a) => a && typeof a === "object");
  const coverage = coverageOf(businessAccounts);

  const totals = {} as Record<SummaryKey, CleanTotals>;
  const summaries = {} as Record<SummaryKey, WindowSummary>;
  // Every summarized window is listed here: the casts above would hide a missing one.
  for (const spec of [...windowsFor(today), ...periodWindowsFor(today), monthWindowFor(today)]) {
    totals[spec.key] = cleanTotals(spec, windows[spec.key]);
    summaries[spec.key] = summarize(spec.key, totals[spec.key], coverage);
  }
  const mtd = summaries.MTD;
  const l30 = summaries.L30;
  const p30 = summaries.P30;

  const comparison: Comparison = {
    last30: l30,
    prev30: p30,
    revenue: { amount: money(l30.revenue - p30.revenue), percent: percentChange(l30.revenue, p30.revenue) },
    cost: { amount: money(l30.cost - p30.cost), percent: percentChange(l30.cost, p30.cost) },
    profit: { amount: money(l30.profit - p30.profit), percent: percentChange(l30.profit, p30.profit) },
    comparable: !l30.partial && !p30.partial,
  };

  const schedule = readSchedule(input.scheduled, today, nowMs);
  const forecast = forecastOf(today, mtd, l30, schedule, input.revenue_basis === "payments" ? "payments" : "completed_jobs");
  const target = targetOf(input.settings);
  const breakEven = breakEvenOf(mtd, forecast, target);
  const payroll = payrollOf(input, today);

  // Only business items count; removed items are gone.
  const items = (input.bank_items ?? []).filter((i) => i && i.business && i.status !== "removed");
  const missingWindows = WINDOW_KEYS.filter((k) => !totals[k].has_data);
  // A missing L30 is already numbers_missing; no_numbers_yet is for L30 read with no rows in it.
  const l30NoRows = l30.has_data && noRows(l30);
  // partial_history arises only with a pay schedule set and no usable override (payrollOf); the
  // other unknown reasons do not change the status.
  const historyBuilding = payroll.unknown_reasons.includes("partial_history");
  const { problems, warnings: dataWarnings } = dataProblems(
    missingWindows,
    l30NoRows,
    historyBuilding,
    items,
    input.jobber ?? null,
    nowMs,
  );
  const status = statusOf(dayOfMonth(today), mtd, comparison, forecast, payroll, target, problems);

  const warnings: Warning[] = [...dataWarnings];
  for (const a of businessAccounts) {
    if (!isLocalDate(a.include_from)) continue;
    const card = a.type === "credit";
    warnings.push(warning(
      card ? "card_counted_from" : "account_counted_from",
      "info",
      `${accountName(a)} counted from ${formatDay(a.include_from)}.`,
      { ref: a.id, date: a.include_from },
    ));
  }
  const transfers = count(input.review_transfers_l30);
  if (transfers > 0) {
    warnings.push(warning(
      "transfers_review",
      "warning",
      `${plural(transfers, "transfer", "transfers")} to accounts that are not linked ${transfers === 1 ? "was" : "were"} counted as costs in the last 30 days. Review them.`,
      { count: transfers },
    ));
  }
  // The same figure as the "Pending" line on the L30 screen.
  const pending = money(totals.L30.pending);
  if (pending > 0) {
    warnings.push(warning("pending_not_counted", "info", `${usd(pending)} pending, not counted yet.`, { amount: pending }));
  }
  if (forecast.pace_only && forecast.pace_only_text) {
    warnings.push(warning("forecast_pace_only", "warning", `The forecast uses your pace only: ${forecast.pace_only_text}.`));
  }

  const jobber = input.jobber ?? null;
  const freshness: Freshness = {
    computed_at: input.now,
    banks: items.map((i) => ({
      id: i.id,
      name: bankName(i),
      status: i.status,
      last_successful_update: i.last_successful_update ?? null,
      hours_since_update: displayHours(hoursSince(i.last_successful_update, nowMs)),
      historical_update_complete: i.historical_update_complete === true,
    })),
    jobber: {
      connected: jobber?.connected === true,
      disconnected: jobber?.disconnected === true,
      last_synced_at: jobber?.last_synced_at ?? null,
      hours_since_sync: displayHours(hoursSince(jobber?.last_synced_at, nowMs)),
    },
    schedule_fetched_at: input.scheduled?.fetched_at ?? null,
  };

  return {
    engine_version: ENGINE_VERSION,
    computed_at: input.now,
    today,
    status,
    profit_mtd: mtd,
    comparison,
    forecast,
    break_even: breakEven,
    payroll,
    spending: { L7: spendingOf(summaries.L7, totals.L7), L30: spendingOf(l30, totals.L30) },
    periods: {
      "7": periodOf(7, "L7", "P7", summaries, totals),
      "14": periodOf(14, "L14", "P14", summaries, totals),
      "30": periodOf(30, "L30", "P30", summaries, totals),
    },
    month: monthOf(mtd, summaries.PMTD),
    coverage,
    freshness,
    warnings,
    revenue_basis: input.revenue_basis === "payments" ? "payments" : "completed_jobs",
    revenue_without_tax: input.revenue_tax !== "as_jobber",
    cashflow_30: {
      from: addDays(today, -29),
      to: today,
      partial_from: l30.partial ? coverage.counted_from : null,
      points: cashflowWindows(today).map((spec) => {
        const raw = input.daily_windows?.[spec.key];
        const t = cleanTotals(spec, raw);
        return { date: spec.from, revenue: t.has_data ? money(t.revenue) : null, cost: t.has_data ? money(t.cost) : null };
      }),
    },
  };
}
