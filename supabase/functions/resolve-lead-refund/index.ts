import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { refund_id, decision, admin_notes, lead_action } = await req.json();
    if (!refund_id || !['approved', 'denied'].includes(decision)) {
      return new Response(JSON.stringify({ error: 'refund_id and valid decision required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (decision === 'approved' && !['sold_out', 'available', 'no_change'].includes(lead_action || 'no_change')) {
      return new Response(JSON.stringify({ error: 'Invalid lead_action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: rr, error: rrErr } = await admin
      .from('refund_requests')
      .select('*, leads(customer_name, city, purchase_count, status), profiles!refund_requests_contractor_id_fkey(phone, full_name)')
      .eq('id', refund_id)
      .maybeSingle();

    if (rrErr || !rr) {
      // fallback without join hint
      const { data: rr2 } = await admin.from('refund_requests').select('*').eq('id', refund_id).maybeSingle();
      if (!rr2) return new Response(JSON.stringify({ error: 'Refund request not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const refundRow: any = rr || (await admin.from('refund_requests').select('*').eq('id', refund_id).maybeSingle()).data;
    if (refundRow.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Already resolved' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: contractorProfile } = await admin.from('profiles').select('phone, full_name, credit_balance').eq('id', refundRow.contractor_id).maybeSingle();
    const { data: leadRow } = await admin.from('leads').select('customer_name, city, purchase_count, status').eq('id', refundRow.lead_id).maybeSingle();

    if (decision === 'approved') {
      const refundAmount = Number(refundRow.purchase_amount);

      // Credit wallet
      await admin
        .from('profiles')
        .update({ credit_balance: (contractorProfile?.credit_balance || 0) + refundAmount, updated_at: new Date().toISOString() })
        .eq('id', refundRow.contractor_id);

      // Log credit transaction
      await admin.from('credit_transactions').insert({
        contractor_id: refundRow.contractor_id,
        amount: refundAmount,
        type: 'refund',
        description: `Refund for lead (${leadRow?.customer_name || ''}, ${leadRow?.city || ''})`,
        lead_id: refundRow.lead_id,
        reason_code: refundRow.reason_code,
      });

      // Lead action
      if (lead_action === 'sold_out') {
        await admin.from('leads').update({ status: 'sold_out' }).eq('id', refundRow.lead_id);
      } else if (lead_action === 'available') {
        const newCount = Math.max(0, (leadRow?.purchase_count || 1) - 1);
        await admin.from('leads').update({ status: 'available', purchase_count: newCount }).eq('id', refundRow.lead_id);
      }

      await admin
        .from('refund_requests')
        .update({
          status: 'approved',
          admin_notes: admin_notes || null,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
          refund_amount: refundAmount,
          lead_action: lead_action || 'no_change',
        })
        .eq('id', refund_id);

      // SMS + push contractor
      if (contractorProfile?.phone) {
        const newBalance = (contractorProfile.credit_balance || 0) + refundAmount;
        const msg = `TreeCheck: Your refund of $${refundAmount.toFixed(2)} has been approved and credited to your account. New balance: $${newBalance.toFixed(2)}.`;
        try {
          await admin.functions.invoke('send-sms', { body: { to: contractorProfile.phone, message: msg } });
        } catch (e) { console.error('SMS failed:', e); }
      }
      try {
        await admin.functions.invoke('send-push', {
          body: {
            contractor_ids: [refundRow.contractor_id],
            notification_type: 'account_activity_non_payment',
            title: '✅ Refund Approved',
            body: `$${refundAmount.toFixed(2)} credited to your account`,
            data: { type: 'refund_approved', lead_id: refundRow.lead_id },
          },
        });

      } catch (e) { console.error('Push failed:', e); }

      return new Response(JSON.stringify({ success: true, status: 'approved', refund_amount: refundAmount }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      // Denied
      await admin
        .from('refund_requests')
        .update({
          status: 'denied',
          admin_notes: admin_notes || null,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', refund_id);

      if (contractorProfile?.phone) {
        const msg = `TreeCheck: Your refund request has been reviewed and not approved.${admin_notes ? ' Note: ' + admin_notes.slice(0, 200) : ''} Reach out if you have questions.`;
        try {
          await admin.functions.invoke('send-sms', { body: { to: contractorProfile.phone, message: msg } });
        } catch (e) { console.error('SMS failed:', e); }
      }
      try {
        await admin.functions.invoke('send-push', {
          body: {
            contractor_ids: [refundRow.contractor_id],
            notification_type: 'account_activity_non_payment',
            title: 'Refund Request Update',
            body: 'Your refund request was not approved. Tap for details.',
            data: { type: 'refund_denied', lead_id: refundRow.lead_id },
          },
        });

      } catch (e) { console.error('Push failed:', e); }

      return new Response(JSON.stringify({ success: true, status: 'denied' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    console.error('resolve-lead-refund error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
