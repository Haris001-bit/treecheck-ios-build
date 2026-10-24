import { createClient } from 'npm:@supabase/supabase-js@2';

export async function requireCompanyPermission(req: Request, ownerId: string, permission: string) {
  const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
  });
  const { data, error } = await caller.rpc('company_has_permission', { p_owner: ownerId, p_permission: permission });
  if (error || data !== true) throw new Error('Your company owner has not granted this permission.');
}