// Picks the Recommended quote for an owner who hasn't picked one in time.
import { calculatePricing } from "../_shared/bidPricing.ts";
import { toPricingInput, withBidExtras, type StoredPricingInputs } from "../_shared/bidPricingInputs.ts";

// Only Mark's company (Timber Edmond) gets auto-picks; every other account picks by hand.
export const AUTO_PICK_OWNERS = new Set(["705cecc2-5926-48c1-a728-b3ebd6b920a2"]);
export const AUTO_PICK_AFTER_MS = 3 * 60 * 60 * 1000;

export interface PickBid {
  id: string; bid_role: string | null; status: string; created_at: string;
  min_pay: number | null; ideal_pay: number | null; [k: string]: unknown;
}
export interface PickRequest {
  owner_contractor_id: string; status: string; quote_pick: unknown; awarded_bid_id: string | null;
  pricing_inputs: StoredPricingInputs | null; owner_cost: number | null;
}

/** Recommended pick once 3 hours have passed since the first climber bid; cheapest Recommended price wins. */
export function chooseAutoPick(r: PickRequest, bids: PickBid[], now: number) {
  if (!AUTO_PICK_OWNERS.has(r.owner_contractor_id)) return null;
  if (r.status !== "open" || r.quote_pick || r.awarded_bid_id) return null;
  const climbers = bids.filter((b) => (b.bid_role ?? "climber") === "climber" && b.status === "submitted");
  if (!climbers.length) return null;
  const first = Math.min(...climbers.map((b) => Date.parse(b.created_at)));
  if (now - first < AUTO_PICK_AFTER_MS) return null;
  let best: { bid: PickBid; amount: number } | null = null;
  for (const b of climbers) {
    const priced = calculatePricing(toPricingInput(withBidExtras(r.pricing_inputs, b as any), {
      crewMinimum: Number(b.min_pay ?? 0),
      crewIdeal: Number(b.ideal_pay ?? 0),
      committedCrewPay: 0,
      legacyOwnerCost: Number(r.owner_cost ?? 0),
    }));
    const amount = Number(priced.baseSale);
    if (!(amount > 0)) continue;
    if (!best || amount < best.amount) best = { bid: b, amount };
  }
  if (!best) return null;
  // At the Recommended price the climber gets his ideal pay (same rule as the Bid Board).
  const ideal = Number(best.bid.ideal_pay ?? 0);
  const climberPay = Math.round(ideal > 0 ? ideal : Number(best.bid.min_pay ?? 0));
  return { bid_id: best.bid.id, option: "recommended", amount: best.amount, climber_pay: climberPay };
}
