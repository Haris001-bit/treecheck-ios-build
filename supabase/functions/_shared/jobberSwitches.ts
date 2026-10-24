// The Jobber milestone's per-company switches (table company_jobber_settings, migration JS1) and the
// global kill switch. Server-side only. Maintained outside Lovable. Only Haris changes a switch, from
// the SQL editor.
//
// Everything fails safe toward "off": the kill switch (the Lovable secret TC_JOBBER_KILL=1), a missing
// row, a read error, or the table not existing yet (a function deployed before the migration) all
// give SWITCHES_OFF, and jobberSwitches never throws.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** One company's Jobber switches and settings (company_jobber_settings, in camelCase). */
export interface JobberSwitches {
  /** A draft quote at the first of the price pick or the award. */
  quotesOnAward: boolean;
  /** bid-hire runs when the customer approves the quote. */
  autoHire: boolean;
  /** The Jobber job is booked from the approved quote. */
  bookJobs: boolean;
  /** Approval sets Quote accepted and completion sets Job complete. */
  completionSync: boolean;
  /** Busy, committed and closed days are removed from the dates climbers see. */
  freeDays: boolean;
  /** The repaired Jobber history import (INVOICE_ events, unlinked JOB_ events, backfill). */
  jobberImport: boolean;
  /** A draft invoice from each closeout, never emailed. */
  closeoutInvoices: boolean;
  /** Jobber visits on one day before that day counts as busy (1 to 20). */
  busyVisitsPerDay: number;
  /** The company's IANA time zone for every date. */
  timezone: string;
  /** Two-letter state for addresses that have none, or null. */
  defaultProvince: string | null;
  /** How quotes are laid out (read by quoteBuilder). */
  quoteTemplate: Record<string, unknown>;
}

const DEFAULT_TIMEZONE = "America/Chicago";
const MAX_BUSY_VISITS = 20;
const COLUMNS =
  "quotes_on_award, auto_hire, book_jobs, completion_sync, free_days, jobber_import, closeout_invoices, " +
  "busy_visits_per_day, timezone, default_province, quote_template";

/** Every switch off, the answer whenever anything is in doubt. */
export const SWITCHES_OFF: Readonly<JobberSwitches> = Object.freeze({
  quotesOnAward: false,
  autoHire: false,
  bookJobs: false,
  completionSync: false,
  freeDays: false,
  jobberImport: false,
  closeoutInvoices: false,
  busyVisitsPerDay: 1,
  timezone: DEFAULT_TIMEZONE,
  defaultProvince: null,
  quoteTemplate: Object.freeze({}) as Record<string, unknown>,
});

/** True when the secret TC_JOBBER_KILL is "1": every company's switches then read as off. */
export function killSwitchOn(): boolean {
  return env("TC_JOBBER_KILL")?.trim() === "1";
}

/** A company's switches (pass the owner's id); SWITCHES_OFF for the kill switch, a missing row or any read problem. */
export async function jobberSwitches(admin: Admin, ownerId: string): Promise<JobberSwitches> {
  // The kill switch comes first, so it never touches the database.
  if (killSwitchOn() || !ownerId) return SWITCHES_OFF;
  try {
    const { data, error } = await admin
      .from("company_jobber_settings").select(COLUMNS).eq("contractor_id", ownerId).maybeSingle();
    if (error) {
      console.warn("[jobberSwitches] read failed, all switches off:", short(error.message ?? error));
      return SWITCHES_OFF;
    }
    return data ? fromRow(data) : SWITCHES_OFF;
  } catch (e) {
    console.warn("[jobberSwitches] read failed, all switches off:", short((e as Error)?.message ?? e));
    return SWITCHES_OFF;
  }
}

function fromRow(row: Record<string, unknown>): JobberSwitches {
  return {
    quotesOnAward: row.quotes_on_award === true,
    autoHire: row.auto_hire === true,
    bookJobs: row.book_jobs === true,
    completionSync: row.completion_sync === true,
    freeDays: row.free_days === true,
    jobberImport: row.jobber_import === true,
    closeoutInvoices: row.closeout_invoices === true,
    busyVisitsPerDay: busyLimit(row.busy_visits_per_day),
    timezone: validTimezone(row.timezone),
    defaultProvince:
      typeof row.default_province === "string" && /^[A-Z]{2}$/.test(row.default_province) ? row.default_province : null,
    quoteTemplate: isObject(row.quote_template) ? row.quote_template : {},
  };
}

/** A whole number from 1 to 20 (the column's own check); anything unreadable counts as 1. */
function busyLimit(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_BUSY_VISITS, Math.max(1, n)) : 1;
}

/** The stored zone when the runtime knows it, otherwise the default, so date code never throws. */
function validTimezone(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: v.trim() });
    return v.trim();
  } catch {
    console.warn("[jobberSwitches] unknown time zone, using", DEFAULT_TIMEZONE);
    return DEFAULT_TIMEZONE;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function short(v: unknown): string {
  return String(v).slice(0, 200);
}

// Environment lookup that never names the Deno global directly, so vitest can import this file.
function env(key: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(key);
}
