/**
 * Test-only fixture: a crew company's rate card built from the price sheet quoted in Mark's large-company document
 * ($650 production minimum, $700 a cable with a $1,400 minimum, braces $250 or $400 above 35" DBH, props $1,500 plus
 * $500 each, stumps $15 a diameter inch with a $350 minimum, PHC $250 per 30 minutes, trunk injection $20 a DBH inch
 * with a $250 minimum, 3" shade trees $2,400, $125 a man-hour and a $5,000 four-person day). Never shown to users.
 */
import { RateCardDefinitionSchema, type RateCardDefinition } from '../rules';

const yesNo = (key: string, label: string) => ({ key, label, kind: 'yes_no' as const });

export const PRICE_SHEET_INPUT = {
  schemaVersion: 1,
  pricing: { method: 'man_hour', manHourRate: 125, dayHours: 8 },
  crews: [
    { key: 'crew2', name: '2-person production', roles: [{ roleKey: 'climber', count: 1 }, { roleKey: 'ground', count: 1 }] },
    { key: 'crew3', name: '3-person climb crew', roles: [{ roleKey: 'climber', count: 1 }, { roleKey: 'ground', count: 2 }], equipment: ['lift', 'mini_skid'] },
    { key: 'crew4', name: '4-person full production', roles: [{ roleKey: 'climber', count: 1 }, { roleKey: 'ground', count: 3 }] },
    { key: 'phc1', name: 'PHC technician', roles: [{ roleKey: 'phc_tech', count: 1 }] },
  ],
  bundles: [
    { key: 'lift_package', name: 'Removal, lift package', equipment: ['lift', 'chip_truck', 'chipper', 'mini_skid'] },
    { key: 'stump_package', name: 'Stump package', equipment: ['stump_grinder', 'mini_skid'] },
  ],
  profiles: [
    { key: 'normal', name: 'Normal', percent: 0 },
    { key: 'high_demand', name: 'High Demand', percent: 10 },
    { key: 'winter_fill', name: 'Winter Fill', percent: -10 },
    { key: 'storm', name: 'Storm', percent: 25 },
  ],
  services: [
    {
      key: 'removal', name: 'Tree removal', category: 'removal', minimum: 650,
      questions: [
        { key: 'crew', label: 'Crew', kind: 'choice', required: true, choices: [{ value: 'crew2', label: '2-person' }, { value: 'crew3', label: '3-person' }, { value: 'crew4', label: '4-person' }] },
        { key: 'hours', label: 'Time on site', kind: 'number', unit: 'hr', required: true },
        { key: 'dbh', label: 'DBH', kind: 'number', unit: 'in' },
        yesNo('lift', 'Lift'), yesNo('mini', 'Mini skid'),
        { key: 'utility', label: 'Utilities', kind: 'choice', choices: [{ value: 'none', label: 'None' }, { value: 'safety_trim', label: 'Safety trim' }, { value: 'line_drop', label: 'Line drop' }] },
        { key: 'access', label: 'Access', kind: 'choice', choices: [{ value: 'easy', label: 'Easy' }, { value: 'rear_yard', label: 'Rear yard' }] },
        yesNo('crane', 'Crane'),
      ],
      strategy: {
        kind: 'crew_time', crewQuestion: 'crew', hoursQuestion: 'hours',
        floors: [{ key: 'full_day_4', minHours: 8, headcount: 4, price: 5000 }],
        equipmentAdders: [{ question: 'crane', equipment: 'crane', perJob: 1800 }],
      },
      production: { equipment: [{ key: 'lift', when: { question: 'lift', equals: true } }, { key: 'mini_skid', when: { question: 'mini', equals: true } }] },
      flags: [
        { when: { question: 'utility', equals: 'line_drop' }, flag: 'utility_requirement', value: 'LINE_DROP' },
        { when: { question: 'utility', equals: 'safety_trim' }, flag: 'utility_requirement', value: 'SAFETY_TRIM' },
        { when: { question: 'crane', equals: true }, flag: 'equipment_requirement', value: 'CRANE' },
        { when: { question: 'access', equals: 'rear_yard' }, flag: 'access', value: 'REAR' },
      ],
    },
    {
      key: 'stump', name: 'Stump grinding', category: 'stump', minimum: 350,
      questions: [{ key: 'stump_diameter', label: 'Diameter flare to flare', kind: 'number', unit: 'in', required: true }, yesNo('on_site', 'Already on another production job')],
      strategy: { kind: 'measurement', question: 'stump_diameter', perUnit: 15, variants: [{ when: { question: 'on_site', equals: true }, range: { low: 5, high: 10, rule: null } }] },
      production: { bundle: 'stump_package', baseHours: 0.5, perUnit: [{ question: 'stump_diameter', hours: 0.03 }] },
    },
    {
      key: 'dynamic_cable', name: 'Dynamic cabling', category: 'cabling', minimum: 1400,
      questions: [{ key: 'cables', label: 'Cables', kind: 'count', required: true }],
      strategy: { kind: 'per_unit', unitQuestion: 'cables', unitPrice: 700 },
      production: { crewTemplate: 'crew2', baseHours: 1, perUnit: [{ question: 'cables', hours: 0.75 }], materials: [{ key: 'dynamic_cable', quantityQuestion: 'cables' }] },
      flags: [{ when: { question: 'cables', gte: 1 }, flag: 'special_material', value: 'DYNAMIC_CABLE' }],
    },
    {
      key: 'ehs_cable', name: 'EHS cable', category: 'cabling',
      questions: [{ key: 'cables', label: 'Cables', kind: 'count', required: true }, yesNo('hub_spoke', 'Hub and spoke')],
      strategy: { kind: 'per_unit', unitQuestion: 'cables', unitPrice: 500 },
      adjustments: [{ when: { question: 'hub_spoke', equals: true }, amount: 250, label: 'Hub and spoke' }],
    },
    {
      key: 'brace', name: 'Bracing', category: 'bracing',
      questions: [{ key: 'dbh', label: 'DBH', kind: 'number', unit: 'in', required: true }],
      strategy: { kind: 'threshold', question: 'dbh', bands: [{ upTo: 35, price: 250 }, { upTo: null, price: 400 }] },
    },
    {
      key: 'props', name: 'Props', category: 'props',
      questions: [{ key: 'props', label: 'Props', kind: 'count', required: true }],
      strategy: { kind: 'first_additional', unitQuestion: 'props', first: 1500, additional: 500 },
    },
    {
      key: 'phc_visit', name: 'PHC treatment visit', category: 'phc',
      questions: [{ key: 'minutes', label: 'Anticipated time', kind: 'number', unit: 'min', required: true }],
      strategy: { kind: 'time_block', minutesQuestion: 'minutes', blockMinutes: 30, blockPrice: 250 },
    },
    {
      key: 'trunk_injection', name: 'Trunk injection', category: 'phc',
      questions: [{ key: 'dbh', label: 'DBH', kind: 'number', unit: 'in', required: true }, { key: 'trees', label: 'Trees', kind: 'count' }],
      strategy: { kind: 'per_dbh', dbhQuestion: 'dbh', perInch: 20, perTreeMinimum: 250, treesQuestion: 'trees' },
    },
    { key: 'basal_bark', name: 'Basal bark spray', category: 'phc', offered: false, questions: [], strategy: { kind: 'fixed', price: 0 } },
    { key: 'fruit_tgr', name: 'Fruit TGR', category: 'phc', sellMonths: [3, 9], questions: [], strategy: { kind: 'fixed', price: 300 } },
    {
      key: 'planting', name: 'Planting', category: 'planting',
      questions: [
        { key: 'type', label: 'Type', kind: 'choice', required: true, choices: [{ value: 'shade', label: 'Shade tree' }, { value: 'evergreen', label: 'Evergreen' }] },
        { key: 'size', label: 'Size', kind: 'choice', required: true, choices: [{ value: '2in', label: '2" caliper' }, { value: '3in', label: '3" caliper' }, { value: '4in', label: '4" caliper' }] },
        { key: 'qty', label: 'Quantity', kind: 'count' },
      ],
      strategy: {
        kind: 'matrix', rowQuestion: 'type', colQuestion: 'size', quantityQuestion: 'qty',
        rows: [{ value: 'shade', label: 'Shade tree' }, { value: 'evergreen', label: 'Evergreen' }],
        cols: [{ value: '2in', label: '2"' }, { value: '3in', label: '3"' }, { value: '4in', label: '4"' }],
        cells: { 'shade|2in': 1800, 'shade|3in': 2400, 'shade|4in': 3200, 'evergreen|2in': 1500, 'evergreen|3in': 2100, 'evergreen|4in': null },
      },
      species: [{ type: 'shade', light: ['full_sun'], moisture: ['dry'], species: ['Bur oak', 'Lacebark elm'] }, { type: 'shade', light: ['full_sun'], moisture: ['wet'], species: ['Bald cypress'] }],
    },
    {
      key: 'japanese_maple', name: 'Japanese maple', category: 'planting',
      questions: [{ key: 'height', label: 'Height', kind: 'number', unit: 'ft', required: true }],
      strategy: { kind: 'height', heightQuestion: 'height', perFoot: 350, maxHeight: 8 },
    },
    {
      key: 'membership', name: 'Tree Health Membership', category: 'membership',
      questions: [{ key: 'lot', label: 'Lot class', kind: 'choice', required: true, choices: [{ value: 'front_1_3', label: 'Front, 1 to 3 trees' }, { value: 'large', label: 'Large lot' }] }],
      strategy: { kind: 'recurring_plan', classQuestion: 'lot', classes: [{ value: 'front_1_3', label: 'Front, 1 to 3 trees', initial: 300, monthly: 45, months: 12, visits: 3 }, { value: 'large', label: 'Large lot', initial: 500, monthly: 85, months: 12, visits: 4 }] },
    },
  ],
  playbooks: [],
  policies: {
    discounts: [{ key: 'veteran', label: 'Veteran discount', percent: 5, categories: ['veteran'] }],
    paymentPlans: [{ key: 'deposit_25', label: '25% deposit, balance on completion', depositPercent: 25, installments: 2, termsText: '25% to schedule, the rest when the work is done.' }],
  },
};

export const priceSheetCard = (): RateCardDefinition => RateCardDefinitionSchema.parse(structuredClone(PRICE_SHEET_INPUT));
