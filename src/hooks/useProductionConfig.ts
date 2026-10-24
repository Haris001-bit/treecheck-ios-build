import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import type { CompanyCostConfig } from '@/lib/production/engine';

export interface LaborRole { id?: string; role_key: string; name: string; loaded_hourly_cost: number; sort_order: number }
export interface EquipmentItem { id?: string; equipment_key: string; name: string; hourly_cost: number; sort_order: number }
export interface ProductionPricing { target_margin: number; minimum_job_charge: number | null; disposal_per_load: number | null }

export const DEFAULT_ROLES: LaborRole[] = [
  { role_key: 'crew_lead', name: 'Crew Lead', loaded_hourly_cost: 38, sort_order: 0 },
  { role_key: 'climber', name: 'Climber', loaded_hourly_cost: 42, sort_order: 1 },
  { role_key: 'ground', name: 'Ground Worker', loaded_hourly_cost: 29, sort_order: 2 },
  { role_key: 'bucket_operator', name: 'Bucket Operator', loaded_hourly_cost: 36, sort_order: 3 },
];
export const DEFAULT_EQUIPMENT: EquipmentItem[] = [
  { equipment_key: 'chipper', name: 'Chipper', hourly_cost: 25, sort_order: 0 },
  { equipment_key: 'mini_skid', name: 'Mini Skid', hourly_cost: 30, sort_order: 1 },
  { equipment_key: 'bucket_truck', name: 'Bucket Truck', hourly_cost: 45, sort_order: 2 },
  { equipment_key: 'chip_truck', name: 'Chip Truck', hourly_cost: 20, sort_order: 3 },
  { equipment_key: 'stump_grinder', name: 'Stump Grinder', hourly_cost: 35, sort_order: 4 },
  { equipment_key: 'crane', name: 'Crane', hourly_cost: 250, sort_order: 5 },
];
export const DEFAULT_PRICING: ProductionPricing = { target_margin: 0.3, minimum_job_charge: null, disposal_per_load: null };

export function useProductionConfig() {
  const { user, effectiveContractorId } = useAuth();
  const ownerId = effectiveContractorId ?? user?.id ?? null;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['production-config', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const db = supabase as any;
      const [r, e, p] = await Promise.all([
        db.from('production_labor_roles').select('*').eq('contractor_id', ownerId).order('sort_order'),
        db.from('production_equipment').select('*').eq('contractor_id', ownerId).order('sort_order'),
        db.from('production_pricing').select('*').eq('contractor_id', ownerId).maybeSingle(),
      ]);
      const configured = (r.data?.length ?? 0) > 0 || (e.data?.length ?? 0) > 0 || !!p.data;
      const roles: LaborRole[] = r.data?.length ? r.data : DEFAULT_ROLES;
      const equipment: EquipmentItem[] = e.data?.length ? e.data : DEFAULT_EQUIPMENT;
      const pricing: ProductionPricing = p.data ?? DEFAULT_PRICING;
      return { roles, equipment, pricing, configured };
    },
  });
  const cfg: CompanyCostConfig | null = q.data ? {
    laborRates: Object.fromEntries(q.data.roles.map((x) => [x.role_key, Number(x.loaded_hourly_cost)])),
    equipmentRates: Object.fromEntries(q.data.equipment.map((x) => [x.equipment_key, Number(x.hourly_cost)])),
    targetMargin: Number(q.data.pricing.target_margin),
    minimumJobCharge: q.data.pricing.minimum_job_charge != null ? Number(q.data.pricing.minimum_job_charge) : null,
    disposalPerLoad: q.data.pricing.disposal_per_load != null ? Number(q.data.pricing.disposal_per_load) : null,
  } : null;

  const save = async (roles: LaborRole[], equipment: EquipmentItem[], pricing: ProductionPricing) => {
    const db = supabase as any;
    const keepR = roles.map((x) => x.role_key);
    const keepE = equipment.map((x) => x.equipment_key);
    const { data: oldR } = await db.from('production_labor_roles').select('role_key').eq('contractor_id', ownerId);
    const { data: oldE } = await db.from('production_equipment').select('equipment_key').eq('contractor_id', ownerId);
    const delR = (oldR ?? []).map((x: any) => x.role_key).filter((k: string) => !keepR.includes(k));
    const delE = (oldE ?? []).map((x: any) => x.equipment_key).filter((k: string) => !keepE.includes(k));
    if (delR.length) await db.from('production_labor_roles').delete().eq('contractor_id', ownerId).in('role_key', delR);
    if (delE.length) await db.from('production_equipment').delete().eq('contractor_id', ownerId).in('equipment_key', delE);
    const res = await Promise.all([
      db.from('production_labor_roles').upsert(roles.map(({ id, ...x }, i) => ({ ...x, sort_order: i, contractor_id: ownerId, updated_at: new Date().toISOString() })), { onConflict: 'contractor_id,role_key' }),
      db.from('production_equipment').upsert(equipment.map(({ id, ...x }, i) => ({ ...x, sort_order: i, contractor_id: ownerId, updated_at: new Date().toISOString() })), { onConflict: 'contractor_id,equipment_key' }),
      db.from('production_pricing').upsert({ ...pricing, contractor_id: ownerId, updated_at: new Date().toISOString() }, { onConflict: 'contractor_id' }),
    ]);
    const err = res.find((x: any) => x.error)?.error;
    if (err) throw err;
    qc.invalidateQueries({ queryKey: ['production-config'] });
  };

  return { ...q, cfg, save, ownerId };
}

export const keyFromName = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `item_${Date.now()}`;
