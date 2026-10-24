// Home's Pulse card (engine-6): each state, its link and the change colours. Rendered with React's own renderer
// in jsdom (no extra test library). Synthetic numbers only.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HomeSummary, WindowSummary } from "../../../../supabase/functions/_shared/pulse/engine";
import { BAD_TEXT, GOOD_TEXT } from "../tone";
import { changeTone, homeStateOf, type PulseHomeState } from "./homeState";
import { PulseHomeCardView } from "./PulseHomeCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-20T17:00:00Z");

const win = (key: "MTD" | "PMTD", from: string, to: string, revenue: number, cost: number, over: Partial<WindowSummary> = {}): WindowSummary => ({
  key, from, to, revenue, revenue_count: 1, cost, cost_count: 1, profit: revenue - cost, has_data: true,
  partial: false, partial_from: null, partial_label: null, ...over,
});

function summary(over: Partial<HomeSummary> = {}, month: Partial<NonNullable<HomeSummary["month"]>> = {}): HomeSummary {
  return {
    engine_version: "engine-6",
    today: "2026-10-20",
    month: {
      current: win("MTD", "2026-10-01", "2026-10-20", 30000, 18000),
      previous: win("PMTD", "2026-09-01", "2026-09-20", 25000, 20000),
      revenue: { amount: 5000, percent: 20 },
      cost: { amount: -2000, percent: -10 },
      profit: { amount: 7000, percent: 140 },
      comparable: true,
      ...month,
    },
    revenue_basis: "payments",
    updated_at: "2026-10-20T15:00:00Z",
    arriving: false,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const show = (state: PulseHomeState) =>
  act(() => root.render(<MemoryRouter><PulseHomeCardView state={state} /></MemoryRouter>));
const text = () => host.textContent ?? "";
const link = () => host.querySelector("a");
const coloured = (cls: string) => [...host.querySelectorAll("span, p")].filter((e) => e.className.split(" ").includes(cls));

describe("PulseHomeCardView", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("not switched on: the Set up prompt, as before", () => {
    show({ kind: "not_allowed" });
    expect(text()).toContain("Connect bank + Jobber");
    expect(link()?.getAttribute("href")).toBe("/dashboard/pulse");
    expect(link()?.textContent).toContain("Set up");
  });

  it("setup not finished, loading, couldn't load, still arriving and no numbers each say so", () => {
    const cases: Array<[PulseHomeState, string, string]> = [
      [{ kind: "setup" }, "Finish setting up Pulse", "Finish setup"],
      [{ kind: "loading" }, "Loading", "Open Pulse"],
      [{ kind: "error" }, "Couldn’t load your numbers here", "Open Pulse"],
      [{ kind: "arriving" }, "still coming in", "Open Pulse"],
      [{ kind: "empty" }, "No numbers yet this month", "Open Pulse"],
    ];
    for (const [state, words, button] of cases) {
      show(state);
      expect(text(), state.kind).toContain(words);
      expect(link()?.textContent, state.kind).toContain(button);
      expect(link()?.getAttribute("href")).toBe("/dashboard/pulse");
    }
  });

  it("numbers: profit as the headline, sales and costs with their changes, the dates and the update time", () => {
    show({ kind: "numbers", summary: summary(), nowMs: NOW });
    expect(text()).toContain("Oct 1 to Oct 20 vs Sep 1 to Sep 20");
    expect(text()).toContain("Profit so far this month");
    expect(text()).toContain("$12,000");
    expect(text()).toContain("up $7,000 (140%) vs the same days last month");
    expect(text()).toContain("Payments received");
    expect(text()).toContain("$30,000");
    expect(text()).toContain("up $5,000 (20%)");
    expect(text()).toContain("Costs");
    expect(text()).toContain("down $2,000 (10%)");
    expect(text()).toContain("Updated 2 hours ago");
    // Sales and profit up and costs down are all good.
    expect(coloured(GOOD_TEXT.split(" ")[0]).length).toBe(5);
  });

  it("a loss says so, and a costs rise shows in the bad colour", () => {
    const s = summary({}, {
      current: win("MTD", "2026-10-01", "2026-10-20", 10000, 14000),
      cost: { amount: 3000, percent: 27.3 },
      profit: { amount: -9000, percent: -180 },
    });
    show({ kind: "numbers", summary: s, nowMs: NOW });
    expect(text()).toContain("Loss so far this month");
    expect(text()).toContain("-$4,000");
    expect(coloured(BAD_TEXT.split(" ")[0]).length).toBe(4);
  });

  it("nothing to compare yet when last month has no numbers", () => {
    show({ kind: "numbers", summary: summary({}, { previous: win("PMTD", "2026-09-01", "2026-09-20", 0, 0, { has_data: false }) }), nowMs: NOW });
    expect(text()).toContain("Nothing to compare with last month yet.");
    expect(text()).not.toContain("vs the same days last month");
    // No change text on the rows either: there's nothing to compare with.
    for (const word of ["up $", "down $"]) expect(text()).not.toContain(word);
  });

  it("a comparison that isn't like for like is grey and called rough", () => {
    const s = summary({}, {
      previous: win("PMTD", "2026-09-01", "2026-09-20", 25000, 20000, { partial: true, partial_from: "2026-09-10" }),
      comparable: false,
    });
    show({ kind: "numbers", summary: s, nowMs: NOW });
    expect(text()).toContain("Rough comparison: some numbers only count from Sep 10.");
    expect(coloured(GOOD_TEXT.split(" ")[0])).toHaveLength(2);
    expect(coloured(BAD_TEXT.split(" ")[0])).toHaveLength(1);
  });
});

describe("homeStateOf and changeTone", () => {
  it("maps each reply to its state", () => {
    expect(homeStateOf({ ok: false, code: "network", error: "x" }, NOW)).toEqual({ kind: "error" });
    expect(homeStateOf({ ok: true, setup_done: false }, NOW)).toEqual({ kind: "setup" });
    expect(homeStateOf({ ok: true, setup_done: true, summary: summary({ arriving: true }), computed_at: "" }, NOW)).toEqual({ kind: "arriving" });
    expect(homeStateOf({ ok: true, setup_done: true, summary: summary({ month: null }), computed_at: "" }, NOW)).toEqual({ kind: "empty" });
    expect(homeStateOf({ ok: true, setup_done: true, summary: summary(), computed_at: "" }, NOW).kind).toBe("numbers");
  });

  it("uses the Pulse screen's colour rule", () => {
    expect(changeTone({ amount: 100, percent: 1 }, false, true)).toBe(GOOD_TEXT);
    expect(changeTone({ amount: -100, percent: -1 }, false, true)).toBe(BAD_TEXT);
    expect(changeTone({ amount: -100, percent: -1 }, true, true)).toBe(GOOD_TEXT);
    expect(changeTone({ amount: 100, percent: 1 }, true, true)).toBe(BAD_TEXT);
    expect(changeTone({ amount: 100, percent: 1 }, false, false)).toBe("text-muted-foreground");
    expect(changeTone({ amount: 0, percent: 0 }, false, true)).toBe("text-muted-foreground");
  });
});
