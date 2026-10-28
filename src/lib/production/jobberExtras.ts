/**
 * Large-company setup: the Jobber parts that need permissions TreeCheck's Jobber app only gets after Jobber's review
 * (Users, Requests, Products & Services, Custom Fields). Built switched off; production_rollout.jobber_extras turns them
 * on. Matches the rate card's services to the company's Jobber products and services, TreeCheck's team to its Jobber
 * users, a Jobber request to a new estimate's customer, and writes the five quote fields TreeCheck fills. Pure.
 */
import type { RateCardDefinition } from './rules';
import type { PricedItem } from './estimate';
import type { QuotePlan } from './quoteLines';
import { evaluatePlaybooks } from './playbooks';

const norm = (s: string) => s.normalize('NFKD').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
/** "Stump grindings" and "stump grinding" are the same item; "Tree removal & cleanup" and "tree removal and cleanup" too. */
const loose = (s: string) => norm(s).split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---------------------------------------------------------------------------------------------------
// Products and services

export interface JobberProduct { id: string; name: string; category?: string | null; visible?: boolean | null }
export interface ServiceMatch { serviceKey: string; serviceName: string; productId: string | null; productName: string | null; how: 'saved' | 'name' | 'none' }
export interface ServicesPreview {
  matches: ServiceMatch[];
  /** Jobber items with the same name: the first visible one is used, the others are listed for the office to tidy. */
  duplicates: { name: string; keptId: string; otherIds: string[] }[];
  /** Jobber items no service on the rate card uses. */
  unused: JobberProduct[];
}

/** The rate card's services against the company's Jobber products and services. A saved choice wins while that item exists. */
export function matchServices(def: RateCardDefinition, products: JobberProduct[], saved: Record<string, string> = {}): ServicesPreview {
  const groups = new Map<string, JobberProduct[]>();
  for (const p of products) {
    if (!p.id || !p.name?.trim()) continue;
    const k = loose(p.name);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const kept = new Map<string, JobberProduct>();
  const duplicates: ServicesPreview['duplicates'] = [];
  for (const [k, list] of groups) {
    const first = list.find((p) => p.visible !== false) ?? list[0];
    kept.set(k, first);
    if (list.length > 1) duplicates.push({ name: first.name, keptId: first.id, otherIds: list.filter((p) => p.id !== first.id).map((p) => p.id) });
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  const used = new Set<string>();
  const matches = def.services.map((s): ServiceMatch => {
    const savedId = saved[s.key];
    const savedHit = savedId ? byId.get(savedId) : undefined;
    const hit = savedHit ?? kept.get(loose(s.name));
    if (hit) used.add(hit.id);
    return { serviceKey: s.key, serviceName: s.name, productId: hit?.id ?? null, productName: hit?.name ?? null, how: savedHit ? 'saved' : hit ? 'name' : 'none' };
  });
  const unused = [...kept.values()].filter((p) => !used.has(p.id));
  return { matches, duplicates, unused };
}

// ---------------------------------------------------------------------------------------------------
// Team

export interface JobberUser { id: string; name: string; email: string | null; isAccountOwner?: boolean | null }
export interface TeamMember { id: string; name: string; email: string | null }
export interface TeamPreview {
  matched: { userId: string; name: string; jobberUserId: string; jobberName: string; how: 'saved' | 'email' | 'name' }[];
  /** In Jobber, not in TreeCheck: the office invites them from Team settings. */
  onlyInJobber: JobberUser[];
  onlyInTreeCheck: TeamMember[];
}

/** TreeCheck's people against the company's Jobber users: a saved choice, then the same email, then one exact name. */
export function matchTeam(members: TeamMember[], users: JobberUser[], saved: Record<string, string> = {}): TeamPreview {
  const taken = new Set<string>();
  const usersById = new Map(users.map((u) => [u.id, u]));
  const matched: TeamPreview['matched'] = [];
  const left: TeamMember[] = [];
  const take = (m: TeamMember, u: JobberUser, how: TeamPreview['matched'][number]['how']) => {
    taken.add(u.id);
    matched.push({ userId: m.id, name: m.name, jobberUserId: u.id, jobberName: u.name, how });
  };
  for (const m of members) {
    const s = saved[m.id] ? usersById.get(saved[m.id]) : undefined;
    if (s && !taken.has(s.id)) take(m, s, 'saved');
    else left.push(m);
  }
  const stillLeft: TeamMember[] = [];
  for (const m of left) {
    const email = m.email?.trim().toLowerCase();
    const u = email ? users.find((x) => !taken.has(x.id) && x.email?.trim().toLowerCase() === email) : undefined;
    if (u) take(m, u, 'email');
    else stillLeft.push(m);
  }
  const onlyInTreeCheck: TeamMember[] = [];
  for (const m of stillLeft) {
    const same = users.filter((x) => !taken.has(x.id) && norm(x.name) === norm(m.name) && norm(m.name) !== '');
    if (same.length === 1) take(m, same[0], 'name');
    else onlyInTreeCheck.push(m);
  }
  return { matched, onlyInJobber: users.filter((u) => !taken.has(u.id)), onlyInTreeCheck };
}

// ---------------------------------------------------------------------------------------------------
// Requests

export interface JobberRequestNode {
  id: string; title?: string | null; createdAt?: string | null; requestStatus?: string | null;
  contactName?: string | null; email?: string | null; phone?: string | null;
  client?: { id: string; name?: string | null; emails?: { address?: string | null }[] | null; phones?: { number?: string | null }[] | null } | null;
  property?: { id: string; address?: { street1?: string | null; street2?: string | null; city?: string | null; province?: string | null; postalCode?: string | null } | null } | null;
}
export interface RequestCustomer { name: string; phone: string; email: string; address: string; jobberRequestId: string }
export interface OpenRequest { id: string; title: string; createdAt: string | null; status: string; customer: RequestCustomer }

/** Jobber's request states that still wait on an estimate. */
const OPEN_REQUEST = new Set(['new', 'upcoming', 'overdue', 'unscheduled', 'today', 'assessment_completed', 'needs_approval']);

/** A new estimate's customer from a Jobber request: the request's own contact first, then its client's. */
export function requestCustomer(r: JobberRequestNode): RequestCustomer {
  const a = r.property?.address;
  const line2 = [a?.province, a?.postalCode].map((s) => s?.trim()).filter(Boolean).join(' ');
  const address = [a?.street1, a?.street2, a?.city, line2].map((s) => s?.trim()).filter(Boolean).join(', ');
  return {
    name: cut((r.contactName?.trim() || r.client?.name?.trim() || ''), 120),
    phone: cut((r.phone?.trim() || r.client?.phones?.find((p) => p.number?.trim())?.number?.trim() || ''), 40),
    email: cut((r.email?.trim() || r.client?.emails?.find((e) => e.address?.trim())?.address?.trim() || ''), 200),
    address: cut(address, 300),
    jobberRequestId: r.id,
  };
}

/** The requests still waiting on an estimate, newest first. */
export function openRequests(nodes: JobberRequestNode[]): OpenRequest[] {
  return nodes
    .filter((r) => !!r?.id && OPEN_REQUEST.has(String(r.requestStatus ?? '').toLowerCase()))
    .map((r) => {
      const customer = requestCustomer(r);
      return { id: r.id, title: r.title?.trim() || customer.name || 'Request', createdAt: r.createdAt ?? null, status: String(r.requestStatus).toLowerCase(), customer };
    })
    .sort((x, y) => String(y.createdAt ?? '').localeCompare(String(x.createdAt ?? '')));
}

// ---------------------------------------------------------------------------------------------------
// The five quote fields

export const QUOTE_FIELDS = [
  { key: 'link', name: 'TreeCheck link', type: 'LINK' },
  { key: 'production_class', name: 'Production class', type: 'TEXT' },
  { key: 'resources', name: 'Required resources', type: 'TEXT' },
  { key: 'flags', name: 'Operational flags', type: 'TEXT' },
  { key: 'priority', name: 'Priority', type: 'TEXT' },
] as const;
export type QuoteFieldKey = (typeof QUOTE_FIELDS)[number]['key'];
export type QuoteFieldValue = { text: string } | { link: { text: string; url: string } };

const FIELD_MAX = 250;
const words = (key: string) => key.replace(/_/g, ' ').trim();
const PRIORITY = { normal: 'Normal', priority: 'Priority', asap: 'ASAP' } as const;
const hoursText = (h: number) => `${Math.round(h * 10) / 10} h`;

/**
 * What TreeCheck writes in the quote's five fields: the estimate's link, the crews and their hours, the equipment and
 * any rental or vendor the playbooks ask for, the work's flags, and the playbooks' scheduling class. The fields are
 * transferable, so Jobber copies them to the jobs the office makes from the quote.
 */
export function quoteFieldValues(def: RateCardDefinition, items: PricedItem[], ctx: {
  estimateUrl: string; estimateNumber: number; equipmentNames?: Record<string, string>;
}): Record<QuoteFieldKey, QuoteFieldValue> {
  const priced = items.filter((i) => i.status === 'ok');
  const crews = new Map<string, number>();
  const equipment = new Set<string>();
  for (const i of priced) {
    const p = i.production;
    if (!p) continue;
    for (const e of p.equipment) equipment.add(e.key);
    // Work with no crew of the company's own (a vendor's planting, say) adds no production class.
    if (!p.crewTemplate && !(p.headcount > 0)) continue;
    const crew = p.crewTemplate ? def.crews.find((c) => c.key === p.crewTemplate)?.name ?? words(p.crewTemplate) : `${p.headcount}-person crew`;
    crews.set(crew, (crews.get(crew) ?? 0) + (p.hours || 0));
  }
  const services = new Map(def.services.map((s) => [s.key, s]));
  const playbook = evaluatePlaybooks(def, priced.filter((i) => services.has(i.serviceKey)).map((i) => ({
    id: i.id, serviceKey: i.serviceKey, serviceName: i.serviceName, category: services.get(i.serviceKey)!.category, answers: i.answers, flags: i.flags ?? {},
  })));
  const named = (k: string) => ctx.equipmentNames?.[k]?.trim() || words(k);
  // A playbook's rental or vendor replaces the plain equipment name.
  const resources = new Map([...equipment].map((k) => [k, named(k)]));
  for (const r of playbook.resources) resources.set(r.resource, r.mode === 'reserve' ? named(r.resource) : `${named(r.resource)} (${r.mode})`);
  const flags = [...new Set(priced.flatMap((i) => Object.entries(i.flags ?? {}).map(([k, v]) => `${words(k)}: ${words(String(v)).toLowerCase()}`)))];
  return {
    link: { link: { text: cut(`Estimate #${ctx.estimateNumber}`, FIELD_MAX), url: ctx.estimateUrl } },
    production_class: { text: cut([...crews].map(([c, h]) => `${c}, ${hoursText(h)}`).join('; ') || 'No crew time', FIELD_MAX) },
    resources: { text: cut([...resources.values()].join(', ') || 'None', FIELD_MAX) },
    flags: { text: cut(flags.join('; ') || 'None', FIELD_MAX) },
    priority: { text: PRIORITY[playbook.schedulingClass] },
  };
}

// ---------------------------------------------------------------------------------------------------
// The quote

export interface QuoteExtras {
  /** Rate card service key to Jobber product or service id. */
  productIds?: Record<string, string>;
  salespersonId?: string | null;
  requestId?: string | null;
  /** Field key to the Jobber custom field configuration id, with the values to write. */
  fieldIds?: Partial<Record<QuoteFieldKey, string>>;
  fieldValues?: Record<QuoteFieldKey, QuoteFieldValue> | null;
}

/** quoteCreate's attributes with the extras added: each work line's product, the salesperson, the request and the fields. */
export function withQuoteExtras(attributes: Record<string, unknown>, plan: QuotePlan, items: Pick<PricedItem, 'id' | 'serviceKey'>[], extras: QuoteExtras): Record<string, unknown> {
  const serviceOf = new Map(items.map((i) => [i.id, i.serviceKey]));
  const lines = (attributes.lineItems as Record<string, unknown>[] | undefined) ?? plan.lineItems as unknown as Record<string, unknown>[];
  const lineItems = lines.map((l, n) => {
    const ref = plan.refs[n];
    const service = ref?.kind === 'work' && ref.workItemId ? serviceOf.get(ref.workItemId) : undefined;
    const productId = service ? extras.productIds?.[service] : undefined;
    return productId ? { ...l, productOrServiceId: productId } : l;
  });
  const customFields = extras.fieldValues
    ? QUOTE_FIELDS.flatMap((f) => {
      const id = extras.fieldIds?.[f.key];
      const v = extras.fieldValues![f.key];
      if (!id || !v) return [];
      return [{ customFieldConfigurationId: id, ...('link' in v ? { valueLink: v.link } : { valueText: v.text }) }];
    })
    : [];
  return {
    ...attributes,
    lineItems,
    ...(extras.salespersonId ? { salespersonId: extras.salespersonId } : {}),
    ...(extras.requestId ? { requestId: extras.requestId } : {}),
    ...(customFields.length ? { customFields } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// Actual hours from Jobber's time sheets

export interface JobberTimeEntry { id: string; finalDuration?: number | null; ticking?: boolean | null; user?: { id: string } | null }
export interface JobberExpense { id: string; total?: number | null }
/** What a Jobber job's time sheets and expenses say about one crew job. A suggestion: reports count it only once saved. */
export interface ActualsFromJobber {
  headcount: number; hours: number; manHours: number; expenses: number | null;
  /** Time entries counted, people who logged time, and timers still running (left out). */
  entries: number; people: number; running: number;
  /** This crew job's part of the Jobber job (1 when the Jobber job is only this crew job). */
  share: number;
  /** Jobber had more entries or expenses than were read. */
  partial: boolean;
  jobNumber: string | null; readAt: string;
}

const quarter = (h: number) => Math.round(h * 4) / 4;
const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * Each crew job's part of a Jobber job, by estimated man-hours (equal parts when none has an estimate). The office can
 * make one Jobber job from several crew jobs, and Jobber's time sheets can't say which hours went to which.
 */
export function jobShares(packets: { id: string; estManHours: number | null }[]): Record<string, number> {
  const total = packets.reduce((s, p) => s + Math.max(0, Number(p.estManHours) || 0), 0);
  return Object.fromEntries(packets.map((p) => [p.id, total > 0 ? Math.max(0, Number(p.estManHours) || 0) / total : 1 / packets.length]));
}

/**
 * Actual crew, hours and expenses from a Jobber job's time entries and expenses: man-hours are the logged time (running
 * timers left out), the crew is the people who logged it, and hours on site are man-hours per person. Null when Jobber
 * holds no finished time and no expense for the job.
 */
export function actualsFromJobber(entries: JobberTimeEntry[], expenses: JobberExpense[], opts: {
  share?: number; partial?: boolean; jobNumber?: string | null; readAt: string;
}): ActualsFromJobber | null {
  const share = opts.share ?? 1;
  const running = entries.filter((e) => e.ticking === true).length;
  const counted = entries.filter((e) => e.ticking !== true && (Number(e.finalDuration) || 0) > 0);
  const spent = expenses.filter((x) => Number.isFinite(Number(x.total)) && Number(x.total) > 0);
  if (!counted.length && !spent.length) return null;
  const people = new Set(counted.map((e) => e.user?.id).filter(Boolean)).size;
  const loggedHours = counted.reduce((s, e) => s + (Number(e.finalDuration) || 0), 0) / 3600;
  const manHours = quarter(loggedHours * share);
  const headcount = manHours > 0 ? Math.max(1, people) : 0;
  return {
    headcount, hours: headcount ? quarter(manHours / headcount) : 0, manHours,
    expenses: spent.length ? cents(spent.reduce((s, x) => s + Number(x.total), 0) * share) : null,
    entries: counted.length, people, running, share: Math.round(share * 1000) / 1000, partial: !!opts.partial,
    jobNumber: opts.jobNumber ?? null, readAt: opts.readAt,
  };
}

/** One line for the crew leader about where the suggested hours came from. */
export function actualsFromJobberNote(a: ActualsFromJobber): string {
  const parts = [`From Jobber's time sheets${a.jobNumber ? ` on job #${a.jobNumber}` : ''}: ${a.entries} time ${a.entries === 1 ? 'entry' : 'entries'} by ${a.people} ${a.people === 1 ? 'person' : 'people'}`];
  if (a.share < 1) parts.push(`this crew job's part (${Math.round(a.share * 100)}%) of that Jobber job, split by the estimated hours`);
  if (a.running) parts.push(`${a.running} ${a.running === 1 ? 'timer is' : 'timers are'} still running and left out`);
  if (a.partial) parts.push('Jobber had more entries than TreeCheck read');
  return `${parts.join('; ')}. Check them and save.`;
}
