// Two-step sign-in window before bank linking, with Supabase Auth's MFA calls mocked. Rendered with
// React's own renderer in jsdom (no extra test library).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mfa = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { mfa } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  NOT_AVAILABLE_MESSAGE,
  SETUP_EXPIRED_NOTE,
  START_FAILED_MESSAGE,
  WRONG_CODE_MESSAGE,
  qrImageSource,
  resetTwoStepForTests,
  useTwoStep,
} from "./TwoStepDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let mounted = false;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="#000"/></svg>';
const verifiedFactor = { id: "f-verified", factor_type: "totp", status: "verified" };
const enrolled = (id: string, secret = "ABCDEFGHIJKLMNOP") => ({
  data: {
    id,
    type: "totp",
    totp: { qr_code: `data:image/svg+xml;utf-8,${SVG}`, secret, uri: `otpauth://totp/TreeCheck:o%40x.com?secret=${secret}&issuer=TreeCheck` },
  },
  error: null,
});

// The window opens in a portal on document.body.
const page = () => document.body.textContent ?? "";
const button = (label: string) => {
  const found = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`No "${label}" button on: ${page()}`);
  return found;
};
const codeBox = () => {
  const found = document.getElementById("pulse-two-step-code") as HTMLInputElement | null;
  if (!found) throw new Error(`No code box on: ${page()}`);
  return found;
};
const dialogOpen = () => document.body.querySelector('[role="dialog"]') !== null;

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

async function click(el: HTMLElement) {
  await act(async () => el.click());
}

async function typeCode(value: string) {
  const box = codeBox();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { ensure, dialog } = useTwoStep();
  return (
    <>
      <button type="button" onClick={() => void ensure().then(onResult)}>go</button>
      <button type="button" onClick={() => void ensure({ force: true }).then(onResult)}>force</button>
      {dialog}
    </>
  );
}

async function show(onResult: (ok: boolean) => void = vi.fn()) {
  await act(async () => root.render(<Harness onResult={onResult} />));
  return onResult;
}

beforeEach(() => {
  resetTwoStepForTests();
  for (const fn of Object.values(mfa)) fn.mockReset();
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
  mfa.unenroll.mockResolvedValue({ data: {}, error: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
});

describe("useTwoStep", () => {
  it("goes straight on when the session already has two-step sign-in", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    const onResult = await show(vi.fn());
    await click(button("go"));
    await until(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(mfa.listFactors).not.toHaveBeenCalled();
    expect(dialogOpen()).toBe(false);
  });

  it("asks for the code when an authenticator is set up", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const onResult = await show(vi.fn());
    await click(button("go"));
    await until(() => expect(page()).toContain("Enter your code"));
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(page()).toContain("Lost your phone?");

    expect(button("Continue")).toBeDisabled();
    await typeCode("123 456");
    expect(codeBox()).toHaveValue("123456");
    await click(button("Continue"));

    await until(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f-verified", code: "123456" });
    await until(() => expect(dialogOpen()).toBe(false));
  });

  it("keeps the window open after a wrong code", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null });
    mfa.challengeAndVerify
      .mockResolvedValueOnce({ data: null, error: { code: "mfa_verification_failed", status: 422 } })
      .mockResolvedValueOnce({ data: {}, error: null });
    const onResult = await show(vi.fn());
    await click(button("go"));
    await until(() => expect(page()).toContain("Enter your code"));

    await typeCode("111111");
    await click(button("Continue"));
    await until(() => expect(page()).toContain(WRONG_CODE_MESSAGE));
    expect(codeBox()).toHaveValue("");
    expect(onResult).not.toHaveBeenCalled();

    await typeCode("222222");
    await click(button("Continue"));
    await until(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("sets up an authenticator the first time, clearing an unfinished setup first", async () => {
    const stale = { id: "f-stale", factor_type: "totp", status: "unverified" };
    mfa.listFactors.mockResolvedValue({ data: { all: [stale], totp: [] }, error: null });
    mfa.enroll.mockResolvedValue(enrolled("f-new"));
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const onResult = await show(vi.fn());
    await click(button("go"));

    await until(() => expect(page()).toContain("Turn on two-step sign-in"));
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "f-stale" });
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: "totp", issuer: "TreeCheck" }));
    const qr = document.body.querySelector('img[alt="QR code for your authenticator app"]');
    expect(qr).toHaveAttribute("src", qrImageSource(`data:image/svg+xml;utf-8,${SVG}`));
    expect(page()).toContain("ABCD EFGH IJKL MNOP");
    expect(page()).not.toContain(SETUP_EXPIRED_NOTE);
    expect(page()).not.toContain("Lost your phone?");

    await typeCode("654321");
    await click(button("Turn on and continue"));
    await until(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f-new", code: "654321" });
  });

  it("closing the window answers false, and reopening shows the same setup", async () => {
    mfa.listFactors.mockResolvedValueOnce({ data: { all: [], totp: [] }, error: null });
    mfa.enroll.mockResolvedValue(enrolled("f-new"));
    const onResult = await show(vi.fn());
    await click(button("go"));
    await until(() => expect(page()).toContain("Turn on two-step sign-in"));

    await click(button("Cancel"));
    await until(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(mfa.unenroll).not.toHaveBeenCalled();

    mfa.listFactors.mockResolvedValueOnce({
      data: { all: [{ id: "f-new", factor_type: "totp", status: "unverified" }], totp: [] },
      error: null,
    });
    await click(button("go"));
    await until(() => expect(page()).toContain("ABCD EFGH IJKL MNOP"));
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it("starts a new setup, with a note, when the earlier one is gone", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    mfa.enroll.mockResolvedValueOnce(enrolled("f-1", "AAAABBBBCCCCDDDD")).mockResolvedValueOnce(enrolled("f-2", "EEEEFFFFGGGGHHHH"));
    mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { code: "mfa_factor_not_found", status: 404 } });
    await show();
    await click(button("go"));
    await until(() => expect(page()).toContain("AAAA BBBB CCCC DDDD"));

    await typeCode("123456");
    await click(button("Turn on and continue"));
    await until(() => expect(page()).toContain("EEEE FFFF GGGG HHHH"));
    expect(page()).toContain(SETUP_EXPIRED_NOTE);
    expect(mfa.enroll).toHaveBeenCalledTimes(2);
  });

  it("shows a retry when two-step sign-in can't start", async () => {
    mfa.listFactors
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null });
    await show();
    await click(button("go"));
    await until(() => expect(page()).toContain(START_FAILED_MESSAGE));
    await click(button("Try again"));
    await until(() => expect(page()).toContain("Enter your code"));
  });

  it("says so when the project has authenticator apps switched off", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    mfa.enroll.mockResolvedValue({ data: null, error: { code: "mfa_totp_enroll_not_enabled", status: 422 } });
    await show();
    await click(button("go"));
    await until(() => expect(page()).toContain(NOT_AVAILABLE_MESSAGE));
  });

  it("asks again when forced, even if the session looks finished", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null });
    await show();
    await click(button("force"));
    await until(() => expect(page()).toContain("Enter your code"));
  });

  it("answers false when the button goes away while asking", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null });
    const onResult = await show(vi.fn());
    await click(button("go"));
    await until(() => expect(page()).toContain("Enter your code"));
    act(() => root.unmount());
    mounted = false;
    await until(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});

describe("qrImageSource", () => {
  it("encodes the SVG so characters like # are safe", () => {
    const src = qrImageSource(`data:image/svg+xml;utf-8,${SVG}`);
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(src).not.toContain("#");
    expect(decodeURIComponent(src.slice("data:image/svg+xml;charset=utf-8,".length))).toBe(SVG);
  });
});
