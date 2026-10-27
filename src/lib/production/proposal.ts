/**
 * Large-company setup: the customer proposal. One builder feeds both the on-screen preview and the Jobber quote, so
 * what the salesperson sees is what the customer gets. The consultation block comes first (salesperson, ISA credential,
 * expected work window, next steps), then one priced line per work item, then plan and payment terms. Pure.
 */
import type { Answers, RateCardDefinition, Service } from './rules';
import { estimateTotals, type EstimateTotals, type LineKind, type Recurring } from './pricing';
import { proposalTitle } from './playbooks';
import { scopeText } from './packaging';
import { dollars } from './answers';

export interface ProposalItemInput {
  id: string; service: Service; answers: Answers; price: number; kind: LineKind; selected?: boolean | null;
  recurring?: Recurring; treeLabel?: string | null; unitCost?: number | null;
}
export interface ProposalLine {
  workItemId: string; name: string; description: string; quantity: number; unitPrice: number; total: number;
  kind: LineKind; optional: boolean; recommended: boolean; taxable: boolean; unitCost: number | null;
}
export interface Proposal {
  title: string;
  consultationText: string | null;
  lines: ProposalLine[];
  termsLines: string[];
  totals: EstimateTotals;
}

export function consultationText(def: RateCardDefinition, ctx: { salespersonName?: string | null; isa?: string | null; workWindow?: string | null }): string | null {
  const c = def.policies.consultation;
  const parts: string[] = [];
  if (c.text.trim()) parts.push(c.text.trim());
  const who: string[] = [];
  if (c.showSalesperson && ctx.salespersonName) who.push(`Estimator: ${ctx.salespersonName}`);
  if (c.showIsa && ctx.isa) who.push(`ISA Certified Arborist ${ctx.isa}`);
  if (who.length) parts.push(who.join(', ') + '.');
  if (c.showWorkWindow && ctx.workWindow) parts.push(`Expected start: ${ctx.workWindow}.`);
  if (c.showNextSteps && c.nextStepsText.trim()) parts.push(c.nextStepsText.trim());
  return parts.length ? parts.join(' ') : null;
}

export function buildProposal(def: RateCardDefinition, input: {
  items: ProposalItemInput[]; salespersonName?: string | null; isa?: string | null; workWindow?: string | null;
  discountKey?: string | null; paymentPlanKey?: string | null; sendUnitCost?: boolean; approved?: boolean;
}): Proposal {
  const lines: ProposalLine[] = input.items.map((it) => {
    const name = it.treeLabel ? `${it.treeLabel}: ${it.service.name}` : it.service.name;
    return {
      workItemId: it.id, name, description: scopeText(it.service, it.answers), quantity: 1, unitPrice: it.price, total: it.price,
      kind: it.kind, optional: it.kind !== 'required', recommended: it.kind === 'recommended',
      taxable: it.service.taxable ?? false,
      unitCost: input.sendUnitCost && it.unitCost !== null && it.unitCost !== undefined ? it.unitCost : null,
    };
  });
  const terms: string[] = [];
  for (const it of input.items) {
    if (it.recurring && it.recurring.months > 0) {
      terms.push(`${it.service.name} (${it.recurring.label}): ${dollars(it.price)} to start, then ${dollars(it.recurring.monthly)} a month for ${it.recurring.months} months${it.recurring.visits ? `, ${it.recurring.visits} visits` : ''}.`);
    }
  }
  const plan = input.paymentPlanKey ? def.policies.paymentPlans.find((p) => p.key === input.paymentPlanKey) : undefined;
  if (plan) terms.push(plan.termsText.trim() || `${plan.label}.`);
  if (def.policies.financingText?.trim()) terms.push(def.policies.financingText.trim());
  const totals = estimateTotals(def, input.items.map((it) => ({ id: it.id, price: it.price, kind: it.kind, selected: it.selected, recurring: it.recurring })), {
    discountKey: input.discountKey, paymentPlanKey: input.paymentPlanKey, approved: input.approved,
  });
  return {
    title: proposalTitle(input.items.map((i) => i.service.name)),
    consultationText: consultationText(def, input),
    lines,
    termsLines: terms,
    totals,
  };
}
