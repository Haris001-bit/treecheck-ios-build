import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const N8N_WEBHOOK = 'https://treecheck.app.n8n.cloud/webhook/request-edit';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = claimsData.claims.sub as string;

    const { capture_id, service, price, notes } = await req.json() ?? {};
    if (!capture_id) {
      return new Response(JSON.stringify({ error: 'capture_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: capture, error: fetchErr } = await admin.from('scout_captures').select('*').eq('id', capture_id).single();
    if (fetchErr || !capture) {
      return new Response(JSON.stringify({ error: 'Capture not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (capture.contractor_id !== userId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: mayReview, error: permissionError } = await userClient.rpc('company_has_permission', { p_owner: capture.owner_id ?? capture.contractor_id, p_permission: 'reviewEstimates' });
    if (permissionError || !mayReview) return new Response(JSON.stringify({ error: 'Estimate approval permission required.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Re-sign photo URL (24h)
    let photoSigned: string | null = null;
    if (capture.photo_path) {
      const { data } = await admin.storage.from('scout-media').createSignedUrl(capture.photo_path, 60 * 60 * 24);
      photoSigned = data?.signedUrl ?? null;
    }

    // Set status back to pending so the UI shows "analyzing"
    await admin.from('scout_captures').update({
      status: 'pending',
      final_service: service ?? capture.final_service,
      final_price_min: price ?? capture.final_price_min,
      final_price_max: price ?? capture.final_price_max,
      final_notes: notes ?? capture.final_notes,
    }).eq('id', capture_id);

    const callbackUrl = `${supabaseUrl}/functions/v1/scout-estimate-callback`;
    const payload = {
      capture_id,
      photo_url: photoSigned,
      notes_summary: capture.notes_summary,
      circumference_inches: capture.circumference_inches,
      diameter_inches: capture.diameter_inches,
      address: {
        street: capture.address_street,
        city: capture.address_city,
        state: capture.address_state,
        zip: capture.address_zip,
        full: `${capture.address_street}, ${capture.address_city}, ${capture.address_state} ${capture.address_zip}`,
      },
      ai_estimate: {
        service: capture.ai_service,
        price: capture.ai_price_max ?? capture.ai_price_min,
        difficulty: capture.ai_difficulty,
        risk: capture.ai_risk,
        notes: capture.ai_notes,
      },
      contractor_edit: {
        service: service ?? null,
        price: price ?? null,
        notes: notes ?? null,
      },
      callback_url: callbackUrl,
      requested_at: new Date().toISOString(),
    };

    try {
      const n8nRes = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scout-Secret': Deno.env.get('SCOUT_WEBHOOK_SECRET') ?? '',
        },
        body: JSON.stringify(payload),
      });
      if (!n8nRes.ok) console.error('n8n request-edit non-OK', n8nRes.status, await n8nRes.text());
    } catch (e) {
      console.error('n8n request-edit failed', e);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    console.error('scout-request-edit error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
