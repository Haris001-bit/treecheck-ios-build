// Financial Pulse: local calendar dates for the calculation engine.
//
// Pure functions only (no runtime-specific or network APIs), so the same file runs in the edge functions
// and in the vitest suite (src/lib/pulse/dates.test.ts).
//
// Every date here is a local calendar day in the company's time zone, written YYYY-MM-DD.
// There are no time zones inside: the caller turns "now" into the company's local date once
// (localDate(now, timezone)) and everything after that is plain calendar arithmetic, done on
// UTC midnights, so a daylight-saving change can never add or lose a day.
//
// Paydays (nextPayday):
// * weekly / biweekly: every 7 / 14 days from the anchor date, forwards and backwards.
// * monthly: the anchor's day of month, clamped to the month length (the 31st pays on Apr 30).
//   An anchor on the last day of its month means "the last day of every month", so an anchor of
//   Feb 28 or Sep 30 pays on Oct 31, not on the 28th or the 30th.
// * semimonthly: two paydays a month, read from the anchor:
//   - an anchor on the 15th or on the last day of its month: the 15th and the last day of the month
//     (the usual US pair). An owner paying on the 1st and the 15th picks a 1st as the anchor.
//   - an anchor on the 1st: the 1st and the 15th.
//   - any other day d: d and d + 15 (d up to the 14th) or d - 15 and d (the 16th onwards), so the
//     5th or the 20th both mean "the 5th and the 20th". Each payday is clamped to the month length,
//     so "the 14th and the 29th" pays on Feb 28 in a normal year and Feb 29 in a leap year.
// * The next payday is the first payday on or after today: a payday that is today still counts,
//   because the money may not have left the account yet. The previous payday (previousPayday) is
//   the last payday on or before today, by the same rules.
//
// Payroll history (payrollHistoryWindow, engine-2): the payroll estimate divides the payroll cost
// of a window aligned to the pay schedule by the pay runs it holds (Haris, round 3).
// * A payroll debit may post up to 6 days before its payday (PAYROLL_DEBIT_LEAD_DAYS: a provider
//   debits a few business days early, and a weekend payday is paid the Friday before) or up to A
//   days after it (PAYROLL_LATE_ALLOWANCE_DAYS: a check that clears later, or Zelle posting the next
//   business day). A is the shortest gap between two paydays minus 7: weekly 0, biweekly 7,
//   semimonthly 6 (the 15th to Feb 28 is 13 days), monthly 21 (Jan 31 to Feb 28 is 28 days).
// * The window takes the last 8 weekly, 4 biweekly, 6 semimonthly or 3 monthly paydays p with
//   p <= today - (A + 1) days, so every debit of a counted run is dated by yesterday (a debit dated
//   today that has not reached the data yet can never leave a counted run short), and today's
//   payday is never counted yet. It runs from 6 days before the oldest of them to A days after the
//   newest, so it always ends by yesterday. The run before the oldest can post no later than 7
//   days before the oldest, and the run after the newest no earlier than A + 1 days after it, so
//   neither is ever inside: with debits from 6 days early to A days late the
//   window holds exactly one debit per run. (Weekly has A = 0: a weekly debit that posts a few days
//   late still gives 8 runs, because the run before the oldest slides in as the newest slides out.)
// * A payday whose debit could predate the payroll accounts' counted-from date (payday - 6 days is
//   before it) is dropped, so the window is never partial; with every payday dropped there is no
//   window yet. That date is the latest counted-from among the payroll accounts (payrollCountedFrom
//   in engine.ts), not the company-wide one: a card linked last week does not hold payroll back.
// * Known limits (round 3): a provider lead of more than 6 days before payday (for example 4
//   business days across a federal holiday), or a debit later than A days after payday, can leave
//   a run's debit outside the window or bring a neighbour's in, so that one estimate is off by one
//   run until the window moves on.
// The caller asks pulse_window_totals for it under the key "PAY" (windowsForSnapshot).
//
// Month comparison (monthWindowFor, engine-6): Home's Pulse card compares this month so far (MTD) with
// the same days of last month, under the key "PMTD": the 1st of last month to today's day of month,
// clamped to last month's length, so March 29 to 31 compare with all of February.

import type { WindowSpec } from "./types.ts";

export { localDate } from "./jobberRevenue.ts";

/** The windows every snapshot needs; a missing one keeps the status off green (numbers_missing). */
export const WINDOW_KEYS = ["MTD", "L30", "P30", "L7"] as const;
export type WindowKey = (typeof WINDOW_KEYS)[number];

/**
 * The extra windows behind the 7 / 14 / 30 day period filter (engine-3): L14 and the 14 days before
 * it (P14), and the 7 days before L7 (P7). Optional: without them a period shows no data, and the
 * status does not change.
 */
export const PERIOD_WINDOW_KEYS = ["L14", "P14", "P7"] as const;
export type PeriodWindowKey = (typeof PERIOD_WINDOW_KEYS)[number];

/**
 * The month comparison's window (engine-6): the same days of last month as MTD covers of this one. Optional:
 * without it the month comparison shows no data, and the status does not change.
 */
export const MONTH_WINDOW_KEY = "PMTD";
export type MonthWindowKey = typeof MONTH_WINDOW_KEY;

/** The payroll history window's key, requested only when there is one (windowsForSnapshot). */
export const PAY_WINDOW_KEY = "PAY";
export type SnapshotWindowKey = WindowKey | PeriodWindowKey | MonthWindowKey | typeof PAY_WINDOW_KEY;

export const PAY_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

/** Pay runs a full payroll history holds (the last N paydays). */
export const PAYROLL_HISTORY_RUNS: Readonly<Record<PayFrequency, number>> = {
  weekly: 8,
  biweekly: 4,
  semimonthly: 6,
  monthly: 3,
};

/** How many days before payday a payroll debit may post and still count for that payday. */
export const PAYROLL_DEBIT_LEAD_DAYS = 6;

/**
 * How many days after payday a payroll debit may post and still count for that payday (A): the
 * shortest gap between two paydays minus 7, so the next run's earliest debit (6 days before its
 * payday) is never inside. A payday counts once it is at least A + 1 days old.
 */
export const PAYROLL_LATE_ALLOWANCE_DAYS: Readonly<Record<PayFrequency, number>> = {
  weekly: 0,
  biweekly: 7,
  semimonthly: 6,
  monthly: 21,
};

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// UTC midnight of a calendar day. setUTCFullYear keeps years below 100 as written.
function utcMs(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getTime();
}

function lastDayOf(year: number, month: number): number {
  return new Date(utcMs(year, month + 1, 0)).getUTCDate();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function fromMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

function build(year: number, month: number, day: number): string {
  return fromMs(utcMs(year, month, day));
}

/** True for a real calendar date written YYYY-MM-DD (so "2026-02-30" is false). */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOf(Number(m[1]), month);
}

function parts(date: string): [number, number, number] {
  if (!isLocalDate(date)) throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  const m = DATE_RE.exec(date) as RegExpExecArray;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toMs(date: string): number {
  const [y, m, d] = parts(date);
  return utcMs(y, m, d);
}

export function isPayFrequency(value: unknown): value is PayFrequency {
  return typeof value === "string" && (PAY_FREQUENCIES as readonly string[]).includes(value);
}

/** The date `days` calendar days after `date` (negative goes back). */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error(`addDays needs a whole number of days, got ${days}`);
  return fromMs(toMs(date) + days * DAY_MS);
}

/** Whole calendar days from `b` to `a` (a minus b): diffDays("2026-10-05", "2026-10-01") = 4. */
export function diffDays(a: string, b: string): number {
  return Math.round((toMs(a) - toMs(b)) / DAY_MS);
}

export function dayOfMonth(date: string): number {
  return parts(date)[2];
}

/** Days in the month containing `date` (28 to 31). */
export function daysInMonth(date: string): number {
  const [y, m] = parts(date);
  return lastDayOf(y, m);
}

export function monthStart(date: string): string {
  const [y, m] = parts(date);
  return build(y, m, 1);
}

export function monthEnd(date: string): string {
  const [y, m] = parts(date);
  return build(y, m, lastDayOf(y, m));
}

/** "Oct 7, 2026", for plain-English labels. */
export function formatDay(date: string): string {
  const [y, m, d] = parts(date);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The fixed windows the engine needs (A11), all inclusive and ending today except P30:
 * MTD = the 1st to today, L30 = today-29 to today, P30 = today-59 to today-30,
 * L7 = today-6 to today. The payroll history window is added by windowsForSnapshot.
 */
export function windowsFor(today: string): Array<WindowSpec & { key: WindowKey }> {
  return [
    { key: "MTD", from: monthStart(today), to: today },
    { key: "L30", from: addDays(today, -29), to: today },
    { key: "P30", from: addDays(today, -59), to: addDays(today, -30) },
    { key: "L7", from: addDays(today, -6), to: today },
  ];
}

/**
 * The period filter's extra windows, inclusive: L14 = today-13 to today, P14 = today-27 to
 * today-14, P7 = today-13 to today-7 (the 7 days before L7).
 */
export function periodWindowsFor(today: string): Array<WindowSpec & { key: PeriodWindowKey }> {
  return [
    { key: "L14", from: addDays(today, -13), to: today },
    { key: "P14", from: addDays(today, -27), to: addDays(today, -14) },
    { key: "P7", from: addDays(today, -13), to: addDays(today, -7) },
  ];
}

/**
 * Last month's window for the month comparison (engine-6): the 1st of last month to today's day of month,
 * clamped to last month's length (see the top of this file).
 */
export function monthWindowFor(today: string): WindowSpec & { key: MonthWindowKey } {
  const from = monthStart(addDays(monthStart(today), -1));
  return { key: MONTH_WINDOW_KEY, from, to: addDays(from, Math.min(dayOfMonth(today), daysInMonth(from)) - 1) };
}

/** The payroll history window (see the top of this file). */
export interface PayrollHistoryWindow {
  from: string;
  to: string;
  /** Paydays it holds: PAYROLL_HISTORY_RUNS for the frequency, fewer when payroll is counted from recently. */
  runs: number;
}

/** A pay schedule read from settings. */
export interface PaySchedule {
  frequency: PayFrequency;
  anchor: string;
}

/** The pay settings windowsForSnapshot reads (pulse_settings; EngineSettings fits). */
export interface PaySettings {
  pay_frequency: unknown;
  pay_anchor_date: unknown;
}

/** The pay schedule, or null when the frequency or the anchor date is missing or invalid. */
export function payScheduleOf(settings: PaySettings | null | undefined): PaySchedule | null {
  if (!settings || typeof settings !== "object") return null;
  const frequency = settings.pay_frequency;
  const anchor = settings.pay_anchor_date;
  return isPayFrequency(frequency) && isLocalDate(anchor) ? { frequency, anchor } : null;
}

/**
 * The payroll history window for today (see the top of this file): the last
 * PAYROLL_HISTORY_RUNS[frequency] paydays p with p <= today - (A + 1) days
 * (A = PAYROLL_LATE_ALLOWANCE_DAYS[frequency]), less any payday with p - 6 days before
 * `countedFrom` (its debit could predate coverage). From 6 days before the oldest payday kept to A
 * days after the newest; null when none is kept. `countedFrom` is the payroll accounts' counted-from
 * date (payrollCountedFrom in engine.ts), null when unknown. A debit more than 6 days early or more
 * than A days late can make one estimate off by one run.
 */
export function payrollHistoryWindow(
  today: string,
  frequency: PayFrequency,
  anchor: string,
  countedFrom: string | null,
): PayrollHistoryWindow | null {
  if (countedFrom !== null && !isLocalDate(countedFrom)) {
    throw new Error(`payrollHistoryWindow: countedFrom must be YYYY-MM-DD or null, got ${JSON.stringify(countedFrom)}`);
  }
  const late = PAYROLL_LATE_ALLOWANCE_DAYS[frequency] ?? 0;
  // Only paydays whose whole debit allowance ended by yesterday count, so a debit dated today that
  // has not reached the data yet can never be missing from a run that is counted.
  const settled = addDays(today, -(late + 1));
  const kept = recentPaydays(settled, frequency, anchor, PAYROLL_HISTORY_RUNS[frequency] ?? 0)
    .filter((p) => countedFrom === null || addDays(p, -PAYROLL_DEBIT_LEAD_DAYS) >= countedFrom);
  if (kept.length === 0) return null;
  return { from: addDays(kept[kept.length - 1], -PAYROLL_DEBIT_LEAD_DAYS), to: addDays(kept[0], late), runs: kept.length };
}

/**
 * Every window to ask pulse_window_totals for: windowsFor(today), the period filter's windows, last month's
 * window for the month comparison ("PMTD"), plus the payroll history window
 * under the key "PAY" when the pay schedule is set and payrollHistoryWindow has one. Pass the same
 * `today`, settings and payroll counted-from date (payrollCountedFrom(payroll_accounts) in
 * engine.ts) that the engine will see, or the engine will not use the PAY totals.
 */
export function windowsForSnapshot(
  today: string,
  settings: PaySettings | null | undefined,
  payrollCountedFrom: string | null,
): Array<WindowSpec & { key: SnapshotWindowKey }> {
  const out: Array<WindowSpec & { key: SnapshotWindowKey }> = [
    ...windowsFor(today), ...periodWindowsFor(today), monthWindowFor(today),
  ];
  const schedule = payScheduleOf(settings);
  const pay = schedule ? payrollHistoryWindow(today, schedule.frequency, schedule.anchor, payrollCountedFrom) : null;
  if (pay) out.push({ key: PAY_WINDOW_KEY, from: pay.from, to: pay.to });
  return out;
}

// Paydays of one month for the day-of-month schedules, clamped to the month length, in order.
// `anchorIsLast` is true when the anchor is the last day of its own month.
function paydaysInMonth(
  year: number,
  month: number,
  frequency: "semimonthly" | "monthly",
  anchorDay: number,
  anchorIsLast: boolean,
): string[] {
  const last = lastDayOf(year, month);
  const on = (day: number) => build(year, month, Math.min(day, last));
  if (frequency === "monthly") return [on(anchorIsLast ? last : anchorDay)];
  if (anchorIsLast || anchorDay === 15) return [on(15), on(last)];
  if (anchorDay === 1) return [on(1), on(15)];
  const first = anchorDay < 15 ? anchorDay : anchorDay - 15;
  return [on(first), on(first + 15)];
}

/** The first payday on or after `today` (see the payday rules at the top of this file). */
export function nextPayday(today: string, frequency: PayFrequency, anchor: string): string {
  const todayMs = toMs(today);
  if (frequency === "weekly" || frequency === "biweekly") {
    const period = frequency === "weekly" ? 7 : 14;
    // Paydays are anchor + k * period for any whole k; take the smallest one not before today.
    const k = Math.ceil(diffDays(today, anchor) / period);
    return addDays(anchor, k * period);
  }
  const anchorDay = dayOfMonth(anchor);
  const anchorIsLast = anchorDay === daysInMonth(anchor);
  const [y, m] = parts(today);
  for (let i = 0; i < 2; i++) {
    const year = m + i > 12 ? y + 1 : y;
    const month = ((m - 1 + i) % 12) + 1;
    for (const day of paydaysInMonth(year, month, frequency, anchorDay, anchorIsLast)) {
      if (toMs(day) >= todayMs) return day;
    }
  }
  // Unreachable: next month always has a payday.
  throw new Error("nextPayday: no payday found");
}

/** The last payday on or before `today` (the same payday rules as nextPayday). */
export function previousPayday(today: string, frequency: PayFrequency, anchor: string): string {
  const todayMs = toMs(today);
  if (frequency === "weekly" || frequency === "biweekly") {
    const period = frequency === "weekly" ? 7 : 14;
    // Paydays are anchor + k * period for any whole k; take the largest one not after today.
    const k = Math.floor(diffDays(today, anchor) / period);
    return addDays(anchor, k * period);
  }
  const anchorDay = dayOfMonth(anchor);
  const anchorIsLast = anchorDay === daysInMonth(anchor);
  const [y, m] = parts(today);
  for (let i = 0; i < 2; i++) {
    const year = m - i < 1 ? y - 1 : y;
    const month = ((m - 1 - i + 12) % 12) + 1;
    const days = paydaysInMonth(year, month, frequency, anchorDay, anchorIsLast);
    for (let j = days.length - 1; j >= 0; j--) {
      if (toMs(days[j]) <= todayMs) return days[j];
    }
  }
  // Unreachable: last month always has a payday.
  throw new Error("previousPayday: no payday found");
}

/** The last `n` paydays on or before `today`, newest first. */
export function recentPaydays(today: string, frequency: PayFrequency, anchor: string, n: number): string[] {
  const out: string[] = [];
  let day = today;
  for (let i = 0; i < n; i++) {
    const p = previousPayday(day, frequency, anchor);
    out.push(p);
    day = addDays(p, -1);
  }
  return out;
}
