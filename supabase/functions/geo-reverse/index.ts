import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_maps';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return new Response(JSON.stringify({ error: 'Google Maps not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { lat, lng } = await req.json();
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return new Response(JSON.stringify({ error: 'lat and lng (numbers) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `${GATEWAY_URL}/maps/api/geocode/json?latlng=${lat},${lng}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': GOOGLE_MAPS_API_KEY,
      },
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'OK') {
      return new Response(JSON.stringify({ error: data.error_message || data.status || 'Geocode failed' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pick the first street_address-ish result
    const result = data.results.find((r: any) => r.types?.includes('street_address')) || data.results[0];
    const get = (type: string, short = false) => {
      const c = result.address_components.find((c: any) => c.types.includes(type));
      return c ? (short ? c.short_name : c.long_name) : '';
    };
    const streetNumber = get('street_number');
    const route = get('route');
    const street = [streetNumber, route].filter(Boolean).join(' ');
    const city = get('locality') || get('sublocality') || get('postal_town') || get('administrative_area_level_2');
    const state = get('administrative_area_level_1', true);
    const zip = get('postal_code');

    return new Response(JSON.stringify({
      street, city, state, zip,
      formatted: result.formatted_address,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
