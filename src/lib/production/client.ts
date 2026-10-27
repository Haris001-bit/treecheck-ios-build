/**
 * Large-company setup: the browser's view of the production_* tables (PS1). Client only, never copied to the functions.
 * The tables aren't in the generated Supabase types until Lovable regenerates them, so reads go through one cast here.
 */
import { supabase } from '@/integrations/supabase/client';
import { parseDefinition, type RateCardDefinition } from './rules';
import { starterDefinition } from './starter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const productionDb = supabase as any;

export interface ProductionStatus {
  rollout: boolean;
  eligible: boolean;
  started: boolean;
  published: boolean;
  owner: string | null;
  is_owner: boolean;
  operating_model: string;
  jobber_extras: boolean;
  can: { price: boolean; setup: boolean; dispatch: boolean; field: boolean; costs: boolean };
}

export const STATUS_OFF: ProductionStatus = {
  rollout: false, eligible: false, started: false, published: false, owner: null, is_owner: false,
  operating_model: 'subcontractors', jobber_extras: false,
  can: { price: false, setup: false, dispatch: false, field: false, costs: false },
};

/** Anything unexpected from production_status means everything stays off. */
export function readStatus(raw: unknown): ProductionStatus {
  if (!raw || typeof raw !== 'object') return STATUS_OFF;
  const r = raw as Partial<ProductionStatus> & { can?: Partial<ProductionStatus['can']> };
  const yes = (v: unknown) => v === true;
  return {
    rollout: yes(r.rollout), eligible: yes(r.eligible), started: yes(r.started), published: yes(r.published),
    owner: typeof r.owner === 'string' ? r.owner : null, is_owner: yes(r.is_owner),
    operating_model: typeof r.operating_model === 'string' ? r.operating_model : 'subcontractors',
    jobber_extras: yes(r.jobber_extras),
    can: { price: yes(r.can?.price), setup: yes(r.can?.setup), dispatch: yes(r.can?.dispatch), field: yes(r.can?.field), costs: yes(r.can?.costs) },
  };
}

export interface ResourceRow { key: string; name: string; ownership: 'owned' | 'rented' | 'vendor'; units: number; hoursPerDay: number; leadTimeDays: number; restrictions?: string }
export interface Basics { branches?: { key: string; name: string }[]; workingDays?: number[]; dayHours?: number; territory?: string; taxRate?: number | null }

export interface SettingsRow {
  contractor_id: string;
  basics: Basics;
  crew_counts: Record<string, number | Record<string, number>>;
  resources: ResourceRow[];
  cost_viewer_ids: string[];
  send_unit_cost: boolean;
  isa_credentials: Record<string, string>;
  active_profile: string;
  profile_schedule: { key: string; from: string; to: string }[];
}

export interface CardRow {
  id: string;
  label: string;
  branch_key: string | null;
  status: 'draft' | 'published' | 'archived';
  version: number | null;
  effective_from: string | null;
  published_at: string | null;
  definition: unknown;
  updated_at: string;
}

/** The definition a new draft starts from: the latest published card's, or the starter card. */
export function newDraftDefinition(fromPublished: unknown | null): RateCardDefinition {
  if (fromPublished) {
    const p = parseDefinition(fromPublished);
    if (p.kind === 'ok') {
      const def = structuredClone(p.def);
      // Frozen selling rates belong to the card they were published with; publishing again works them out afresh.
      def.pricing.derivedRates = undefined;
      return def;
    }
  }
  return starterDefinition();
}

export const DEFAULT_BASICS: Basics = { branches: [], workingDays: [1, 2, 3, 4, 5], dayHours: 8, territory: '', taxRate: null };
