import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate with webhook secret
    const authHeader = req.headers.get('x-webhook-secret');
    const webhookSecret = Deno.env.get('LEAD_WEBHOOK_SECRET');

    if (!webhookSecret || authHeader !== webhookSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { email, application_id, full_name, company_name, phone, market } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .insert({ email: email.trim().toLowerCase(), market: market || 'OKC' })
      .select()
      .single();

    if (inviteError) {
      console.error('Error creating invitation:', inviteError);
      return new Response(
        JSON.stringify({ error: 'Failed to create invitation' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update application status if provided
    if (application_id) {
      await supabaseAdmin
        .from('applications')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', application_id);
    }

    const origin = Deno.env.get('APP_ORIGIN') || 'https://app.treecheck.ai';
    const params = new URLSearchParams({ token: invitation.invite_token });
    if (full_name) params.set('name', full_name);
    if (company_name) params.set('company', company_name);
    if (phone) params.set('phone', phone);
    const inviteUrl = `${origin}/accept-invite?${params.toString()}`;

    console.log(`[CREATE-INVITATION] Created invite for ${email}, URL: ${inviteUrl}`);

    return new Response(
      JSON.stringify({
        success: true,
        invite_url: inviteUrl,
        invite_token: invitation.invite_token,
        expires_at: invitation.expires_at,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in create-invitation:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
