// Reads Google's geocoder answer for a business location: the two-letter US state and the city it found.
// placeFromGeocode is pure, so the Oklahoma rule is tested without calling Google.
interface Component { long_name?: string; short_name?: string; types?: string[] }

export interface Place { city: string; state: string; lat: number; lng: number; label: string }

// deno-lint-ignore no-explicit-any
export function placeFromGeocode(result: any, typedCity: string): Place | null {
  const comps: Component[] = Array.isArray(result?.address_components) ? result.address_components : [];
  const pick = (type: string) => comps.find((c) => c.types?.includes(type));
  const country = pick('country')?.short_name;
  const state = pick('administrative_area_level_1')?.short_name?.toUpperCase();
  const lat = Number(result?.geometry?.location?.lat), lng = Number(result?.geometry?.location?.lng);
  if (country !== 'US' || !state || !/^[A-Z]{2}$/.test(state) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const city = pick('locality')?.long_name || pick('sublocality')?.long_name || pick('administrative_area_level_2')?.long_name || typedCity;
  return { city, state, lat, lng, label: result?.formatted_address || `${city}, ${state}` };
}

// Google Maps goes through Lovable's connector gateway (GOOGLE_MAPS_API_KEY is the gateway connection's key).
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_maps';

/** Looks up "city, state" in the US. Null when it can't be found or the lookup isn't configured. */
export async function geocodeBusinessPlace(city: string, state: string): Promise<Place | null> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY'), mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!lovableKey || !mapsKey) { console.error('geocodeBusinessPlace: maps gateway not configured'); return null; }
  const address = `${city}, ${state}, USA`;
  const res = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:US`, {
    headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': mapsKey },
  }).catch(() => null);
  if (!res) return null;
  const data = await res.json().catch(() => null);
  return res.ok ? placeFromGeocode(data?.results?.[0], city) : null;
}
