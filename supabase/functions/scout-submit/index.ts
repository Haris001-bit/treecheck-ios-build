import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { companyMode } from '../_shared/tcNotify.ts';
import { claimFreeUse, companyPlan, companyTrialUsed, freeLimitMessage } from '../_shared/freePlan.ts';
import { activeGuidance, NO_GUIDANCE, recordScoutSent } from '../_shared/scoutLearning.ts';
import { scoutInputs } from '../_shared/scoutLearningCore.ts';

const N8N_WEBHOOK = 'https://treecheck.app.n8n.cloud/webhook/scout-tree-automation';
const PRUNING_NO_ESTIMATE = 'AI estimates are available for removals and stump grinding. Pruning requires an on-site visit.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // A Free preview that fails after its monthly slot was taken gives the slot back.
  let refundPreview: null | (() => Promise<unknown>) = null;

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
    const { data: ownerProfile, error: ownerError } = await userClient.from('profiles').select('parent_contractor_id').eq('id', userId).single();
    if (ownerError) throw ownerError;
    const companyOwner = ownerProfile?.parent_contractor_id ?? userId;
    const { data: mayCreate, error: permissionError } = await userClient.rpc('company_has_permission', { p_owner: companyOwner, p_permission: 'createScout' });
    // Free plan (Oklahoma owners): the owner can try Scout; the estimate stays hidden until a trial or paid plan.
    const freePreview = (await companyPlan(createClient(supabaseUrl, serviceKey), companyOwner)) === 'free';
    if (freePreview && userId !== companyOwner) return new Response(JSON.stringify({ error: 'On the Free plan, only the company owner can try Scout.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!freePreview && (permissionError || !mayCreate)) return new Response(JSON.stringify({ error: 'A Scout license and owner permission are required to create estimates.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const {
      photoBase64,        // data URL string (image/*) — legacy single photo
      photosBase64,       // optional array of up to 3 data URLs (same tree)
      voiceMemoBase64,    // data URL string or null
      notesRaw,
      service,
      circumferenceInches,
      diameterInches,
      address,
      customerName,
      customerPhone,
      customerEmail,
      trees,              // pruning only: [{label, note, photo_indexes}]
      worksheet,          // optional estimator worksheet fields (wk_* columns)
    } = body ?? {};

    // Whitelist worksheet columns so clients can't write arbitrary fields.
    const WK_NUM = ['wk_ground_crew', 'wk_hours', 'wk_loads', 'wk_crane_hours', 'wk_stump_diameter_inches', 'wk_extras_amount', 'wk_total', 'wk_climber_payout'];
    const WK_BOOL = ['wk_climber_required', 'wk_crane_required', 'wk_stump', 'wk_mini_skid'];
    const wkPatch: Record<string, unknown> = {};
    // The worksheet is part of full Scout, not the Free preview.
    if (!freePreview && worksheet && typeof worksheet === 'object') {
      for (const k of WK_NUM) {
        const v = (worksheet as Record<string, unknown>)[k];
        if (typeof v === 'number' && isFinite(v)) wkPatch[k] = v;
      }
      for (const k of WK_BOOL) {
        const v = (worksheet as Record<string, unknown>)[k];
        if (typeof v === 'boolean') wkPatch[k] = v;
      }
      const lvl = (worksheet as Record<string, unknown>).wk_rigging_level;
      if (lvl === 'none' || lvl === 'intermediate' || lvl === 'advanced') wkPatch.wk_rigging_level = lvl;
      const note = (worksheet as Record<string, unknown>).wk_extras_note;
      if (typeof note === 'string' && note.trim()) wkPatch.wk_extras_note = note.trim().slice(0, 200);
      const bd = (worksheet as Record<string, unknown>).wk_breakdown;
      if (Array.isArray(bd)) wkPatch.wk_breakdown = bd;
    }

    const VALID_SERVICES = ['Tree Removal', 'Stump Grinding', 'Pruning/Trimming'];
    const requestedService = typeof service === 'string' && VALID_SERVICES.includes(service) ? service : null;

    // Accept either a single photoBase64 or a photosBase64 array (up to 3, same tree).
    const photoList: string[] = [];
    if (Array.isArray(photosBase64)) {
      for (const p of photosBase64) {
        if (typeof p === 'string' && p.startsWith('data:')) photoList.push(p);
      }
    } else if (typeof photoBase64 === 'string' && photoBase64.startsWith('data:')) {
      photoList.push(photoBase64);
    }
    if (photoList.length === 0) {
      return new Response(JSON.stringify({ error: 'photoBase64 required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const isPruning = requestedService === 'Pruning/Trimming';
    const maxPhotos = isPruning ? 24 : 3;
    if (photoList.length > maxPhotos) {
      return new Response(JSON.stringify({ error: `Maximum ${maxPhotos} photos per submission` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!address?.street || !address?.city || !address?.state || !address?.zip) {
      return new Response(JSON.stringify({ error: 'Full address required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Decode helper for data URLs
    const decodeDataUrl = (dataUrl: string): { bytes: Uint8Array; mime: string } => {
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!m) throw new Error('Invalid data URL');
      const mime = m[1];
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, mime };
    };

    // Multi-tree grouping is allowed for pruning jobs only.
    let treeList: { label: string; note: string | null; photo_indexes: number[] }[] | null = null;
    if (isPruning && Array.isArray(trees) && trees.length > 1) {
      treeList = trees.slice(0, 8).map((t: any, i: number) => ({
        label: typeof t?.label === 'string' && t.label.trim() ? t.label.trim().slice(0, 40) : `Tree ${i + 1}`,
        note: typeof t?.note === 'string' && t.note.trim() ? t.note.trim().slice(0, 200) : null,
        photo_indexes: Array.isArray(t?.photo_indexes)
          ? t.photo_indexes.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < photoList.length).slice(0, 3)
          : [],
      }));
    }

    const captureId = crypto.randomUUID();
    // Free previews: 3 AI estimates a month (pruning never gets an AI price, so it never counts).
    const lockedPreview = freePreview && !isPruning;
    if (lockedPreview) {
      const claim = await claimFreeUse(admin, companyOwner, 'scout_preview', captureId);
      if (!claim.ok) {
        const trialUsed = await companyTrialUsed(admin, companyOwner);
        return new Response(JSON.stringify({ error: freeLimitMessage('scout_preview', claim.limit, trialUsed), code: 'free_scout_limit', used: claim.used, limit: claim.limit, trial_used: trialUsed }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      refundPreview = () => admin.from('free_plan_usage').delete().eq('owner_id', companyOwner).eq('kind', 'scout_preview').eq('ref_id', captureId);
    }

    // Upload photos (first one stays the primary photo_path for backwards compat)
    const photoPaths: string[] = [];
    for (let i = 0; i < photoList.length; i++) {
      const photo = decodeDataUrl(photoList[i]);
      const photoExt = photo.mime.split('/')[1]?.split('+')[0] || 'jpg';
      const path = photoPaths.length === 0
        ? `${userId}/${captureId}/photo.${photoExt}`
        : `${userId}/${captureId}/photo-${photoPaths.length + 1}.${photoExt}`;
      const { error } = await admin.storage.from('scout-media').upload(path, photo.bytes, { contentType: photo.mime, upsert: true });
      if (error) throw new Error('Photo upload failed: ' + error.message);
      photoPaths.push(path);
    }
    const photoPath = photoPaths[0];

    // Upload optional voice memo
    let voiceMemoPath: string | null = null;
    if (voiceMemoBase64) {
      const memo = decodeDataUrl(voiceMemoBase64);
      voiceMemoPath = `${userId}/${captureId}/voice-memo.webm`;
      const { error } = await admin.storage.from('scout-media').upload(voiceMemoPath, memo.bytes, { contentType: memo.mime, upsert: true });
      if (error) throw new Error('Voice memo upload failed: ' + error.message);
    }

    // Summarize notes via Lovable AI
    let notesSummary = (notesRaw ?? '').toString().trim();

    // If no typed notes but we have a voice memo, transcribe it via Lovable AI (Gemini multimodal)
    if (!notesSummary && voiceMemoBase64 && typeof voiceMemoBase64 === 'string') {
      try {
        const aiKey = Deno.env.get('LOVABLE_API_KEY');
        const m = /^data:([^;]+);base64,(.+)$/.exec(voiceMemoBase64);
        if (aiKey && m) {
          const mime = m[1];
          const b64 = m[2];
          const fmt = mime.includes('mp4') || mime.includes('aac') ? 'mp4'
            : mime.includes('mpeg') ? 'mp3'
            : mime.includes('wav') ? 'wav'
            : 'webm';
          const transRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'Transcribe the audio verbatim. Output ONLY the transcript, no preamble.' },
                { role: 'user', content: [
                  { type: 'text', text: 'Transcribe this voice memo from a tree-service estimator.' },
                  { type: 'input_audio', input_audio: { data: b64, format: fmt } },
                ] },
              ],
            }),
          });
          if (transRes.ok) {
            const tj = await transRes.json();
            const tx = tj?.choices?.[0]?.message?.content?.trim();
            if (tx) notesSummary = tx;
          } else {
            console.error('audio transcription failed', transRes.status, await transRes.text());
          }
        }
      } catch (e) { console.error('transcribe error', e); }
    }

    if (notesSummary.length > 0) {
      try {
        const aiKey = Deno.env.get('LOVABLE_API_KEY');
        if (aiKey) {
          const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You clean up rough field notes from a tree-service estimator into ONE short, simple paragraph (2-4 sentences). STRICT RULES: Do NOT assume, infer, guess, or invent ANY detail that is not explicitly stated in the notes. If something is unclear, garbled, ambiguous, or not understandable, OMIT it entirely — do not try to interpret it. Only include facts that are clearly stated. NEVER identify, guess, or name the tree species (e.g. oak, maple, pine) — even if the notes mention or hint at one, omit the species entirely. No bullet points, no headings, no fluff, no filler. If nothing is clearly understandable, return an empty string.' },
                { role: 'user', content: notesSummary },
              ],
            }),
          });
          if (aiRes.ok) {
            const j = await aiRes.json();
            const out = j?.choices?.[0]?.message?.content?.trim();
            if (out) notesSummary = out;
          }
        }
      } catch (_e) { /* fall back to raw */ }
    }

    // Determine the business owner who must review this capture.
    // - Solo accounts: owner is the submitter themselves (no behavior change).
    // - Team rep: owner is the parent unless the parent has opted into auto-approve.
    const { data: profile } = await admin
      .from('profiles')
      .select('parent_contractor_id')
      .eq('id', userId)
      .maybeSingle();
    const parentId = (profile?.parent_contractor_id as string | null) ?? null;
    let ownerId = userId;
    if (parentId) {
      const { data: parent } = await admin
        .from('profiles')
        .select('scout_auto_approve_reps')
        .eq('id', parentId)
        .maybeSingle();
      ownerId = parent?.scout_auto_approve_reps ? userId : parentId;
    }

    // Insert capture row
    const { error: insertErr } = await admin.from('scout_captures').insert({
      id: captureId,
      free_preview_locked: lockedPreview,
      contractor_id: userId,
      owner_id: ownerId,
      // Pruning never gets an AI estimate: it skips n8n and goes straight to review.
      status: isPruning ? 'awaiting_review' : 'pending',
      ...(isPruning ? { ai_service: 'Pruning/Trimming', ai_notes: PRUNING_NO_ESTIMATE } : {}),
      photo_path: photoPath,
      photo_paths: photoPaths,
      trees: treeList,
      voice_memo_path: voiceMemoPath,
      notes_raw: notesRaw ?? null,
      notes_summary: notesSummary || null,
      requested_service: requestedService,
      circumference_inches: circumferenceInches ?? null,
      diameter_inches: diameterInches ?? null,
      address_street: address.street,
      address_city: address.city,
      address_state: address.state,
      address_zip: address.zip,
      customer_name: (typeof customerName === 'string' && customerName.trim()) ? customerName.trim().slice(0, 120) : null,
      customer_phone: (typeof customerPhone === 'string' && customerPhone.trim()) ? customerPhone.trim().slice(0, 40) : null,
      customer_email: (typeof customerEmail === 'string' && customerEmail.trim()) ? customerEmail.trim().slice(0, 200) : null,
      ...wkPatch,
    });
    if (insertErr) throw new Error('DB insert failed: ' + insertErr.message);
    refundPreview = null;

    // Open the capture for crew bids right away (photo-only card for the crew).
    // Owners who have auto-broadcast turned off still send jobs out manually.
    try {
      const { data: ownerFlags } = await admin
        .from('profiles')
        .select('crew_auto_broadcast')
        .eq('id', ownerId)
        .maybeSingle();
      // A Free preview is never sent to subs on its own; the owner sends jobs from Jobs.
      // A demo (sandbox) company always gets the job in Jobs right away; no real sub is ever alerted from it.
      const demoCompany = (await companyMode(admin, ownerId)) === 'sandbox';
      if ((ownerFlags?.crew_auto_broadcast || demoCompany) && !freePreview) {
        const { data: existing } = await admin
          .from('bid_requests')
          .select('id')
          .eq('capture_id', captureId)
          .maybeSingle();
        if (!existing) {
          const res = await fetch(`${supabaseUrl}/functions/v1/bid-request-create`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              owner_contractor_id: ownerId,
              capture_id: captureId,
              title: requestedService || 'Tree job',
              description: notesSummary || null,
              city: address.city,
              photo_path: photoPath,
              role_needed: 'both',
            }),
          });
          if (!res.ok) console.error('scout auto bid request failed', res.status, await res.text());
        }
      }
    } catch (bidErr) {
      console.error('scout auto bid request error', bidErr);
    }

    // Create signed URLs (24h)
    const { data: photoSigned } = await admin.storage.from('scout-media').createSignedUrl(photoPath, 60 * 60 * 24);
    const photoSignedUrls: string[] = [];
    for (const p of photoPaths) {
      const { data } = await admin.storage.from('scout-media').createSignedUrl(p, 60 * 60 * 24);
      if (data?.signedUrl) photoSignedUrls.push(data.signedUrl);
    }
    let voiceSigned: string | null = null;
    if (voiceMemoPath) {
      const { data } = await admin.storage.from('scout-media').createSignedUrl(voiceMemoPath, 60 * 60 * 24);
      voiceSigned = data?.signedUrl ?? null;
    }

    // Scout learning: the company's learned guidance (empty unless the owner turned learning on), and a record of
    // what Scout is given, so the weekly loop compares Scout's own first answer. Never for pruning or Free previews.
    const learns = !isPruning && !lockedPreview;
    const learning = learns ? await activeGuidance(admin, companyOwner, 'scout') : NO_GUIDANCE;
    if (learns) {
      await recordScoutSent(admin, {
        captureId,
        companyId: companyOwner,
        versionId: learning.version_id,
        inputs: scoutInputs({ service: requestedService, diameterInches, circumferenceInches, notes: notesSummary, photoCount: photoPaths.length, voiceMemo: !!voiceMemoPath }),
      });
    }

    // Fire to n8n. src=scout marks Scout's own answers; Request Edit's answers come back without it.
    const callbackUrl = `${supabaseUrl}/functions/v1/scout-estimate-callback?src=scout`;
    const payload = {
      capture_id: captureId,
      photo_url: photoSigned?.signedUrl ?? null,
      photo_urls: photoSignedUrls,
      voice_memo_url: voiceSigned,
      notes_summary: notesSummary || null,
      service: requestedService,
      circumference_inches: circumferenceInches ?? null,
      diameter_inches: diameterInches ?? null,
      address: {
        street: address.street,
        city: address.city,
        state: address.state,
        zip: address.zip,
        full: `${address.street}, ${address.city}, ${address.state} ${address.zip}`,
      },
      callback_url: callbackUrl,
      submitted_at: new Date().toISOString(),
      company_guidance: learning.block,
    };

    // Send SMS alert to business owner that a scout capture was submitted.
    // A sandbox (demo) company sends none, not even the ops copy.
    const quietScout = (await companyMode(admin, ownerId)) === 'sandbox';
    if (!quietScout) try {
      const { data: ownerProfile } = await admin
        .from('profiles')
        .select('phone, full_name')
        .eq('id', ownerId)
        .maybeSingle();
      const { data: repProfile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', userId)
        .maybeSingle();

      const ownerPhoneRaw = (ownerProfile?.phone ?? '').toString();
      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

      const sendSms = async (toRaw: string, body: string) => {
        if (!toRaw || !accountSid || !authToken || !fromNumber) return;
        let phone = toRaw.replace(/\D/g, '');
        if (phone.length === 10) phone = '+1' + phone;
        else if (!phone.startsWith('+')) phone = '+' + phone;
        try {
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + btoa(`${accountSid}:${authToken}`),
              },
              body: new URLSearchParams({ To: phone, From: fromNumber, Body: body }),
            },
          );
          if (!res.ok) console.error('Scout SMS send failed', res.status, await res.text());
        } catch (smsErr) {
          console.error('Scout SMS error', smsErr);
        }
      };

      const repLabel = repProfile?.full_name || repProfile?.email || 'Your field rep';
      const svcLabel = requestedService || 'a tree job';
      const addrLabel = `${address.street}, ${address.city}`;
      const ownerMsg = `TreeCheck Scout: ${repLabel} just submitted a new ${svcLabel} capture at ${addrLabel}. Review it in your dashboard.`;
      const adminMsg = `Scout capture submitted by ${repLabel} (owner ${ownerId.slice(0, 8)}) — ${svcLabel} at ${addrLabel}.`;

      // Alert business owner (if a different person than the submitting rep)
      if (ownerId !== userId) {
        await sendSms(ownerPhoneRaw, ownerMsg);
      } else {
        // Solo account — still confirm receipt to the submitter
        await sendSms(ownerPhoneRaw, ownerMsg);
      }

      // Admin alert per ops policy
      await sendSms('+13036693816', adminMsg);
    } catch (alertErr) {
      console.error('scout-submit alert error', alertErr);
    }

    if (!isPruning) try {
      const n8nRes = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scout-Secret': Deno.env.get('SCOUT_WEBHOOK_SECRET') ?? '',
        },
        body: JSON.stringify(payload),
      });
      if (!n8nRes.ok) console.error('n8n webhook non-OK', n8nRes.status, await n8nRes.text());
    } catch (e) {
      console.error('n8n webhook failed', e);
    }

    return new Response(JSON.stringify({ capture_id: captureId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    console.error('scout-submit error', e);
    if (refundPreview) await refundPreview().catch(() => undefined);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
