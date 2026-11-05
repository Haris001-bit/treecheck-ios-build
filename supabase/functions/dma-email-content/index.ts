import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { featuredProjectPrompt, jobNotesMessage, withBrandVoice, FORMULA_TOOL, renderArticle, type FormulaProject } from '../_shared/dmaFormula.ts';
import { claimFreeUse, companyTrialUsed, freeLimitMessage } from '../_shared/freePlan.ts';
import { previewTeaser } from './teaser.ts';

const fields = z.object({ title: z.string().trim().min(1).max(200), article: z.string().trim().min(1).max(20000), google_caption: z.string().trim().max(5000), facebook_caption: z.string().trim().max(5000), instagram_caption: z.string().trim().max(5000) }).strict();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), notes: z.string().trim().min(1).max(5000), neighborhood: z.string().trim().max(100).optional(), photo_paths: z.array(z.string().max(300)).min(1).max(4) }).strict(),
  z.object({ action: z.literal('save'), id: z.string().uuid(), content: fields }).strict(),
  z.object({ action: z.literal('send'), id: z.string().uuid() }).strict(),
]);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // A preview that fails after its monthly slot was taken gives the slot back.
  let refund: null | (() => PromiseLike<unknown>) = null;
  if (req.method !== 'POST') return json({ error: 'Use a POST request.' }, 405);
  try {
    const header = req.headers.get('Authorization');
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!header) return json({ error: 'Please sign in again.' }, 401);
    if (!url || !key || !anon) return json({ error: 'Marketing is not configured.' }, 503);
    const caller = createClient(url, anon, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return json({ error: 'Please sign in again.' }, 401);
    const body = schema.safeParse(await req.json().catch(() => null));
    if (!body.success) return json({ error: 'Check your notes, photos and content.' }, 400);
    // One authority owns company resolution, permissions and date-bounded DMA access.
    const { data: access, error: accessError } = await caller.functions.invoke('dma-setup', { body: { action: 'status' } });
    if (accessError || access?.error || !access?.can_manage) return json({ error: 'Marketing management access is required.' }, 403);
    // Free plan previews (owner only): a partial post, the rest waits server-side until a trial or paid plan.
    const preview = access.free_preview === true && !access.can_generate;
    if (!access.can_generate && !preview) return json({ error: 'Your trial has ended. Active DMA access is required to create or send posts.' }, 403);
    if (access.connected) return json({ error: 'This company publishes to its connected website. Use the existing publishing workflow.' }, 409);
    // Same as the website path (Mark, 2026-10-29): photos + a voice memo is enough; the brand voice setup is optional.
    const db = createClient(url, key, { auth: { persistSession: false } });
    const owner = access.setup?.contractor_id ?? access.owner_id ?? (preview ? auth.user.id : null);
    const companyName = access.setup?.company_name || access.defaults?.company_name || 'Tree service company';
    const serviceArea = access.setup?.service_area || access.defaults?.service_area || '';
    const voiceSample = access.setup?.voice_preview || 'Not provided';
    if (!owner) return json({ error: 'Company setup is missing.' }, 400);
    const input = body.data;
    if (input.action === 'send') {
      // Never report a send or queue success without verified sender infrastructure.
      return json({ error: 'Email delivery is awaiting sender-domain setup. Your saved content is available to copy.' }, 503);
    }
    if (input.action === 'save') {
      const { data: current } = await db.from('dma_email_posts').select('free_preview_locked').eq('contractor_id', owner).eq('id', input.id).maybeSingle();
      if (current?.free_preview_locked) return json({ error: 'Start your trial to see and edit the full post.' }, 403);
      const { data: post, error } = await db.from('dma_email_posts').update({ ...input.content, updated_at: new Date().toISOString() }).eq('contractor_id', owner).eq('id', input.id).select('*').maybeSingle();
      if (error) throw error;
      if (!post) return json({ error: 'This post is not available to your company.' }, 404);
      return json({ post });
    }
    const urls: string[] = [];
    for (const path of input.photo_paths) {
      if (!path.startsWith(`dma/${auth.user.id}/`) || path.includes('..') || !/^dma\/[0-9a-f-]+\/[0-9a-f-]+\/photo-[1-4]\.(jpg|jpeg|png|webp)$/.test(path)) return json({ error: 'A photo does not belong to this submission.' }, 400);
      const { data, error } = await db.storage.from('lead-photos').createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return json({ error: 'Could not load a job photo. Please upload it again.' }, 400);
      urls.push(data.signedUrl);
    }
    const aiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!aiKey) return json({ error: 'Content generation is not configured.' }, 503);
    const postId = crypto.randomUUID();
    if (preview) {
      const claim = await claimFreeUse(db, owner, 'dma_preview', postId);
      if (!claim.ok) {
        const trialUsed = await companyTrialUsed(db, owner);
        return json({ error: freeLimitMessage('dma_preview', claim.limit, trialUsed), code: 'free_dma_limit', used: claim.used, limit: claim.limit, trial_used: trialUsed }, 403);
      }
      refund = () => db.from('free_plan_usage').delete().eq('owner_id', owner).eq('kind', 'dma_preview').eq('ref_id', postId);
    }
    // Same Featured Project formula as the website writer, filled with this company's own name, phone and area.
    const { data: ownerProfile } = await db.from('profiles').select('full_name,phone').eq('id', owner).maybeSingle();
    const system = withBrandVoice(featuredProjectPrompt({ name: companyName, owner: access.setup?.contact_name || ownerProfile?.full_name || '', phone: ownerProfile?.phone || '', serviceArea, website: access.setup?.website_url || access.defaults?.website_url || '' }), access.setup?.brand_voice);
    const userText = `${jobNotesMessage(input.notes, input.neighborhood)}\n\n${voiceSample !== 'Not provided' ? `Owner-approved voice sample: ${voiceSample}\n\n` : ''}Number of photos provided: ${urls.length}. Generate the featured project now.`;
    let project: FormulaProject | null = null;
    for (let attempt = 1; attempt <= 3 && !project; attempt++) {
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST', signal: req.signal,
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: userText }, ...urls.map(url => ({ type: 'image_url', image_url: { url } }))] }], tools: [FORMULA_TOOL], tool_choice: { type: 'function', function: { name: 'generate_featured_project' } } }),
      });
      if (res.status === 429 || res.status === 402) {
        if (refund) await refund();
        return json({ error: res.status === 429 ? 'Post writing is busy. Try again in a minute.' : 'Post writing is temporarily unavailable. Please try again later.' }, res.status);
      }
      if (res.ok) {
        const args = (await res.json())?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        try { if (args) project = JSON.parse(args); } catch { project = null; }
      } else console.warn('[dma-email] AI attempt', attempt, res.status, (await res.text()).slice(0, 300));
      if (!project && attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
    }
    const output = project && project.title && project.intro && Array.isArray(project.sections)
      ? { title: project.title, article: renderArticle(project), google_caption: project.googleCaption || '', facebook_caption: project.facebookCaption || '', instagram_caption: project.instagramCaption || '' }
      : null;
    const content = fields.safeParse(output);
    if (!content.success) {
      if (refund) await refund();
      return json({ error: 'The generated content was incomplete. Your photos and notes are unchanged; try again.' }, 502);
    }
    if (preview) {
      const { error: vaultError } = await db.from('free_preview_vault').insert({ kind: 'dma', ref_id: postId, owner_id: owner, content: content.data });
      if (vaultError) throw vaultError;
    }
    const shown = preview
      ? { title: content.data.title, article: previewTeaser(content.data.article), google_caption: '', facebook_caption: '', instagram_caption: '', free_preview_locked: true }
      : content.data;
    const { data: post, error } = await db.from('dma_email_posts').insert({ id: postId, contractor_id: owner, created_by: auth.user.id, notes: input.notes, photo_paths: input.photo_paths, ...shown }).select('*').single();
    if (error) throw error;
    refund = null;
    return json({ post });
  } catch (error) {
    if (refund) await Promise.resolve(refund()).catch(() => undefined);
    if (error instanceof Error && error.name === 'AbortError') return json({ error: 'Generation cancelled.' }, 499);
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    // Preserve provider status and failure detail, not a generic invocation failure.
    const message = error instanceof Error ? error.message : 'Could not prepare this post.';
    console.error('DMA content failed', status, message);
    return json({ error: message }, [400,401,402,403,429,500,502,503].includes(status) ? status : 500);
  }
});