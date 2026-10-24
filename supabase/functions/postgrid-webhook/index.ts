// PostGrid webhook: updates postcard_sends row when status changes.
import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, postgrid-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    console.log('[postgrid-webhook] event', JSON.stringify(body).slice(0, 1000));

    // PostGrid event shape: { type, data: { id, status, ... } }
    const postgridId: string | undefined = body?.data?.id || body?.id;
    const status: string | undefined = body?.data?.status || body?.status;
    if (!postgridId) return json({ ok: true, ignored: true });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (status === 'delivered') updates.delivered_at = new Date().toISOString();

    const { error } = await admin
      .from('postcard_sends')
      .update(updates)
      .eq('postgrid_id', postgridId);
    if (error) console.error('[postgrid-webhook] update error', error);

    return json({ ok: true });
  } catch (e) {
    console.error('[postgrid-webhook]', e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
