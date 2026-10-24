// Financial Pulse: what the Sandbox test tool (pulse-sandbox) may ask Plaid to do. Server-side only.
// No imports, so it can be unit-tested without Deno.
//
// The tool puts a TEST bank into the states real banks get into (needs login, new accounts, revoked...),
// so the real Reconnect and Add accounts flows can be tested end to end (W2-06, W2-11). Plaid only
// offers these calls in Sandbox; the tool also refuses anything that is not a Sandbox bank of a
// company that is itself on Sandbox and owned by the caller, so it can never touch a real bank.

/** Webhooks the tool may ask Plaid's Sandbox to fire (Plaid's /sandbox/item/fire_webhook list). */
export const SANDBOX_WEBHOOKS: Record<string, "ITEM" | "TRANSACTIONS"> = {
  NEW_ACCOUNTS_AVAILABLE: "ITEM",
  PENDING_DISCONNECT: "ITEM",
  LOGIN_REPAIRED: "ITEM",
  USER_PERMISSION_REVOKED: "ITEM",
  USER_ACCOUNT_REVOKED: "ITEM",
  ERROR: "ITEM",
  SYNC_UPDATES_AVAILABLE: "TRANSACTIONS",
  DEFAULT_UPDATE: "TRANSACTIONS",
};

export type SandboxRequest =
  | { action: "reset_login"; itemRowId: string }
  | { action: "fire_webhook"; itemRowId: string; webhookType: "ITEM" | "TRANSACTIONS"; webhookCode: string };

/** Reads the request body; null when it isn't one of the allowed requests. */
export function parseSandboxRequest(body: Record<string, unknown>): SandboxRequest | null {
  const itemRowId = typeof body.item_row_id === "string" ? body.item_row_id.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(itemRowId)) return null;
  if (body.action === "reset_login") return { action: "reset_login", itemRowId };
  if (body.action === "fire_webhook") {
    const code = typeof body.webhook_code === "string" ? body.webhook_code.toUpperCase() : "";
    if (!Object.prototype.hasOwnProperty.call(SANDBOX_WEBHOOKS, code)) return null;
    return { action: "fire_webhook", itemRowId, webhookType: SANDBOX_WEBHOOKS[code], webhookCode: code };
  }
  return null;
}

/**
 * Why the tool refuses this bank, or null when it may go ahead: the bank must belong to the caller's
 * company, be a Sandbox bank, still be connected, and the company itself must be on Sandbox.
 */
export function sandboxRefusal(
  ownerId: string,
  companyEnv: unknown,
  item: { owner_id?: unknown; plaid_env?: unknown; status?: unknown; removed_at?: unknown } | null,
): string | null {
  if (!item || item.owner_id !== ownerId) return "not_found";
  if (companyEnv !== "sandbox" || item.plaid_env !== "sandbox") return "sandbox_only";
  if (item.status === "removed" || item.removed_at) return "not_found";
  return null;
}
