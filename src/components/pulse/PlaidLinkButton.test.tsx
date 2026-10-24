// The bank button asks for two-step sign-in before Plaid Link, with the Pulse calls, Plaid's script and
// the two-step window mocked. Rendered with React's own renderer in jsdom (no extra test library).
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  linkToken: vi.fn(),
  exchange: vi.fn(),
  sync: vi.fn(),
  saveLinkSession: vi.fn(),
  clearLinkSession: vi.fn(),
}));
const ensure = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/pulse/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pulse/api")>()),
  ...api,
}));
vi.mock("./TwoStepDialog", () => ({ useTwoStep: () => ({ ensure, dialog: null }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import PlaidLinkButton, { type PlaidLinkButtonProps } from "./PlaidLinkButton";
import { CONSENT_VERSION } from "@/lib/pulse/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

interface Config {
  token: string;
  onSuccess: (publicToken: string, metadata: unknown) => void;
}
let lastConfig: Config | null = null;
const handler = { open: vi.fn(), exit: vi.fn(), destroy: vi.fn() };
const create = vi.fn((config: Config) => {
  lastConfig = config;
  return handler;
});

const MFA_REFUSAL = { ok: false, code: "mfa_required", error: "Two-step sign-in is needed to link a bank." };
const METADATA = {
  institution: { institution_id: "ins_1", name: "First Bank" },
  accounts: [{ id: "acc_1", name: "Checking", mask: "1234", type: "depository", subtype: "checking" }],
  link_session_id: "ls_1",
};

const theButton = () => {
  const found = host.querySelector("button");
  if (!found) throw new Error(`No button on: ${host.innerHTML}`);
  return found;
};

async function until(check: () => void, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function show(el: ReactElement) {
  await act(async () => root.render(el));
}

async function showNew(props: Partial<PlaidLinkButtonProps> = {}) {
  const onLinked = vi.fn();
  const onFailure = vi.fn();
  await show(<PlaidLinkButton mode="new" label="Link your bank" onLinked={onLinked} onFailure={onFailure} {...props} />);
  return { onLinked, onFailure };
}

async function press() {
  await act(async () => theButton().click());
}

async function plaidSucceeds() {
  await act(async () => lastConfig?.onSuccess("public-1", METADATA));
}

beforeEach(() => {
  lastConfig = null;
  for (const fn of [...Object.values(api), ensure, create, handler.open, handler.exit, handler.destroy]) fn.mockReset();
  create.mockImplementation((config: Config) => {
    lastConfig = config;
    return handler;
  });
  (window as unknown as { Plaid?: unknown }).Plaid = { create };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { Plaid?: unknown }).Plaid;
});

describe("PlaidLinkButton two-step sign-in", () => {
  it("asks for two-step sign-in, then opens Plaid and saves the bank", async () => {
    ensure.mockResolvedValue(true);
    api.linkToken.mockResolvedValue({ ok: true, link_token: "link-1", expiration: "" });
    api.exchange.mockResolvedValue({ ok: true, item_row_id: "item-1", accounts: 1 });
    const { onLinked, onFailure } = await showNew();

    await press();
    await until(() => expect(handler.open).toHaveBeenCalled());
    expect(ensure).toHaveBeenCalledWith();
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(api.linkToken.mock.invocationCallOrder[0]);
    expect(api.linkToken).toHaveBeenCalledWith({ mode: "new" });
    expect(lastConfig?.token).toBe("link-1");

    await plaidSucceeds();
    await until(() => expect(onLinked).toHaveBeenCalledWith({ mode: "new", itemRowId: "item-1", accounts: 1 }));
    expect(api.exchange).toHaveBeenCalledWith(expect.objectContaining({ public_token: "public-1", consent_version: CONSENT_VERSION }));
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("stops quietly when the owner closes the two-step window", async () => {
    ensure.mockResolvedValue(false);
    const { onFailure } = await showNew();
    await press();
    await until(() => expect(theButton().textContent).toBe("Link your bank"));
    expect(theButton()).toBeEnabled();
    expect(ensure).toHaveBeenCalled();
    expect(api.linkToken).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("asks again and retries once when the server refuses the link token", async () => {
    ensure.mockResolvedValue(true);
    api.linkToken.mockResolvedValueOnce(MFA_REFUSAL).mockResolvedValueOnce({ ok: true, link_token: "link-2", expiration: "" });
    const { onFailure } = await showNew();
    await press();
    await until(() => expect(handler.open).toHaveBeenCalled());
    expect(ensure).toHaveBeenNthCalledWith(2, { force: true });
    expect(api.linkToken).toHaveBeenCalledTimes(2);
    expect(lastConfig?.token).toBe("link-2");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("doesn't retry when the owner closes the window after a server refusal", async () => {
    ensure.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    api.linkToken.mockResolvedValue(MFA_REFUSAL);
    const { onFailure } = await showNew();
    await press();
    await until(() => expect(ensure).toHaveBeenCalledTimes(2));
    await until(() => expect(theButton().textContent).toBe("Link your bank"));
    expect(api.linkToken).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("asks for the code and saves the same bank when the save is refused", async () => {
    ensure.mockResolvedValue(true);
    api.linkToken.mockResolvedValue({ ok: true, link_token: "link-1", expiration: "" });
    api.exchange.mockResolvedValueOnce(MFA_REFUSAL).mockResolvedValueOnce({ ok: true, item_row_id: "item-1", accounts: 1 });
    const { onLinked } = await showNew();
    await press();
    await until(() => expect(handler.open).toHaveBeenCalled());
    await plaidSucceeds();
    await until(() => expect(onLinked).toHaveBeenCalled());
    expect(ensure).toHaveBeenLastCalledWith({ force: true });
    expect(api.exchange).toHaveBeenCalledTimes(2);
    expect(api.exchange.mock.calls[1][0]).toEqual(api.exchange.mock.calls[0][0]);
  });

  it("reports the refusal when the owner closes the window at the save", async () => {
    ensure.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    api.linkToken.mockResolvedValue({ ok: true, link_token: "link-1", expiration: "" });
    api.exchange.mockResolvedValue(MFA_REFUSAL);
    const { onLinked, onFailure } = await showNew();
    await press();
    await until(() => expect(handler.open).toHaveBeenCalled());
    await plaidSucceeds();
    await until(() => expect(onFailure).toHaveBeenCalledWith(MFA_REFUSAL));
    expect(api.exchange).toHaveBeenCalledTimes(1);
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("asks before Reconnect and Add accounts too", async () => {
    ensure.mockResolvedValue(true);
    api.linkToken.mockResolvedValue({ ok: true, link_token: "link-u", expiration: "" });
    await show(<PlaidLinkButton mode="update" itemRowId="item-9" accountSelection label="Add accounts" onLinked={vi.fn()} onFailure={vi.fn()} />);
    await press();
    await until(() => expect(handler.open).toHaveBeenCalled());
    expect(ensure).toHaveBeenCalled();
    expect(api.linkToken).toHaveBeenCalledWith({ mode: "update", item_row_id: "item-9", account_selection: true });
  });

  it("the OAuth return reopens Link with its stored token without asking again", async () => {
    await showNew({ resumeToken: "link-stored", receivedRedirectUri: "https://app.treecheck.ai/dashboard/pulse/oauth-return?oauth_state_id=x" });
    await until(() => expect(handler.open).toHaveBeenCalled());
    expect(lastConfig?.token).toBe("link-stored");
    expect(ensure).not.toHaveBeenCalled();
    expect(api.linkToken).not.toHaveBeenCalled();
  });
});
