import type { Category, CrewTemplate, Service, Strategy } from '@/lib/production/rules';

export const STRATEGY_LABELS: Record<Strategy['kind'], string> = {
  crew_time: 'Crew time (crew hours or day rates)',
  per_unit: 'Per unit (a price per item)',
  first_additional: 'First unit, then each extra',
  threshold: 'One price up to a size, another above',
  measurement: 'Per inch or foot measured',
  time_block: 'Per block of time',
  per_dbh: 'Per DBH inch, with a per-tree minimum',
  matrix: 'Price table by type and size',
  height: 'Per foot of height',
  recurring_plan: 'Membership (start plus monthly)',
  fixed: 'One fixed price',
  sub_bid: 'Subcontractor price plus margin',
  manual: 'Priced by hand each time',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  removal: 'Removal', pruning: 'Pruning', stump: 'Stump grinding', cabling: 'Cabling', bracing: 'Bracing', props: 'Props',
  crane: 'Crane work', planting: 'Planting', phc: 'Plant health care', membership: 'Membership', ground: 'Ground work', other: 'Other',
};

const num = (key: string, label: string, unit?: string) => ({ key, label, kind: 'number' as const, required: true, ...(unit ? { unit } : {}) });
const count = (key: string, label: string, required = true) => ({ key, label, kind: 'count' as const, required });

/** A new service of a given pricing kind with the questions it needs; every price starts at 0. */
export function blankService(kind: Strategy['kind'], name: string, category: Category, key: string, crews: CrewTemplate[]): Service {
  const base = { key, name, category, fulfillment: 'internal' as const, offered: true };
  switch (kind) {
    case 'per_unit': return { ...base, questions: [count('units', 'Units')], strategy: { kind, unitQuestion: 'units', unitPrice: 0 } };
    case 'first_additional': return { ...base, questions: [count('units', 'Units')], strategy: { kind, unitQuestion: 'units', first: 0, additional: 0 } };
    case 'threshold': return { ...base, questions: [num('measure', 'Measurement')], strategy: { kind, question: 'measure', bands: [{ upTo: 10, price: 0 }, { upTo: null, price: 0 }] } };
    case 'measurement': return { ...base, questions: [num('size', 'Size', 'in')], strategy: { kind, question: 'size', perUnit: 0 } };
    case 'time_block': return { ...base, questions: [num('minutes', 'Anticipated time', 'min')], strategy: { kind, minutesQuestion: 'minutes', blockMinutes: 60, blockPrice: 0 } };
    case 'per_dbh': return { ...base, questions: [num('dbh', 'DBH', 'in'), count('trees', 'Trees', false)], strategy: { kind, dbhQuestion: 'dbh', perInch: 0, treesQuestion: 'trees' } };
    case 'matrix': return {
      ...base,
      questions: [{ key: 'type', label: 'Type', kind: 'choice', required: true, choices: [{ value: 'standard', label: 'Standard' }] }, count('qty', 'Quantity', false)],
      strategy: { kind, rowQuestion: 'type', quantityQuestion: 'qty', rows: [{ value: 'standard', label: 'Standard' }], cells: { standard: 0 } },
    };
    case 'height': return { ...base, questions: [num('height', 'Height', 'ft'), count('qty', 'Quantity', false)], strategy: { kind, heightQuestion: 'height', perFoot: 0, quantityQuestion: 'qty' } };
    case 'crew_time': return {
      ...base,
      questions: [
        { key: 'crew', label: 'Crew', kind: 'choice', required: true, choices: crews.map((c) => ({ value: c.key, label: c.name })) },
        num('hours', 'Time on site', 'hr'),
      ],
      strategy: { kind, crewQuestion: 'crew', hoursQuestion: 'hours' },
    };
    case 'recurring_plan': return {
      ...base,
      questions: [{ key: 'class', label: 'Plan class', kind: 'choice', required: true, choices: [{ value: 'standard', label: 'Standard' }] }],
      strategy: { kind, classQuestion: 'class', classes: [{ value: 'standard', label: 'Standard', initial: 0, monthly: 0, months: 12, visits: 0 }] },
    };
    case 'sub_bid': return { ...base, fulfillment: 'subcontractor', questions: [num('sub_price', 'Expected sub price', '$')], strategy: { kind, costQuestion: 'sub_price', margin: 0.3 } };
    case 'manual': return { ...base, questions: [num('price', 'Price', '$')], strategy: { kind, priceQuestion: 'price' } };
    default: return { ...base, questions: [], strategy: { kind: 'fixed', price: 0 } };
  }
}
