// Financial Pulse: brings a linked bank's transactions and balances into Pulse, then sorts them.
// Server-side only (service role). Plaid data never goes to any AI.
//
// syncItem (A7):
// * One sync per item at a time (plaid_claim_sync lock, 5 minutes). A webhook that arrives while
//   a sync is running sets the item's "sync again" flag; the running sync runs once more.
// * /transactions/sync from the saved cursor, 500 per page, Plaid categories v2. Each page is
//   written as it arrives (idempotent upserts keyed on transaction_id, owner-scoped deletes), and
//   the cursor is committed only when Plaid says there is nothing more (compare-and-swap), so an
//   interrupted run simply starts again from the saved cursor. If Plaid's data changes mid-way
//   (TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION), the whole run restarts from the saved cursor.
// * After setup is complete, rows on accounts the owner did not mark as business are not stored,
//   and any left over are deleted at the end of each pass (data minimisation, D14), also by a pass
//   that started before the owner finished setup.
// * Then /accounts/get (free, cached balances; discovers accounts; an account the bank no longer
//   shares is marked closed and stops paying payroll), /item/get (last successful update, errors),
//   and the whole company is sorted again (classifyOwner). A change of the connection's status or
//   accounts marks the numbers changed, so the Pulse screen never shows a fixed bank as broken.
// Known limit: a first history that needs more pages than one run's time allows starts again from
// the beginning on the next run (pages are idempotent); about 5,000 to 15,000 transactions fit.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

import { loadItem, PlaidApiError, plaidPost } from "../plaid.ts";
import { reconcileAccounts } from "./accountReconcile.ts";
import { mapAccount, mapTransaction, type PlaidAccount, type PlaidTransaction } from "./plaidMap.ts";
import { classifyAll, SORTER_VERSION } from "./sorter.ts";
import type { SorterAccount, SorterRule, SorterTxn } from "./types.ts";

const PAGE_SIZE = 500;
const WRITE_CHUNK = 500;
const DELETE_CHUNK = 100; // ids go in the URL of a delete; keep it short
const READ_CHUNK = 1000;
const MAX_RESTARTS = 3;
const SYNC_LOCK_SECONDS = 300;
const CLASSIFY_LOCK_SECONDS = 120;
const EXTRA_PASSES = 2;

export interface SyncResult {
  item_row_id: string;
  added: number;
  modified: number;
  removed: number;
  complete: boolean;
  skipped?: "busy" | "inactive";
  error?: string;
}

/**
 * Saves Plaid's account facts and balances (never the owner's choices: is_business, include_from,
 * use_for_payroll) and returns Plaid account id -> plaid_accounts row id for the item.
 */
export async function saveAccounts(
  admin: Admin,
  ownerId: string,
  itemRowId: string,
  accounts: PlaidAccount[],
  asOf: string,
): Promise<Map<string, string>> {
  if (accounts.length > 0) {
    const rows = accounts.map((a) => mapAccount(a, ownerId, itemRowId, asOf));
    const { error } = await admin.from("plaid_accounts").upsert(rows, { onConflict: "account_id" });
    if (error) throw new Error(`plaid_accounts save failed: ${error.message}`);
  }
  const { data, error } = await admin.from("plaid_accounts").select("id, account_id").eq("item_row_id", itemRowId);
  if (error) throw new Error(`plaid_accounts read failed: ${error.message}`);
  return new Map((data ?? []).map((r: { id: string; account_id: string }) => [r.account_id, r.id]));
}

/** After setup: the ids of the owner's non-business accounts (their rows are not kept). Null before setup. */
async function personalAccounts(admin: Admin, ownerId: string): Promise<Set<string> | null> {
  const { data: settings, error: sErr } = await admin
    .from("pulse_settings").select("setup_completed_at").eq("owner_id", ownerId).maybeSingle();
  if (sErr) throw new Error(`pulse_settings read failed: ${sErr.message}`);
  if (!settings?.setup_completed_at) return null; // before setup, keep everything so accounts can be chosen
  const { data, error } = await admin.from("plaid_accounts").select("id").eq("owner_id", ownerId).eq("is_business", false);
  if (error) throw new Error(`plaid_accounts read failed: ${error.message}`);
  return new Set((data ?? []).map((a: { id: string }) => a.id));
}

/** Deletes the stored rows of the owner's non-business accounts (after setup). Returns how many accounts had rows removed. */
export async function purgePersonalRows(admin: Admin, ownerId: string): Promise<number> {
  const personal = await personalAccounts(admin, ownerId);
  if (!personal || personal.size === 0) return 0;
  const ids = [...personal];
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const { error } = await admin.from("plaid_transactions").delete().eq("owner_id", ownerId).in("account_row_id", ids.slice(i, i + DELETE_CHUNK));
    if (error) throw new Error(`personal rows cleanup failed: ${error.message}`);
  }
  return ids.length;
}

export async function markDirty(admin: Admin, ownerId: string): Promise<void> {
  const { error } = await admin.from("pulse_snapshots").upsert({ owner_id: ownerId, dirty: true }, { onConflict: "owner_id" });
  if (error) throw new Error(`snapshot mark failed: ${error.message}`);
}


/**
 * Syncs one item. Never throws for Plaid item problems: they are recorded on the item.
 * A "sync again" request that arrives just before this sync lets go of the item is run here too, so it
 * never waits for the next webhook.
 */
export async function syncItem(admin: Admin, itemRowId: string, deadline: number): Promise<SyncResult> {
  let result = await syncOnce(admin, itemRowId, deadline);
  for (let handoff = 0; handoff < EXTRA_PASSES && !result.skipped && !result.error && Date.now() < deadline; handoff++) {
    const again = await admin.rpc("plaid_take_resync", { p_item_row_id: itemRowId });
    if (again.error || again.data !== true) break;
    const next = await syncOnce(admin, itemRowId, deadline);
    if (next.skipped) break; // another sync has the item now and was asked to run again
    result = { ...next, added: result.added + next.added, modified: result.modified + next.modified, removed: result.removed + next.removed };
  }
  return result;
}

async function claimSync(admin: Admin, itemRowId: string): Promise<boolean> {
  const claim = await admin.rpc("plaid_claim_sync", { p_item_row_id: itemRowId, p_seconds: SYNC_LOCK_SECONDS });
  if (claim.error) throw new Error(`sync lock failed: ${claim.error.message}`);
  return claim.data === true;
}

async function syncOnce(admin: Admin, itemRowId: string, deadline: number): Promise<SyncResult> {
  const result: SyncResult = { item_row_id: itemRowId, added: 0, modified: 0, removed: 0, complete: false };
  if (!(await claimSync(admin, itemRowId))) {
    // Someone is syncing this item now: ask them to run once more. Then try once more, in case they let
    // go just before the request was recorded (they also check for requests after letting go).
    const { error: fErr } = await admin.from("plaid_items").update({ resync_requested: true }).eq("id", itemRowId);
    if (fErr) throw new Error(`resync request failed: ${fErr.message}`);
    if (!(await claimSync(admin, itemRowId))) return { ...result, skipped: "busy" };
    await admin.rpc("plaid_take_resync", { p_item_row_id: itemRowId }); // this run covers the request
  }

  let ownerForCleanup: string | null = null;
  try {
    const ctx = await loadItem(admin, itemRowId);
    ownerForCleanup = ctx.ownerId;
    if (ctx.status === "revoked" || ctx.status === "removed") return { ...result, skipped: "inactive" };

    for (let pass = 0; pass <= EXTRA_PASSES; pass++) {
      const seenAt = new Date().toISOString();
      const { data: sec, error: sErr } = await admin
        .from("plaid_item_secrets").select("sync_cursor").eq("item_row_id", itemRowId).maybeSingle();
      if (sErr) throw new Error(`cursor read failed: ${sErr.message}`);
      const savedCursor: string | null = sec?.sync_cursor ?? null;
      const personal = await personalAccounts(admin, ctx.ownerId);

      let finished = false;
      let nextCursor: string | null = null;
      let updateStatus: string | null = null;
      let dropped = 0;
      for (let attempt = 0; attempt <= MAX_RESTARTS && !finished; attempt++) {
        let cursor = savedCursor;
        let added = 0, modified = 0, removed = 0;
        try {
          for (;;) {
            if (Date.now() > deadline) break;
            const body: Record<string, unknown> = {
              access_token: ctx.accessToken,
              count: PAGE_SIZE,
              options: { personal_finance_category_version: "v2", include_original_description: false },
            };
            if (cursor) body.cursor = cursor;
            const page = await plaidPost(ctx.env, "/transactions/sync", body);
            const accountIds = await saveAccounts(admin, ctx.ownerId, ctx.itemRowId, (page.accounts ?? []) as PlaidAccount[], seenAt);
            if (typeof page.transactions_update_status === "string") updateStatus = page.transactions_update_status;

            const changed = [...((page.added ?? []) as PlaidTransaction[]), ...((page.modified ?? []) as PlaidTransaction[])];
            const known = changed
              .map((t) => ({ t, accountRowId: accountIds.get(t.account_id) }))
              .filter((x): x is { t: PlaidTransaction; accountRowId: string } => !!x.accountRowId);
            dropped += changed.length - known.length;
            const rows = known
              .filter((x) => personal === null || !personal.has(x.accountRowId))
              .map((x) => mapTransaction(x.t, ctx.ownerId, x.accountRowId, seenAt));
            for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
              const { error } = await admin.from("plaid_transactions")
                .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "transaction_id" });
              if (error) throw new Error(`plaid_transactions save failed: ${error.message}`);
            }
            const removedIds = ((page.removed ?? []) as Array<{ transaction_id: string }>).map((r) => r.transaction_id).filter(Boolean);
            for (let i = 0; i < removedIds.length; i += DELETE_CHUNK) {
              const { error } = await admin.from("plaid_transactions").delete()
                .eq("owner_id", ctx.ownerId).in("transaction_id", removedIds.slice(i, i + DELETE_CHUNK));
              if (error) throw new Error(`plaid_transactions delete failed: ${error.message}`);
            }
            added += (page.added ?? []).length;
            modified += (page.modified ?? []).length;
            removed += removedIds.length;

            cursor = typeof page.next_cursor === "string" && page.next_cursor !== "" ? page.next_cursor : cursor;
            if (!page.has_more) {
              finished = true;
              nextCursor = cursor;
              break;
            }
          }
          result.added += added;
          result.modified += modified;
          result.removed += removed;
          if (!finished) break; // out of time: the next run starts again from the saved cursor
        } catch (e) {
          if (e instanceof PlaidApiError && e.errorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < MAX_RESTARTS) {
            continue;
          }
          throw e;
        }
      }
      if (dropped > 0) console.error("[plaid-sync] transactions for unknown accounts skipped", dropped);

      if (finished && nextCursor && nextCursor !== savedCursor) {
        const cas = await admin.rpc("plaid_commit_cursor", {
          p_item_row_id: itemRowId, p_old_cursor: savedCursor, p_new_cursor: nextCursor,
        });
        if (cas.error) throw new Error(`cursor commit failed: ${cas.error.message}`);
      }
      result.complete = finished;

      // Balances for every account (cached by Plaid, no extra charge), and the item's health.
      const acc = await plaidPost(ctx.env, "/accounts/get", { access_token: ctx.accessToken });
      const sharedAccounts = (acc.accounts ?? []) as PlaidAccount[];
      await saveAccounts(admin, ctx.ownerId, ctx.itemRowId, sharedAccounts, new Date().toISOString());
      const accountsMoved = await reconcileAccounts(admin, ctx.ownerId, ctx.itemRowId, new Set(sharedAccounts.map((a) => a.account_id)));
      const got = await plaidPost(ctx.env, "/item/get", { access_token: ctx.accessToken });
      const patch: Record<string, unknown> = {
        last_synced_at: new Date().toISOString(),
        last_successful_update: got?.status?.transactions?.last_successful_update ?? null,
        consent_expiration_time: got?.item?.consent_expiration_time ?? null,
      };
      if (updateStatus === "INITIAL_UPDATE_COMPLETE" || updateStatus === "HISTORICAL_UPDATE_COMPLETE") patch.initial_update_complete = true;
      if (updateStatus === "HISTORICAL_UPDATE_COMPLETE") patch.historical_update_complete = true;
      if (got?.item?.institution_name) patch.institution_name = got.item.institution_name;
      const itemErr = got?.item?.error?.error_code ?? null;
      if (itemErr === "ITEM_LOGIN_REQUIRED") {
        patch.status = "login_required";
        patch.error_code = itemErr;
      } else if (itemErr === "USER_PERMISSION_REVOKED" || itemErr === "ITEM_NOT_FOUND") {
        patch.status = "revoked";
        patch.error_code = itemErr;
      } else if (itemErr) {
        // Any other problem Plaid reports on the connection: never shown as connected.
        patch.status = "error";
        patch.error_code = itemErr;
        if (ctx.status !== "error") patch.error_at = new Date().toISOString();
      } else if (!itemErr && (ctx.status === "login_required" || ctx.status === "error")) {
        patch.status = "active";
        patch.error_code = null;
      }
      const { error: uErr } = await admin.from("plaid_items").update(patch).eq("id", itemRowId);
      if (uErr) throw new Error(`plaid_items update failed: ${uErr.message}`);
      const statusMoved = patch.status !== undefined && patch.status !== ctx.status;

      // Always: a pass that started before the owner pressed Finish still removes personal rows
      // (purgePersonalRows does nothing until setup is finished).
      await purgePersonalRows(admin, ctx.ownerId);
      await classifyOwner(admin, ctx.ownerId); // marks the snapshot stale when sorting changed rows
      if (rowsChanged(result) || statusMoved || accountsMoved) await markDirty(admin, ctx.ownerId);

      // A webhook arrived while this ran: run once more while time allows. A request is only taken
      // when it will be run; otherwise it stays for the check after letting go (syncItem).
      if (pass === EXTRA_PASSES || Date.now() > deadline) break;
      const again = await admin.rpc("plaid_take_resync", { p_item_row_id: itemRowId });
      if (again.error || again.data !== true) break;
    }
    return result;
  } catch (e) {
    // A pass that failed part-way still removes personal rows it may have stored after Finish.
    if (ownerForCleanup) await purgePersonalRows(admin, ownerForCleanup).catch(() => { /* best effort */ });
    if (e instanceof PlaidApiError && e.errorCode === "ITEM_LOGIN_REQUIRED") {
      await admin.from("plaid_items").update({ status: "login_required", error_code: e.errorCode, error_at: new Date().toISOString() }).eq("id", itemRowId);
      await markItemOwnerDirty(admin, itemRowId);
      return { ...result, error: "login_required" };
    }
    if (e instanceof PlaidApiError && (e.errorCode === "ITEM_NOT_FOUND" || e.errorCode === "USER_PERMISSION_REVOKED")) {
      await admin.from("plaid_items").update({ status: "revoked", error_code: e.errorCode, error_at: new Date().toISOString() }).eq("id", itemRowId);
      await markItemOwnerDirty(admin, itemRowId);
      return { ...result, error: "revoked" };
    }
    throw e;
  } finally {
    await admin.rpc("plaid_release_sync", { p_item_row_id: itemRowId });
  }
}

function rowsChanged(r: SyncResult): boolean {
  return r.added + r.modified + r.removed > 0;
}

/** The connection's status changed where the item context is not at hand: mark its company's numbers changed. */
async function markItemOwnerDirty(admin: Admin, itemRowId: string): Promise<void> {
  const { data } = await admin.from("plaid_items").select("owner_id").eq("id", itemRowId).maybeSingle();
  if (data?.owner_id) await markDirty(admin, data.owner_id).catch(() => { /* best effort */ });
}

type StoredTxn = SorterTxn & {
  treatment: string;
  category_key: string | null;
  exclude_reason: string | null;
  matched_transaction_id: string | null;
  classified_by: string | null;
  rule_id: string | null;
  sorter_version: string | null;
  review: boolean | null;
};

const TXN_COLS = "transaction_id, account_row_id, pending, pending_transaction_id, txn_date, authorized_date, amount, name, " +
  "merchant_name, merchant_entity_id, counterparty_name, counterparty_type, payment_channel, pfc_primary, pfc_detailed, " +
  "pfc_confidence, treatment, category_key, exclude_reason, matched_transaction_id, classified_by, rule_id, sorter_version, review";

/** Reads every row of the owner's transactions, in transaction_id order, with keyset paging (no gaps). */
async function readAllTransactions(admin: Admin, ownerId: string): Promise<StoredTxn[]> {
  const out: StoredTxn[] = [];
  let after: string | null = null;
  for (;;) {
    let q = admin.from("plaid_transactions").select(TXN_COLS).eq("owner_id", ownerId).order("transaction_id").limit(READ_CHUNK);
    if (after !== null) q = q.gt("transaction_id", after);
    const { data, error } = await q;
    if (error) throw new Error(`plaid_transactions read failed: ${error.message}`);
    const rows = (data ?? []) as StoredTxn[];
    out.push(...rows);
    if (rows.length < READ_CHUNK) return out;
    after = rows[rows.length - 1].transaction_id;
  }
}

async function classifyOnce(admin: Admin, ownerId: string): Promise<number> {
  // Independent reads, side by side (an owner's tap waits on this sort).
  const [{ data: accounts, error: aErr }, { data: rules, error: rErr }, { data: settings }, { data: cats }, txns] = await Promise.all([
    admin.from("plaid_accounts").select("id, type, subtype, is_business, include_from").eq("owner_id", ownerId),
    admin.from("pulse_rules").select("id, rule_type, match_kind, match_value, account_row_id, category_key")
      .eq("owner_id", ownerId).eq("active", true),
    admin.from("pulse_settings").select("card_payment_window_days, transfer_window_days").eq("owner_id", ownerId).maybeSingle(),
    admin.from("pulse_categories").select("key").eq("owner_id", ownerId).eq("active", true),
    readAllTransactions(admin, ownerId),
  ]);
  if (aErr) throw new Error(`plaid_accounts read failed: ${aErr.message}`);
  if (rErr) throw new Error(`pulse_rules read failed: ${rErr.message}`);
  if (txns.length === 0) return 0;

  const keys = (cats ?? []).map((c: { key: string }) => c.key);
  const results = classifyAll(
    (accounts ?? []) as SorterAccount[],
    txns.map((t) => ({ ...t, amount: Number(t.amount) })),
    (rules ?? []) as SorterRule[],
    {
      card_payment_window_days: settings?.card_payment_window_days ?? 5,
      transfer_window_days: settings?.transfer_window_days ?? 5,
    },
    keys.length > 0 ? keys : undefined,
  );

  const byId = new Map(txns.map((t) => [t.transaction_id, t]));
  const changed = results.filter((c) => {
    const t = byId.get(c.transaction_id);
    return !t || t.treatment !== c.treatment || t.category_key !== c.category_key || t.exclude_reason !== c.exclude_reason ||
      t.matched_transaction_id !== c.matched_transaction_id || t.classified_by !== c.classified_by ||
      t.rule_id !== c.rule_id || t.sorter_version !== SORTER_VERSION || (t.review === true) !== (c.review === true);
  }).map((c) => ({
    transaction_id: c.transaction_id,
    treatment: c.treatment,
    category_key: c.category_key,
    exclude_reason: c.exclude_reason,
    matched_transaction_id: c.matched_transaction_id,
    classified_by: c.classified_by,
    rule_id: c.rule_id,
    sorter_version: c.sorter_version,
    // M5: "counted, but check it" (a transfer to an account that is not linked).
    review: c.review === true,
  }));

  let written = 0;
  for (let i = 0; i < changed.length; i += WRITE_CHUNK) {
    const { data, error } = await admin.rpc("pulse_apply_classifications", {
      p_owner: ownerId, p_rows: changed.slice(i, i + WRITE_CHUNK),
    });
    if (error) throw new Error(`classification write failed: ${error.message}`);
    written += Number(data ?? 0);
  }
  return written;
}

/**
 * Sorts all of a company's transactions again and writes back only what changed, one sort per
 * company at a time. When a sort is already running this returns 0 and that sort runs once more.
 * Returns how many rows changed.
 */
export async function classifyOwnerResult(admin: Admin, ownerId: string): Promise<{ changed: number; deferred: boolean }> {
  const claim = await admin.rpc("pulse_claim_classify", { p_owner: ownerId, p_seconds: CLASSIFY_LOCK_SECONDS });
  if (claim.error) throw new Error(`classify lock failed: ${claim.error.message}`);
  // The lock's expiry time is this sort's token; none means another sort holds it and will sort again.
  let token: string | null = typeof claim.data === "string" ? claim.data : null;
  if (!token) return { changed: 0, deferred: true };
  let total = 0;
  try {
    for (let round = 0; round < 4 && token; round++) {
      total += await classifyOnce(admin, ownerId);
      const released = await admin.rpc("pulse_release_classify", { p_owner: ownerId, p_token: token, p_drop_request: false });
      if (released.error) throw new Error(`classify release failed: ${released.error.message}`);
      if (released.data === true) {
        token = null;
        break;
      }
      // Another sort was asked for while this one ran: take the request and sort again. If this sort's
      // lock ran out and another sort holds it now, that one sorts (no token comes back).
      const renewed: { data: unknown; error: { message: string } | null } =
        await admin.rpc("pulse_take_classify_request", { p_owner: ownerId, p_token: token, p_seconds: CLASSIFY_LOCK_SECONDS });
      if (renewed.error) throw new Error(`classify renew failed: ${renewed.error.message}`);
      token = typeof renewed.data === "string" ? renewed.data : null;
    }
  } finally {
    // Still holding the lock (an error, or four rounds): leave it free and drop the pending request
    // (the next sync sorts again anyway). Only this sort's own lock is ever touched.
    if (token) await admin.rpc("pulse_release_classify", { p_owner: ownerId, p_token: token, p_drop_request: true });
  }
  if (total > 0) await markDirty(admin, ownerId);
  return { changed: total, deferred: false };
}

/** Sorts the company again; returns how many rows changed (0 when another sort held the lock: it sorts once more). */
export async function classifyOwner(admin: Admin, ownerId: string): Promise<number> {
  return (await classifyOwnerResult(admin, ownerId)).changed;
}
