// Financial Pulse: the numbers for the owner's screen (A8, A11).
// POST {} or { force: true } -> { ok, snapshot, computed_at, cached, refreshing, jobber_import }
// POST { summary: true } -> { ok, setup_done, summary?, computed_at? }: Home's Pulse card (engine-6).
//   Numbers only (homeSummaryOf: no bank names, accounts or transactions). Never refreshes a bank or
//   Jobber, never writes the refresh marker and never saves the snapshot: it reads the stored snapshot
//   when fresh, otherwise works the numbers out from the data already synced, in memory.
// Caller: a company owner with Pulse switched on; the owner id comes from pulse_owner_id().
//
// The stored snapshot is returned when it is fresh: not marked changed, under 10 minutes old, for
// today's date and the current engine. Otherwise the numbers are worked out again: pulse_window_totals
// (M5) for the windows the engine needs, then computeSnapshot, then saved. A sync that lands while
// this runs can be missed for at most those 10 minutes.
// After replying, stale sources are refreshed in the background so the next open is current: business
// banks last synced over 6 hours ago, Jobber changes over 30 minutes old (the full history first, when
// it was never imported), the Jobber schedule over 30 minutes old, and payments recorded in Jobber over
// 30 minutes old (the whole history the first time and weekly; W3-10a). `refreshing` tells the page to
// ask once more a little later. Never returns tokens, account numbers or another company's data.

import {
  accountCountedFrom,
  cashflowWindows,
  computeSnapshot,
  ENGINE_VERSION,
  homeSummaryOf,
  payrollCountedFrom,
  type EngineInput,
  type Snapshot,
} from "../_shared/pulse/engine.ts";
import { localDate, windowsForSnapshot } from "../_shared/pulse/dates.ts";
import { SORTER_VERSION } from "../_shared/pulse/sorter.ts";
import { syncItem } from "../_shared/pulse/plaidSync.ts";
import {
  getState,
  grantedScopes,
  markDirty as markJobberDirty,
  openConnection,
  refreshScheduled,
  runBackfill,
  runIncremental,
  runPaymentsImport,
  PAYMENTS_FULL_EVERY_MS,
  saveState as saveJobberState,
  type JobberConn,
} from "../_shared/pulse/jobberSync.ts";
import { JobberGraphqlError, JobberReconnectRequired } from "../_shared/jobber.ts";
import { failureText, importFailing, needsReconnect } from "../_shared/pulse/jobberFailure.ts";
import { jobberUpdatedAt } from "../_shared/pulse/jobberFreshness.ts";
import { adminClient, afterReply, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";
import type { WindowTotals } from "../_shared/pulse/types.ts";

const FRESH_MS = 10 * 60_000;
// One budget for the whole background refresh, inside the edge runtime's wall-clock limit.
const REFRESH_BUDGET_MS = 100_000;
// A refresh started this recently is still running: don't start another.
const REFRESH_INFLIGHT_MS = 3 * 60_000;
const NO_SYNC_STATUSES = new Set(["login_required", "revoked", "error", "pending_disconnect"]);
const BANK_REFRESH_MS = 6 * 3_600_000;
const JOBBER_REFRESH_MS = 30 * 60_000;
const DEFAULT_TZ = "America/Chicago";

const older = (iso: string | null | undefined, ms: number, nowMs: number) => !iso || nowMs - Date.parse(iso) > ms;
/** The latest of some ISO instants (anything else ignored), or null. */
const latestIso = (...xs: unknown[]) =>
  xs.filter((x): x is string => typeof x === "string" && Number.isFinite(Date.parse(x)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || caller.kind !== "user") return json({ ok: false, error: "Unauthorized" }, 401);
    if (!caller.ownerId) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    const ownerId = caller.ownerId;
    const body = await bodyOf(req);
    // Home's Pulse card: numbers only, no refresh and nothing saved (see the top of this file).
    const summary = body.summary === true;
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const [settingsQ, itemsQ, accountsQ, startsQ, tokenQ, snapQ, access, jobberState, newestJobQ, newestPayQ] = await Promise.all([
      admin.from("pulse_settings")
        .select("timezone, profit_target_monthly, cash_reserve, pay_frequency, pay_anchor_date, payroll_amount_override, revenue_tax, setup_completed_at")
        .eq("owner_id", ownerId).maybeSingle(),
      admin.from("plaid_items")
        .select("id, plaid_env, institution_name, status, last_successful_update, historical_update_complete, new_accounts_available, last_synced_at")
        .eq("owner_id", ownerId).neq("status", "removed"),
      admin.from("plaid_accounts")
        .select("id, item_row_id, name, mask, type, status, is_business, include_from, use_for_payroll, balance_available, balance_current, balance_as_of")
        .eq("owner_id", ownerId),
      admin.rpc("pulse_account_starts", { p_owner: ownerId }),
      admin.from("jobber_tokens").select("disconnected_at").eq("contractor_id", ownerId).maybeSingle(),
      admin.from("pulse_snapshots").select("metrics, computed_at, as_of_date, engine_version, dirty, inputs").eq("owner_id", ownerId).maybeSingle(),
      admin.from("pulse_access").select("plaid_env").eq("owner_id", ownerId).maybeSingle(),
      getState(admin, ownerId),
      // The newest job saved: a webhook saves a job the moment it changes in Jobber.
      admin.from("jobber_jobs").select("synced_at").eq("owner_id", ownerId).not("synced_at", "is", null)
        .order("synced_at", { ascending: false }).limit(1).maybeSingle(),
      // M6: the newest payment saved. Read leniently (below): before M6 is applied it fails.
      admin.from("jobber_payments").select("synced_at").eq("owner_id", ownerId).not("synced_at", "is", null)
        .order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    for (const [what, q] of [["settings", settingsQ], ["items", itemsQ], ["accounts", accountsQ], ["account starts", startsQ], ["jobber", tokenQ], ["snapshot", snapQ], ["access", access], ["jobber jobs", newestJobQ]] as const) {
      if (q.error) throw new Error(`${what} read failed: ${q.error.message}`);
    }
    // Without M6 (not applied yet): no payments to read.
    if (newestPayQ.error) console.error("[pulse-get] payments read failed", newestPayQ.error.message);
    const paymentsReady = !newestPayQ.error;
    const settings = settingsQ.data ?? null;
    if (summary && !settings?.setup_completed_at) return json({ ok: true, setup_done: false });
    const tz = validTz(settings?.timezone) ? settings!.timezone : DEFAULT_TZ;
    const today = localDate(nowIso, tz);
    const env = access.data?.plaid_env ?? null;
    // Only this company's current environment counts (test and real banks never mix).
    const allItems = (itemsQ.data ?? []) as Array<Record<string, unknown>>;
    const items = allItems.filter((i) => !env || i.plaid_env === env);
    if (items.length !== allItems.length) {
      // pulse-admin refuses to switch environment while old banks remain, so this should never happen.
      console.error("[pulse-get] banks from another environment are still linked", ownerId);
    }
    const itemIds = new Set(items.map((i) => i.id as string));
    const accounts = ((accountsQ.data ?? []) as Array<Record<string, unknown>>).filter((a) => itemIds.has(a.item_row_id as string));

    // ---- background refresh (decided now, run after replying) ----
    const candidates = summary ? [] : items.filter((i) =>
      !NO_SYNC_STATUSES.has(i.status as string) &&
      accounts.some((a) => a.item_row_id === i.id && a.is_business) &&
      older(i.last_synced_at as string | null, BANK_REFRESH_MS, nowMs));
    // Skip banks a sync is already working on.
    let staleItems = candidates;
    if (candidates.length > 0) {
      const { data: locks, error: lErr } = await admin.from("plaid_item_secrets")
        .select("item_row_id, sync_lock_until").in("item_row_id", candidates.map((i) => i.id as string));
      if (lErr) throw new Error(`sync lock read failed: ${lErr.message}`);
      const busy = new Set(((locks ?? []) as Array<{ item_row_id: string; sync_lock_until: string | null }>)
        .filter((l) => l.sync_lock_until && Date.parse(l.sync_lock_until) > nowMs).map((l) => l.item_row_id));
      staleItems = candidates.filter((i) => !busy.has(i.id as string));
    }
    const jobberConnected = !!tokenQ.data && !tokenQ.data.disconnected_at;
    // Jobber's first import: when it started and whether its last try failed (the screen shows a problem
    // instead of waiting when it keeps failing).
    const jobberImport = {
      started_at: (jobberState.backfill_started_at as string | null) ?? null,
      done: !!jobberState.backfill_completed_at,
      // Several tries in a row failed (or the sign-in was refused): the screen shows a problem.
      failing: importFailing(jobberState),
      reconnect: needsReconnect(jobberState),
    };
    const jobberStale = jobberConnected && (!jobberState.backfill_completed_at || older(jobberState.incremental_watermark, JOBBER_REFRESH_MS, nowMs));
    const scheduleStale = jobberConnected && older(jobberState.scheduled_fetched_at, JOBBER_REFRESH_MS, nowMs);
    // Payments recorded in Jobber: the whole history the first time and weekly, else this month and the two before.
    const paymentsFullDue = jobberConnected && paymentsReady && (!jobberState.payments_backfill_completed_at ||
      older(jobberState.payments_backfill_completed_at, PAYMENTS_FULL_EVERY_MS, nowMs));
    const paymentsDue = jobberConnected && paymentsReady &&
      (paymentsFullDue || older(jobberState.payments_refreshed_at, JOBBER_REFRESH_MS, nowMs));
    const priorInputs = (snapQ.data?.inputs ?? {}) as Record<string, unknown>;
    const startedAt = typeof priorInputs.refresh_started_at === "string" ? Date.parse(priorInputs.refresh_started_at) : NaN;
    const inFlight = Number.isFinite(startedAt) && nowMs - startedAt < REFRESH_INFLIGHT_MS;
    const needed = !summary && (staleItems.length > 0 || jobberStale || scheduleStale || paymentsDue);
    const startRefresh = needed && !inFlight;
    const refreshing = needed;
    const deadline = nowMs + REFRESH_BUDGET_MS;
    const refresh = async () => {
      for (const i of staleItems) {
        if (Date.now() > deadline - 10_000) return;
        try {
          await syncItem(admin, i.id as string, deadline - 5_000);
        } catch (e) {
          console.error("[pulse-get] bank refresh failed", i.id, String((e as Error)?.message ?? e).slice(0, 200));
        }
      }
      if ((!jobberStale && !scheduleStale && !paymentsDue) || Date.now() > deadline - 15_000) return;
      let conn: JobberConn | null = null;
      try {
        conn = await openConnection(admin, ownerId);
        if (!conn) return;
        if (jobberStale || scheduleStale) {
          const scopes = await grantedScopes(admin, conn);
          if (jobberStale) {
            const r = jobberState.backfill_completed_at
              ? await runIncremental(admin, conn, scopes, deadline - 5_000)
              : await runBackfill(admin, conn, scopes, deadline - 5_000, false);
            if (r.jobs > 0 || r.done) await markJobberDirty(admin, ownerId);
          }
          if (scheduleStale && Date.now() < deadline - 10_000) {
            await refreshScheduled(admin, conn, scopes);
            await markJobberDirty(admin, ownerId);
          }
        }
      } catch (e) {
        const message = String((e as Error)?.message ?? e);
        console.error("[pulse-get] Jobber refresh failed", message.slice(0, 200));
        // Recorded so the screen can say what is wrong instead of waiting: failed tries in a row are
        // counted (read again now: a page saved during this try started the count over), a refused
        // sign-in means "reconnect Jobber", and a permission error re-checks Jobber's permissions.
        const previous = await getState(admin, ownerId).catch(() => jobberState);
        const patch: Record<string, unknown> = {
          last_error: failureText(previous, e instanceof JobberReconnectRequired, message),
        };
        if (e instanceof JobberGraphqlError && e.isPermissionError) patch.granted_scopes = null;
        // The numbers show Jobber as needing a reconnect: work them out again when that changes.
        const changed = needsReconnect({ last_error: patch.last_error }) !== needsReconnect(jobberState);
        await saveJobberState(admin, ownerId, patch).catch(() => {});
        if (changed) await markJobberDirty(admin, ownerId).catch(() => {});
        return;
      }
      // Payments recorded in Jobber (W3-10a). A problem here is logged; it is not a failed job import.
      if (paymentsDue && conn && Date.now() < deadline - 10_000) {
        try {
          const r = await runPaymentsImport(admin, conn, deadline - 5_000, paymentsFullDue);
          if (r.saved > 0 || r.removed > 0 || r.done) await markJobberDirty(admin, ownerId);
        } catch (e) {
          console.error("[pulse-get] Jobber payments refresh failed", String((e as Error)?.message ?? e).slice(0, 200));
        }
      }
    };

    // ---- the stored snapshot, when fresh ----
    const snap = snapQ.data;
    const fresh = snap && !snap.dirty && snap.metrics && snap.engine_version === ENGINE_VERSION &&
      snap.as_of_date === today && snap.computed_at && nowMs - Date.parse(snap.computed_at) < FRESH_MS;
    if (summary && fresh) {
      return json({ ok: true, setup_done: true, summary: homeSummaryOf(snap.metrics as Snapshot), computed_at: snap.computed_at });
    }
    if (fresh && body.force !== true) {
      if (startRefresh) {
        const { error: mErr } = await admin.from("pulse_snapshots")
          .update({ inputs: { ...priorInputs, refresh_started_at: nowIso } }).eq("owner_id", ownerId);
        if (mErr) throw new Error(`refresh marker failed: ${mErr.message}`);
        await afterReply(refresh());
      }
      return json({ ok: true, snapshot: snap.metrics, computed_at: snap.computed_at, cached: true, refreshing, jobber_import: jobberImport });
    }

    // ---- work the numbers out again ----
    const accountStarts = (startsQ.data ?? {}) as Record<string, string>;
    // Plaid gives every account of one bank link the same history range, so an account's history
    // starts where its bank link's does (a card first used last week still has the link's history).
    const linkStart = new Map<string, string>();
    for (const a of accounts) {
      const d = accountStarts[a.id as string];
      const item = a.item_row_id as string;
      if (d && (!linkStart.has(item) || d < linkStart.get(item)!)) linkStart.set(item, d);
    }
    const starts: Record<string, string> = {};
    for (const a of accounts) {
      const d = linkStart.get(a.item_row_id as string) ?? accountStarts[a.id as string];
      if (d) starts[a.id as string] = d;
    }
    const business = accounts.filter((a) => a.is_business === true);
    // Payroll money only from accounts the bank still shares (closed and revoked ones keep their history).
    // A closed account (the bank no longer shares it) never counts as payroll money.
    const payroll = business.filter((a) => a.use_for_payroll === true && a.type !== "credit" && a.status === "active").map((a) => ({
      available: a.balance_available === null || a.balance_available === undefined ? null : Number(a.balance_available),
      current: a.balance_current === null || a.balance_current === undefined ? null : Number(a.balance_current),
      as_of: (a.balance_as_of as string | null) ?? null,
      counted_from: accountCountedFrom({ include_from: (a.include_from as string | null) ?? null, history_start: starts[a.id as string] ?? null }),
    }));
    const engineSettings = settings
      ? {
        profit_target_monthly: settings.profit_target_monthly === null ? null : Number(settings.profit_target_monthly),
        cash_reserve: settings.cash_reserve === null ? null : Number(settings.cash_reserve),
        pay_frequency: settings.pay_frequency ?? null,
        pay_anchor_date: settings.pay_anchor_date ?? null,
        payroll_amount_override: settings.payroll_amount_override === null ? null : Number(settings.payroll_amount_override),
      }
      : null;
    const specs = [...windowsForSnapshot(today, engineSettings, payrollCountedFrom(payroll)), ...cashflowWindows(today)];
    const totalsQ = await admin.rpc("pulse_window_totals", { p_owner: ownerId, p_tz: tz, p_windows: specs });
    if (totalsQ.error) throw new Error(`window totals failed: ${totalsQ.error.message}`);
    const windows = (totalsQ.data ?? {}) as Record<string, WindowTotals>;
    // The basis these very totals used (M6), so the wording always matches the numbers; before M6 there
    // is none and revenue is completed jobs.
    const revenueBasis: "payments" | "completed_jobs" =
      Object.values(windows).some((w) => w?.revenue_basis === "payments") ? "payments" : "completed_jobs";

    const input: EngineInput = {
      today,
      now: nowIso,
      windows,
      daily_windows: windows,
      scheduled: jobberState.scheduled_status || jobberState.scheduled_fetched_at
        ? { status: jobberState.scheduled_status ?? null, fetched_at: jobberState.scheduled_fetched_at ?? null, by_day: jobberState.scheduled_by_day ?? null }
        : null,
      settings: engineSettings,
      payroll_accounts: payroll,
      business_accounts: business.map((a) => ({
        id: a.id as string,
        name: (a.name as string | null) ?? null,
        mask: (a.mask as string | null) ?? null,
        type: (a.type as string | null) ?? null,
        include_from: (a.include_from as string | null) ?? null,
        history_start: starts[a.id as string] ?? null,
      })),
      bank_items: items.map((i) => ({
        id: i.id as string,
        institution_name: (i.institution_name as string | null) ?? null,
        status: i.status as EngineInput["bank_items"][number]["status"],
        last_successful_update: (i.last_successful_update as string | null) ?? null,
        historical_update_complete: i.historical_update_complete === true,
        new_accounts_available: i.new_accounts_available === true,
        business: accounts.some((a) => a.item_row_id === i.id && a.is_business === true),
      })),
      jobber: {
        connected: jobberConnected,
        // Disconnected in Jobber, or Jobber refused the stored sign-in: either way it must be reconnected.
        disconnected: !!tokenQ.data?.disconnected_at || needsReconnect(jobberState),
        // Newest news from Jobber: the last full check for changes, or a job or payment saved since.
        // Newest news from Jobber. When sales are payments, the last payments read that finished: if those
        // reads keep failing, the "more than a day old" warning says so. Otherwise the last full check for
        // job changes, or a job saved since.
        last_synced_at: revenueBasis === "payments"
          ? latestIso(jobberState.payments_refreshed_at)
          : jobberUpdatedAt(jobberState, latestIso(newestJobQ.data?.synced_at)),
      },
      revenue_basis: revenueBasis,
      revenue_tax: settings?.revenue_tax === "as_jobber" ? "as_jobber" : "pre_tax",
      review_transfers_l30: Number(windows.L30?.review_count ?? 0),
    };
    const snapshot = computeSnapshot(input);
    // Home's Pulse card: the numbers from the data already synced, never saved.
    if (summary) return json({ ok: true, setup_done: true, summary: homeSummaryOf(snapshot), computed_at: nowIso });

    const { error: sErr } = await admin.from("pulse_snapshots").upsert({
      owner_id: ownerId,
      engine_version: ENGINE_VERSION,
      sorter_version: SORTER_VERSION,
      computed_at: nowIso,
      as_of_date: today,
      timezone: tz,
      metrics: snapshot,
      warnings: snapshot.warnings,
      inputs: {
        banks: items.length, business_accounts: business.length, payroll_accounts: payroll.length, windows: specs.length,
        ...(startRefresh ? { refresh_started_at: nowIso } : inFlight ? { refresh_started_at: priorInputs.refresh_started_at } : {}),
      },
      dirty: false,
    }, { onConflict: "owner_id" });
    if (sErr) throw new Error(`snapshot save failed: ${sErr.message}`);

    if (startRefresh) await afterReply(refresh());
    return json({ ok: true, snapshot, computed_at: nowIso, cached: false, refreshing, jobber_import: jobberImport });
  } catch (e) {
    console.error("[pulse-get]", String((e as Error)?.message ?? e).slice(0, 300));
    return fail("server_error", "Couldn't work out your numbers. Please try again.");
  }
});
