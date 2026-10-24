// Financial Pulse: the Sandbox test tool only accepts known actions and only ever touches the caller's
// own Sandbox test banks (never a real bank).
import { describe, expect, it } from "vitest";
import { parseSandboxRequest, SANDBOX_WEBHOOKS, sandboxRefusal } from "../../../supabase/functions/_shared/pulse/sandboxTools";

const ID = "0b5c1e1a-2f3d-4c5e-8a9b-0c1d2e3f4a5b";

describe("parseSandboxRequest", () => {
  it("accepts reset_login", () => {
    expect(parseSandboxRequest({ action: "reset_login", item_row_id: ID })).toEqual({ action: "reset_login", itemRowId: ID });
  });

  it("accepts the allowed webhooks with their type", () => {
    expect(parseSandboxRequest({ action: "fire_webhook", item_row_id: ID, webhook_code: "new_accounts_available" }))
      .toEqual({ action: "fire_webhook", itemRowId: ID, webhookType: "ITEM", webhookCode: "NEW_ACCOUNTS_AVAILABLE" });
    expect(parseSandboxRequest({ action: "fire_webhook", item_row_id: ID, webhook_code: "SYNC_UPDATES_AVAILABLE" }))
      .toMatchObject({ webhookType: "TRANSACTIONS" });
    for (const code of Object.keys(SANDBOX_WEBHOOKS)) {
      expect(parseSandboxRequest({ action: "fire_webhook", item_row_id: ID, webhook_code: code })).not.toBeNull();
    }
  });

  it("refuses anything else", () => {
    expect(parseSandboxRequest({ action: "fire_webhook", item_row_id: ID, webhook_code: "toString" })).toBeNull();
    expect(parseSandboxRequest({ action: "fire_webhook", item_row_id: ID, webhook_code: "PRODUCT_READY" })).toBeNull();
    expect(parseSandboxRequest({ action: "fire_webhook", item_row_id: ID })).toBeNull();
    expect(parseSandboxRequest({ action: "remove", item_row_id: ID })).toBeNull();
    expect(parseSandboxRequest({ action: "reset_login", item_row_id: "not-an-id" })).toBeNull();
    expect(parseSandboxRequest({ action: "reset_login" })).toBeNull();
  });
});

describe("sandboxRefusal", () => {
  const ok = { owner_id: "owner-a", plaid_env: "sandbox", status: "active", removed_at: null };

  it("lets an owner's own Sandbox bank through, in any state but removed", () => {
    expect(sandboxRefusal("owner-a", "sandbox", ok)).toBeNull();
    expect(sandboxRefusal("owner-a", "sandbox", { ...ok, status: "login_required" })).toBeNull();
  });

  it("never touches a real bank, or any bank of a company on real banks", () => {
    expect(sandboxRefusal("owner-a", "sandbox", { ...ok, plaid_env: "production" })).toBe("sandbox_only");
    expect(sandboxRefusal("owner-a", "production", ok)).toBe("sandbox_only");
    expect(sandboxRefusal("owner-a", undefined, ok)).toBe("sandbox_only");
  });

  it("never touches another company's bank, or a removed one", () => {
    expect(sandboxRefusal("owner-b", "sandbox", ok)).toBe("not_found");
    expect(sandboxRefusal("owner-a", "sandbox", null)).toBe("not_found");
    expect(sandboxRefusal("owner-a", "sandbox", { ...ok, status: "removed" })).toBe("not_found");
    expect(sandboxRefusal("owner-a", "sandbox", { ...ok, removed_at: "2026-10-02T00:00:00Z" })).toBe("not_found");
  });
});
