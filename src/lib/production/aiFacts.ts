/**
 * Large-company setup: the facts the AI may pull from a salesperson's photos and voice note, each with a confidence.
 * The AI never prices: these facts only pre-fill answers, the salesperson confirms them (uncertain ones highlighted),
 * and the company's published rules set the price. Pure.
 */
import type { Answers, CrewTemplate, Question, Service } from './rules';
import type { AnswerSource } from './productionRules';

type FactKind = 'number' | 'boolean' | 'text' | { choices: string[] };
export interface AiFact { key: string; label: string; kind: FactKind }

export const AI_FACTS: AiFact[] = [
  { key: 'dbh', label: 'Trunk diameter at breast height, inches', kind: 'number' },
  { key: 'height', label: 'Tree height, feet', kind: 'number' },
  { key: 'tree_count', label: 'Number of trees for this item', kind: 'number' },
  { key: 'species', label: 'Likely species', kind: 'text' },
  { key: 'condition', label: 'Condition', kind: { choices: ['healthy', 'declining', 'dead'] } },
  { key: 'access', label: 'Access for crew and equipment', kind: { choices: ['easy', 'moderate', 'tight', 'rear_yard'] } },
  { key: 'gated', label: 'Behind a gate', kind: 'boolean' },
  { key: 'structure_near', label: 'House or structure in the drop zone', kind: 'boolean' },
  { key: 'utility', label: 'Utility lines', kind: { choices: ['none', 'near_lines', 'service_drop', 'primary_lines'] } },
  { key: 'crane', label: 'Crane likely needed', kind: 'boolean' },
  { key: 'lift', label: 'Lift likely needed', kind: 'boolean' },
  { key: 'mini', label: 'Mini skid fits and helps', kind: 'boolean' },
  { key: 'stump_grinding', label: 'Customer wants the stump ground', kind: 'boolean' },
  { key: 'stump_diameter', label: 'Stump diameter flare to flare, inches', kind: 'number' },
  { key: 'crew_size', label: 'Crew size the salesperson mentions', kind: 'number' },
  { key: 'duration_hours', label: 'Time on site the salesperson mentions, hours', kind: 'number' },
  { key: 'debris', label: 'Debris handling', kind: { choices: ['haul_all', 'leave_wood', 'chip_on_site'] } },
  { key: 'cables', label: 'Cables needed', kind: 'number' },
  { key: 'braces', label: 'Braces needed', kind: 'number' },
  { key: 'props', label: 'Props needed', kind: 'number' },
  { key: 'phc_treatment', label: 'Plant health treatment mentioned', kind: 'text' },
  { key: 'planting_type', label: 'Replacement tree type', kind: { choices: ['shade', 'evergreen', 'ornamental', 'screening', 'maple'] } },
  { key: 'light', label: 'Light at the planting site', kind: { choices: ['full_sun', 'part_shade', 'shade'] } },
  { key: 'moisture', label: 'Moisture at the planting site', kind: { choices: ['dry', 'average', 'wet'] } },
  { key: 'urgency', label: 'Urgency', kind: { choices: ['asap', 'priority', 'normal'] } },
  { key: 'hazards', label: 'Special hazards or instructions', kind: 'text' },
];

const valueSchema = (k: FactKind) => {
  if (k === 'number') return { type: ['number', 'null'] };
  if (k === 'boolean') return { type: ['boolean', 'null'] };
  if (k === 'text') return { type: ['string', 'null'] };
  return { anyOf: [{ type: 'string', enum: k.choices }, { type: 'null' }] };
};

/** Strict JSON schema for the AI's answer, with the company's service keys as the allowed services. */
export function aiSchema(services: { key: string }[]) {
  const keys = services.length ? services.map((s) => s.key) : ['other'];
  const facts: Record<string, unknown> = {};
  for (const f of AI_FACTS) {
    facts[f.key] = {
      type: 'object', additionalProperties: false, required: ['value', 'confidence'],
      properties: { value: valueSchema(f.kind), confidence: { type: 'number', description: '0 to 1' } },
    };
  }
  return {
    type: 'object', additionalProperties: false, required: ['trees'],
    properties: {
      trees: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['label', 'services', 'facts', 'observations'],
          properties: {
            label: { type: 'string' },
            services: { type: 'array', items: { type: 'string', enum: keys } },
            facts: { type: 'object', additionalProperties: false, required: AI_FACTS.map((f) => f.key), properties: facts },
            observations: { type: 'string' },
          },
        },
      },
    },
  };
}

export interface FactValue { value: string | number | boolean | null; confidence: number }

function toAnswer(q: Question, v: FactValue['value']): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  switch (q.kind) {
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? v : null;
    case 'count': return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
    case 'yes_no': return typeof v === 'boolean' ? v : ['yes', 'true'].includes(String(v).toLowerCase()) ? true : ['no', 'false'].includes(String(v).toLowerCase()) ? false : null;
    case 'choice': {
      const s = String(v).toLowerCase();
      const c = q.choices?.find((x) => x.value.toLowerCase() === s || x.label.toLowerCase() === s);
      return c ? c.value : null;
    }
    default: return String(v).slice(0, 200);
  }
}

/**
 * The AI's facts as answers for one service. A question takes the fact named in its aiFact (or a fact with its own
 * key); a crew question takes the template whose headcount matches the crew size mentioned, and an hours question
 * the time mentioned. Below the threshold an answer is still filled but listed as uncertain.
 */
export function factsToAnswers(service: Service, facts: Record<string, FactValue>, crews: CrewTemplate[] = [], threshold = 0.6) {
  const answers: Answers = {};
  const sources: Record<string, AnswerSource> = {};
  const uncertain: string[] = [];
  const confidence: Record<string, number> = {};
  const st = service.strategy;
  for (const q of service.questions) {
    let f: FactValue | undefined;
    let value: string | number | boolean | null = null;
    if (st.kind === 'crew_time' && q.key === st.crewQuestion) {
      f = facts.crew_size;
      const n = typeof f?.value === 'number' ? Math.round(f.value) : null;
      const t = n === null ? undefined : crews.find((c) => c.roles.reduce((s, r) => s + r.count, 0) === n);
      value = t && q.choices?.some((c) => c.value === t.key) ? t.key : null;
    } else if (st.kind === 'crew_time' && q.key === st.hoursQuestion) {
      f = facts.duration_hours;
      value = toAnswer(q, f?.value ?? null);
    } else {
      f = facts[q.aiFact ?? q.key];
      value = f ? toAnswer(q, f.value) : null;
    }
    if (value === null || !f) continue;
    answers[q.key] = value;
    sources[q.key] = 'ai';
    confidence[q.key] = Math.max(0, Math.min(1, Number(f.confidence) || 0));
    if (confidence[q.key] < threshold) uncertain.push(q.key);
  }
  return { answers, sources, uncertain, confidence };
}
