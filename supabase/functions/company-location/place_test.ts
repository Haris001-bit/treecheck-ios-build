import { assertEquals } from 'jsr:@std/assert@1';
import { placeFromGeocode } from '../_shared/businessPlace.ts';

const answer = (state: string, country = 'US') => ({
  formatted_address: `Edmond, ${state}, USA`,
  geometry: { location: { lat: 35.65, lng: -97.47 } },
  address_components: [
    { long_name: 'Edmond', short_name: 'Edmond', types: ['locality'] },
    { long_name: 'Oklahoma', short_name: state, types: ['administrative_area_level_1'] },
    { long_name: 'United States', short_name: country, types: ['country'] },
  ],
});

Deno.test('the state comes from the map lookup, not from what was typed', () => {
  assertEquals(placeFromGeocode(answer('OK'), 'edmund')?.state, 'OK');
  assertEquals(placeFromGeocode(answer('TX'), 'Edmond')?.state, 'TX');
});
Deno.test('a place outside the US is not a business location', () => {
  assertEquals(placeFromGeocode(answer('ON', 'CA'), 'Edmond'), null);
});
