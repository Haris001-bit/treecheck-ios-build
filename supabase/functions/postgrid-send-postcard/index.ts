// PostGrid: send a postcard for a Scout capture.
// Admin-gated during test mode. Uses POSTGRID_TEST_API_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSTGRID_TEMPLATE_ID = 'template_tfijXepnmgEkA78fV3XBPr';
const POSTGRID_BASE = 'https://api.postgrid.com/print-mail/v1';

interface ReturnAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  company?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('POSTGRID_TEST_API_KEY');
    if (!apiKey) throw new Error('PostGrid API key not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth: validate JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not authenticated' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'Not authenticated' }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    // Admin-gate during test mode
    const { data: profile } = await admin
      .from('profiles')
      .select('role, full_name, company_name, return_address')
      .eq('id', userId)
      .maybeSingle();
    if (!profile || profile.role !== 'admin') {
      return json({ error: 'Postcards are admin-only during test mode' }, 403);
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const captureId: string | undefined = body.scout_capture_id;
    const overrideReturn: ReturnAddress | undefined = body.return_address;
    if (!captureId) return json({ error: 'scout_capture_id required' }, 400);

    // Load capture
    const { data: capture, error: capErr } = await admin
      .from('scout_captures')
      .select('*')
      .eq('id', captureId)
      .maybeSingle();
    if (capErr || !capture) return json({ error: 'Capture not found' }, 404);

    if (!capture.address_street || !capture.address_city || !capture.address_state || !capture.address_zip) {
      return json({ error: 'Capture is missing a complete recipient address' }, 400);
    }

    // Resolve return address — prefer override (and persist to profile if first time)
    let returnAddress: ReturnAddress | null =
      overrideReturn ?? (profile.return_address as ReturnAddress | null);
    if (!returnAddress) {
      return json({ error: 'No return address on file. Please provide one.', need_return_address: true }, 400);
    }
    if (overrideReturn) {
      await admin.from('profiles').update({ return_address: overrideReturn }).eq('id', userId);
    }

    // Signed URL for tree photo (1 hr)
    let photoUrl: string | null = null;
    if (capture.photo_path) {
      const { data: signed } = await admin.storage
        .from('scout-media')
        .createSignedUrl(capture.photo_path, 60 * 60);
      photoUrl = signed?.signedUrl ?? null;
    }

    const notes = (capture.final_notes || capture.notes_summary || capture.notes_raw || '').slice(0, 500);

    // Merge variables PostGrid template will reference
    const mergeVariables: Record<string, string> = {
      customImage: photoUrl ?? '',
      tree_photo_url: photoUrl ?? '',
      notes,
      company_name: profile.company_name || profile.full_name || 'TreeCheck',
      qr_url: `https://app.treecheck.ai/estimate/${captureId}`,
    };

    const recipientName = profile.company_name || profile.full_name || 'Resident';
    const companyName = returnAddress.company || profile.company_name || profile.full_name || 'TreeCheck';

    // Build PostGrid form-encoded body
    const form = new URLSearchParams();
    form.set('frontTemplate', POSTGRID_TEMPLATE_ID);
    form.set('backTemplate', POSTGRID_TEMPLATE_ID);
    form.set('size', '9x6');
    // recipient (to)
    form.set('to[firstName]', 'Resident');
    form.set('to[companyName]', recipientName);
    form.set('to[addressLine1]', capture.address_street);
    form.set('to[city]', capture.address_city);
    form.set('to[provinceOrState]', capture.address_state);
    form.set('to[postalOrZip]', capture.address_zip);
    form.set('to[country]', 'US');
    // return (from)
    form.set('from[companyName]', companyName);
    form.set('from[addressLine1]', returnAddress.street);
    form.set('from[city]', returnAddress.city);
    form.set('from[provinceOrState]', returnAddress.state);
    form.set('from[postalOrZip]', returnAddress.zip);
    form.set('from[country]', 'US');
    // merge variables
    for (const [k, v] of Object.entries(mergeVariables)) {
      form.set(`mergeVariables[${k}]`, v);
    }

    const pgRes = await fetch(`${POSTGRID_BASE}/postcards`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const pgData = await pgRes.json();

    if (!pgRes.ok) {
      console.error('[postgrid] error', pgData);
      // Persist failure row for visibility
      await admin.from('postcard_sends').insert({
        contractor_id: userId,
        scout_capture_id: captureId,
        postgrid_template_id: POSTGRID_TEMPLATE_ID,
        status: 'failed',
        recipient_address: {
          street: capture.address_street,
          city: capture.address_city,
          state: capture.address_state,
          zip: capture.address_zip,
        },
        return_address: returnAddress,
        merge_variables: mergeVariables,
        is_test: true,
        error_message: pgData?.error?.message || pgData?.message || JSON.stringify(pgData).slice(0, 500),
      });
      return json({ error: pgData?.error?.message || 'PostGrid send failed', details: pgData }, 502);
    }

    // Persist success
    const { data: row, error: insErr } = await admin
      .from('postcard_sends')
      .insert({
        contractor_id: userId,
        scout_capture_id: captureId,
        postgrid_id: pgData.id,
        postgrid_template_id: POSTGRID_TEMPLATE_ID,
        status: pgData.status || 'queued',
        recipient_name: recipientName,
        recipient_address: {
          street: capture.address_street,
          city: capture.address_city,
          state: capture.address_state,
          zip: capture.address_zip,
        },
        return_address: returnAddress,
        merge_variables: mergeVariables,
        is_test: true,
        send_to_postgrid_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insErr) console.error('[postgrid] db insert failed', insErr);

    return json({ success: true, postcard: row, postgrid: pgData });
  } catch (e) {
    console.error('[postgrid-send-postcard]', e);
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
