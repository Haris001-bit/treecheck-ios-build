// The notice the phone apps show for the parts of Financial Pulse that stay on the website. Rendered with
// React's own renderer in jsdom (no extra test library).
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ getWebBaseUrl: () => "https://app.example.test" }));

import NativeLinkNotice, { PulseSetupOnWebsite } from "./NativeLinkNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const show = (el: ReactElement, at = "/") =>
  act(() => root.render(<MemoryRouter key={at} initialEntries={[at]}>{el}</MemoryRouter>));
const text = () => host.textContent ?? "";
const button = (label: RegExp) => [...host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""));
const link = () => [...host.querySelectorAll("a")].find((a) => /Open the website/.test(a.textContent ?? ""));
const click = (el: Element | undefined) => act(() => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

describe("NativeLinkNotice (the parts of Financial Pulse that stay on the website)", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("setup: setup happens on the website, easiest on a computer; the numbers then show in the app", () => {
    show(<NativeLinkNotice reason="setup" />);
    expect(text()).toContain("Set up Financial Pulse on the website");
    expect(text()).toContain("It's easiest on a computer.");
    expect(text()).toContain("your numbers show here in the app too");
    expect(text()).toContain("app.example.test");
    expect(text()).toContain("sign in with your TreeCheck email and password");
  });

  it("manage: never says the numbers are fine when the owner came to fix them", () => {
    show(<NativeLinkNotice reason="manage" />);
    expect(text()).toContain("This part is on the website");
    expect(text()).toContain("Once you've done it there, your numbers here update by themselves.");
    expect(text()).not.toContain("keep updating on their own");
  });

  it("Open the website is a plain link in a new window: the app hands it to the phone's own browser", () => {
    show(<NativeLinkNotice reason="setup" />);
    expect(link()?.getAttribute("href")).toBe("https://app.example.test/dashboard/pulse/setup");
    expect(link()?.getAttribute("target")).toBe("_blank");
  });

  it("the website opens at the part the owner asked for", () => {
    show(<NativeLinkNotice reason="manage" section="banks" />);
    expect(link()?.getAttribute("href")).toBe("https://app.example.test/dashboard/pulse/setup?section=banks");
  });

  it("Back and check again do what they say; neither shows unless given", () => {
    const back = vi.fn();
    const again = vi.fn();
    show(<NativeLinkNotice reason="setup" onBack={back} onCheckAgain={again} />);
    click(button(/Back to Financial Pulse/));
    click(button(/check again/));
    expect(back).toHaveBeenCalledTimes(1);
    expect(again).toHaveBeenCalledTimes(1);
    show(<NativeLinkNotice reason="setup" />);
    expect(button(/Back to Financial Pulse/)).toBeUndefined();
    expect(button(/check again/)).toBeUndefined();
  });

  it("the app's setup page carries ?section into the website link, and only a known section", () => {
    show(<Routes><Route path="/dashboard/pulse/setup" element={<PulseSetupOnWebsite />} /></Routes>, "/dashboard/pulse/setup?section=jobber");
    expect(link()?.getAttribute("href")).toBe("https://app.example.test/dashboard/pulse/setup?section=jobber");
    show(<Routes><Route path="/dashboard/pulse/setup" element={<PulseSetupOnWebsite />} /></Routes>, "/dashboard/pulse/setup?section=evil%22");
    expect(link()?.getAttribute("href")).toBe("https://app.example.test/dashboard/pulse/setup");
  });
});
