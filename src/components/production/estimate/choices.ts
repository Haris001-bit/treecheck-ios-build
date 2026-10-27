import type { Answers, RateCardDefinition } from '@/lib/production/rules';
import type { EstimateItemInput } from '@/lib/production/estimate';

/** A work item as the salesperson edits it: the AI's unsure answers stay outlined until checked. */
export type ItemDraft = EstimateItemInput & { uncertain?: string[] };

// The crew and hours last picked per service, offered first next time (this device only).
const REMEMBER = 'tc-crew-estimate-last';
function remembered(): Record<string, { crew?: string; hours?: number }> {
  try { return JSON.parse(localStorage.getItem(REMEMBER) ?? '{}'); } catch { return {}; }
}
export function rememberChoice(serviceKey: string, crew?: string, hours?: number) {
  try { localStorage.setItem(REMEMBER, JSON.stringify({ ...remembered(), [serviceKey]: { crew, hours } })); } catch { /* private mode */ }
}
export function lastChoice(serviceKey: string) { return remembered()[serviceKey] ?? {}; }

/** A new work item's first answers: the crew and hours last picked for this service, under the service's own question keys. */
export function startingAnswers(def: RateCardDefinition, serviceKey: string): Answers {
  const service = def.services.find((s) => s.key === serviceKey);
  const st = service?.strategy;
  if (!service || st?.kind !== 'crew_time') return {};
  const last = lastChoice(serviceKey);
  const crewOk = !!last.crew && (service.questions.find((q) => q.key === st.crewQuestion)?.choices ?? []).some((c) => c.value === last.crew);
  return { [st.crewQuestion]: crewOk ? last.crew! : null, [st.hoursQuestion]: last.hours ?? null };
}
