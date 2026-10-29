import { describe, expect, it } from 'vitest';
import { ownerTypedPrice } from '../../supabase/functions/scout-request-edit/priceEdit';

const fresh = { ai_price_min: 1500, ai_price_max: 1500, final_price_min: null, final_price_max: null };

describe('ownerTypedPrice', () => {
  it('does not treat the untouched AI price as an owner edit', () => {
    expect(ownerTypedPrice(fresh, 1500)).toBeNull();
  });

  it('keeps a price the owner changed', () => {
    expect(ownerTypedPrice(fresh, 1200)).toBe(1200);
  });

  it('keeps updating a price the owner already set', () => {
    expect(ownerTypedPrice({ ...fresh, final_price_min: 1200, final_price_max: 1200 }, 1500)).toBe(1500);
  });

  it('ignores a missing price', () => {
    expect(ownerTypedPrice(fresh, undefined)).toBeNull();
  });
});
