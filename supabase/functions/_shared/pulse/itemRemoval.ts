// Financial Pulse: closes a company's bank connections at Plaid before its TreeCheck account is deleted
// (W2-07, A7 "Deletion").
// Deleting the account deletes the bank records and their stored keys (cascade from profiles), so a
// connection left open at Plaid then could never be closed. Plaid /item/remove runs first for every live
// connection; the slot ledger keeps each one (it still counts against the free Trial) and is stamped
// removed. A connection Plaid can't be reached for stops the deletion so the owner can try again.

import { loadItem, PlaidApiError, plaidPost } from "../plaid.ts";
import { removalVerdict } from "./plaidMap.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface BankRemoval {
  itemRowId: string;
  outcome: "removed" | "already_gone" | "unreadable" | "failed";
}

/** Removes every live bank connection of this owner at Plaid. Returns one result per connection. */
export async function disconnectOwnerBanks(admin: Admin, ownerId: string): Promise<BankRemoval[]> {
  const { data: items, error } = await admin.from("plaid_items")
    .select("id, item_id, status").eq("owner_id", ownerId).neq("status", "removed");
  if (error) throw new Error(`plaid_items read failed: ${error.message}`);
  const results: BankRemoval[] = [];
  for (const item of (items ?? []) as Array<{ id: string; item_id: string }>) {
    let outcome: BankRemoval["outcome"] = "removed";
    try {
      const ctx = await loadItem(admin, item.id);
      await plaidPost(ctx.env, "/item/remove", { access_token: ctx.accessToken, reason_code: "OTHER" });
    } catch (e) {
      const verdict = removalVerdict(e instanceof PlaidApiError ? e.errorCode : null, (e as Error)?.message);
      outcome = verdict === "gone" ? "already_gone" : verdict === "unreadable" ? "unreadable" : "failed";
      // Ids and codes only: never a token.
      console.error("[pulse] bank removal", item.id, outcome, e instanceof PlaidApiError ? e.errorCode : "");
    }
    if (outcome !== "failed") {
      const { error: lErr } = await admin.from("plaid_slot_ledger")
        .update({ removed_at: new Date().toISOString() }).eq("item_id", item.item_id).is("removed_at", null);
      if (lErr) throw new Error(`ledger update failed: ${lErr.message}`);
    }
    results.push({ itemRowId: item.id, outcome });
  }
  return results;
}
