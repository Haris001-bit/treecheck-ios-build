// RipSaw RS2511 giveaway admin actions. Admins only.
// - refresh: marks card-checkout and phone app signups as entered once their trial has started (live billing only).
// - draw (after entries close): picks one entered, not-yet-drawn entry at random, with no weighting by plan, billing
//   cycle or anything else; drawing again picks an alternate.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { GIVEAWAY_ENDS_AT, GIVEAWAY_ID, TRIAL_STARTED_BILLING_STATUSES } from '../_shared/giveaway.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Unbiased random index in [0, n) from the platform's secure random source. */
function secureIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

// deno-lint-ignore no-explicit-any
async function allRows(query: (from: number) => any): Promise<any[]> {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const header = req.headers.get('Authorization');
    if (!header) return json({ error: 'Please sign in again.' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: auth } = await db.auth.getUser(header.replace(/^Bearer\s+/i, ''));
    if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await db.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ error: 'Only TreeCheck admins can do this.' }, 403);
    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'refresh' ? 'refresh' : 'draw';

    // Card-checkout and phone app signups: entered once their trial has started. Live billing only, so test purchases
    // (App Review and the sandbox test logins) never reach the draw.
    const waiting = await allRows((from) => db.from('giveaway_entries').select('id, user_id')
      .eq('giveaway', GIVEAWAY_ID).eq('status', 'awaiting_trial').order('id').range(from, from + 999));
    let promoted = 0;
    for (let i = 0; i < waiting.length; i += 200) {
      const ids = waiting.slice(i, i + 200).map((w) => w.user_id).filter(Boolean);
      if (!ids.length) continue;
      const { data: started, error } = await db.from('company_billing').select('owner_id')
        .in('owner_id', ids).eq('environment', 'live').or(`stripe_subscription_id.not.is.null,status.in.(${TRIAL_STARTED_BILLING_STATUSES.join(',')})`);
      if (error) throw error;
      const owners = [...new Set((started ?? []).map((s) => s.owner_id))];
      if (!owners.length) continue;
      const { data: up, error: upErr } = await db.from('giveaway_entries').update({ status: 'entered' })
        .eq('giveaway', GIVEAWAY_ID).eq('status', 'awaiting_trial').in('user_id', owners).select('id');
      if (upErr) throw upErr;
      promoted += up?.length ?? 0;
    }
    if (action === 'refresh') return json({ promoted });

    if (Date.now() <= Date.parse(GIVEAWAY_ENDS_AT)) {
      return json({ error: 'Entries are still open. You can draw a winner after November 30 at 11:59 PM Central.' }, 400);
    }
    const pool = await allRows((from) => db.from('giveaway_entries').select('id')
      .eq('giveaway', GIVEAWAY_ID).eq('status', 'entered').is('drawn_at', null).lte('created_at', GIVEAWAY_ENDS_AT)
      .order('id').range(from, from + 999));
    if (!pool.length) return json({ error: 'No entries are left to draw.' }, 400);

    const pick = pool[secureIndex(pool.length)];
    const { data: winner, error: upErr } = await db.from('giveaway_entries').update({ drawn_at: new Date().toISOString() })
      .eq('id', pick.id).is('drawn_at', null)
      .select('id, full_name, email, phone, company_name, region, country, source, created_at, drawn_at').maybeSingle();
    if (upErr) throw upErr;
    if (!winner) return json({ error: 'Someone else drew at the same moment. Refresh and try again.' }, 409);
    console.log('[GIVEAWAY-DRAW] drawn', { entry: winner.id, pool: pool.length, by: auth.user.id });
    return json({ winner, pool: pool.length });
  } catch (e) {
    console.error('[GIVEAWAY-DRAW]', e instanceof Error ? e.message : e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
