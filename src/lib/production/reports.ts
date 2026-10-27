/**
 * Large-company setup: the production learning loop. Did we estimate the resources right, and did the price produce the
 * economics we expected? Pure: the screens pass in what the caller may read (prices only for the price layer, costs
 * only for cost viewers).
 */
import { dollars, r2 } from './answers';

export interface ReportItem {
  serviceKey: string; serviceName: string; category: string; engineAmount: number; price: number;
  override?: { from: number; to: number; reason: string | null; material: boolean } | null;
  crewTemplate: string | null; headcount: number; estHours: number; estManHours: number;
  equipmentHours: Record<string, number>; access?: string | null; dbh?: number | null;
}
export interface ReportEstimate {
  id: string; status: string; salespersonId: string | null; salespersonName?: string | null;
  sentAt?: string | null; approvedAt?: string | null; total: number; backlogWeeksAtSend?: number | null; items: ReportItem[];
}
export interface ReportPacket {
  estimateId: string; packageKey: string; crewTemplate: string | null; crewName?: string | null; estHours: number; estManHours: number;
  estEquipment: Record<string, number>; services: string[];
  actuals?: { hours?: number | null; manHours?: number | null; equipment?: Record<string, number>; expenses?: number | null; factors?: string[] } | null;
  completedAt?: string | null;
}
export interface ReportCost { estimateId: string; estimatedCost: number }

export interface Rate { key: string; label: string; value: number; n: number }
export interface Report {
  jobsWithActuals: number;
  manHours: { estimated: number; actual: number; diffPct: number | null };
  equipmentHours: { key: string; estimated: number; actual: number }[];
  revenuePerManHour: { overall: number | null; byCrew: Rate[]; byService: Rate[] };
  costs: { estimated: number; actual: number; marginByService: Rate[] } | null;
  winRate: { overall: number | null; byPriceBand: Rate[]; bySalesperson: Rate[]; byBacklog: Rate[] };
  overrides: { share: number | null; lowerShare: number | null; higherShare: number | null; winOverridden: number | null; winStandard: number | null; byReason: Rate[] };
  accuracy: { byEstimator: Rate[]; bySize: Rate[]; byAccess: Rate[]; byEquipment: Rate[] };
  insights: string[];
}

const pct = (a: number, b: number) => (b > 0 ? r2((a - b) / b) : null);
const share = (n: number, d: number) => (d > 0 ? r2(n / d) : null);
const decided = (e: ReportEstimate) => e.status === 'approved' || e.status === 'lost' || (e.status === 'archived' && !!e.approvedAt);
const won = (e: ReportEstimate) => e.status === 'approved' || (e.status === 'archived' && !!e.approvedAt);

function groupRate<T>(rows: T[], key: (r: T) => string | null, label: (k: string) => string, num: (rs: T[]) => number, den: (rs: T[]) => number): Rate[] {
  const g = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); if (k === null) continue; g.set(k, [...(g.get(k) ?? []), r]); }
  return [...g].map(([k, rs]) => { const d = den(rs); return { key: k, label: label(k), value: d > 0 ? r2(num(rs) / d) : 0, n: rs.length }; })
    .sort((a, b) => b.n - a.n);
}

function band(total: number): string {
  if (total < 1000) return 'under_1k';
  if (total < 2500) return '1k_2_5k';
  if (total < 5000) return '2_5k_5k';
  return '5k_plus';
}
const BAND_LABEL: Record<string, string> = { under_1k: 'Under $1,000', '1k_2_5k': '$1,000 to $2,499', '2_5k_5k': '$2,500 to $4,999', '5k_plus': '$5,000 and up' };
const backlogBand = (w: number | null | undefined) => (w === null || w === undefined ? null : w < 1 ? 'low' : w < 3 ? 'normal' : 'high');
const BACKLOG_LABEL: Record<string, string> = { low: 'Under 1 week booked', normal: '1 to 2 weeks booked', high: '3 or more weeks booked' };
const sizeBand = (dbh: number | null | undefined) => (dbh === null || dbh === undefined ? null : dbh < 18 ? 'small' : dbh < 30 ? 'medium' : 'large');
const SIZE_LABEL: Record<string, string> = { small: 'Under 18" DBH', medium: '18" to 29" DBH', large: '30" DBH and up' };

export function computeReports(input: { estimates: ReportEstimate[]; packets: ReportPacket[]; costs?: ReportCost[] | null; targetRate?: number | null; crewNames?: Record<string, string> }): Report {
  const { estimates, packets } = input;
  const byId = new Map(estimates.map((e) => [e.id, e]));
  const done = packets.filter((p) => p.actuals && (p.actuals.manHours ?? 0) > 0);
  const estMH = r2(done.reduce((s, p) => s + p.estManHours, 0));
  const actMH = r2(done.reduce((s, p) => s + (p.actuals?.manHours ?? 0), 0));

  const equip = new Map<string, { estimated: number; actual: number }>();
  for (const p of done) {
    for (const [k, h] of Object.entries(p.estEquipment)) { const e = equip.get(k) ?? { estimated: 0, actual: 0 }; e.estimated = r2(e.estimated + h); equip.set(k, e); }
    for (const [k, h] of Object.entries(p.actuals?.equipment ?? {})) { const e = equip.get(k) ?? { estimated: 0, actual: 0 }; e.actual = r2(e.actual + h); equip.set(k, e); }
  }

  // Revenue per actual man-hour: each packet's share of its estimate's sold price, by its share of the estimate's man-hours.
  const revenueOf = (p: ReportPacket) => {
    const e = byId.get(p.estimateId);
    if (!e) return 0;
    const all = packets.filter((x) => x.estimateId === p.estimateId).reduce((s, x) => s + x.estManHours, 0);
    return all > 0 ? (e.total * p.estManHours) / all : 0;
  };
  const crewLabel = (k: string) => input.crewNames?.[k] ?? k;
  const rph = (rs: ReportPacket[]) => rs.reduce((s, p) => s + revenueOf(p), 0);
  const mh = (rs: ReportPacket[]) => rs.reduce((s, p) => s + (p.actuals?.manHours ?? 0), 0);
  const overall = actMH > 0 ? r2(rph(done) / actMH) : null;

  let costs: Report['costs'] = null;
  if (input.costs) {
    const cmap = new Map(input.costs.map((c) => [c.estimateId, c.estimatedCost]));
    const ests = [...new Set(done.map((p) => p.estimateId))];
    const estimated = r2(ests.reduce((s, id) => s + (cmap.get(id) ?? 0), 0));
    const actual = r2(done.reduce((s, p) => s + (p.actuals?.expenses ?? 0), 0));
    const items = estimates.filter(won).flatMap((e) => e.items.map((i) => ({ i, cost: cmap.get(e.id) ?? null, total: e.total })));
    const marginByService = groupRate(items, (x) => (x.cost === null ? null : x.i.serviceKey), (k) => items.find((x) => x.i.serviceKey === k)?.i.serviceName ?? k,
      (rs) => rs.reduce((s, x) => s + (x.i.price - (x.cost! * (x.total > 0 ? x.i.price / x.total : 0))), 0), (rs) => rs.reduce((s, x) => s + x.i.price, 0));
    costs = { estimated, actual, marginByService };
  }

  const dec = estimates.filter(decided);
  const winOf = (rs: ReportEstimate[]) => rs.filter(won).length;
  const overall2 = share(winOf(dec), dec.length);
  const items = dec.flatMap((e) => e.items.map((i) => ({ i, e })));
  const overridden = items.filter((x) => x.i.override?.material);
  const overrideEsts = new Set(overridden.map((x) => x.e.id));

  const accuracyRows = done.map((p) => {
    const e = byId.get(p.estimateId);
    const item = e?.items.find((i) => p.services.includes(i.serviceName) || p.services.includes(i.serviceKey));
    return { p, e, item };
  });
  const acc = (rs: { p: ReportPacket }[]) => {
    const est = rs.reduce((s, r) => s + r.p.estManHours, 0);
    const act = rs.reduce((s, r) => s + (r.p.actuals?.manHours ?? 0), 0);
    return est > 0 ? act / est : 0;
  };

  const equipmentRows: { p: ReportPacket; eq: string }[] = accuracyRows.flatMap((r) => Object.keys(r.p.estEquipment).map((k) => ({ p: r.p, eq: k })));

  const report: Report = {
    jobsWithActuals: done.length,
    manHours: { estimated: estMH, actual: actMH, diffPct: pct(actMH, estMH) },
    equipmentHours: [...equip].map(([key, v]) => ({ key, ...v })),
    revenuePerManHour: {
      overall,
      byCrew: groupRate(done, (p) => p.crewTemplate, crewLabel, rph, mh),
      byService: groupRate(done, (p) => p.packageKey, (k) => k, rph, mh),
    },
    costs,
    winRate: {
      overall: overall2,
      byPriceBand: groupRate(dec, (e) => band(e.total), (k) => BAND_LABEL[k], winOf, (rs) => rs.length),
      bySalesperson: groupRate(dec, (e) => e.salespersonId, (k) => dec.find((e) => e.salespersonId === k)?.salespersonName ?? 'Salesperson', winOf, (rs) => rs.length),
      byBacklog: groupRate(dec, (e) => backlogBand(e.backlogWeeksAtSend), (k) => BACKLOG_LABEL[k], winOf, (rs) => rs.length),
    },
    overrides: {
      share: share(overridden.length, items.length),
      lowerShare: share(overridden.filter((x) => x.i.override!.to < x.i.override!.from).length, items.length),
      higherShare: share(overridden.filter((x) => x.i.override!.to > x.i.override!.from).length, items.length),
      winOverridden: share(dec.filter((e) => overrideEsts.has(e.id) && won(e)).length, dec.filter((e) => overrideEsts.has(e.id)).length),
      winStandard: share(dec.filter((e) => !overrideEsts.has(e.id) && won(e)).length, dec.filter((e) => !overrideEsts.has(e.id)).length),
      byReason: groupRate(overridden, (x) => x.i.override!.reason ?? 'No reason', (k) => k, (rs) => rs.length, () => overridden.length),
    },
    accuracy: {
      byEstimator: groupRate(accuracyRows, (r) => r.e?.salespersonId ?? null, (k) => estimates.find((e) => e.salespersonId === k)?.salespersonName ?? 'Salesperson', (rs) => acc(rs), () => 1),
      bySize: groupRate(accuracyRows, (r) => sizeBand(r.item?.dbh), (k) => SIZE_LABEL[k], (rs) => acc(rs), () => 1),
      byAccess: groupRate(accuracyRows, (r) => r.item?.access ?? null, (k) => k.replace(/_/g, ' '), (rs) => acc(rs), () => 1),
      byEquipment: groupRate(equipmentRows, (r) => r.eq, (k) => k.replace(/_/g, ' '), (rs) => acc(rs), () => 1),
    },
    insights: [],
  };
  report.insights = insights(done, input.targetRate ?? null, crewLabel, revenueOf);
  return report;
}

/**
 * Sentences in the shape of Mark's example: "3-person climb crew removals: estimated 4.6 hours on average, actual 5.4,
 * underestimated by 17%. Realized $111 a man-hour against the $125 target. Most common factor: restricted rear access."
 */
function insights(done: ReportPacket[], target: number | null, crewLabel: (k: string) => string, revenueOf: (p: ReportPacket) => number): string[] {
  const out: string[] = [];
  const groups = new Map<string, ReportPacket[]>();
  for (const p of done) { const k = `${p.crewTemplate ?? 'unassigned'}|${p.packageKey}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  for (const [k, ps] of sorted) {
    if (ps.length < 3) continue;
    const [crew, pkg] = k.split('|');
    const est = ps.reduce((s, p) => s + p.estHours, 0) / ps.length;
    const act = ps.reduce((s, p) => s + (p.actuals?.hours ?? p.estHours), 0) / ps.length;
    if (est <= 0) continue;
    const diff = (act - est) / est;
    const parts = [`${crewLabel(crew)} ${pkg} jobs: estimated ${r2(est).toFixed(1)} hours on average, actual ${r2(act).toFixed(1)}`];
    if (Math.abs(diff) >= 0.05) parts[0] += `, ${diff > 0 ? 'underestimated' : 'overestimated'} by ${Math.round(Math.abs(diff) * 100)}%`;
    parts[0] += '.';
    const mh = ps.reduce((s, p) => s + (p.actuals?.manHours ?? 0), 0);
    const rev = ps.reduce((s, p) => s + revenueOf(p), 0);
    if (mh > 0 && rev > 0) parts.push(`Realized ${dollars(Math.round(rev / mh))} a man-hour${target ? ` against the ${dollars(target)} target` : ''}.`);
    const factors = new Map<string, number>();
    for (const p of ps) for (const f of p.actuals?.factors ?? []) factors.set(f, (factors.get(f) ?? 0) + 1);
    const top = [...factors].sort((a, b) => b[1] - a[1])[0];
    if (top && diff > 0) parts.push(`Most common factor: ${top[0]}.`);
    out.push(parts.join(' '));
    if (out.length >= 5) break;
  }
  return out;
}
