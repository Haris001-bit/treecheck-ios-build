/**
 * Large-company setup: pricing a whole crew estimate, the same way on the salesperson's screen (live) and on the server
 * (on save, the price that counts). Each work item is priced from the card, any override is checked for a reason, and
 * the totals follow the discount and payment plan. Pure.
 */
import type { Answers, RateCardDefinition } from './rules';
import type { AnswerSource, ProductionEstimate } from './productionRules';
import type { ProfileSettings } from './profiles';
import { priceWorkItem, applyOverride, estimateTotals, type EstimateTotals, type LineKind, type Recurring } from './pricing';

export interface EstimateItemInput {
  id: string;
  serviceKey: string;
  treeKey?: string | null;
  kind: LineKind;
  answers: Answers;
  answerSources?: Record<string, AnswerSource>;
  /** The price the salesperson typed over the calculated one, if any. */
  sell?: number | null;
  overrideReason?: string | null;
  /** The customer's choice on an optional or recommended item, once known. */
  selected?: boolean | null;
}

export type ItemStatus = 'ok' | 'missing' | 'blocked' | 'not_offered' | 'needs_reason' | 'unknown_service';

export interface PricedItem extends EstimateItemInput {
  serviceName: string;
  status: ItemStatus;
  message: string | null;
  engineAmount: number | null;
  price: number | null;
  override: { from: number; to: number; reason: string | null; material: boolean } | null;
  steps: string[];
  production: ProductionEstimate | null;
  flags: Record<string, string>;
  recurring?: Recurring;
  profile: { key: string | null; percent: number } | null;
  /** The item's line on the Jobber quote, once the estimate is sent there. */
  jobberLineId?: string | null;
}

export interface PricedEstimate { items: PricedItem[]; totals: EstimateTotals; ok: boolean; problems: string[] }

export function priceEstimate(def: RateCardDefinition, items: EstimateItemInput[], opts: {
  day: string; settings?: ProfileSettings | null; discountKey?: string | null; paymentPlanKey?: string | null; approved?: boolean;
}): PricedEstimate {
  const problems: string[] = [];
  const priced: PricedItem[] = items.map((it) => {
    const service = def.services.find((s) => s.key === it.serviceKey);
    const base = { ...it, serviceName: service?.name ?? it.serviceKey, engineAmount: null, price: null, override: null, steps: [], production: null, flags: {}, profile: null };
    if (!service) {
      problems.push(`${it.serviceKey}: this service isn't on the rate card any more`);
      return { ...base, status: 'unknown_service', message: "This service isn't on the rate card any more." };
    }
    const r = priceWorkItem(def, service, it.answers, { day: opts.day, settings: opts.settings, sources: it.answerSources });
    if (r.kind === 'not_offered') {
      problems.push(`${service.name}: ${r.reason}`);
      return { ...base, status: 'not_offered', message: r.reason };
    }
    if (r.kind === 'missing') {
      const labels = r.missing.map((k) => service.questions.find((q) => q.key === k)?.label ?? k);
      problems.push(`${service.name}: answer ${labels.join(', ')}`);
      return { ...base, status: 'missing', message: `Answer ${labels.join(', ')}`, production: r.production };
    }
    if (r.kind === 'blocked') {
      problems.push(`${service.name}: ${r.reason}`);
      return { ...base, status: 'blocked', message: r.reason, production: r.production };
    }
    const o = applyOverride(r.engineAmount, it.sell, it.overrideReason);
    const done = { ...base, engineAmount: r.engineAmount, steps: r.steps, production: r.production, flags: r.flags, recurring: r.recurring, profile: r.profile };
    if (o.kind === 'needs_reason') {
      problems.push(`${service.name}: pick a reason for the ${o.direction} price`);
      return { ...done, status: 'needs_reason', message: `Pick a reason for the ${o.direction} price`, price: null };
    }
    return { ...done, status: 'ok', message: null, price: o.price, override: o.override };
  });
  const totals = estimateTotals(def, priced.filter((p) => p.price !== null).map((p) => ({ id: p.id, price: p.price as number, kind: p.kind, selected: p.selected, recurring: p.recurring })), {
    discountKey: opts.discountKey, paymentPlanKey: opts.paymentPlanKey, approved: opts.approved,
  });
  return { items: priced, totals, ok: problems.length === 0 && priced.length > 0, problems };
}

/** The items that count once the customer approves: every required one, plus the optional and recommended ones chosen. */
export function approvedItems<T extends { id: string; kind: LineKind; selected?: boolean | null }>(items: T[], chosen: string[] | null): T[] {
  return items.filter((i) => i.kind === 'required' || (chosen ? chosen.includes(i.id) : i.kind === 'recommended' ? i.selected !== false : i.selected === true));
}
