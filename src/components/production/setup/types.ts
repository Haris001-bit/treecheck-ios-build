import type { RateCardDefinition } from '@/lib/production/rules';
import type { ProductionStatus, SettingsRow } from '@/lib/production/client';
import type { TeamMember } from '@/hooks/useProductionSetup';

export type StepKey = 'basics' | 'services' | 'pricing' | 'crews' | 'method' | 'playbooks' | 'policies' | 'review' | 'validate' | 'publish';

export interface StepProps {
  def: RateCardDefinition;
  update: (fn: (d: RateCardDefinition) => void) => void;
  settings: SettingsRow;
  updateSettings: (patch: Partial<SettingsRow>) => void;
  status: ProductionStatus;
  members: TeamMember[];
  goTo: (step: StepKey, serviceKey?: string) => void;
  focusService: string | null;
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
