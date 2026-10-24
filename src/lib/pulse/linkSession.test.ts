// The Plaid Link session kept for a bank's sign-in return (OAuth). A bank that signs in through its own phone app
// can send the owner back in a new browser tab, so the session lives in localStorage for 30 minutes.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { LINK_SESSION_MAX_AGE_MS, LINK_TOKEN_STORAGE_KEY, clearLinkSession, readLinkSession, saveLinkSession } from "./api";

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
const ctx = { mode: "update" as const, itemRowId: "item-1", accountSelection: true };

describe("Plaid Link session for a bank's sign-in return", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("is found again from another tab (localStorage), within 30 minutes", () => {
    saveLinkSession("link-token-1", ctx, T0);
    expect(localStorage.getItem(LINK_TOKEN_STORAGE_KEY)).toBe("link-token-1");
    expect(readLinkSession(T0 + LINK_SESSION_MAX_AGE_MS)).toEqual({ token: "link-token-1", context: ctx });
  });

  it("is dropped after 30 minutes", () => {
    saveLinkSession("link-token-1", ctx, T0);
    expect(readLinkSession(T0 + LINK_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(LINK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("a session saved by the older code (this tab only) is still read", () => {
    sessionStorage.setItem(LINK_TOKEN_STORAGE_KEY, "old-token");
    sessionStorage.setItem("pulse_link_context", JSON.stringify({ mode: "new", itemRowId: null, accountSelection: false }));
    expect(readLinkSession(T0)).toEqual({ token: "old-token", context: { mode: "new", itemRowId: null, accountSelection: false } });
  });

  it("an update session without its bank is refused, as before", () => {
    saveLinkSession("link-token-2", { mode: "update", itemRowId: null, accountSelection: false }, T0);
    expect(readLinkSession(T0)).toBeNull();
  });

  it("clearing removes it from both places", () => {
    saveLinkSession("link-token-1", ctx, T0);
    sessionStorage.setItem(LINK_TOKEN_STORAGE_KEY, "old-token");
    clearLinkSession();
    expect(localStorage.getItem(LINK_TOKEN_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY)).toBeNull();
    expect(readLinkSession(T0)).toBeNull();
  });
});
