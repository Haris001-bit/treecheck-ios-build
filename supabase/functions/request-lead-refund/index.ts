import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_REASONS = [
  'job_already_done_diy',
  'suspected_scam',
  'unable_to_reach',
  'customer_denies',
  'wrong_service',
  'misrepresented',
  'duplicate',
  'other',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { purchase_id, reason_code, reason_notes } = body;

    if (!purchase_id || typeof purchase_id !== 'string') {
      return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!reason_code || !VALID_REASONS.includes(reason_code)) {
      return new Response(JSON.stringify({ error: 'Invalid reason_code' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (reason_code === 'other' && (!reason_notes || reason_notes.trim().length < 10)) {
      return new Response(JSON.stringify({ error: 'Please describe your reason (at least 10 characters)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (reason_notes && reason_notes.length > 1000) {
      return new Response(JSON.stringify({ error: 'Notes too long (max 1000 chars)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify purchase ownership + within 7 days + lead is from TreeCheck (not personal)
    const { data: purchase, error: pErr } = await admin
      .from('lead_purchases')
      .select('id, lead_id, contractor_id, purchase_amount, purchased_at, leads(source, customer_name, city)')
      .eq('id', purchase_id)
      .maybeSingle();

    if (pErr || !purchase) {
      return new Response(JSON.stringify({ error: 'Purchase not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (purchase.contractor_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Not your purchase' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Check if requester is admin (admins can bypass the 7-day window for testing)
    const { data: requesterProfile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdminUser = requesterProfile?.role === 'admin';

    const ageDays = (Date.now() - new Date(purchase.purchased_at).getTime()) / (1000 * 60 * 60 * 24);
    if (!isAdminUser && ageDays > 7) {
      return new Response(JSON.stringify({ error: 'Refund window expired (7 days)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // @ts-ignore
    if (purchase.leads?.source === 'personal') {
      return new Response(JSON.stringify({ error: 'Personal leads are not eligible for refunds' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Insert (unique constraint on purchase_id prevents duplicates)
    const { data: refundRow, error: insErr } = await admin
      .from('refund_requests')
      .insert({
        lead_id: purchase.lead_id,
        contractor_id: user.id,
        purchase_id: purchase.id,
        purchase_amount: purchase.purchase_amount,
        reason_code,
        reason_notes: reason_notes?.trim() || null,
      })
      .select()
      .single();

    if (insErr) {
      if (insErr.code === '23505') {
        return new Response(JSON.stringify({ error: 'A refund request already exists for this lead' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // SMS admin
    const { data: profile } = await admin.from('profiles').select('full_name, company_name').eq('id', user.id).maybeSingle();
    // @ts-ignore
    const customer = purchase.leads?.customer_name || 'Customer';
    // @ts-ignore
    const city = purchase.leads?.city || '';
    const reasonLabels: Record<string, string> = {
      job_already_done_diy: 'Work was already done (DIY/neighbor)',
      suspected_scam: 'Suspected scam',
      unable_to_reach: 'Unable to reach customer',
      customer_denies: 'Customer denies request',
      wrong_service: 'Wrong service',
      misrepresented: 'Misrepresented job',
      duplicate: 'Duplicate lead',
      other: 'Other',
    };
    const adminMsg = `[TreeCheck] Refund request from ${profile?.company_name || profile?.full_name || 'contractor'}: $${purchase.purchase_amount} for ${customer} (${city}). Reason: ${reasonLabels[reason_code]}${reason_notes ? ' — ' + reason_notes.slice(0, 100) : ''}. Review in admin.`;

    try {
      await admin.functions.invoke('send-sms', { body: { to: '+13036693816', message: adminMsg } });
    } catch (e) {
      console.error('Failed to SMS admin:', e);
    }

    return new Response(JSON.stringify({ success: true, refund_request: refundRow }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('request-lead-refund error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
