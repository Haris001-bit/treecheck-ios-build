// Financial Pulse: which stored accounts a bank still shares (A7). Server-side only.
// Kept apart from plaidSync.ts so it can be unit-tested without Deno.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Accounts the bank no longer shares (the owner unticked them in Plaid's window, or the account
 * closed) are marked closed: they stop counting as payroll money (pulse-get counts only active
 * accounts) and their not-yet-cleared charges are removed (they will never clear here). An account
 * that is shared again is open again with the owner's choices as they were. Rows already stored stay:
 * they are the business's history (switching the account to Not business deletes them). An empty reply
 * never closes anything. A 'revoked' account (Plaid's USER_ACCOUNT_REVOKED) is left to the webhook.
 * Returns whether any account changed.
 */
export async function reconcileAccounts(admin: Admin, ownerId: string, itemRowId: string, shared: Set<string>): Promise<boolean> {
  if (shared.size === 0) return false;
  const { data, error } = await admin.from("plaid_accounts")
    .select("id, account_id, status").eq("owner_id", ownerId).eq("item_row_id", itemRowId);
  if (error) throw new Error(`plaid_accounts read failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; account_id: string; status: string }>;
  const close = rows.filter((r) => r.status === "active" && !shared.has(r.account_id)).map((r) => r.id);
  const reopen = rows.filter((r) => r.status === "closed" && shared.has(r.account_id)).map((r) => r.id);
  if (close.length > 0) {
    const { error: cErr } = await admin.from("plaid_accounts")
      .update({ status: "closed" }).eq("owner_id", ownerId).in("id", close);
    if (cErr) throw new Error(`plaid_accounts close failed: ${cErr.message}`);
    const { error: pErr } = await admin.from("plaid_transactions")
      .delete().eq("owner_id", ownerId).in("account_row_id", close).eq("pending", true);
    if (pErr) throw new Error(`pending rows cleanup failed: ${pErr.message}`);
  }
  if (reopen.length > 0) {
    const { error: oErr } = await admin.from("plaid_accounts")
      .update({ status: "active" }).eq("owner_id", ownerId).in("id", reopen);
    if (oErr) throw new Error(`plaid_accounts reopen failed: ${oErr.message}`);
  }
  return close.length + reopen.length > 0;
}
