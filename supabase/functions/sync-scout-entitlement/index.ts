// Public endpoint called by tradesmarketing.ai after a Stripe event.
// Auth: shared secret in `x-sync-secret` header (must match TRADESMARKETING_SYNC_SECRET).
// Body: { email, status, seat_count, current_period_end, stripe_customer_id, stripe_subscription_id }
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Payload {
  email: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  seat_count?: number;
  current_period_end?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const secret = Deno.env.get('TRADESMARKETING_SYNC_SECRET');
    if (!secret) throw new Error('TRADESMARKETING_SYNC_SECRET not configured');

    const provided = req.headers.get('x-sync-secret');
    if (provided !== secret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as Payload;
    if (!body.email || !body.status) {
      return new Response(JSON.stringify({ error: 'email and status are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // Resolve email -> contractor (auth.users.id)
    const emailLower = body.email.trim().toLowerCase();
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', emailLower)
      .maybeSingle();
    if (profileErr) throw profileErr;

    if (!profile) {
      // No TreeCheck account yet — record as pending so we can link later.
      const { error: pendErr } = await admin.from('pending_entitlements').upsert({
        email: emailLower,
        product: 'scout',
        status: body.status,
        seat_count: body.seat_count ?? 1,
        current_period_end: body.current_period_end ?? null,
        stripe_customer_id: body.stripe_customer_id ?? null,
        stripe_subscription_id: body.stripe_subscription_id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email,product' });
      if (pendErr) throw pendErr;
      return new Response(JSON.stringify({ ok: true, linked: false, reason: 'no_treecheck_account' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: upsertErr } = await admin.from('product_entitlements').upsert({
      contractor_id: profile.id,
      product: 'scout',
      status: body.status,
      seat_count: body.seat_count ?? 1,
      current_period_end: body.current_period_end ?? null,
      stripe_customer_id: body.stripe_customer_id ?? null,
      stripe_subscription_id: body.stripe_subscription_id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'contractor_id,product' });
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ ok: true, linked: true, contractor_id: profile.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[sync-scout-entitlement]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
