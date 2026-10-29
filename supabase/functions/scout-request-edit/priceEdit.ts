// The edit form opens pre-filled with Scout's AI price. Only a price the owner actually changed
// (or a price they already own from an earlier edit or approval) becomes their Scout price, because
// an owner's Scout price is auto-picked as the job's official price in Jobs.
export type CapturePrices = {
  ai_price_min: number | null;
  ai_price_max: number | null;
  final_price_min: number | null;
  final_price_max: number | null;
};

/** The owner's typed price to save, or null to keep the capture's current owner price (possibly none). */
export function ownerTypedPrice(capture: CapturePrices, price: unknown): number | null {
  const typed = typeof price === 'number' ? price : Number(price);
  if (price == null || price === '' || !Number.isFinite(typed) || typed <= 0) return null;
  if ((capture.final_price_min ?? capture.final_price_max) != null) return typed;
  const ai = capture.ai_price_max ?? capture.ai_price_min;
  if (ai != null && Number(ai) === typed) return null;
  return typed;
}
