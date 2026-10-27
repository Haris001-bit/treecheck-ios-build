// Who is calling a production-* function, which company they belong to, and what they may do there. The layer check
// runs production_can (PS1) as the caller, so it is exactly the rule the tables enforce. Maintained outside Lovable.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const productionCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
export const productionJson = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...productionCors, "Content-Type": "application/json" } });

export type ProductionLayer = "price" | "setup" | "dispatch" | "field" | "costs";

export interface ProductionCaller {
  userId: string;
  ownerId: string;
  admin: SupabaseClient;
  asCaller: SupabaseClient;
  can: (layer: ProductionLayer) => Promise<boolean>;
}

/** Null when the request has no valid session. */
export async function productionCaller(req: Request): Promise<ProductionCaller | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: who, error } = await asCaller.auth.getUser();
  const userId = who?.user?.id;
  if (error || !userId) return null;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("parent_contractor_id").eq("id", userId).maybeSingle();
  const ownerId = (me?.parent_contractor_id as string | null) ?? userId;
  const cache = new Map<ProductionLayer, boolean>();
  const can = async (layer: ProductionLayer) => {
    if (cache.has(layer)) return cache.get(layer)!;
    const { data, error: e } = await asCaller.rpc("production_can", { p_owner: ownerId, p_layer: layer });
    const ok = !e && data === true;
    cache.set(layer, ok);
    return ok;
  };
  return { userId, ownerId, admin, asCaller, can };
}

/** Whether the company is in the rollout and runs its own crews (production_status as the caller). */
export async function productionEligible(c: ProductionCaller): Promise<boolean> {
  const { data, error } = await c.asCaller.rpc("production_status");
  return !error && !!data && (data as { eligible?: boolean }).eligible === true;
}

// The company data helpers live in productionData.ts (no npm imports, so vitest runs what uses them); re-exported here.
export {
  todayIso, effectiveCard, companySettings, companyCosts, capacitySettings, backlogNow, pathInCompany, MEDIA_BUCKET, type SettingsLite,
} from "./productionData.ts";
