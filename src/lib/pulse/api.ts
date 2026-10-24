// Financial Pulse: typed calls to the Pulse edge functions.
// Every call resolves (never throws). Expected refusals come back from the server as HTTP 200 with
// { ok: false, code, error }; anything else (non-2xx, bad JSON, no connection) becomes the "network" code.
import type { HomeSummary, Snapshot } from "../../../supabase/functions/_shared/pulse/engine";
import { supabase } from "@/integrations/supabase/client";

/** Version of the consent text shown before Plaid Link; stored with each new bank link. */
export const CONSENT_VERSION = "pulse-consent-2";

/** plaid-link-token and plaid-exchange refuse with this code until the session finished two-step sign-in. */
export { TWO_STEP_CODE } from "../../../supabase/functions/_shared/pulse/twoStep";

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const NOT_ENABLED_MESSAGE = "Financial Pulse isn't switched on for your company yet.";
export const NOT_PERSONAL_MESSAGE = "This payment isn't marked as personal, so there's nothing to change.";
export const SET_BY_SUPPORT_MESSAGE =
  "TreeCheck support marked this payment as personal. Please contact TreeCheck if it should count as business.";

export interface PulseFailure<C extends string = string> {
  ok: false;
  code: C | "network";
  error: string;
}

// ---- plaid-link-token --------------------------------------------------------------------------
export type LinkTokenCode =
  | "not_enabled"
  | "company_limit"
  | "team_limit"
  | "not_configured"
  | "plaid_error"
  | "not_found"
  | "same_institution"
  | "mfa_required";
export type LinkTokenBody =
  | { mode: "new" }
  | { mode: "update"; item_row_id: string; account_selection?: boolean };
export type LinkTokenResult =
  | { ok: true; link_token: string; expiration: string }
  | PulseFailure<LinkTokenCode>;

// ---- plaid-exchange ----------------------------------------------------------------------------
export interface ExchangeInstitution {
  institution_id: string;
  name: string;
}
export interface ExchangeAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}
export interface ExchangeMetadata {
  institution: ExchangeInstitution | null;
  accounts: ExchangeAccount[];
  link_session_id: string | null;
}
export interface ExchangeBody {
  public_token: string;
  metadata: ExchangeMetadata;
  consent_version: string;
}
export type ExchangeCode =
  | "not_enabled"
  | "bad_request"
  | "same_institution"
  | "duplicate_accounts"
  | "company_limit"
  | "team_limit"
  | "not_configured"
  | "store_failed"
  | "exchange_unclear"
  | "plaid_error"
  | "mfa_required";
export type ExchangeResult =
  | { ok: true; item_row_id: string; accounts: number }
  | PulseFailure<ExchangeCode>;

// ---- plaid-sync --------------------------------------------------------------------------------
export interface SyncBody {
  item_row_id?: string;
  /** Only right after a successful Plaid Link update (Reconnect or Add accounts) for item_row_id. */
  after_update?: boolean;
  /** With after_update: Plaid's account picker was shown, so "new accounts available" is cleared. */
  account_selection?: boolean;
}
export type SyncResult =
  | {
      ok: true;
      items: number;
      added: number;
      modified: number;
      removed: number;
      /** One entry per bank that could not be synced, e.g. "login_required" or "error". */
      problems: string[];
    }
  | PulseFailure;

// ---- pulse-setup -------------------------------------------------------------------------------
export interface AccountSetting {
  id: string;
  is_business: boolean;
  include_from: string | null;
  use_for_payroll: boolean;
  /** True only for a business credit card whose count-from choice the owner has made (now or earlier). */
  count_from_chosen?: boolean;
}
export interface SetAccountsBody {
  action: "set_accounts";
  accounts: AccountSetting[];
}
/** Only the fields sent change. 0 or blank typical payroll means "work it out from the bank". */
export interface PulseSettingsPatch {
  timezone?: string;
  pay_frequency?: string | null;
  pay_anchor_date?: string | null;
  payroll_amount_override?: number | null;
  profit_target_monthly?: number | null;
  cash_reserve?: number;
  setup_step?: string | null;
}
export interface SaveSettingsBody {
  action: "save_settings";
  settings: PulseSettingsPatch;
}
export interface CompleteSetupBody {
  action: "complete";
}
export type SetupBody = SetAccountsBody | SaveSettingsBody | CompleteSetupBody;
/** history_repull (set_accounts): an account switched to business after setup is bringing in its past transactions. */
export type SetupResult = { ok: true; history_repull?: boolean } | PulseFailure;
export type CompleteSetupResult = { ok: true; personal_rows_removed_from: number } | PulseFailure;

// ---- pulse-transaction-action ------------------------------------------------------------------
// The "Personal, not business" button. personalRuleFor gives the label for "Every charge from
// {label}"; when its merchant is null, only "just this one" is offered.
export {
  personalRuleFor,
  type PersonalMerchantKey,
  type PersonalRuleChoice,
  type PersonalRuleTxn,
} from "../../../supabase/functions/_shared/pulse/personalRule";

/** "one": this payment only. "merchant": every charge from the same merchant or payee. */
export type PersonalScope = "one" | "merchant";
export interface MarkPersonalBody {
  action: "mark_personal";
  transaction_id: string;
  scope: PersonalScope;
}
export interface UndoPersonalBody {
  action: "undo";
  /** The rule_id a mark_personal reply returned. */
  rule_id: string;
}
export interface CountAsBusinessBody {
  action: "count_as_business";
  transaction_id: string;
}
export type TransactionActionBody = MarkPersonalBody | UndoPersonalBody | CountAsBusinessBody;
export type TransactionActionCode =
  | "not_enabled"
  | "bad_request"
  | "not_found"
  | "not_personal"
  | "set_by_support"
  | "server_error";
export type MarkPersonalResult =
  | {
      ok: true;
      rule_id: string;
      /** "one" when the owner asked for the merchant but its key names no one (a bare Zelle payment). */
      scope_applied: PersonalScope;
      /** A bank sync was sorting: the change lands when it finishes, so check again shortly. */
      pending?: boolean;
    }
  | PulseFailure<TransactionActionCode>;
export type UndoPersonalResult = { ok: true; pending?: boolean } | PulseFailure<TransactionActionCode>;
export type CountAsBusinessResult = { ok: true; deactivated: number; pending?: boolean } | PulseFailure<TransactionActionCode>;
export type TransactionActionResult = MarkPersonalResult | UndoPersonalResult | CountAsBusinessResult;

// ---- shared invoke -----------------------------------------------------------------------------
type Parsed = { ok: true; body: Record<string, unknown> } | PulseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function networkFailure(): PulseFailure<never> {
  return { ok: false, code: "network", error: GENERIC_ERROR };
}

function parseBody(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

async function invokePulse(fn: string, body: object): Promise<Parsed> {
  try {
    const { data, error } = await supabase.functions.invoke<unknown>(fn, { body });
    if (error) return networkFailure();
    const parsed = parseBody(data);
    if (!isRecord(parsed) || typeof parsed.ok !== "boolean") return networkFailure();
    if (!parsed.ok) {
      const code = typeof parsed.code === "string" && parsed.code ? parsed.code : "unknown";
      const text =
        typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : GENERIC_ERROR;
      return { ok: false, code, error: text };
    }
    return { ok: true, body: parsed };
  } catch {
    return networkFailure();
  }
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ---- public calls ------------------------------------------------------------------------------
export async function linkToken(body: LinkTokenBody): Promise<LinkTokenResult> {
  const r = await invokePulse("plaid-link-token", body);
  if (r.ok === false) return r as PulseFailure<LinkTokenCode>;
  const token = r.body.link_token;
  if (typeof token !== "string" || !token) return networkFailure();
  const expiration = typeof r.body.expiration === "string" ? r.body.expiration : "";
  return { ok: true, link_token: token, expiration };
}

export async function exchange(body: ExchangeBody): Promise<ExchangeResult> {
  const r = await invokePulse("plaid-exchange", body);
  if (r.ok === false) return r as PulseFailure<ExchangeCode>;
  const itemRowId = r.body.item_row_id;
  if (typeof itemRowId !== "string" || !itemRowId) return networkFailure();
  return { ok: true, item_row_id: itemRowId, accounts: asCount(r.body.accounts) };
}

function asProblems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is string => typeof p === "string" && p.length > 0);
}

export async function sync(body: SyncBody): Promise<SyncResult> {
  const r = await invokePulse("plaid-sync", body);
  if (r.ok === false) return r;
  return {
    ok: true,
    items: asCount(r.body.items),
    added: asCount(r.body.added),
    modified: asCount(r.body.modified),
    removed: asCount(r.body.removed),
    problems: asProblems(r.body.problems),
  };
}

export function setup(body: CompleteSetupBody): Promise<CompleteSetupResult>;
export function setup(body: SetAccountsBody | SaveSettingsBody): Promise<SetupResult>;
export async function setup(body: SetupBody): Promise<SetupResult | CompleteSetupResult> {
  const r = await invokePulse("pulse-setup", body);
  if (r.ok === false) return r;
  if (body.action === "complete") {
    return { ok: true, personal_rows_removed_from: asCount(r.body.personal_rows_removed_from) };
  }
  if (body.action === "set_accounts") return { ok: true, history_repull: r.body.history_repull === true };
  return { ok: true };
}

export function transactionAction(body: MarkPersonalBody): Promise<MarkPersonalResult>;
export function transactionAction(body: UndoPersonalBody): Promise<UndoPersonalResult>;
export function transactionAction(body: CountAsBusinessBody): Promise<CountAsBusinessResult>;
export async function transactionAction(body: TransactionActionBody): Promise<TransactionActionResult> {
  const r = await invokePulse("pulse-transaction-action", body);
  if (r.ok === false) return r as PulseFailure<TransactionActionCode>;
  if (body.action === "mark_personal") {
    const ruleId = r.body.rule_id;
    if (typeof ruleId !== "string" || !ruleId) return networkFailure();
    // Never claim more than the server confirmed: anything but "merchant" reads as this payment only.
    const scope: PersonalScope = r.body.scope_applied === "merchant" ? "merchant" : "one";
    return { ok: true, rule_id: ruleId, scope_applied: scope, pending: r.body.pending === true };
  }
  if (body.action === "count_as_business") return { ok: true, deactivated: asCount(r.body.deactivated), pending: r.body.pending === true };
  return { ok: true, pending: r.body.pending === true };
}

/** Plain-language text for a failure. Known refusal codes get fixed wording; others show the server's own text. */
export function pulseErrorMessage(failure: PulseFailure): string {
  switch (failure.code) {
    case "same_institution":
      return "This bank is already linked. Press Reconnect or Add accounts on that bank in Setup, or contact TreeCheck if it has no buttons.";
    case "duplicate_accounts":
      return "One or more of these accounts is already linked. To add another account at that bank, press Add accounts on it in Setup.";
    case "company_limit":
      return "Your company has reached its number of bank connections. Please contact TreeCheck to link another bank.";
    case "team_limit":
      return "TreeCheck's bank connections are full right now. Please contact TreeCheck.";
    case "not_configured":
      return "Bank linking is not set up yet. Please contact TreeCheck.";
    case "store_failed":
      return "The bank connected but could not be saved. Please contact TreeCheck before trying again.";
    case "exchange_unclear":
      return "We could not confirm the bank connection. Please contact TreeCheck before trying again.";
    case "not_enabled":
      return NOT_ENABLED_MESSAGE;
    case "not_personal":
      return NOT_PERSONAL_MESSAGE;
    case "set_by_support":
      return SET_BY_SUPPORT_MESSAGE;
    default:
      // Includes bad_request, whose server text says what to fix.
      return failure.error || GENERIC_ERROR;
  }
}

export const BANK_UPDATED_MESSAGE = "Bank updated.";
export const STILL_NEEDS_LOGIN_MESSAGE = "Your bank still needs you to log in. Try Reconnect again.";
export const BANK_TURNED_OFF_MESSAGE =
  "This connection was turned off at your bank. Please contact TreeCheck to set it up again.";
export const UPDATE_NOT_CONFIRMED_MESSAGE =
  "We couldn't get your latest transactions from this bank yet. Please try again in a few minutes. If it keeps happening, contact TreeCheck.";

/**
 * What to tell the owner after the sync that follows a Plaid Link update (Reconnect or Add accounts).
 * "Bank updated." only when the sync ran with no problems.
 */
export function afterUpdateOutcome(result: SyncResult): { ok: boolean; message: string } {
  if (result.ok === false) {
    if (result.code === "not_enabled") return { ok: false, message: NOT_ENABLED_MESSAGE };
    return { ok: false, message: UPDATE_NOT_CONFIRMED_MESSAGE };
  }
  if (result.problems.length === 0) return { ok: true, message: BANK_UPDATED_MESSAGE };
  if (result.problems.includes("login_required")) return { ok: false, message: STILL_NEEDS_LOGIN_MESSAGE };
  if (result.problems.includes("revoked")) return { ok: false, message: BANK_TURNED_OFF_MESSAGE };
  return { ok: false, message: UPDATE_NOT_CONFIRMED_MESSAGE };
}

// ---- Plaid Link session (kept for the OAuth redirect round trip) --------------------------------
// Plaid sends OAuth banks back to /dashboard/pulse/oauth-return, where Link must reopen with the
// same link token. The token is short-lived and only opens Link; it is not a bank access key.
// It is kept in localStorage for 30 minutes, not only in this tab: a bank that signs in through its
// own phone app can send the owner back in a new browser tab, which must still find it.
export const LINK_TOKEN_STORAGE_KEY = "pulse_link_token";
const LINK_CONTEXT_STORAGE_KEY = "pulse_link_context";
const LINK_SAVED_AT_STORAGE_KEY = "pulse_link_saved_at";
export const LINK_SESSION_MAX_AGE_MS = 30 * 60_000;

export interface LinkContext {
  mode: "new" | "update";
  itemRowId: string | null;
  accountSelection: boolean;
}

export function saveLinkSession(token: string, context: LinkContext, nowMs = Date.now()): void {
  try {
    localStorage.setItem(LINK_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(LINK_CONTEXT_STORAGE_KEY, JSON.stringify(context));
    localStorage.setItem(LINK_SAVED_AT_STORAGE_KEY, String(nowMs));
  } catch {
    // Storage can be blocked (private mode); only the OAuth return needs it.
  }
}

// The saved session's storage: localStorage while it is fresh, else a tab-only one from the older code.
function linkSessionStore(nowMs: number): Storage | null {
  const savedAt = Number(localStorage.getItem(LINK_SAVED_AT_STORAGE_KEY));
  if (localStorage.getItem(LINK_TOKEN_STORAGE_KEY)) {
    if (Number.isFinite(savedAt) && savedAt > 0 && nowMs - savedAt <= LINK_SESSION_MAX_AGE_MS) return localStorage;
    clearLinkSession();
    return null;
  }
  return sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY) ? sessionStorage : null;
}

export function readLinkSession(nowMs = Date.now()): { token: string; context: LinkContext } | null {
  try {
    const store = linkSessionStore(nowMs);
    const token = store?.getItem(LINK_TOKEN_STORAGE_KEY);
    if (!store || !token) return null;
    const raw = parseBody(store.getItem(LINK_CONTEXT_STORAGE_KEY));
    const mode = isRecord(raw) && raw.mode === "update" ? "update" : "new";
    const itemRowId = isRecord(raw) && typeof raw.itemRowId === "string" ? raw.itemRowId : null;
    const accountSelection = isRecord(raw) && raw.accountSelection === true;
    if (mode === "update" && !itemRowId) return null;
    return { token, context: { mode, itemRowId, accountSelection } };
  } catch {
    return null;
  }
}

export function clearLinkSession(): void {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      store().removeItem(LINK_TOKEN_STORAGE_KEY);
      store().removeItem(LINK_CONTEXT_STORAGE_KEY);
      store().removeItem(LINK_SAVED_AT_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }
}

// ---- pulse-get ---------------------------------------------------------------------------------
// The numbers for the Pulse screen. `refreshing` means stale bank or Jobber data is being fetched in
// the background: ask once more a little later.
/** Jobber's first import, as pulse-get reports it next to the numbers. */
export interface JobberImportInfo {
  started_at: string | null;
  done: boolean;
  /** The last try failed (cleared by any progress). */
  failing: boolean;
  /** Jobber refused the stored sign-in: the owner must reconnect Jobber. */
  reconnect: boolean;
}

export type PulseGetResult =
  | { ok: true; snapshot: Snapshot; computed_at: string; cached: boolean; refreshing: boolean; jobber_import: JobberImportInfo | null }
  | PulseFailure;

// ---- pulse-get, summary mode (Home's Pulse card, engine-6) ------------------------------------
export type PulseHomeResult =
  | { ok: true; setup_done: false }
  | { ok: true; setup_done: true; summary: HomeSummary; computed_at: string }
  | PulseFailure;

/**
 * Home's Pulse card numbers. The server never starts a refresh for it and saves nothing. A reply without the
 * month comparison (for example from a pulse-get older than engine-6) counts as a network failure.
 */
export async function pulseHomeSummary(): Promise<PulseHomeResult> {
  const r = await invokePulse("pulse-get", { summary: true });
  if (r.ok === false) return r as PulseFailure;
  if (r.body.setup_done === false) return { ok: true, setup_done: false };
  const summary = r.body.summary;
  if (
    r.body.setup_done !== true || !isRecord(summary) || !isRecord(summary.month) ||
    !isRecord(summary.month.current) || !isRecord(summary.month.previous)
  ) return networkFailure();
  return {
    ok: true,
    setup_done: true,
    summary: summary as unknown as HomeSummary,
    computed_at: typeof r.body.computed_at === "string" ? r.body.computed_at : "",
  };
}

export async function pulseGet(force = false): Promise<PulseGetResult> {
  const r = await invokePulse("pulse-get", force ? { force: true } : {});
  if (r.ok === false) return r as PulseFailure;
  const snapshot = r.body.snapshot;
  if (!isRecord(snapshot) || !isRecord(snapshot.status) || !isRecord(snapshot.periods)) return networkFailure();
  return {
    ok: true,
    snapshot: snapshot as unknown as Snapshot,
    computed_at: typeof r.body.computed_at === "string" ? r.body.computed_at : "",
    cached: r.body.cached === true,
    refreshing: r.body.refreshing === true,
    jobber_import: isRecord(r.body.jobber_import)
      ? {
        started_at: typeof r.body.jobber_import.started_at === "string" ? r.body.jobber_import.started_at : null,
        done: r.body.jobber_import.done === true,
        failing: r.body.jobber_import.failing === true,
        reconnect: r.body.jobber_import.reconnect === true,
      }
      : null,
  };
}
