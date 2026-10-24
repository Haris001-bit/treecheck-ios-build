import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { brandVoice, withinTrial, connectedPublisher } from './rules.ts';
import { companyPlan } from '../_shared/freePlan.ts';

const text = z.string().trim().max(1000);
const voices = z.object({
  tone: z.array(z.string().max(100)).max(3), toneOther: text,
  concerns: z.array(z.string().max(100)).max(3), concernsOther: text,
  standards: z.array(z.string().max(100)).max(3), standardsOther: text,
  story: text, favoritePhrases: text, avoid: text, example: text,
}).strict();
const valuesSchema = z.object({
  company_name: z.string().trim().min(1).max(150), contact_name: z.string().trim().min(1).max(100),
  delivery_email: z.string().trim().email().max(255), service_area: z.string().trim().min(1).max(200),
  website_url: z.union([z.literal(''), z.string().trim().url().max(500).refine(v => /^https?:\/\//i.test(v))]),
  voice_answers: voices, voice_preview: z.string().trim().max(2000),
}).strict();
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('save'), values: valuesSchema, complete: z.boolean() }).strict(),
]);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use a POST request.' }, 405);
  try {
    const header = req.headers.get('Authorization');
    if (!header) return json({ error: 'Please sign in again.' }, 401);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !key || !anon) return json({ error: 'Marketing setup is not configured.' }, 503);
    const db = createClient(url, key, { auth: { persistSession: false } });
    const caller = createClient(url, anon, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return json({ error: 'Please sign in again.' }, 401);
    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Check your company details and email address.', fields: parsed.error.flatten() }, 400);
    const { data: own, error: ownError } = await db.from('profiles').select('id,parent_contractor_id,account_type').eq('id', auth.user.id).single();
    if (ownError) throw ownError;
    if (own.account_type !== 'company') return json({ error: 'DMA setup is for company accounts.' }, 403);
    const owner = own.parent_contractor_id || own.id;
    const { data: profile, error: profileError } = await db.from('profiles').select('company_name,full_name,email,subscription_tier,trial_ends_at,dma_beta_enabled,is_founder').eq('id', owner).single();
    if (profileError) throw profileError;
    const { data: allowed, error: permissionError } = await caller.rpc('company_has_permission', { p_owner: owner, p_permission: 'dmaManage' });
    if (permissionError) throw permissionError;
    // Legacy RPC bypasses feature checks; constrain legacy team members explicitly.
    let canManage = allowed === true;
    // Free plan (Oklahoma owners): the owner can set up DMA and make preview posts, never full posts.
    const freePreview = auth.user.id === owner && (await companyPlan(db, owner)) === 'free';
    if (freePreview) canManage = true;
    if (auth.user.id !== owner) {
      const { data: member, error } = await db.from('team_member_access').select('member_kind,permissions,status').eq('owner_id', owner).eq('user_id', auth.user.id).maybeSingle();
      if (error) throw error;
      canManage = canManage && member?.status === 'active' && member.member_kind === 'employee' && member.permissions?.dmaManage === true;
    }
    const [{ data: integration, error: intError }, { data: setup, error: setupError }, { data: billing, error: billingError }] = await Promise.all([
      db.from('dma_integrations').select('site_provider,publish_endpoint_url,website_url,public_site_url').eq('contractor_id', owner).maybeSingle(),
      db.from('dma_company_setup').select('*').eq('contractor_id', owner).maybeSingle(),
      db.from('company_billing').select('pricing_version,status,trial_ends_at').eq('owner_id', owner).maybeSingle(),
    ]);
    if (intError || setupError || billingError) throw intError || setupError || billingError;
    if (!canManage) return json({ error: 'Your company owner has not granted marketing management access.' }, 403);
    const versioned = billing?.pricing_version === '2026-10';
    const trialEnd = versioned && billing?.status === 'trialing' ? billing.trial_ends_at : profile.subscription_tier === 'demo_trial' ? profile.trial_ends_at : null;
    const trialActive = withinTrial(trialEnd);
    let canGenerate = versioned ? canManage : trialActive || profile.dma_beta_enabled === true || profile.is_founder === true;
    if (!versioned && !canGenerate) {
      const { data: entitlements, error } = await db.from('product_entitlements').select('status,current_period_end').eq('contractor_id', owner).in('product', ['dma','dma_web']);
      if (error) throw error;
      canGenerate = (entitlements || []).some(e => ['active','trialing'].includes(e.status) && (!e.current_period_end || withinTrial(e.current_period_end)));
      if (!canGenerate) {
        const { data, error } = await caller.functions.invoke('check-dma-subscription');
        if (!error && !data?.error) canGenerate = data?.subscribed === true || data?.beta_enabled === true;
      }
    }
    if (parsed.data.action === 'status') return json({ setup, connected: connectedPublisher(owner, integration), can_manage: canManage, can_generate: canGenerate, free_preview: freePreview && !canGenerate, trial_ends_at: trialActive ? trialEnd : null,
      defaults: { company_name: profile.company_name || '', contact_name: profile.full_name || '', delivery_email: profile.email || '', service_area: '', website_url: integration?.public_site_url || integration?.website_url || '' } });
    const values = parsed.data.values;
    const voice = brandVoice(values.voice_answers);
    const { data: saved, error: saveError } = await db.from('dma_company_setup').upsert({ ...values, contractor_id: owner, brand_voice: voice,
      completed_at: parsed.data.complete ? setup?.completed_at || new Date().toISOString() : setup?.completed_at || null, updated_at: new Date().toISOString() }).select('*').single();
    if (saveError) throw saveError;
    // Only sync voice guidance: never alter their real publishing endpoint or login email.
    const { error: syncError } = await db.from('dma_integrations').upsert({ contractor_id: owner, brand_voice: voice }, { onConflict: 'contractor_id' });
    if (syncError) throw syncError;
    return json({ setup: saved });
  } catch (error) {
    console.error('DMA setup failed', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'Could not save your marketing setup. Please try again.' }, 500);
  }
});