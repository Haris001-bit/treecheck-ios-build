// The company's main business location (decides Free-plan eligibility). Owners save their city and state; the
// state stored is the one Google's geocoder returns. Admins can force Free on or off for one company.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { geocodeBusinessPlace } from '../_shared/businessPlace.ts';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('save'), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(40) }).strict(),
  z.object({ action: z.literal('override'), owner_id: z.string().uuid(), free_override: z.boolean().nullable() }).strict(),
]);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const header = req.headers.get('Authorization');
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!header || !url || !key) return json({ error: 'Please sign in again.' }, 401);
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data: auth } = await db.auth.getUser(header.replace(/^Bearer\s+/i, ''));
    if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Enter your business city and state.' }, 400);
    const { data: me } = await db.from('profiles').select('id, role, account_type, parent_contractor_id').eq('id', auth.user.id).maybeSingle();
    const input = parsed.data;

    if (input.action === 'override') {
      if (me?.role !== 'admin') return json({ error: 'Only TreeCheck admins can change this.' }, 403);
      const { data, error } = await db.from('company_locations').update({ free_override: input.free_override }).eq('owner_id', input.owner_id).select('*').maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'This company has not saved a business location yet.' }, 404);
      return json({ location: data });
    }

    if (!me || me.account_type !== 'company') return json({ error: 'Business location is for tree company accounts.' }, 403);
    const owner = me.parent_contractor_id ?? me.id;
    if (input.action === 'get') {
      const [{ data: location }, { data: area }] = await Promise.all([
        db.from('company_locations').select('city, state, label').eq('owner_id', owner).maybeSingle(),
        db.from('service_areas').select('city, region').eq('contractor_id', owner).order('created_at').limit(1).maybeSingle(),
      ]);
      return json({ location, suggestion: area ? { city: area.city, state: area.region ?? '' } : null });
    }
    if (owner !== me.id) return json({ error: 'Only the company owner can change the business location.' }, 403);

    const place = await geocodeBusinessPlace(input.city, input.state);
    if (!place) return json({ error: "We couldn't find that city. Check the spelling and the state." }, 400);
    const { data: saved, error } = await db.from('company_locations').upsert({
      owner_id: owner, city: place.city, state: place.state, latitude: place.lat, longitude: place.lng, label: place.label,
    }, { onConflict: 'owner_id' }).select('city, state, label').single();
    if (error) throw error;
    return json({ location: saved });
  } catch (error) {
    console.error('company-location failed', error instanceof Error ? error.message : error);
    return json({ error: 'Could not save your business location. Please try again.' }, 500);
  }
});
