import { describe, expect, it } from "vitest";
import { chooseAutoPick } from "../../../supabase/functions/quote-auto-pick/choose";

const MARK = "705cecc2-5926-48c1-a728-b3ebd6b920a2";
const t0 = Date.parse("2026-10-16T12:00:00Z");
const H = 3600_000;
const req = (owner = MARK, extra: any = {}) => ({
  owner_contractor_id: owner, status: "open", quote_pick: null, awarded_bid_id: null,
  pricing_inputs: null, owner_cost: 0, ...extra,
});
const bid = (id: string, ideal: number, min: number, at = t0) => ({
  id, bid_role: "climber", status: "submitted", created_at: new Date(at).toISOString(), min_pay: min, ideal_pay: ideal,
});

describe("auto-pick", () => {
  it("waits 3 hours after the first climber bid", () => {
    expect(chooseAutoPick(req(), [bid("a", 1000, 800)], t0 + 3 * H - 60_000)).toBeNull();
    expect(chooseAutoPick(req(), [bid("a", 1000, 800)], t0 + 3 * H)?.option).toBe("recommended");
  });
  it("only for Mark's account", () => {
    expect(chooseAutoPick(req("someone-else"), [bid("a", 1000, 800)], t0 + 5 * H)).toBeNull();
  });
  it("never overrides a pick already made", () => {
    expect(chooseAutoPick(req(MARK, { quote_pick: { bid_id: "a" } }), [bid("a", 1000, 800)], t0 + 5 * H)).toBeNull();
  });
  it("picks the cheapest recommended quote and pays the climber his ideal", () => {
    const p = chooseAutoPick(req(), [bid("a", 1500, 1200), bid("b", 1000, 800)], t0 + 5 * H)!;
    expect(p.bid_id).toBe("b");
    expect(p.climber_pay).toBe(1000);
  });
});
