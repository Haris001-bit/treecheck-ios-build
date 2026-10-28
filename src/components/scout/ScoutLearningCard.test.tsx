// The Scout learning card: who sees what, every report state, undo only for the owner, and no long dashes anywhere.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "owner-1" }, effectiveContractorId: "owner-1" }) }));

import { ScoutLearningView } from "./ScoutLearningCard";
import { factorSentence, gapText, latestRun, missCauseText, overallGap, runTitle, statusLine, type LearningReport, type LearnRun } from "./scoutLearningText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const toggled: boolean[] = [];
const undone: string[] = [];

function show(report: LearningReport) {
  act(() => root.render(
    <ScoutLearningView report={report} saving={false} onToggle={(on) => toggled.push(on)} onUndo={(s) => undone.push(s)} />,
  ));
  return host.textContent ?? "";
}

const run = (over: Partial<LearnRun> = {}): LearnRun => ({
  id: "r1", kind: "initial", week_start: null, status: "rewritten", finished_at: "2026-10-25T15:00:00Z",
  jobs: [
    { ref: "c1", picked_on: "2026-10-13", service: "Tree Removal", city: "Edmond", estimate: 1300, estimate_low: 1300, estimate_high: 1300, picked: 1000, auto: false, gap_pct: 30, size_given: false, older: false },
    { ref: "c2", picked_on: "2026-10-15", service: "Tree Removal", city: "Yukon", estimate: 2400, estimate_low: 2400, estimate_high: 2400, picked: 2000, auto: true, gap_pct: 20, size_given: true, older: false },
  ],
  avg_gap_pct: 25, summary: "Scout ran about 25 percent high on removals.", changes: ["Removals without a trunk size now come out lower."],
  active: true, undone_at: null, ...over,
});
const on = (over: Partial<LearningReport> = {}): LearningReport => ({
  visible: true, is_owner: true, enabled: true, pending_first_run: false,
  scout: {
    active: { run_id: "r1", guidance: { factors: [{ service: "Tree Removal", size: "not_given", factor: 0.8, jobs: 2 }], rules: ["Single removals here usually need one or two disposal loads."] }, since: null },
    can_undo: true, runs: [run()],
  },
  website: null, ...over,
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  toggled.length = 0;
  undone.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("who sees what", () => {
  it("nothing when the report isn't visible (Free plan, reps, subs)", () => {
    expect(show({ visible: false })).toBe("");
  });

  it("off: the owner gets the explanation and the switch; a teammate is told the owner can turn it on", () => {
    const text = show({ visible: true, is_owner: true, enabled: false });
    expect(text).toContain("Every week Scout compares its estimates with the prices you picked in Jobs");
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    act(() => (host.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(toggled).toEqual([true]);
    expect(show({ visible: true, is_owner: false, enabled: false })).toContain("Your company owner can turn this on.");
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });

  it("on, waiting for the first run", () => {
    expect(show(on({ pending_first_run: true, scout: { active: null, can_undo: false, runs: [] } }))).toContain("Learning from your past jobs");
  });
});

describe("the report", () => {
  it("shows the jobs, the average, the summary, what changed and the owner's undo", () => {
    const text = show(on());
    for (const bit of ["From your past jobs", "Scout learned from these jobs", "Tree Removal, Edmond", "Scout $1,300", "Picked $1,000",
      "Scout was 30% high", "auto-picked", "no size given", "Scout was 23% high overall on these jobs.",
      "Scout ran about 25 percent high on removals.", "What changed", "Undo this change"]) {
      expect(text).toContain(bit);
    }
  });

  it("no undo for a teammate, for an undone change, or when the latest run didn't rewrite", () => {
    expect(show(on({ is_owner: false }))).not.toContain("Undo this change");
    expect(show(on({ scout: { ...on().scout!, can_undo: false } }))).not.toContain("Undo this change");
    const kept = show(on({ scout: { active: null, can_undo: false, runs: [run({ status: "no_jobs", jobs: [], avg_gap_pct: null, summary: null, changes: [], active: false })] } }));
    expect(kept).toContain("No new picked jobs that week, so nothing changed.");
    expect(kept).not.toContain("Undo this change");
  });

  it("a failed run says Scout keeps its adjustments", () => {
    expect(show(on({ scout: { ...on().scout!, runs: [run({ status: "failed", active: false, changes: [] })] } })))
      .toContain("Scout keeps its current adjustments and tries again.");
  });

  it("shows the website's report in its own section once it has one", () => {
    const text = show(on({ website: { active: null, can_undo: false, runs: [run({ id: "w1", status: "unchanged", active: false, changes: [] })] } }));
    expect(text).toContain("Scout in the app");
    expect(text).toContain("Your website's price form");
  });

  it("never shows a long dash", () => {
    expect(show(on())).not.toMatch(/[–—]/);
    expect(show({ visible: true, is_owner: true, enabled: false })).not.toMatch(/[–—]/);
  });
});

describe("the report's details (promised in the 2026-10-08 scope)", () => {
  const detailed = () => run({
    jobs: [{ ...run().jobs[0], notes: "OBSERVATIONS: one trunk, 2 loads\nTotal: $1300", has_photo: true, may_include_edit: false, projected: 1100,
      crew: { hours: 5, crew: 1, ground_crew: 2, disposal_loads: 2, mini_skid: true, equipment: null } },
    { ...run().jobs[1], projected: 2100 }],
  });

  it("tapping a job shows its photo, the crew's offer and Scout's own notes, and asks for the photos once", () => {
    let asked = 0;
    act(() => root.render(
      <ScoutLearningView report={on({ scout: { ...on().scout!, runs: [detailed()] } })} saving={false} onToggle={() => {}} onUndo={() => {}}
        photos={{ c1: "https://example.test/photo.jpg" }} onPhotos={() => { asked++; }} />,
    ));
    expect(host.textContent).not.toContain("Crew's offer");
    const row = [...host.querySelectorAll("li button")][0] as HTMLButtonElement;
    act(() => row.click());
    expect(host.textContent).toContain("Crew's offer: 5 hours, crew of 1, 2 on the ground, 2 loads, mini skid");
    expect(host.textContent).toContain("Scout's notes");
    expect(host.textContent).toContain("OBSERVATIONS: one trunk, 2 loads");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://example.test/photo.jpg");
    expect(asked).toBe(1);
  });

  it("a large miss shows why Scout missed first, with the likely cause and how sure it is (Mark, 2026-10-27)", () => {
    const missed = run({ jobs: [{ ...run().jobs[0], large_miss: true, miss: { reason: "No trunk size was given, so Scout judged it from the photo and placed it a size too large.", cause: "size", confidence: "medium" } }, run().jobs[1]] });
    show(on({ scout: { ...on().scout!, runs: [missed] } }));
    expect(host.textContent).not.toContain("Why Scout missed");
    const [first, second] = [...host.querySelectorAll("li button")] as HTMLButtonElement[];
    act(() => first.click());
    expect(host.textContent).toContain("Why Scout missedNo trunk size was given, so Scout judged it from the photo");
    expect(host.textContent).toContain("Likely cause: the tree's size. Confidence: medium.");
    expect(second.disabled).toBe(true);
    expect(missCauseText({ reason: "x", cause: "insufficient_information", confidence: "low" })).toBe("Likely cause: unclear from the job details. Confidence: low.");
    expect(missCauseText({ reason: "x", cause: "other", confidence: "high" })).toBe("Confidence: high.");
  });

  it("a change shows what Scout would have priced the same jobs at", () => {
    // Projected 1100 + 2100 = 3200 against picks of 3000: 7% high, instead of 23% (3700 against 3000).
    expect(show(on({ scout: { ...on().scout!, runs: [detailed()] } })))
      .toContain("Checked on the same jobs: with the new adjustments, Scout would have been 7% high overall.");
    expect(show(on({ scout: { ...on().scout!, runs: [run()] } }))).not.toContain("Checked on the same jobs");
  });

  it("the intro promises only what undo does", () => {
    expect(show({ visible: true, is_owner: true, enabled: false })).toContain("you can undo the latest change or switch it off at any time");
  });
});

describe("the words", () => {
  it("gaps, titles, statuses and factor sentences", () => {
    expect([gapText(25), gapText(-8.4), gapText(0.2), gapText(null)]).toEqual(["Scout was 25% high", "Scout was 8% low", "Scout matched", ""]);
    expect(runTitle(run({ kind: "weekly", week_start: "2026-10-19" }), true)).toBe("Last week (Oct 19 to Oct 25)");
    expect(runTitle(run({ kind: "weekly", week_start: "2026-10-19" }), false)).toBe("Week of Oct 19");
    expect(statusLine(run({ undone_at: "2026-10-27T00:00:00Z" }))).toBe("You undid this change.");
    expect(factorSentence({ service: "Tree Removal", size: "not_given", factor: 0.8, jobs: 2 })).toBe("Tree removals with no trunk size given come out 20% lower.");
    expect(factorSentence({ service: "Stump Grinding", size: "any", factor: 1.1, jobs: 1 })).toBe("Stump grinding jobs come out 10% higher.");
    expect(latestRun([run({ id: "a", status: "running" }), run({ id: "b" })])).toMatchObject({ latest: { id: "b" }, working: true });
  });

  it("a factor of 1.00 reads as standard pricing", () => {
    expect(factorSentence({ service: "Tree Removal", size: "36+", factor: 1, jobs: 1 })).toBe("Tree removals over 36 inches keep Scout's standard price.");
  });

  it("the overall gap is Scout's total against the picked total, so one small job can't swing it", () => {
    // Timber's 13 jobs from the 2026-10-21 preview: the per-job average is +24.9%, carried by a $297 pick alone.
    const pairs = [[1175, 850], [1114, 1865], [2815, 2310], [1405, 1955], [1792, 1865], [1845, 1908], [3708, 2743],
      [2296, 1429], [1005, 1100], [2394, 2670], [1012, 297], [1630, 1460], [2440, 2210]];
    const jobs = pairs.map(([estimate, picked], i) => ({ ...run().jobs[0], ref: `j${i}`, estimate, picked }));
    expect(gapText(overallGap(jobs))).toBe("Scout was 9% high");
    expect(overallGap([])).toBeNull();
    expect(overallGap([{ ...run().jobs[0], picked: 0 }])).toBeNull();
    expect(show(on({ scout: { ...on().scout!, runs: [run({ jobs })] } }))).toContain("Scout was 9% high overall on these jobs.");
  });
});
