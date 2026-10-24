import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { activeGuidance, companyOf, NO_GUIDANCE, recordScoutSent } from '../_shared/scoutLearning.ts';
import { scoutInputs } from '../_shared/scoutLearningCore.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const N8N_WEBHOOK = 'https://treecheck.app.n8n.cloud/webhook/scout-tree-automation';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Caller must be signed in
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = userData.user.id;

    const { capture_id } = await req.json();
    if (!capture_id) {
      return new Response(JSON.stringify({ error: 'capture_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: capture, error: capErr } = await admin
      .from('scout_captures')
      .select('*')
      .eq('id', capture_id)
      .maybeSingle();
    if (capErr || !capture) {
      return new Response(JSON.stringify({ error: 'Capture not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only the owning company (or an admin) may retry
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerId)
      .eq('role', 'admin')
      .maybeSingle();
    const isAdmin = !!roleRow;
    if (!isAdmin && capture.owner_id !== callerId && capture.contractor_id !== callerId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (capture.status !== 'pending') {
      return new Response(JSON.stringify({ error: `Capture is ${capture.status}, not pending` }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rebuild signed media URLs
    const paths: string[] = Array.isArray(capture.photo_paths) && capture.photo_paths.length
      ? capture.photo_paths
      : (capture.photo_path ? [capture.photo_path] : []);
    const photoSignedUrls: string[] = [];
    for (const p of paths) {
      const { data } = await admin.storage.from('scout-media').createSignedUrl(p, 60 * 60 * 24);
      if (data?.signedUrl) photoSignedUrls.push(data.signedUrl);
    }
    let voiceSigned: string | null = null;
    if (capture.voice_memo_path) {
      const { data } = await admin.storage.from('scout-media').createSignedUrl(capture.voice_memo_path, 60 * 60 * 24);
      voiceSigned = data?.signedUrl ?? null;
    }

    // Scout learning: the same guidance and record as scout-submit (never for pruning or Free previews).
    const learns = capture.requested_service !== 'Pruning/Trimming' && capture.free_preview_locked !== true;
    const company = learns && capture.owner_id ? await companyOf(admin, capture.owner_id) : null;
    const learning = company ? await activeGuidance(admin, company, 'scout') : NO_GUIDANCE;
    if (company) {
      await recordScoutSent(admin, {
        captureId: capture.id,
        companyId: company,
        versionId: learning.version_id,
        inputs: scoutInputs({
          service: capture.requested_service, diameterInches: capture.diameter_inches,
          circumferenceInches: capture.circumference_inches, notes: capture.notes_summary || capture.notes_raw,
          photoCount: paths.length, voiceMemo: !!capture.voice_memo_path,
        }),
      });
    }

    const payload = {
      capture_id: capture.id,
      photo_url: photoSignedUrls[0] ?? null,
      photo_urls: photoSignedUrls,
      voice_memo_url: voiceSigned,
      notes_summary: capture.notes_summary || capture.notes_raw || null,
      service: capture.requested_service,
      circumference_inches: capture.circumference_inches ?? null,
      diameter_inches: capture.diameter_inches ?? null,
      address: {
        street: capture.address_street,
        city: capture.address_city,
        state: capture.address_state,
        zip: capture.address_zip,
        full: `${capture.address_street}, ${capture.address_city}, ${capture.address_state} ${capture.address_zip}`,
      },
      callback_url: `${supabaseUrl}/functions/v1/scout-estimate-callback?src=scout`,
      submitted_at: new Date().toISOString(),
      retry: true,
      company_guidance: learning.block,
    };

    const n8nRes = await fetch(N8N_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scout-Secret': Deno.env.get('SCOUT_WEBHOOK_SECRET') ?? '',
      },
      body: JSON.stringify(payload),
    });

    if (!n8nRes.ok) {
      const body = await n8nRes.text();
      console.error('n8n retry non-OK', n8nRes.status, body);
      return new Response(JSON.stringify({ error: `Estimator webhook returned ${n8nRes.status}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, capture_id: capture.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('scout-retry-estimate error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
