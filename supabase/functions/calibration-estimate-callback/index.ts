// The Scout webhook (n8n) answers calibration photos here. Saves the trunk/height reading only:
// no texts, no pushes, no jobs, no Scout learning rows, and the returned price is thrown away.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { storeCalibrationReading } from '../_shared/calibrationWebhook.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-scout-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const expected = Deno.env.get('SCOUT_WEBHOOK_SECRET');
    if (!expected || req.headers.get('X-Scout-Secret') !== expected) return json({ error: 'Forbidden' }, 403);
    const body = await req.json().catch(() => null);
    const id = String(body?.capture_id ?? new URL(req.url).searchParams.get('calibration_id') ?? '');
    if (!UUID.test(id)) return json({ error: 'capture_id required' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const saved = await storeCalibrationReading(admin, id, body ?? {});
    return saved ? json({ ok: true }) : json({ error: 'Unknown calibration' }, 404);
  } catch (e) {
    console.error('calibration-estimate-callback', e);
    return json({ error: 'Could not save the reading' }, 500);
  }
});
