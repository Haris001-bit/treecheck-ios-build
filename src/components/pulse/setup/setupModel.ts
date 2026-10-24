// Financial Pulse setup: shared types, steps and helpers.
// The wizard renders a SetupState and calls SetupActions; the page wires them to the live backend,
// the design preview to sample data.

import { format, parseISO } from "date-fns";
import { nextPayday, PAY_FREQUENCIES, type PayFrequency } from "../../../../supabase/functions/_shared/pulse/dates";
import type { AccountSetting } from "@/lib/pulse/api";
import type { SetupSection } from "../screen/pulseScreenTypes";

export type { PayFrequency, SetupSection };
export { PAY_FREQUENCIES };

export interface SetupBank {
  id: string;
  institution_name: string | null;
  status: string;
  new_accounts_available: boolean;
  last_successful_update: string | null;
  linked_at: string;
}

export interface SetupAccount {
  id: string;
  item_row_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  is_business: boolean;
  include_from: string | null;
  use_for_payroll: boolean;
  status: string;
  /** When the owner last made this card's count-from choice. Null means never. */
  count_from_confirmed_at: string | null;
  /** When the account first came in from the bank (accounts added after setup are marked New). */
  created_at: string | null;
}

export interface SetupSettings {
  pay_frequency: PayFrequency | null;
  pay_anchor_date: string | null;
  payroll_amount_override: number | null;
  profit_target_monthly: number | null;
  cash_reserve: number | null;
  setup_step: string | null;
  setup_completed_at: string | null;
  timezone: string | null;
}

export interface SetupState {
  jobberConnected: boolean;
  /** The Jobber account's name, so an owner can see they connected the right one. */
  jobberAccountName: string | null;
  banks: SetupBank[];
  accounts: SetupAccount[];
  settings: SetupSettings;
}

export interface SettingsPatch {
  timezone?: string;
  pay_frequency?: PayFrequency | null;
  pay_anchor_date?: string | null;
  payroll_amount_override?: number | null;
  profit_target_monthly?: number | null;
  cash_reserve?: number;
  setup_step?: string | null;
}

/** Bringing in Jobber's past jobs, started the moment Jobber connects. */
export interface JobberImport {
  /** continuing: this page stopped asking; the rest comes in when the owner opens Financial Pulse. */
  state: "idle" | "running" | "done" | "failed" | "continuing";
  /** Jobs read so far. */
  jobs: number;
  /** For "failed": what the owner can do. */
  message?: string;
  /** For "failed": Jobber refused the stored sign-in. */
  reconnect?: boolean;
}

export interface SetupActions {
  /** Starts Jobber's login; the page leaves TreeCheck and comes back to this step. Throws with a message. */
  connectJobber(): Promise<void>;
  /**
   * Saves every account's choices. Throws with a message. Resolves once saved; historyRepull says an
   * account switched to business after setup is bringing in its past transactions.
   */
  saveAccounts(accounts: AccountSetting[]): Promise<{ historyRepull: boolean }>;
  /** Saves settings. Throws with a message. */
  saveSettings(patch: SettingsPatch): Promise<void>;
  /** Marks setup finished. Throws with a message. */
  complete(): Promise<void>;
  /** Reads the banks, accounts and settings again; resolves to the state read (the last good one if this read failed). */
  refresh(): Promise<SetupState | null>;
}

// ---------------------------------------------------------------------------
// Steps

export const STEPS = ["start", "jobber", "banks", "accounts", "payroll", "finish"] as const;
export type StepKey = (typeof STEPS)[number];

export const STEP_TITLE: Record<StepKey, string> = {
  start: "Before you start",
  jobber: "Connect Jobber",
  banks: "Link your bank and card",
  accounts: "Business accounts",
  payroll: "Payroll and goal",
  finish: "Finish",
};

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === "string" && (STEPS as readonly string[]).includes(v);
}

export function isSetupSection(v: unknown): v is SetupSection {
  return v === "jobber" || v === "banks" || v === "accounts" || v === "payroll";
}

/** Accounts were saved before when the server holds an owner choice (both only come from a save). */
export function accountsSaved(state: SetupState): boolean {
  return state.accounts.some((a) => a.is_business || a.count_from_confirmed_at !== null);
}

/**
 * The furthest step the owner can be on. Jobber is required (Haris, 2026-10-01): without it sales
 * would read as $0. No bank stops at "banks", unsaved business accounts at "accounts".
 */
export function furthestStep(state: SetupState): StepKey {
  if (!state.jobberConnected) return "jobber";
  if (state.banks.length === 0) return "banks";
  if (!accountsSaved(state) || !state.accounts.some((a) => a.is_business)) return "accounts";
  return "finish";
}

/** Where a returning owner starts: the saved step, but never past what is done. */
export function resumeStep(state: SetupState): StepKey {
  const saved = isStepKey(state.settings.setup_step) ? state.settings.setup_step : "start";
  const max = furthestStep(state);
  return STEPS.indexOf(saved) > STEPS.indexOf(max) ? max : saved;
}

/**
 * Where the wizard opens. Coming back from Jobber's login (step "jobber" in the address), the owner was
 * on that step, so it opens there even if their saved step was lost; otherwise where they left off.
 */
export function openingStep(state: SetupState, requested?: StepKey): StepKey {
  if (requested && STEPS.indexOf(requested) <= STEPS.indexOf(furthestStep(state)) && requested !== "start") return requested;
  return resumeStep(state);
}

// ---------------------------------------------------------------------------
// Accounts

export interface Draft {
  is_business: boolean;
  include_from: string | null;
  use_for_payroll: boolean;
  /** Credit cards: the owner has made the count-from choice (now or earlier). */
  count_from_chosen: boolean;
}

export function isCreditCard(a: SetupAccount): boolean {
  return (a.type ?? "").toLowerCase() === "credit";
}

export function isBankAccount(a: SetupAccount): boolean {
  return a.type === "depository";
}

export function accountKind(a: SetupAccount): string {
  if (isCreditCard(a)) return "Credit card";
  if (a.subtype) {
    const text = a.subtype.replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return a.type === "depository" ? "Bank account" : "Account";
}

/** "Business Checking ...7001" */
export function accountName(a: SetupAccount): string {
  return `${a.name || accountKind(a)}${a.mask ? ` ...${a.mask}` : ""}`;
}

/** How long an account added after setup is marked New (an account kept personal stops nagging). */
export const NEW_ACCOUNT_DAYS = 14;

/** An account that came in after setup, in the last two weeks, that the owner has not turned on. */
export function isNewAccount(a: SetupAccount, setupCompletedAt: string | null, nowMs: number = Date.now()): boolean {
  if (!setupCompletedAt || a.is_business || a.status !== "active" || !a.created_at) return false;
  const created = Date.parse(a.created_at);
  return Number.isFinite(created) && created > Date.parse(setupCompletedAt) && nowMs - created < NEW_ACCOUNT_DAYS * 86_400_000;
}

export function serverDraft(a: SetupAccount): Draft {
  return {
    is_business: a.is_business,
    include_from: a.include_from,
    use_for_payroll: a.use_for_payroll,
    count_from_chosen: a.count_from_confirmed_at !== null,
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return a.is_business === b.is_business && a.include_from === b.include_from &&
    a.use_for_payroll === b.use_for_payroll && a.count_from_chosen === b.count_from_chosen;
}

/**
 * Applies an owner's change to an account's draft. A card turned back on as business asks its
 * question again: its earlier answer was about a time it was personal.
 */
export function nextDraft(a: SetupAccount, current: Draft, patch: Partial<Draft>): Draft {
  const next = { ...current, ...patch };
  if (patch.is_business === true && !current.is_business && !a.is_business && isCreditCard(a)) {
    next.count_from_chosen = false;
    next.include_from = null;
  }
  return next;
}

/** A business credit card needs an explicit "Count everything" or "Count from" choice. */
export function needsCountChoice(a: SetupAccount, d: Draft): boolean {
  return isCreditCard(a) && d.is_business && !d.count_from_chosen;
}

/** The set_accounts payload: every account, with drafts applied ("pays payroll" only on business bank accounts). */
export function accountPayload(accounts: SetupAccount[], draftFor: (a: SetupAccount) => Draft): AccountSetting[] {
  return accounts.map((a) => {
    const d = draftFor(a);
    return {
      id: a.id,
      is_business: d.is_business,
      include_from: d.include_from,
      use_for_payroll: d.is_business && isBankAccount(a) && d.use_for_payroll,
      count_from_chosen: isCreditCard(a) && d.is_business && d.count_from_chosen,
    };
  });
}

// ---------------------------------------------------------------------------
// Payroll schedule
//
// The engine reads paydays from a frequency and one anchor date (dates.ts nextPayday): weekly and
// every 2 weeks step from the anchor date itself; twice a month and once a month use only its day of
// the month (an anchor on the last day of its month means "the last day of every month"). So the
// owner answers in their own words (next payday; which two days; which day) and the anchor is made from
// that. Day-only anchors are dated in January, which has 31 days, so day 29 to 30 never turn into
// "the last day" and the 31st does.

export const FREQUENCY_LABEL: Record<PayFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Once a month",
};

/** Twice a month: the 1st and 15th, the 15th and 30th, the 15th and the last day, or a day and 15 days later. */
export type SemiPair = "1-15" | "15-30" | "15-last" | "custom";

export interface PaySchedule {
  frequency: PayFrequency | null;
  /** Every week / every 2 weeks: the next payday (YYYY-MM-DD). */
  nextPayday: string;
  /** Twice a month. */
  semiPair: SemiPair | null;
  /** Twice a month, "custom": the first payday, 2 to 14; the second is 15 days later. */
  semiDay: number | null;
  /** Once a month: 1 to 30, or "last". */
  monthDay: number | "last" | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthLength(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLastDayOfMonth(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  return d === monthLength(y, m);
}

/** "1st", "2nd", "15th", "22nd". */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The next few paydays from today, by the engine's own rules; empty when the inputs are not complete. */
export function upcomingPaydays(today: string, frequency: PayFrequency | null, anchor: string | null, count = 3): string[] {
  if (!frequency || !anchor || !DATE.test(anchor)) return [];
  const out: string[] = [];
  let from = today;
  for (let i = 0; i < count; i++) {
    const p = nextPayday(from, frequency, anchor);
    out.push(p);
    from = addDays(p, 1);
  }
  return out;
}

/** The owner's answers, read back from the saved frequency and anchor. */
export function scheduleFromSettings(frequency: PayFrequency | null, anchor: string | null, today: string): PaySchedule {
  const empty: PaySchedule = { frequency, nextPayday: "", semiPair: null, semiDay: null, monthDay: null };
  if (!frequency || !anchor || !DATE.test(anchor)) return empty;
  const d = Number(anchor.slice(8, 10));
  if (frequency === "weekly" || frequency === "biweekly") return { ...empty, nextPayday: upcomingPaydays(today, frequency, anchor, 1)[0] ?? "" };
  if (frequency === "semimonthly") {
    if (d === 1) return { ...empty, semiPair: "1-15" };
    if (d === 15 || isLastDayOfMonth(anchor)) return { ...empty, semiPair: "15-last" };
    if (d === 30) return { ...empty, semiPair: "15-30" };
    return { ...empty, semiPair: "custom", semiDay: d > 15 ? d - 15 : d };
  }
  return { ...empty, monthDay: isLastDayOfMonth(anchor) ? "last" : Math.min(d, 30) };
}

/** The anchor date for the owner's answers; null while an answer is missing. */
export function anchorFromSchedule(s: PaySchedule, today: string): string | null {
  const jan = (day: number) => `${today.slice(0, 4)}-01-${String(day).padStart(2, "0")}`;
  switch (s.frequency) {
    case "weekly":
    case "biweekly":
      return DATE.test(s.nextPayday) ? s.nextPayday : null;
    case "semimonthly":
      if (s.semiPair === "1-15") return jan(1);
      if (s.semiPair === "15-last") return jan(15);
      // January 30th is not the last day of its month, so the engine reads it as "the 15th and the 30th".
      if (s.semiPair === "15-30") return jan(30);
      if (s.semiPair === "custom" && s.semiDay !== null && s.semiDay >= 2 && s.semiDay <= 14) return jan(s.semiDay);
      return null;
    case "monthly":
      if (s.monthDay === "last") return jan(31);
      if (typeof s.monthDay === "number" && s.monthDay >= 1 && s.monthDay <= 30) return jan(s.monthDay);
      return null;
    default:
      return null;
  }
}

/** "every 2 weeks", "on the 1st and 15th", "on the 15th and the last day", "on the 20th of each month". */
export function scheduleText(frequency: PayFrequency | null, anchor: string | null): string {
  if (!frequency) return "";
  if (frequency === "weekly") return "every week";
  if (frequency === "biweekly") return "every 2 weeks";
  const s = scheduleFromSettings(frequency, anchor, "2000-01-01");
  if (frequency === "semimonthly") {
    if (s.semiPair === "1-15") return "on the 1st and 15th";
    if (s.semiPair === "15-last") return "on the 15th and the last day of the month";
    if (s.semiPair === "15-30") return "on the 15th and 30th";
    if (s.semiDay) return `on the ${ordinal(s.semiDay)} and ${ordinal(s.semiDay + 15)}`;
    return "twice a month";
  }
  if (s.monthDay === "last") return "on the last day of each month";
  return s.monthDay ? `on the ${ordinal(s.monthDay)} of each month` : "once a month";
}

// ---------------------------------------------------------------------------
// Money and dates

/** "$1,250" from 1250; "" for null. */
export function moneyText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A typed amount: "" is null, "1,250" or "$1250.50" is a number, anything else is NaN. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}

export function todayLocal(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function formatDay(value: string): string {
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

export function formatWeekday(value: string): string {
  try {
    return format(parseISO(value), "EEE, MMM d");
  } catch {
    return value;
  }
}

export function formatWhen(value: string | null): string {
  if (!value) return "Not updated yet";
  try {
    return `Last updated ${format(new Date(value), "MMM d, yyyy h:mm a")}`;
  } catch {
    return "Not updated yet";
  }
}

/** The browser's time zone, when it is a real one. */
export function browserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.includes("/") ? tz : null;
  } catch {
    return null;
  }
}

/** Statuses where Plaid Link's update mode (Reconnect) is the fix. */
export const NEEDS_RECONNECT = new Set(["login_required", "pending_expiration", "pending_disconnect", "error"]);

// ---------------------------------------------------------------------------
// Jobber's reply when it sends the owner back

// The callback's own sentences, and what the owner sees for each (with a next step).
const JOBBER_CALLBACK_TEXTS: Record<string, string> = {
  "Jobber did not return an authorization code.": "Jobber didn't connect. Please press Connect Jobber to try again.",
  "This connection link expired. Please tap Connect Jobber again.": "This connection link expired. Please press Connect Jobber again.",
  "TreeCheck could not read your Jobber account details. Please tap Connect Jobber again.":
    "TreeCheck couldn't read your Jobber account details. Please press Connect Jobber again.",
  "This Jobber account is already connected to another TreeCheck company. Each Jobber account can be connected to one TreeCheck company.":
    "This Jobber account is already connected to another TreeCheck company. Please contact TreeCheck to move it to this company.",
};

/** The same message for an owner whose Jobber is still connected (their button says Reconnect Jobber). */
export function forConnectedJobber(message: string): string {
  return message.replace(/\bConnect Jobber\b/g, "Reconnect Jobber");
}

/**
 * The message to show for jobber_error from the address bar. Only the callback's own fixed sentences
 * are shown as they are (anyone can put text in a link); anything else gets one plain sentence.
 */
export function jobberErrorText(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  // Own keys only: "toString" and the like must not count as one of the callback's sentences.
  if (Object.prototype.hasOwnProperty.call(JOBBER_CALLBACK_TEXTS, t)) return JOBBER_CALLBACK_TEXTS[t];
  if (t === "access_denied" || /denied/i.test(t)) return "Jobber wasn't allowed to connect. Press Connect Jobber to try again.";
  return "Jobber didn't connect. Please press Connect Jobber to try again.";
}
