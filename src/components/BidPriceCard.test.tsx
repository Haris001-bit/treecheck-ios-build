// The AI price next to a crew offer (calibration item, promised in the 2026-10-08 scope): it shows and can be picked
// even when the formula can't price the offer, and website jobs show their own AI estimate.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiMidpoint, BidPriceCard, type QuoteOption } from "./BidPriceCard";
import type { PricingResult } from "@/lib/bidPricing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const picks: [QuoteOption, number][] = [];

const unpriced = { baseSale: null, warnings: ["Add the crew's hours to price this offer."] } as unknown as PricingResult;

function show(props: Partial<Parameters<typeof BidPriceCard>[0]>) {
  act(() => root.render(<BidPriceCard result={unpriced} onPick={(o, v) => picks.push([o, v])} {...props} />));
  return host.textContent ?? "";
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  picks.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the AI price when the formula can't price the offer", () => {
  it("shows the warning, the AI price and the owner's own price, and the AI price can be picked", () => {
    const text = show({ aiMin: 1200, aiMax: 1400 });
    expect(text).toContain("Add the crew's hours to price this offer.");
    expect(text).toContain("Scout AI price");
    expect(text).toContain("$1,300");
    expect(text).toContain("Or type your own price for the homeowner");
    const box = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Scout AI price"))!;
    act(() => box.click());
    expect(picks).toEqual([["ai", 1300]]);
  });

  it("a website job uses its own label; no AI price means no AI box", () => {
    expect(show({ aiMin: 955, aiMax: 1293, aiLabel: "AI estimate" })).toContain("AI estimate");
    expect(show({ aiMin: null, aiMax: null })).not.toContain("Scout AI price");
    expect(show({ aiMin: 0, aiMax: 0 })).not.toContain("Scout AI price");
  });

  it("the pick banner names the option the owner picked", () => {
    const text = show({ aiMin: 1000, aiMax: 1000, aiLabel: "AI estimate",
      pick: { bid_id: "b", option: "ai", amount: 1000, picked_at: "2026-10-22T12:00:00Z", picked_by_name: "Mark" } });
    expect(text).toContain("Mark picked AI estimate");
  });
});

describe("aiMidpoint", () => {
  it("the middle of the range, one end when only one is known, and nothing for zero or missing", () => {
    expect([aiMidpoint(1000, 1400), aiMidpoint(null, 900), aiMidpoint(800, null), aiMidpoint(0, 0), aiMidpoint(null, null)])
      .toEqual([1200, 900, 800, null, null]);
  });
});
