import { createClient } from 'npm:@supabase/supabase-js@2';
import { recordScoutResult } from '../_shared/scoutLearning.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const secret = req.headers.get('X-Scout-Secret');
    const expected = Deno.env.get('SCOUT_WEBHOOK_SECRET');
    if (!expected || secret !== expected) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { capture_id, service, price, difficulty, risk, notes } = body ?? {};
    // Accept `price` (preferred) or legacy price_min/price_max
    const singlePrice = price ?? body?.price_max ?? body?.price_min;

    if (!capture_id || !service || singlePrice == null) {
      return new Response(JSON.stringify({ error: 'capture_id, service, price required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Normalize service to one of the three valid job types. Never let species
    // names (oak, pine, conifer, etc.) leak into the service field.
    const VALID = ['Tree Removal', 'Stump Grinding', 'Pruning/Trimming'];
    const s = String(service).toLowerCase();
    let normalizedService: string;
    if (s.includes('stump') || s.includes('grind')) normalizedService = 'Stump Grinding';
    else if (s.includes('prun') || s.includes('trim')) normalizedService = 'Pruning/Trimming';
    else if (s.includes('remov')) normalizedService = 'Tree Removal';
    else if (VALID.includes(service)) normalizedService = service;
    else normalizedService = 'Tree Removal'; // safe default — never a species

    // Strip any species references the upstream automation may have included.
    const SPECIES = /\b(oak|maple|pine|conifer|deciduous|evergreen|spruce|fir|cedar|elm|ash|birch|willow|cottonwood|sycamore|magnolia|cypress|redwood|sequoia|hickory|walnut|pecan|poplar|aspen|juniper|hemlock|locust|mulberry|dogwood|cherry|plum|apple|pear|palm|holly|beech|chestnut|catalpa|gum|sweetgum|bradford\s*pear|crape\s*myrtle|crepe\s*myrtle|bald\s*cypress|live\s*oak|red\s*oak|white\s*oak)\b/gi;
    const sanitizeNotes = (txt: unknown): string | null => {
      if (!txt) return null;
      const cleaned = String(txt)
        .replace(SPECIES, 'tree')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned || null;
    };

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // The service the rep selected in Scout always wins over what n8n returns.
    const { data: capRow } = await admin.from('scout_captures').select('requested_service, free_preview_locked, owner_id').eq('id', capture_id).maybeSingle();
    const locked = capRow?.free_preview_locked === true;
    const requested = capRow?.requested_service as string | null;
    if (requested === 'Pruning/Trimming') {
      // Pruning never takes an AI estimate; ignore anything n8n sends back.
      return new Response(JSON.stringify({ ok: true, ignored: 'pruning' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (requested && VALID.includes(requested)) {
      if (requested !== normalizedService) console.warn('n8n service mismatch', { capture_id, requested, returned: service });
      normalizedService = requested;
    }

    const fullNotes = sanitizeNotes(notes);

    // Condense the n8n line-item description into a short, professional
    // ISA-arborist "summary of findings" suitable for the back of a postcard.
    // Constraints: 1–2 short sentences, <= ~240 chars, no species names,
    // no pricing, no contractor branding — just findings + recommended action.
    let postcardSummary: string | null = null;
    if (fullNotes) {
      try {
        const apiKey = Deno.env.get('LOVABLE_API_KEY');
        if (apiKey) {
          const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-3-flash-preview',
              messages: [
                {
                  role: 'system',
                  content:
                    'You are an ISA-certified arborist writing a brief "Summary of Findings" for the back of a postcard mailed to a homeowner. Rewrite the input into 1-2 short, professional sentences (max 240 characters total). Focus on tree condition, risk, and recommended action. Do NOT name or guess tree species - refer to it as "the tree" or "this tree". Do NOT mention price, cost, or company name. No emojis, no greetings, no signatures. Return only the summary text.',
                },
                { role: 'user', content: fullNotes },
              ],
            }),
          });
          if (aiResp.ok) {
            const data = await aiResp.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (text) {
              postcardSummary = sanitizeNotes(text)?.slice(0, 280) ?? null;
            }
          } else {
            console.error('AI condense failed', aiResp.status, await aiResp.text().catch(() => ''));
          }
        } else {
          console.warn('LOVABLE_API_KEY missing — skipping postcard condense');
        }
      } catch (e) {
        console.error('AI condense error', e);
      }
    }

    const estimate = {
      ai_price_min: singlePrice,
      ai_price_max: singlePrice,
      ai_difficulty: difficulty ?? null,
      ai_risk: risk ?? null,
      ai_notes: fullNotes,
      notes_summary: postcardSummary ?? fullNotes,
    };
    if (locked) {
      // Free plan preview: the estimate waits server-side; the app only learns that it is ready and the job type.
      const { error: vaultError } = await admin.from('free_preview_vault').upsert({ kind: 'scout', ref_id: capture_id, owner_id: capRow!.owner_id, content: estimate });
      if (vaultError) throw new Error(vaultError.message);
    }
    const { error } = await admin.from('scout_captures').update(
      locked ? { status: 'awaiting_review', ai_service: normalizedService } : { status: 'awaiting_review', ai_service: normalizedService, ...estimate },
    ).eq('id', capture_id);

    if (error) throw new Error(error.message);

    // Scout learning keeps Scout's own first answer (src=scout, set by scout-submit and scout-retry-estimate).
    // Request Edit's answers carry no marker, so the estimate the weekly loop compares is never the owner's edit.
    if (!locked && new URL(req.url).searchParams.get('src') === 'scout') {
      await recordScoutResult(admin, {
        captureId: capture_id, ownerId: capRow?.owner_id as string | null, price: singlePrice,
        difficulty, risk, service: normalizedService, notes: fullNotes,
      });
    }

    // Alert the business owner that a capture is ready to review.
    // Best-effort: log failures but never break the callback.
    try {
      const { data: capture } = await admin
        .from('scout_captures')
        .select('owner_id, contractor_id, address_street, address_city')
        .eq('id', capture_id)
        .maybeSingle();

      const ownerId = capture?.owner_id as string | undefined;
      if (ownerId) {
        const [{ data: ownerProfile }, { data: repProfile }] = await Promise.all([
          admin.from('profiles').select('phone, full_name').eq('id', ownerId).maybeSingle(),
          admin.from('profiles').select('full_name, email').eq('id', capture!.contractor_id).maybeSingle(),
        ]);

        const repLabel = repProfile?.full_name || repProfile?.email || 'Your field rep';
        const addrLabel = [capture?.address_street, capture?.address_city].filter(Boolean).join(', ') || 'a property';
        const priceLabel = `$${Number(singlePrice).toLocaleString()}`;
        const title = 'Scout estimate ready to review';
        const body = locked
          ? `Your ${normalizedService} Scout preview at ${addrLabel} is ready.`
          : `${repLabel}'s ${normalizedService} capture at ${addrLabel} is ready — AI quoted ${priceLabel}.`;

        // SMS via Twilio
        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
        const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
        const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');
        const ownerPhoneRaw = (ownerProfile?.phone ?? '').toString();
        if (ownerPhoneRaw && accountSid && authToken && fromNumber) {
          let phone = ownerPhoneRaw.replace(/\D/g, '');
          if (phone.length === 10) phone = '+1' + phone;
          else if (!phone.startsWith('+')) phone = '+' + phone;
          try {
            const smsRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Authorization: 'Basic ' + btoa(`${accountSid}:${authToken}`),
                },
                body: new URLSearchParams({
                  To: phone,
                  From: fromNumber,
                  Body: `TreeCheck: ${body} Open your Scout Inbox to approve.`,
                }),
              },
            );
            if (!smsRes.ok) console.error('scout-review SMS failed', smsRes.status, await smsRes.text());
          } catch (smsErr) {
            console.error('scout-review SMS error', smsErr);
          }
        }

        // Push notification via send-push edge function
        try {
          const pushRes = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                contractor_ids: [ownerId],
                notification_type: 'account_activity_non_payment',
                title,
                body,
                data: { route: '/dashboard/scout-inbox', capture_id, source: 'scout' },
              }),

            },
          );
          if (!pushRes.ok) console.error('scout-review push failed', pushRes.status, await pushRes.text());
        } catch (pushErr) {
          console.error('scout-review push error', pushErr);
        }
      }
    } catch (notifyErr) {
      console.error('scout-review notify error', notifyErr);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (e) {
    console.error('scout-estimate-callback error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
