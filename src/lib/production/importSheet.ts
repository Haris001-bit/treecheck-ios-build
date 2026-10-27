/**
 * Large-company setup: turning a company's price sheet into a draft rate card. The AI reads the sheet into IMPORT_SCHEMA
 * (every field nullable, nothing guessed); normalizeImport maps that onto the starter card, and anything it can't map,
 * plus every conflict the AI quoted from the sheet, becomes a finding for an admin to settle. Pure.
 */
import { CATEGORIES, RateCardDefinitionSchema, type Category, type Finding, type RateCardDefinition, type Service } from './rules';
import { starterDefinition } from './starter';
import { dollars } from './answers';

const n = { type: ['number', 'null'] };
const s = { type: ['string', 'null'] };
const KINDS = ['fixed', 'per_unit', 'threshold', 'first_additional', 'measurement', 'time_block', 'per_dbh', 'matrix', 'height', 'crew_time', 'recurring_plan', 'manual'] as const;
const TRIGGERS = ['safety_trim', 'line_drop', 'okie_locate', 'cabling', 'bracing', 'airspade', 'crane', 'grapple', 'asap', 'priority', 'gated_access', 'other'] as const;
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

/** Strict JSON schema the AI fills from a price sheet. */
export const IMPORT_SCHEMA = obj({
  services: {
    type: 'array',
    items: obj({
      name: { type: 'string' }, category: { type: 'string', enum: [...CATEGORIES] }, kind: { type: 'string', enum: [...KINDS] },
      unit_label: s, price: n, unit_price: n, minimum: n, maximum: n, first_price: n, additional_price: n,
      threshold: n, below_price: n, above_price: n, per_unit: n, range_low: n, range_high: n, range_condition: s,
      block_minutes: n, block_price: n, per_inch: n, per_tree_minimum: n, per_foot: n, max_height: n,
      matrix: { type: 'array', items: obj({ row: { type: 'string' }, col: s, price: n }) },
      plan_classes: { type: 'array', items: obj({ label: { type: 'string' }, initial: n, monthly: n, months: n, visits: n }) },
      sell_months: { type: 'array', items: { type: 'integer' } },
      not_offered: { type: 'boolean' }, notes: s, quote: s,
    }),
  },
  crew_pricing: obj({
    man_hour_rate: n, day_hours: n, job_minimum: n,
    full_day_prices: { type: 'array', items: obj({ headcount: { type: 'integer' }, price: { type: 'number' } }) },
  }),
  playbook_hints: { type: 'array', items: obj({ trigger: { type: 'string', enum: [...TRIGGERS] }, note: s, quote: s }) },
  discounts: { type: 'array', items: obj({ label: { type: 'string' }, percent: n, categories: { type: 'array', items: { type: 'string' } }, quote: s }) },
  payment_plans: { type: 'array', items: obj({ label: { type: 'string' }, deposit_percent: n, installments: n, terms: s, quote: s }) },
  consultation_text: s,
  financing_text: s,
  conflicts: { type: 'array', items: obj({ text: { type: 'string' }, quote: s }) },
});

type Num = number | null | undefined;
export interface ImportedService {
  name: string; category: string; kind: string; unit_label?: string | null; price?: Num; unit_price?: Num; minimum?: Num; maximum?: Num;
  first_price?: Num; additional_price?: Num; threshold?: Num; below_price?: Num; above_price?: Num; per_unit?: Num;
  range_low?: Num; range_high?: Num; range_condition?: string | null; block_minutes?: Num; block_price?: Num; per_inch?: Num;
  per_tree_minimum?: Num; per_foot?: Num; max_height?: Num; matrix?: { row: string; col?: string | null; price?: Num }[];
  plan_classes?: { label: string; initial?: Num; monthly?: Num; months?: Num; visits?: Num }[]; sell_months?: number[];
  not_offered?: boolean; notes?: string | null; quote?: string | null;
}
export interface ImportedSheet {
  services?: ImportedService[];
  crew_pricing?: { man_hour_rate?: Num; day_hours?: Num; job_minimum?: Num; full_day_prices?: { headcount: number; price: number }[] };
  playbook_hints?: { trigger: string; note?: string | null; quote?: string | null }[];
  discounts?: { label: string; percent?: Num; categories?: string[]; quote?: string | null }[];
  payment_plans?: { label: string; deposit_percent?: Num; installments?: Num; terms?: string | null; quote?: string | null }[];
  consultation_text?: string | null;
  financing_text?: string | null;
  conflicts?: { text: string; quote?: string | null }[];
}

const pos = (v: Num) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const clip = (t: string | null | undefined, max: number) => (t ? t.trim().slice(0, max) : undefined);
export const slug = (t: string) => {
  const k = t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return /^[a-z]/.test(k) ? k : `s_${k}`.slice(0, 36);
};
const uniqueKey = (base: string, used: Set<string>) => {
  let k = base || 'service';
  for (let i = 2; used.has(k); i++) k = `${base.slice(0, 33)}_${i}`;
  used.add(k);
  return k;
};
const cat = (c: string): Category => (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : 'other';
const num = (key: string, label: string, unit?: string | null) => ({ key, label, kind: 'number' as const, required: true, ...(unit ? { unit: unit.slice(0, 20) } : {}) });
const cnt = (key: string, label: string) => ({ key, label, kind: 'count' as const, required: true });

export interface NormalizedImport { def: RateCardDefinition; findings: Finding[]; warnings: string[] }

export function normalizeImport(raw: ImportedSheet, base: RateCardDefinition = starterDefinition()): NormalizedImport {
  const def: RateCardDefinition = structuredClone(base);
  const findings: Finding[] = [];
  const warnings: string[] = [];
  const used = new Set<string>();
  const services: Service[] = [];
  const crewSvc = base.services.find((x) => x.strategy.kind === 'crew_time');

  const cp = raw.crew_pricing ?? {};
  if (pos(cp.man_hour_rate)) def.pricing.manHourRate = pos(cp.man_hour_rate)!;
  if (pos(cp.day_hours)) def.pricing.dayHours = Math.min(24, pos(cp.day_hours)!);
  const floors = (cp.full_day_prices ?? []).filter((f) => f.headcount > 0 && f.price > 0)
    .map((f) => ({ key: `full_day_${f.headcount}`, minHours: def.pricing.dayHours, headcount: Math.round(f.headcount), price: f.price }));

  for (const x of raw.services ?? []) {
    if (!x?.name?.trim()) continue;
    const name = x.name.trim().slice(0, 120);
    const key = uniqueKey(slug(name), used);
    const category = cat(x.category);
    const u = clip(x.unit_label, 40);
    let svc: Service | null = null;
    const common = {
      key, name, category, fulfillment: 'internal' as const, offered: !x.not_offered,
      ...(x.sell_months?.length ? { sellMonths: [...new Set(x.sell_months.filter((m) => m >= 1 && m <= 12))] } : {}),
      ...(pos(x.minimum) !== null ? { minimum: pos(x.minimum)! } : {}),
      ...(pos(x.maximum) !== null ? { maximum: pos(x.maximum)! } : {}),
    };
    const missing = (what: string) => findings.push({ key: `import:${key}:price`, text: `${name}: couldn't read ${what} from the sheet. Enter it by hand.`, quote: clip(x.quote, 500), blocking: true });
    switch (x.kind) {
      case 'fixed':
        if (pos(x.price) === null) missing('the price');
        svc = { ...common, questions: [], strategy: { kind: 'fixed', price: pos(x.price) ?? 0 } } as Service; break;
      case 'per_unit':
        if (pos(x.unit_price) === null) missing('the price per unit');
        svc = { ...common, questions: [cnt('units', u ?? 'Units')], strategy: { kind: 'per_unit', unitQuestion: 'units', unitPrice: pos(x.unit_price) ?? 0 } } as Service; break;
      case 'first_additional':
        if (pos(x.first_price) === null) missing('the first-unit price');
        svc = { ...common, questions: [cnt('units', u ?? 'Units')], strategy: { kind: 'first_additional', unitQuestion: 'units', first: pos(x.first_price) ?? 0, additional: pos(x.additional_price) ?? 0 } } as Service; break;
      case 'threshold': {
        const t = pos(x.threshold);
        if (t === null || pos(x.below_price) === null || pos(x.above_price) === null) missing('the threshold and both prices');
        svc = { ...common, questions: [num('measure', u ?? 'Measurement')], strategy: { kind: 'threshold', question: 'measure', bands: [{ upTo: t ?? 0, price: pos(x.below_price) ?? 0 }, { upTo: null, price: pos(x.above_price) ?? 0 }] } } as Service; break;
      }
      case 'measurement': {
        if (pos(x.per_unit) === null) missing('the price per unit');
        const qs: Service['questions'] = [num('size', u ?? 'Size')];
        const variants = [];
        if (pos(x.range_low) !== null && pos(x.range_high) !== null) {
          qs.push({ key: 'variant', label: (clip(x.range_condition, 120) ?? 'Special case').slice(0, 120), kind: 'yes_no' });
          variants.push({ when: { question: 'variant', equals: true }, range: { low: pos(x.range_low)!, high: pos(x.range_high)!, rule: null } });
        }
        svc = { ...common, questions: qs, strategy: { kind: 'measurement', question: 'size', perUnit: pos(x.per_unit) ?? 0, ...(variants.length ? { variants } : {}) } } as Service; break;
      }
      case 'time_block': {
        const mins = Math.round(pos(x.block_minutes) ?? 60);
        if (pos(x.block_price) === null) missing('the price per time block');
        svc = { ...common, questions: [num('minutes', 'Anticipated time', 'min')], strategy: { kind: 'time_block', minutesQuestion: 'minutes', blockMinutes: Math.min(480, Math.max(5, mins)), blockPrice: pos(x.block_price) ?? 0 } } as Service; break;
      }
      case 'per_dbh':
        if (pos(x.per_inch) === null) missing('the price per DBH inch');
        svc = { ...common, questions: [num('dbh', 'DBH', 'in'), { key: 'trees', label: 'Trees', kind: 'count' }], strategy: { kind: 'per_dbh', dbhQuestion: 'dbh', perInch: pos(x.per_inch) ?? 0, ...(pos(x.per_tree_minimum) !== null ? { perTreeMinimum: pos(x.per_tree_minimum)! } : {}), treesQuestion: 'trees' } } as Service; break;
      case 'height':
        if (pos(x.per_foot) === null) missing('the price per foot');
        svc = { ...common, questions: [num('height', 'Height', 'ft'), { key: 'qty', label: 'Quantity', kind: 'count' }], strategy: { kind: 'height', heightQuestion: 'height', perFoot: pos(x.per_foot) ?? 0, ...(pos(x.max_height) !== null ? { maxHeight: pos(x.max_height)! } : {}), quantityQuestion: 'qty' } } as Service; break;
      case 'matrix': {
        const cells = (x.matrix ?? []).filter((c) => c?.row?.trim());
        if (!cells.length) { missing('the price table'); }
        const rows = [...new Set(cells.map((c) => c.row.trim().slice(0, 60)))];
        const cols = [...new Set(cells.map((c) => (c.col ?? '').trim().slice(0, 60)).filter(Boolean))];
        const rv = (r: string) => slug(r) || 'row';
        const table: Record<string, number | null> = {};
        for (const c of cells) {
          const r = rv(c.row.trim());
          const col = (c.col ?? '').trim();
          table[col ? `${r}|${slug(col)}` : r] = pos(c.price);
        }
        const questions: Service['questions'] = [{ key: 'row', label: 'Type', kind: 'choice', required: true, choices: (rows.length ? rows : ['Standard']).map((r) => ({ value: rv(r), label: r })) }];
        if (cols.length) questions.push({ key: 'col', label: 'Size', kind: 'choice', required: true, choices: cols.map((c) => ({ value: slug(c), label: c })) });
        questions.push({ key: 'qty', label: 'Quantity', kind: 'count' });
        svc = { ...common, questions, strategy: { kind: 'matrix', rowQuestion: 'row', ...(cols.length ? { colQuestion: 'col', cols: cols.map((c) => ({ value: slug(c), label: c })) } : {}), quantityQuestion: 'qty', rows: (rows.length ? rows : ['Standard']).map((r) => ({ value: rv(r), label: r })), cells: table } } as Service;
        break;
      }
      case 'recurring_plan': {
        const classes = (x.plan_classes ?? []).filter((c) => c?.label?.trim()).map((c, i) => ({
          value: slug(c.label) || `class_${i + 1}`, label: c.label.trim().slice(0, 120), initial: pos(c.initial) ?? 0, monthly: pos(c.monthly) ?? 0,
          months: Math.min(120, Math.round(pos(c.months) ?? 12)), visits: Math.min(366, Math.round(pos(c.visits) ?? 0)),
        }));
        if (!classes.length) missing('the plan classes');
        const list = classes.length ? classes : [{ value: 'standard', label: 'Standard', initial: 0, monthly: 0, months: 12, visits: 0 }];
        svc = { ...common, questions: [{ key: 'class', label: 'Plan class', kind: 'choice', required: true, choices: list.map((c) => ({ value: c.value, label: c.label })) }], strategy: { kind: 'recurring_plan', classQuestion: 'class', classes: list } } as Service; break;
      }
      case 'crew_time': {
        const cs = crewSvc?.strategy;
        if (crewSvc && cs && cs.kind === 'crew_time') svc = { ...structuredClone(crewSvc), ...common, strategy: { ...cs, floors } } as Service;
        if (!pos(cp.man_hour_rate)) missing('the man-hour rate');
        if (pos(cp.job_minimum) !== null && svc && svc.minimum === undefined) svc.minimum = pos(cp.job_minimum)!;
        break;
      }
      default:
        svc = { ...common, questions: [{ key: 'price', label: 'Price', kind: 'number', required: true }], strategy: { kind: 'manual', priceQuestion: 'price' } } as Service;
        findings.push({ key: `import:${key}:manual`, text: `${name}: the sheet's rule wasn't clear, so it's priced by hand for now.`, quote: clip(x.quote, 500), blocking: false });
    }
    if (!svc) continue;
    if (x.notes?.trim()) warnings.push(`${name}: ${x.notes.trim().slice(0, 200)}`);
    services.push(svc);
  }
  if (services.length) {
    // Keep the starter's crew-time services (removal, pruning, ground) unless the sheet brought its own.
    const fromSheet = new Set(services.map((x) => x.category));
    const keep = base.services.filter((x) => x.strategy.kind === 'crew_time' && !fromSheet.has(x.category))
      .map((x) => ({ ...x, strategy: x.strategy.kind === 'crew_time' ? { ...x.strategy, floors } : x.strategy, ...(pos(cp.job_minimum) !== null && x.category === 'removal' ? { minimum: pos(cp.job_minimum)! } : {}) }) as Service);
    for (const k of keep) { if (!used.has(k.key)) { used.add(k.key); services.unshift(k); } }
    def.services = services;
  } else if (floors.length) {
    def.services = def.services.map((x) => (x.strategy.kind === 'crew_time' ? { ...x, strategy: { ...x.strategy, floors } } : x));
  }

  const discounts = (raw.discounts ?? []).filter((d) => d?.label?.trim() && pos(d.percent) !== null);
  const dUsed = new Set<string>();
  def.policies.discounts = discounts.map((d) => ({
    key: uniqueKey(slug(d.label), dUsed), label: d.label.trim().slice(0, 120), percent: Math.min(100, pos(d.percent)!),
    categories: (d.categories ?? []).map((c) => c.trim().toLowerCase().slice(0, 60)).filter(Boolean),
  }));
  const plans = (raw.payment_plans ?? []).filter((p) => p?.label?.trim());
  const pUsed = new Set<string>();
  def.policies.paymentPlans = plans.map((p) => ({
    key: uniqueKey(slug(p.label), pUsed), label: p.label.trim().slice(0, 120), depositPercent: Math.min(100, pos(p.deposit_percent) ?? 0),
    installments: Math.min(36, Math.max(1, Math.round(pos(p.installments) ?? 1))), termsText: (p.terms ?? '').trim().slice(0, 600),
  }));
  if (def.policies.paymentPlans.length > 1) {
    findings.push({
      key: 'import:payment_plans', blocking: true,
      text: `The sheet has ${def.policies.paymentPlans.length} payment plans (${def.policies.paymentPlans.map((p) => p.label).join('; ')}). Which is current?`,
      quote: clip(plans.map((p) => p.quote).filter(Boolean).join(' / '), 500),
      choices: def.policies.paymentPlans.map((p) => p.label.slice(0, 60)).slice(0, 6),
    });
  }
  if (raw.consultation_text?.trim()) def.policies.consultation.text = raw.consultation_text.trim().slice(0, 1500);
  if (raw.financing_text?.trim()) def.policies.financingText = raw.financing_text.trim().slice(0, 600);

  for (const h of raw.playbook_hints ?? []) {
    if (h.trigger === 'other' && h.note?.trim()) findings.push({ key: `import:playbook:${slug(h.note).slice(0, 40)}`, text: `The sheet asks for a step the playbooks don't cover yet: ${h.note.trim().slice(0, 300)}`, quote: clip(h.quote, 500), blocking: false });
  }
  (raw.conflicts ?? []).forEach((c, i) => {
    if (c?.text?.trim()) findings.push({ key: `import:conflict:${i + 1}`, text: c.text.trim().slice(0, 500), quote: clip(c.quote, 500), blocking: true, choices: ['Settled'] });
  });
  if (pos(cp.man_hour_rate) && floors.length) {
    for (const f of floors) {
      const byRate = f.headcount * f.minHours * def.pricing.manHourRate!;
      if (Math.abs(byRate - f.price) >= 0.5) warnings.push(`A ${f.headcount}-person day is ${dollars(f.price)} on the sheet, but the man-hour rate gives ${dollars(byRate)}.`);
    }
  }
  def.findings = [...def.findings.filter((f) => !f.key.startsWith('import:')), ...findings].slice(0, 100);
  const checked = RateCardDefinitionSchema.safeParse(def);
  if (!checked.success) {
    warnings.push('Some of the sheet could not be used as read; check the services.');
    return { def: base, findings, warnings };
  }
  return { def: checked.data, findings, warnings };
}
